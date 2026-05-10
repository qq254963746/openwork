import type { UIMessage } from "ai";

import type { OpenworkSessionSnapshot } from "../../../../app/lib/openwork-server";
import { mergeSnapshotAndLiveMessages, messageListContainsAll } from "../sync/message-merge";
import { snapshotToUIMessages } from "../sync/usechat-adapter";

export function resolveRenderedSessionSnapshot(input: {
  sessionId: string;
  currentSnapshot: OpenworkSessionSnapshot | null | undefined;
  cachedRendered: { sessionId: string; snapshot: OpenworkSessionSnapshot } | null | undefined;
}) {
  if (input.currentSnapshot?.session.id === input.sessionId) {
    return input.currentSnapshot;
  }
  if (
    input.cachedRendered?.sessionId === input.sessionId &&
    input.cachedRendered.snapshot.session.id === input.sessionId
  ) {
    return input.cachedRendered.snapshot;
  }
  return null;
}

/** Footer line for assistant replies: timing, usage, and model (from session snapshot). */
export type AssistantReplyFooterMeta = {
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
  tokenTotal?: number;
  modelKey: string;
};

function parseAssistantMetaFromSnapshot(
  snapshot: OpenworkSessionSnapshot | null | undefined,
): Map<string, AssistantReplyFooterMeta> {
  const map = new Map<string, AssistantReplyFooterMeta>();
  if (!snapshot?.messages?.length) return map;

  for (const row of snapshot.messages) {
    const info = row.info as {
      id?: string;
      role?: string;
      time?: { created?: number; completed?: number } | null;
      tokens?: {
        total?: number;
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number } | null;
      } | null;
      providerID?: string;
      modelID?: string;
    };

    if (info.role !== "assistant") continue;
    const id = typeof info.id === "string" ? info.id : "";
    if (!id) continue;

    const created = info.time?.created;
    if (typeof created !== "number" || !Number.isFinite(created)) continue;

    const completed = info.time?.completed;
    let durationMs: number | undefined;
    if (typeof completed === "number" && Number.isFinite(completed) && completed >= created) {
      durationMs = completed - created;
    }

    let tokenTotal: number | undefined;
    const tokens = info.tokens;
    if (tokens && typeof tokens === "object") {
      if (typeof tokens.total === "number" && tokens.total > 0) {
        tokenTotal = tokens.total;
      } else {
        const sum =
          (typeof tokens.input === "number" ? tokens.input : 0) +
          (typeof tokens.output === "number" ? tokens.output : 0) +
          (typeof tokens.reasoning === "number" ? tokens.reasoning : 0) +
          (typeof tokens.cache?.read === "number" ? tokens.cache.read : 0) +
          (typeof tokens.cache?.write === "number" ? tokens.cache.write : 0);
        if (sum > 0) tokenTotal = sum;
      }
    }

    const providerID = typeof info.providerID === "string" ? info.providerID : "";
    const modelID = typeof info.modelID === "string" ? info.modelID : "";
    const modelKey =
      providerID && modelID ? `${providerID}/${modelID}` : modelID || providerID || "—";

    map.set(id, {
      startedAtMs: created,
      finishedAtMs: typeof completed === "number" ? completed : undefined,
      durationMs,
      tokenTotal,
      modelKey,
    });
  }

  return map;
}

function aggregateAssistantRunMeta(
  runIds: string[],
  raw: Map<string, AssistantReplyFooterMeta>,
): AssistantReplyFooterMeta | null {
  const metas = runIds.map((mid) => raw.get(mid)).filter(Boolean) as AssistantReplyFooterMeta[];
  if (metas.length === 0) return null;

  const startedAtMs = Math.min(...metas.map((m) => m.startedAtMs));
  const finishedCandidates = metas
    .map((m) => m.finishedAtMs)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const finishedAtMs = finishedCandidates.length > 0 ? Math.max(...finishedCandidates) : undefined;

  let durationMs: number | undefined;
  if (typeof finishedAtMs === "number" && finishedAtMs >= startedAtMs) {
    durationMs = finishedAtMs - startedAtMs;
  } else {
    const sumDur = metas.reduce((acc, m) => acc + (m.durationMs ?? 0), 0);
    durationMs = sumDur > 0 ? sumDur : undefined;
  }

  const tokenSum = metas.reduce((acc, m) => acc + (m.tokenTotal ?? 0), 0);
  const tokenTotal = tokenSum > 0 ? tokenSum : undefined;

  const lastId = runIds[runIds.length - 1]!;
  const modelKey = raw.get(lastId)?.modelKey ?? metas[metas.length - 1]!.modelKey;

  return {
    startedAtMs,
    finishedAtMs,
    durationMs,
    tokenTotal,
    modelKey,
  };
}

/**
 * One entry per QA “assistant run”: only the **last** assistant message id in each
 * consecutive assistant segment maps to aggregated timing + summed tokens for the whole run.
 */
export function buildAssistantReplyFooterMetaMap(
  snapshot: OpenworkSessionSnapshot | null | undefined,
  orderedMessages: UIMessage[],
): ReadonlyMap<string, AssistantReplyFooterMeta> {
  const raw = parseAssistantMetaFromSnapshot(snapshot);
  const result = new Map<string, AssistantReplyFooterMeta>();

  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const lastId = run[run.length - 1]!;
    const aggregated = aggregateAssistantRunMeta(run, raw);
    if (aggregated) {
      result.set(lastId, aggregated);
    }
    run = [];
  };

  for (const message of orderedMessages) {
    if (message.role === "assistant") {
      run.push(message.id);
    } else {
      flush();
    }
  }
  flush();

  return result;
}

export function deriveRenderedSessionMessages(input: {
  transcriptState: UIMessage[] | null | undefined;
  snapshot: OpenworkSessionSnapshot | null | undefined;
  includeLiveOnlyMessages?: boolean;
}) {
  const liveMessages = input.transcriptState ?? [];
  const snapshotMessages = input.snapshot && input.snapshot.messages.length > 0
    ? snapshotToUIMessages(input.snapshot)
    : [];

  if (liveMessages.length > 0 && snapshotMessages.length === 0) return liveMessages;
  if (liveMessages.length === 0 && snapshotMessages.length > 0) return snapshotMessages;
  if (liveMessages.length > 0 && snapshotMessages.length > 0) {
    if (messageListContainsAll(liveMessages, snapshotMessages)) return liveMessages;
    return mergeSnapshotAndLiveMessages(snapshotMessages, liveMessages, {
      appendLiveOnlyMessages: input.includeLiveOnlyMessages,
    });
  }
  if (input.snapshot && input.snapshot.messages.length > 0) {
    return snapshotMessages;
  }
  return input.transcriptState ?? [];
}
