import type { UIMessage } from "ai";
import type { Part, PermissionRequest, QuestionRequest, SessionStatus, Todo } from "@aiwork-engine/sdk/v2/client";

import { getReactQueryClient } from "../../../infra/query-client";
import { createClient } from "../../../../app/lib/opencode";
import { normalizeEvent, safeStringify } from "../../../../app/utils";
import type { OpencodeEvent, PendingPermission, PendingQuestion } from "../../../../app/types";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../../../../app/types";
import { snapshotToUIMessages } from "./usechat-adapter";
import type { AiWorkSessionSnapshot } from "../../../../app/lib/aiwork-server";
import { mergeSnapshotIntoCachedMessages, messageListContainsAll } from "./message-merge";

type SyncOptions = {
  workspaceId: string;
  baseUrl: string;
  aiworkToken: string;
};

type PendingDelta = {
  sessionId: string;
  messageId: string;
  partId: string;
  reasoning: boolean;
  delta: string;
};

type SyncEntry = {
  refs: number;
  dispose: () => void;
  pendingDeltas: Map<string, { messageId: string; reasoning: boolean; text: string }>;
  /** Mirrors OpenCode part kinds so `message.part.delta` with `field: "text"` can target reasoning parts (same as usechat-adapter). */
  partKinds: Map<string, Part["type"]>;
  // Coalesce rapid-fire delta events from the SSE stream into one cache
  // commit per animation frame. Without this, a long response produces a
  // setQueryData per token; each triggers a full transcript re-render
  // (~27ms on large sessions) which starves the main thread and looks to
  // the user like the app "freezes after 2 words."
  deltaFlushBuffer: PendingDelta[];
  deltaFlushScheduled: boolean;
};

const idleStatus: SessionStatus = { type: "idle" };
const syncs = new Map<string, SyncEntry>();

function buildLocalAssistantErrorMessage(text: string): UIMessage {
  return {
    id: `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    parts: [{ type: "text", text, state: "done" }],
  };
}

function formatSessionErrorText(details: { type?: string | null; message?: string | null }) {
  const type = (details.type ?? "").trim();
  const message = (details.message ?? "").trim();
  const header = "Request failed.";
  if (type && message) return `${header}\n\n[${type}]: ${message}`;
  if (type) return `${header}\n\n[${type}]`;
  if (message) return `${header}\n\n${message}`;
  return header;
}

function extractSessionErrorDetails(error: unknown): { type?: string; message?: string } {
  if (!error) return {};
  if (typeof error === "string") return { message: error };
  if (error instanceof Error) return { message: error.message || safeStringify(error) };
  if (typeof error !== "object") return { message: String(error) };

  const record = error as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  const message = typeof record.message === "string" ? record.message : undefined;
  if ((type?.trim() || message?.trim()) && (type?.trim() || message?.trim())) {
    // don't early-return; nested may have better message/type
  }

  if ("error" in record) {
    const nested = extractSessionErrorDetails(record.error);
    if ((nested.type?.trim() || nested.message?.trim()) && (!type || !message)) {
      return { type: nested.type ?? type, message: nested.message ?? message };
    }
  }

  if ("data" in record) {
    const nested = extractSessionErrorDetails(record.data);
    if ((nested.type?.trim() || nested.message?.trim()) && (!type || !message)) {
      return { type: nested.type ?? type, message: nested.message ?? message };
    }
  }

  const responseBody = typeof record.responseBody === "string" ? record.responseBody : "";
  if (responseBody.trim()) {
    try {
      const parsed = JSON.parse(responseBody) as any;
      const parsedType =
        typeof parsed?.error?.type === "string"
          ? parsed.error.type
          : typeof parsed?.type === "string"
            ? parsed.type
            : undefined;
      const parsedMessage =
        typeof parsed?.error?.message === "string"
          ? parsed.error.message
          : typeof parsed?.message === "string"
            ? parsed.message
            : undefined;
      if (parsedType?.trim() || parsedMessage?.trim()) {
        return { type: parsedType ?? type, message: parsedMessage ?? message };
      }
    } catch {
      return { type, message: responseBody };
    }
  }

  const fallback = safeStringify(error);
  return { type, message: message ?? fallback };
}

export const transcriptKey = (workspaceId: string, sessionId: string) =>
  ["react-session-transcript", workspaceId, sessionId] as const;
export const statusKey = (workspaceId: string, sessionId: string) =>
  ["react-session-status", workspaceId, sessionId] as const;
export const todoKey = (workspaceId: string, sessionId: string) =>
  ["react-session-todos", workspaceId, sessionId] as const;
export const permissionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-permissions", workspaceId, sessionId] as const;
export const questionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-questions", workspaceId, sessionId] as const;

/**
 * Per-session "revert barrier": when a session is reverted, the SSE pipe may
 * still flush late events for messages that are now discarded server-side.
 * If those events sneak through `upsertMessage` / `upsertPart`, the discarded
 * conversation re-materializes in the cache.
 *
 * The barrier holds an explicit set of messageIDs the caller wants ignored
 * (typically every messageID at-or-after the revert point at the moment
 * `revertSession` was called). The barrier auto-expires so it doesn't leak.
 *
 * We deliberately track an explicit ID set rather than a "drop everything
 * with id >= X" threshold, because new user/assistant messages sent after
 * the revert have IDs that are also > X (ULIDs are time-ordered) and must
 * NOT be filtered.
 */
type RevertBarrier = {
  blockedIds: Set<string>;
  expiresAt: number;
};
const revertBarriers = new Map<string, RevertBarrier>();
const REVERT_BARRIER_TTL_MS = 8000;

export function setSessionRevertBarrier(
  workspaceId: string,
  sessionId: string,
  blockedIds: Iterable<string>,
): void {
  const key = `${workspaceId}::${sessionId}`;
  revertBarriers.set(key, {
    blockedIds: new Set(blockedIds),
    expiresAt: Date.now() + REVERT_BARRIER_TTL_MS,
  });
}

export function clearSessionRevertBarrier(workspaceId: string, sessionId: string): void {
  revertBarriers.delete(`${workspaceId}::${sessionId}`);
}

function shouldDropMessageDueToBarrier(
  workspaceId: string,
  sessionId: string,
  messageID: string,
): boolean {
  const key = `${workspaceId}::${sessionId}`;
  const entry = revertBarriers.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    revertBarriers.delete(key);
    return false;
  }
  return entry.blockedIds.has(messageID);
}

function syncKey(input: SyncOptions) {
  return `${input.workspaceId}:${input.baseUrl}:${input.aiworkToken}`;
}

function hydratePartKindsForWorkspace(workspaceId: string, messages: UIMessage[]) {
  const prefix = `${workspaceId}:`;
  for (const [key, entry] of syncs) {
    if (!key.startsWith(prefix)) continue;
    for (const message of messages) {
      for (const part of message.parts) {
        const id = getPartMetadataId(part);
        if (!id) continue;
        if (part.type === "reasoning") entry.partKinds.set(id, "reasoning");
        else if (part.type === "text") entry.partKinds.set(id, "text");
        else if (part.type === "file") entry.partKinds.set(id, "file");
      }
    }
  }
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: { status?: unknown };
  };
  const status = record.status ?? record.response?.status ?? record.cause?.status;
  return typeof status === "number" ? status : null;
}

function shouldRetrySyncSubscribe(error: unknown) {
  const status = getErrorStatus(error);
  return status !== 401 && status !== 403 && status !== 404;
}

function withReceivedAt(permission: PermissionRequest, receivedAt: number): PendingPermission {
  return { ...permission, receivedAt };
}

function sortPermissions(a: PendingPermission, b: PendingPermission) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

function withQuestionReceivedAt(question: QuestionRequest, receivedAt: number): PendingQuestion {
  return { ...question, receivedAt };
}

function sortQuestions(a: PendingQuestion, b: PendingQuestion) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

export function seedPermissionState(
  workspaceId: string,
  sessionId: string,
  permissions: PermissionRequest[],
  options: { snapshotStartedAt?: number } = {},
) {
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((permission) => [permission.id, permission.receivedAt]));
    const seeded = permissions
      .filter((permission) => permission.sessionID === sessionId)
      .map((permission) => withReceivedAt(permission, receivedAtById.get(permission.id) ?? now));
    const seededIds = new Set(seeded.map((permission) => permission.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (permission) =>
              permission.sessionID === sessionId &&
              permission.receivedAt > snapshotStartedAt &&
              !seededIds.has(permission.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortPermissions);
  });
}

export function seedQuestionState(
  workspaceId: string,
  sessionId: string,
  questions: QuestionRequest[],
  options: { snapshotStartedAt?: number } = {},
) {
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((question) => [question.id, question.receivedAt]));
    const seeded = questions
      .filter((question) => question.sessionID === sessionId)
      .map((question) => withQuestionReceivedAt(question, receivedAtById.get(question.id) ?? now));
    const seededIds = new Set(seeded.map((question) => question.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (question) =>
              question.sessionID === sessionId &&
              question.receivedAt > snapshotStartedAt &&
              !seededIds.has(question.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortQuestions);
  });
}

function toUIPart(part: Part): UIMessage["parts"][number] | null {
  if (part.type === "text") {
    return {
      type: "text",
      text: typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "",
      state: "done",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "reasoning") {
    return {
      type: "reasoning",
      text: typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "",
      state: "done",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "file") {
    const file = part as Part & { url?: string; filename?: string; mime?: string };
    if (!file.url) return null;
    return {
      type: "file",
      url: file.url,
      filename: file.filename,
      mediaType: file.mime ?? "application/octet-stream",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "tool") {
    const record = part as Part & { tool?: string; state?: Record<string, unknown> };
    const state = record.state ?? {};
    const toolName = typeof record.tool === "string" ? record.tool : "tool";
    if (typeof state.error === "string" && state.error.trim()) {
      return {
        type: "dynamic-tool",
        toolName,
        toolCallId: part.id,
        state: "output-error",
        input: state.input,
        errorText: state.error,
      };
    }
    if (state.output !== undefined) {
      return {
        type: "dynamic-tool",
        toolName,
        toolCallId: part.id,
        state: "output-available",
        input: state.input,
        output: state.output,
      };
    }
    return {
      type: "dynamic-tool",
      toolName,
      toolCallId: part.id,
      state: "input-available",
      input: state.input,
    };
  }
  if (part.type === "step-start") return { type: "step-start" };
  return null;
}

function getPartMetadataId(part: UIMessage["parts"][number]) {
  if (part.type !== "text" && part.type !== "reasoning" && part.type !== "file") return null;
  const metadata = part.providerMetadata?.opencode;
  if (!metadata || typeof metadata !== "object") return null;
  return "partId" in metadata ? (metadata as { partId?: string }).partId ?? null : null;
}

function upsertMessage(messages: UIMessage[], next: UIMessage) {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index === -1) return [...messages, next];
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          ...next,
          parts: next.parts.length > 0 ? next.parts : message.parts,
        }
      : message,
  );
}

/**
 * When a message.part.updated or message.part.delta event arrives for a
 * messageID we haven't seen a message.updated for yet, we have to stub the
 * message so the part has somewhere to live. The stub's role used to be
 * hard-coded to "assistant", which meant that if part events beat the
 * message.updated event for a *user* turn (a common race during
 * promptAsync), that user message flashed as an assistant-styled block
 * until the real role arrived a tick later.
 *
 * Infer the stub role from the conversation instead. Chat sessions
 * alternate, so the new message is almost always the opposite role of the
 * most recent known message. If the transcript is empty the first message
 * is always the user's.
 */
function inferStubRole(messages: UIMessage[]): UIMessage["role"] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "user";
  if (lastMessage.role === "user") return "assistant";
  if (lastMessage.role === "assistant") return "user";
  return "assistant";
}

function upsertPart(messages: UIMessage[], messageId: string, partId: string, next: UIMessage["parts"][number]) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const index = message.parts.findIndex((part) =>
      ("toolCallId" in part && part.toolCallId === partId) || getPartMetadataId(part) === partId,
    );
    if (index === -1) {
      return { ...message, parts: [...message.parts, next] };
    }
    const parts = message.parts.slice();
    parts[index] = next;
    return { ...message, parts };
  });
}

function resolveDeltaTargetsReasoning(entry: SyncEntry, messages: UIMessage[], item: PendingDelta): boolean {
  if (item.reasoning) return true;
  const kind = entry.partKinds.get(item.partId);
  if (kind === "reasoning") return true;
  if (kind === "text" || kind === "tool" || kind === "file" || kind === "step-start") return false;
  const msg = messages.find((m) => m.id === item.messageId);
  const hit = msg?.parts.find((p) => getPartMetadataId(p) === item.partId);
  return hit?.type === "reasoning";
}

function appendDelta(messages: UIMessage[], messageId: string, partId: string, delta: string, reasoning: boolean) {
  // Fast path: locate the target message by index, only clone that message
  // and its parts array. The previous implementation ran messages.map AND
  // message.parts.map on every delta event, which is O(N * P) per token.
  // For an old session with hundreds of prior messages/parts that allocated
  // thousands of objects per token and crushed the main thread after a
  // handful of tokens.
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) return messages;

  const target = messages[messageIndex]!;
  const lastPart = target.parts[target.parts.length - 1];

  let partIndex = -1;
  for (let i = 0; i < target.parts.length; i++) {
    const part = target.parts[i]!;
    const id = getPartMetadataId(part);
    if (reasoning && part.type === "reasoning") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    } else if (!reasoning && part.type === "text") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    }
  }

  let nextParts: UIMessage["parts"];
  if (partIndex === -1) {
    // No existing matching part — append a fresh one so the delta is not lost.
    const newPart: UIMessage["parts"][number] = reasoning
      ? {
          type: "reasoning",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { opencode: { partId } },
        }
      : {
          type: "text",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { opencode: { partId } },
        };
    nextParts = target.parts.slice();
    nextParts.push(newPart);
  } else {
    const existing = target.parts[partIndex]!;
    nextParts = target.parts.slice();
    if (existing.type === "text") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    } else if (existing.type === "reasoning") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    }
  }

  const nextMessages = messages.slice();
  nextMessages[messageIndex] = { ...target, parts: nextParts };
  return nextMessages;
}

function applyEvent(entry: SyncEntry, workspaceId: string, event: OpencodeEvent) {
  const queryClient = getReactQueryClient();

  if (event.type === "session.error") {
    const props = (event.properties ?? {}) as { sessionID?: string; error?: unknown };
    const sessionId = typeof props.sessionID === "string" ? props.sessionID : "";
    if (!sessionId) return;
    const details = extractSessionErrorDetails(props.error);
    const text = formatSessionErrorText({
      type: details.type,
      message: details.message || "Session failed",
    });
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, sessionId), (current = []) => {
      const last = current[current.length - 1];
      const lastText =
        last?.role === "assistant"
          ? last.parts
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("")
              .trim()
          : "";
      if (lastText && lastText === text.trim()) return current;
      return [...current, buildLocalAssistantErrorMessage(text)];
    });
    queryClient.setQueryData(statusKey(workspaceId, sessionId), idleStatus);
    return;
  }

  if (event.type === "session.status") {
    const props = (event.properties ?? {}) as { sessionID?: string; status?: SessionStatus };
    if (!props.sessionID || !props.status) return;
    queryClient.setQueryData(statusKey(workspaceId, props.sessionID), props.status);
    return;
  }

  if (event.type === "todo.updated") {
    const props = (event.properties ?? {}) as { sessionID?: string; todos?: Todo[] };
    if (!props.sessionID || !props.todos) return;
    queryClient.setQueryData(todoKey(workspaceId, props.sessionID), props.todos);
    return;
  }

  if (event.type === "permission.asked") {
    const permission = event.properties as PermissionRequest;
    if (!permission?.id || !permission.sessionID) return;
    const receivedAt = Date.now();
    queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, permission.sessionID), (current = []) => {
      const existing = current.find((item) => item.id === permission.id);
      const next = withReceivedAt(permission, existing?.receivedAt ?? receivedAt);
      if (existing) {
        return current.map((item) => (item.id === permission.id ? next : item)).sort(sortPermissions);
      }
      return [...current, next].sort(sortPermissions);
    });
    return;
  }

  if (event.type === "permission.replied") {
    const props = (event.properties ?? {}) as { sessionID?: string; requestID?: string };
    if (!props.sessionID || !props.requestID) return;
    queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, props.sessionID), (current = []) =>
      current.filter((permission) => permission.id !== props.requestID),
    );
    return;
  }

  if (event.type === "question.asked") {
    const question = event.properties as QuestionRequest;
    if (!question?.id || !question.sessionID) return;
    const receivedAt = Date.now();
    queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, question.sessionID), (current = []) => {
      const existing = current.find((item) => item.id === question.id);
      const next = withQuestionReceivedAt(question, existing?.receivedAt ?? receivedAt);
      if (existing) {
        return current.map((item) => (item.id === question.id ? next : item)).sort(sortQuestions);
      }
      return [...current, next].sort(sortQuestions);
    });
    return;
  }

  if (event.type === "question.replied") {
    const props = (event.properties ?? {}) as { sessionID?: string; requestID?: string };
    if (!props.sessionID || !props.requestID) return;
    queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, props.sessionID), (current = []) =>
      current.filter((question) => question.id !== props.requestID),
    );
    return;
  }

  if (event.type === "message.updated") {
    const props = (event.properties ?? {}) as { info?: { id?: string; role?: UIMessage["role"] | string; sessionID?: string } };
    const info = props.info;
    if (!info?.id || !info.sessionID || (info.role !== "user" && info.role !== "assistant" && info.role !== "system")) {
      return;
    }
    if (shouldDropMessageDueToBarrier(workspaceId, info.sessionID, info.id)) return;
    const next = { id: info.id, role: info.role, parts: [] } satisfies UIMessage;
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, info.sessionID), (current = []) =>
      upsertMessage(current, next),
    );
    return;
  }

  if (event.type === "message.part.updated") {
    const props = (event.properties ?? {}) as { part?: Part };
    const part = props.part;
    if (!part?.sessionID || !part.messageID) return;
    if (shouldDropMessageDueToBarrier(workspaceId, part.sessionID, part.messageID)) return;
    entry.partKinds.set(part.id, part.type);
    const mapped = toUIPart(part);
    if (!mapped) return;
    const pending = entry.pendingDeltas.get(part.id);
    const seededPart =
      pending && ((mapped.type === "text" && !pending.reasoning) || (mapped.type === "reasoning" && pending.reasoning))
        ? { ...mapped, text: `${mapped.text}${pending.text}`, state: "streaming" as const }
        : mapped;
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, part.sessionID), (current = []) => {
      // If we already have this message, keep its role; otherwise infer
      // from the alternation pattern. Only the newly-stubbed case needs
      // the inference — upsertMessage preserves existing role when the
      // stub's role matches what we'd write anyway, and any subsequent
      // message.updated will overwrite both.
      const existing = current.find((m) => m.id === part.messageID);
      const role = existing?.role ?? inferStubRole(current);
      const withMessage = upsertMessage(current, { id: part.messageID, role, parts: [] });
      return upsertPart(withMessage, part.messageID, part.id, seededPart);
    });
    if (pending) entry.pendingDeltas.delete(part.id);
    return;
  }

  if (event.type === "message.part.delta") {
    const props = (event.properties ?? {}) as {
      sessionID?: string;
      messageID?: string;
      partID?: string;
      field?: string;
      delta?: string;
    };
    if (!props.sessionID || !props.messageID || !props.partID || !props.delta) return;
    if (shouldDropMessageDueToBarrier(workspaceId, props.sessionID, props.messageID)) return;
    const field = typeof props.field === "string" ? props.field : "text";
    const kind = entry.partKinds.get(props.partID);
    const isReasoningDelta = field === "reasoning" || (field === "text" && kind === "reasoning");
    // Buffer this delta and let the frame flusher apply all queued deltas
    // for this entry in a single setQueryData call per affected session.
    entry.deltaFlushBuffer.push({
      sessionId: props.sessionID!,
      messageId: props.messageID!,
      partId: props.partID!,
      reasoning: isReasoningDelta,
      delta: props.delta!,
    });
    scheduleDeltaFlush(entry, workspaceId);
    return;
  }

  if (event.type === "session.idle") {
    const props = (event.properties ?? {}) as { sessionID?: string };
    if (!props.sessionID) return;
    queryClient.setQueryData(statusKey(workspaceId, props.sessionID), idleStatus);
  }
}

function scheduleDeltaFlush(entry: SyncEntry, workspaceId: string) {
  if (entry.deltaFlushScheduled) return;
  entry.deltaFlushScheduled = true;
  const run = () => {
    entry.deltaFlushScheduled = false;
    if (entry.deltaFlushBuffer.length === 0) return;
    flushDeltas(entry, workspaceId);
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

function flushDeltas(entry: SyncEntry, workspaceId: string) {
  const queryClient = getReactQueryClient();
  const pending = entry.deltaFlushBuffer;
  entry.deltaFlushBuffer = [];

  // Group by session id so each transcript cache is touched at most once
  // per flush.
  const bySession = new Map<string, PendingDelta[]>();
  for (const item of pending) {
    const bucket = bySession.get(item.sessionId);
    if (bucket) bucket.push(item);
    else bySession.set(item.sessionId, [item]);
  }

  for (const [sessionId, items] of bySession) {
    queryClient.setQueryData<UIMessage[]>(
      transcriptKey(workspaceId, sessionId),
      (current = []) => {
        let next = current;
        // Track which message shells we've ensured exist this flush so we
        // don't call upsertMessage for the same message on every delta.
        const ensuredMessageIds = new Set<string>();
        for (const item of items) {
          if (!ensuredMessageIds.has(item.messageId)) {
            // Preserve the existing role if the message is already in
            // state; otherwise infer it from the alternation pattern
            // so the brief "stub before message.updated" window doesn't
            // mislabel the message's bubble style.
            const existing = next.find((m) => m.id === item.messageId);
            const role = existing?.role ?? inferStubRole(next);
            next = upsertMessage(next, { id: item.messageId, role, parts: [] });
            ensuredMessageIds.add(item.messageId);
          }
          const reasoningDelta = resolveDeltaTargetsReasoning(entry, next, item);
          next = appendDelta(next, item.messageId, item.partId, item.delta, reasoningDelta);
          // If the delta landed on a synthetic "no matching part" case, keep
          // the text so a later message.part.updated event can stitch it.
          const message = next.find((m) => m.id === item.messageId);
          const matched = message?.parts.some((part) =>
            (part.type === "dynamic-tool" && part.toolCallId === item.partId) ||
              getPartMetadataId(part) === item.partId,
          );
          if (!matched) {
            const existing = entry.pendingDeltas.get(item.partId) ?? {
              messageId: item.messageId,
              reasoning: reasoningDelta,
              text: "",
            };
            existing.text += item.delta;
            entry.pendingDeltas.set(item.partId, existing);
          }
        }
        return next;
      },
    );
  }
}

function startSync(input: SyncOptions) {
  const client = createClient(input.baseUrl, undefined, { token: input.aiworkToken, mode: "aiwork" });
  const controller = new AbortController();
  const entry = syncs.get(syncKey(input));
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelayMs = 1_000;

  const scheduleRetry = () => {
    if (disposed || controller.signal.aborted || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
  };

  const connect = async () => {
    try {
      const sub = await client.event.subscribe(undefined, { signal: controller.signal });
      retryDelayMs = 1_000;
      for await (const raw of sub.stream) {
        if (controller.signal.aborted) return;
        const event = normalizeEvent(raw);
        if (!event) continue;
        if (!entry) continue;
        applyEvent(entry, input.workspaceId, event);
      }
      if (!controller.signal.aborted) scheduleRetry();
    } catch (error) {
      if (!controller.signal.aborted && shouldRetrySyncSubscribe(error)) scheduleRetry();
    }
  };

  void connect();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller.abort();
  };
}

export function ensureWorkspaceSessionSync(input: SyncOptions) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (existing) {
    existing.refs += 1;
    return () => releaseWorkspaceSessionSync(input);
  }

  syncs.set(key, {
    refs: 1,
    dispose: () => {},
    pendingDeltas: new Map(),
    partKinds: new Map(),
    deltaFlushBuffer: [],
    deltaFlushScheduled: false,
  });

  const created = syncs.get(key)!;
  created.dispose = startSync(input);

  return () => releaseWorkspaceSessionSync(input);
}

function releaseWorkspaceSessionSync(input: SyncOptions) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (!existing) return;
  existing.refs -= 1;
  if (existing.refs > 0) return;
  // Immediate disposal is important here: a single OpenCode runtime is shared
  // across local workspaces, and keeping old workspace subscriptions alive for
  // 10s means rapid workspace switches accumulate multiple parallel event
  // streams. Under larger transcripts that duplicates cache writes and can make
  // the UI feel frozen after a handful of switches.
  existing.dispose();
  syncs.delete(key);
}

export function seedSessionState(workspaceId: string, snapshot: AiWorkSessionSnapshot) {
  const queryClient = getReactQueryClient();
  const key = transcriptKey(workspaceId, snapshot.session.id);
  const incoming = snapshotToUIMessages(snapshot);
  const existing = queryClient.getQueryData<UIMessage[]>(key);

  if (
    existing &&
    existing.length > 0 &&
    (
      snapshot.status.type === "busy" ||
      snapshot.status.type === "retry" ||
      (existing.length > incoming.length && messageListContainsAll(existing, incoming))
    )
  ) {
    // During active streaming the server snapshot may have empty/stale text
    // for in-progress parts while the cache already accumulated text via
    // deltas.  Merge so we never overwrite longer cached text with shorter
    // server text. Also preserve a longer cache when a remount first sees an
    // older snapshot before the fresh snapshot request returns.
    const merged = mergeSnapshotIntoCachedMessages(incoming, existing);
    queryClient.setQueryData(key, merged);
  } else {
    queryClient.setQueryData(key, incoming);
  }

  const seededMessages = queryClient.getQueryData<UIMessage[]>(key) ?? incoming;
  hydratePartKindsForWorkspace(workspaceId, seededMessages);

  queryClient.setQueryData(statusKey(workspaceId, snapshot.session.id), snapshot.status);
  queryClient.setQueryData(todoKey(workspaceId, snapshot.session.id), snapshot.todos);
}

/** Clears permission prompt cache when navigating away from a session (UI scope). */
export function trackWorkspaceSessionSync(input: SyncOptions, sessionId: string | null | undefined) {
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (!normalizedSessionId) return () => {};

  return () => {
    const queryClient = getReactQueryClient();
    queryClient.removeQueries({ queryKey: permissionKey(input.workspaceId, normalizedSessionId), exact: true });
    queryClient.removeQueries({ queryKey: questionKey(input.workspaceId, normalizedSessionId), exact: true });
  };
}
