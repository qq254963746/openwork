/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import { abortSessionSafe } from "../../../../app/lib/opencode-session";
import { readWorkspaceCloudImports, type CloudImportedPlugin } from "../../../../app/cloud/import-state";
import type {
  AiWorkServerClient,
  AiWorkSessionSnapshot,
} from "../../../../app/lib/aiwork-server";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerPart,
  McpServerEntry,
  McpStatusMap,
  SkillCard,
} from "../../../../app/types";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "../../../shell/app-inspector";
import { useControlAction, type AiWorkControlAction } from "../../../shell/control/control-provider";
import { getReactQueryClient } from "../../../infra/query-client";
import { ReactSessionComposer } from "./composer/composer";
import { DevProfiler } from "../../../shell/dev-profiler";
import { Loader2 } from "lucide-react";
import { dlsPrimarySolidClass } from "../../workspace/modal-styles";

import { t } from "../../../../i18n";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import type { ReactComposerNotice } from "./composer/notice";
import {
  SessionWorkspacePanel,
  type SessionWorkspacePanelHandle,
} from "./session-workspace-panel";
import { SessionDebugPanel } from "./debug-panel";
import {
  buildAssistantReplyFooterMetaMap,
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import { SessionTranscript } from "./message-list";
import { deriveSessionRenderModel } from "../sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import {
  seedSessionState,
  questionKey as reactQuestionKey,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
  todoKey as reactTodoKey,
} from "../sync/session-sync";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../../../../app/types";
import type { TodoItem } from "../../../../app/types";

const EMPTY_TRANSCRIPT: UIMessage[] = [];
const IDLE_STATUS: SessionStatus = { type: "idle" };
const DEFAULT_COMPOSER_CONTROL_TEXT = "Help me outline the next AiWork task.";
const JUMP_TO_LATEST_BOX_SHADOW =
  "0 2px 4px 0 rgba(0,0,0,0.03), 0 4px 10px 0 rgba(0,0,0,0.05), 0 4px 16px 0 rgba(0,0,0,0.05)";

/** Soft shadow along the top edge of the composer stack (separates from transcript). Theme-aware via CSS variable. */
const COMPOSER_SHELL_TOP_SHADOW = "var(--composer-shell-top-shadow)";

function JumpToLatestGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      stroke="currentColor"
      className={`box-border inline-block size-6 p-[3px] text-[18px] leading-none ${props.className ?? ""}`.trim()}
      style={{ fontSize: "18px" }}
      aria-hidden
    >
      <path
        d="M18.5651 13.9344C18.8775 14.2468 18.8775 14.7528 18.5651 15.0652L13.274 20.3562C12.5731 21.0571 11.4321 21.063 10.7272 20.3582L5.4342 15.0652C5.1219 14.7528 5.1219 14.2468 5.4342 13.9344C5.74659 13.622 6.25264 13.622 6.56506 13.9344L11.1998 18.5691L11.1998 2.9998C11.1998 2.55803 11.5579 2.2001 11.9996 2.2C12.4415 2.2 12.7994 2.55797 12.7994 2.9998L12.7994 18.5691L17.4342 13.9344C17.7466 13.622 18.2526 13.622 18.5651 13.9344Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.8}
        vectorEffect="nonScalingStroke"
      />
    </svg>
  );
}

type SessionError = {
  message: string;
  kind?: "model-not-found" | "generic";
  /** For model-not-found: the model that failed. */
  failedModel?: { providerID: string; modelID: string };
  /** For model-not-found: suggested replacements from the backend. */
  suggestions?: Array<{ providerID: string; modelID: string }>;
};

export type SessionSurfaceProps = {
  client: AiWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  opencodeBaseUrl: string;
  aiworkToken: string;
  developerMode: boolean;
  /** When true, assistant `reasoning` parts render in the Thinking collapsible (Settings → Show model reasoning). */
  showThinking?: boolean;
  modelLabel: string;
  onModelClick: () => void;
  onSendDraft: (draft: ComposerDraft) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<import("@opencode-ai/sdk/v2/client").Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<import("../../../../app/types").SlashCommandOption[]>;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onUploadInboxFiles?: ((files: File[], options?: { notify?: boolean }) => void | Promise<unknown>) | null;
  onOpenSettingsSection?: ((section: "commands" | "skills" | "mcps" | "plugins") => void) | undefined;
  /** Right column (workspace files / context): visibility is controlled only via SessionPage toggle, not breakpoints. */
  workspaceSidePanelOpen: boolean;
  /** Opens the workspace side panel (e.g. before routing a transcript “View file” action into {@link SessionWorkspacePanel}). */
  requestWorkspaceSidePanelOpen?: () => void;
  /** Pending inline question prompt (AskQuestion). */
  activeQuestion?: { id: string; questions: QuestionInfo[] } | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
};

function messageToReadableText(message: UIMessage) {
  const header = message.role === "user" ? "You" : message.role === "assistant" ? "AiWork" : message.role;
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "dynamic-tool") {
        if (part.state === "output-error") return [`[tool:${part.toolName}] ${part.errorText}`];
        if (part.state === "output-available") return [`[tool:${part.toolName}] ${JSON.stringify(part.output)}`];
        return [`[tool:${part.toolName}] ${JSON.stringify(part.input)}`];
      }
      return [];
    })
    .join("\n\n");
  return `${header}\n${body}`.trim();
}

function transcriptToText(messages: UIMessage[]) {
  return messages
    .map(messageToReadableText)
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function statusLabel(snapshot: AiWorkSessionSnapshot | undefined, busy: boolean) {
  if (busy) return "Running...";
  if (snapshot?.status.type === "busy") return "Running...";
  if (snapshot?.status.type === "retry") return `Retrying: ${snapshot.status.message}`;
  return "Ready";
}

function controlTextArgument(args: unknown) {
  if (typeof args === "string") return args;
  if (args && typeof args === "object" && "text" in args) {
    const text = (args as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return DEFAULT_COMPOSER_CONTROL_TEXT;
}

const waitForControl = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function useSharedQueryState<T>(queryKey: readonly unknown[], fallback: T) {
  const queryClient = getReactQueryClient();
  // useSyncExternalStore requires getSnapshot to return the same reference
  // while the external store has not changed. Callers must pass stable
  // fallbacks for empty cache states.
  return useSyncExternalStore(
    (callback) => queryClient.getQueryCache().subscribe(callback),
    () => (queryClient.getQueryData<T>(queryKey) ?? fallback),
    () => fallback,
  );
}

function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function AssistantWaitingCard() {
  return (
    <div className="-mt-10 flex justify-center py-2" role="status" aria-live="polite" aria-busy="true">
      <span className="relative inline-flex items-center justify-center">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-gray-9" strokeWidth={2} aria-hidden />
        <span className="sr-only">{t("session.assistant_reply_loading")}</span>
      </span>
    </div>
  );
}

function parseSessionError(thrown: unknown): SessionError {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  // Try to detect ProviderModelNotFoundError from the SDK error shape.
  // The error message may be a JSON string from our serializer in session-route.
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.name === "ProviderModelNotFoundError" && parsed?.data) {
      const { providerID, modelID, suggestions } = parsed.data;
      return {
        message: `Model ${providerID}/${modelID} is not available.`,
        kind: "model-not-found",
        failedModel: { providerID, modelID },
        suggestions: Array.isArray(suggestions) ? suggestions : [],
      };
    }
  } catch {
    // Not JSON — fall through to plain message
  }
  // Check if the raw string mentions model-not-found patterns
  if (/ProviderModelNotFoundError/i.test(raw) || /model.*not found/i.test(raw)) {
    return { message: raw, kind: "model-not-found" };
  }
  return { message: raw || "Failed to send prompt." };
}

function formatSessionErrorMessage(error: SessionError) {
  const detail = (error.message ?? "").trim();
  if (!detail) return "Request failed.";
  return `Request failed.\n\n${detail}`;
}

function buildLocalAssistantErrorMessage(text: string): UIMessage {
  return {
    id: `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    parts: [{ type: "text", text, state: "done" }],
  };
}

function SessionErrorCard({ error, onDismiss, onChangeModel, onOpenModelPicker }: {
  error: SessionError;
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  return (
    <div className="mx-auto max-w-[800px] px-3 py-3 sm:px-5">
      <div className="rounded-2xl border border-red-6/30 bg-red-3/15 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-red-11">{error.message}</div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0 ? (
                  error.suggestions.map((s) => (
                    <button
                      key={`${s.providerID}/${s.modelID}`}
                      type="button"
                      className="rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                      onClick={() => {
                        onChangeModel?.(s);
                        onDismiss();
                      }}
                    >
                      Use {s.providerID}/{s.modelID}
                    </button>
                  ))
                ) : null}
                <button
                  type="button"
                  className="rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  Change model
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-red-10 transition-colors hover:bg-red-3 hover:text-red-11"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function revokeAttachmentPreview(attachment: { previewUrl?: string | undefined }) {
  if (!attachment.previewUrl) return;
  URL.revokeObjectURL(attachment.previewUrl);
}

function InlineQuestionPrompt(props: {
  active: { id: string; questions: QuestionInfo[] };
  busy: boolean;
  onReply: (answers: string[][]) => void;
  onDismiss?: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[][]>([]);
  const [currentSelection, setCurrentSelection] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    setCurrentIndex(0);
    setAnswers(new Array(props.active.questions.length).fill([]));
    setCurrentSelection([]);
    setCustomInput("");
  }, [props.active.id, props.active.questions.length]);

  const currentQuestion = props.active.questions[currentIndex];
  if (!currentQuestion) return null;

  const isLastQuestion = currentIndex === props.active.questions.length - 1;
  const canProceed = (() => {
    if (currentQuestion.custom && customInput.trim().length > 0) return true;
    return currentSelection.length > 0;
  })();

  const toggleOption = (value: string) => {
    if (props.busy) return;
    if (currentQuestion.multiple) {
      setCurrentSelection((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
      return;
    }
    setCurrentSelection([value]);
    if (!currentQuestion.custom) {
      const nextAnswers = answers.slice();
      nextAnswers[currentIndex] = [value];
      if (isLastQuestion) {
        props.onReply(nextAnswers);
      } else {
        setAnswers(nextAnswers);
        setCurrentIndex((i) => i + 1);
        setCurrentSelection([]);
        setCustomInput("");
      }
    }
  };

  const handleNext = () => {
    if (!canProceed || props.busy) return;
    const nextAnswer = [...currentSelection];
    if (currentQuestion.custom && customInput.trim()) {
      nextAnswer.push(customInput.trim());
    }
    const nextAnswers = answers.slice();
    nextAnswers[currentIndex] = nextAnswer;
    if (isLastQuestion) {
      props.onReply(nextAnswers);
    } else {
      setAnswers(nextAnswers);
      setCurrentIndex((i) => i + 1);
      setCurrentSelection([]);
      setCustomInput("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-3 sm:px-5">
      <div className="mb-3 rounded-2xl border border-dls-border bg-dls-surface shadow-[var(--dls-card-shadow)]">
        <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="text-[13px] font-semibold text-dls-text">
                {currentQuestion.header || "Question"}
              </div>
              <div className="text-[11px] font-medium text-dls-secondary">
                {currentIndex + 1} / {props.active.questions.length}
              </div>
            </div>
            <div className="mt-1 text-[13px] leading-5 text-dls-secondary">
              {currentQuestion.question}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-1 text-[12px] font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-60"
            onClick={props.onDismiss}
            disabled={props.busy}
            aria-label="Dismiss question"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="px-4 pb-4 sm:px-5">
          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt: { description: string; label?: string }) => {
              const value = opt.description;
              const selected = currentSelection.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-colors ${
                    selected
                      ? "border-[rgba(var(--dls-accent-rgb),0.35)] bg-[rgba(var(--dls-accent-rgb),0.10)] text-dls-text"
                      : "border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                  }`}
                  onClick={() => toggleOption(value)}
                  disabled={props.busy}
                >
                  <span className="min-w-0 break-words font-medium text-current">{opt.label || value}</span>
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-[rgba(var(--dls-accent-rgb),0.45)] bg-[rgba(var(--dls-accent-rgb),0.25)]"
                        : "border-dls-border bg-transparent"
                    }`}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>

          {currentQuestion.custom ? (
            <div className="mt-3">
              <input
                type="text"
                value={customInput}
                onChange={(event) => setCustomInput(event.currentTarget.value)}
                className="w-full rounded-xl border border-dls-border bg-dls-surface px-3.5 py-2.5 text-[13px] text-dls-text placeholder:text-dls-secondary focus:border-[rgba(var(--dls-accent-rgb),0.45)] focus:outline-none"
                placeholder="Type your answer…"
                disabled={props.busy}
              />
            </div>
          ) : null}

          {currentQuestion.multiple || currentQuestion.custom ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60 ${dlsPrimarySolidClass}`}
                onClick={handleNext}
                disabled={!canProceed || props.busy}
              >
                {isLastQuestion ? "Submit" : "Next"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SessionSurface(props: SessionSurfaceProps) {
  const MIN_CHAT_COLUMN_WIDTH = 440;
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [mentions, setMentions] = useState<Record<string, "agent" | "file">>({});
  const [notice, setNotice] = useState<ReactComposerNotice | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [sending, setSending] = useState(false);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ sessionId: string; snapshot: AiWorkSessionSnapshot } | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [toolImportedPlugins, setToolImportedPlugins] = useState<CloudImportedPlugin[]>([]);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const workspacePanelRef = useRef<SessionWorkspacePanelHandle>(null);
  const pendingWorkspaceRelativePathRef = useRef<string | null>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  /** Wired after {@link useSessionScrollController} so {@link handleSend} can snap to latest without reordering hooks. */
  const scrollToLatestAfterSendRef = useRef<(() => void) | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const opencodeClient = useMemo(
    () => createClient(props.opencodeBaseUrl, undefined, { token: props.aiworkToken, mode: "aiwork" }),
    [props.opencodeBaseUrl, props.aiworkToken],
  );

  const AiWorkspaceRelativePath = useCallback(
    (relativePath: string) => {
      const normalized = relativePath.trim().replace(/\\/g, "/");
      if (!normalized) return;
      if (props.workspaceSidePanelOpen) {
        workspacePanelRef.current?.selectWorkspaceRelativePath(normalized);
        return;
      }
      pendingWorkspaceRelativePathRef.current = normalized;
      props.requestWorkspaceSidePanelOpen?.();
    },
    [props.workspaceSidePanelOpen, props.requestWorkspaceSidePanelOpen],
  );

  const fetchWorkspaceFileText = useCallback(
    async (relativePath: string) => {
      try {
        const res = await props.client.readWorkspaceFile(props.workspaceId, relativePath);
        return res.content;
      } catch {
        return undefined;
      }
    },
    [props.client, props.workspaceId],
  );

  useLayoutEffect(() => {
    if (!props.workspaceSidePanelOpen) return;
    const pending = pendingWorkspaceRelativePathRef.current;
    if (!pending) return;
    pendingWorkspaceRelativePathRef.current = null;
    workspacePanelRef.current?.selectWorkspaceRelativePath(pending);
  }, [props.workspaceSidePanelOpen]);

  const snapshotQueryKey = useMemo(
    () => ["react-session-snapshot", props.workspaceId, props.sessionId],
    [props.workspaceId, props.sessionId],
  );
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const snapshotQuery = useQuery<AiWorkSessionSnapshot>({
    queryKey: snapshotQueryKey,
    queryFn: async () => (await props.client.getSessionSnapshot(props.workspaceId, props.sessionId, { limit: 140 })).item,
    staleTime: 500,
  });

  const currentSnapshot = snapshotQuery.data?.session.id === props.sessionId ? snapshotQuery.data : null;
  const transcriptState = useSharedQueryState<UIMessage[]>(transcriptQueryKey, EMPTY_TRANSCRIPT);
  const statusState = useSharedQueryState(statusQueryKey, currentSnapshot?.status ?? IDLE_STATUS);

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({ sessionId: props.sessionId, snapshot: currentSnapshot });
  }, [props.sessionId, currentSnapshot]);

  useEffect(() => {
    hydratedKeyRef.current = null;
    setError(null);
    setSending(false);
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    // Clear draft + attachments + mentions on session change so typed text
    // doesn't bleed across sessions (and across workspaces). The sessionId
    // effectively changes when the workspace changes too because the route
    // navigates to the remembered session id for that workspace.
    setDraft("");
    setAttachments((current) => {
      current.forEach(revokeAttachmentPreview);
      return [];
    });
    setMentions({});
    setNotice(null);
  }, [props.sessionId]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeAttachmentPreview);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
      draft,
      draftLength: draft.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
      })),
      mentions,
      sending,
      error,
      hasNotice: Boolean(notice),
    }));
    return dispose;
  }, [
    attachments,
    draft,
    error,
    mentions,
    notice,
    props.sessionId,
    props.workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
    });
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [currentSnapshot, props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${props.sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [props.sessionId, currentSnapshot, props.workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId: props.sessionId,
    currentSnapshot,
    cachedRendered: rendered,
  });
  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;
  const chatStreaming = sending || liveStatus.type === "busy" || liveStatus.type === "retry";
  const renderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot, includeLiveOnlyMessages: chatStreaming || Boolean(error) }),
    [chatStreaming, error, snapshot, transcriptState],
  );
  const assistantReplyMetaById = useMemo(
    () => buildAssistantReplyFooterMetaMap(snapshot, renderedMessages),
    [snapshot, renderedMessages],
  );

  /** Reply footer meta comes from {@link snapshot}; transcript updates live first — refresh snapshot when streaming ends so tokens/time appear without reloading. */
  const chatStreamingPrevRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = chatStreamingPrevRef.current;
    if (prev === true && chatStreaming === false) {
      void snapshotQuery.refetch();
    }
    chatStreamingPrevRef.current = chatStreaming;
  }, [chatStreaming, snapshotQuery]);

  const workspacePanelRefreshPrevStreamingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!props.workspaceSidePanelOpen) {
      workspacePanelRefreshPrevStreamingRef.current = chatStreaming;
      return;
    }
    const prev = workspacePanelRefreshPrevStreamingRef.current;
    if (prev !== null && prev !== chatStreaming) {
      const qc = getReactQueryClient();
      void snapshotQuery.refetch();
      void qc.invalidateQueries({ queryKey: ["workspaceDirList", props.workspaceId] });
      void qc.invalidateQueries({ queryKey: ["workspaceFilePreview", props.workspaceId] });
      void qc.invalidateQueries({ queryKey: ["sessionWrittenFilePreview", props.workspaceId] });
    }
    workspacePanelRefreshPrevStreamingRef.current = chatStreaming;
  }, [chatStreaming, props.workspaceId, props.workspaceSidePanelOpen, snapshotQuery]);

  const pendingSessionLoad = !snapshot && snapshotQuery.isLoading && renderedMessages.length === 0;
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (awaitingAssistantBaseline === null) return false;
    return renderedMessages
      .slice(awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [awaitingAssistantBaseline, renderedMessages]);
  const showAssistantWaitState = awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  /** Full-height layout so the empty-session prompt + hint vertically center in the chat viewport. */
  const showEmptyTranscriptWelcome =
    renderedMessages.length === 0 &&
    snapshot != null &&
    snapshot.messages.length === 0 &&
    !error &&
    !showAssistantWaitState &&
    !(showDelayedLoading && pendingSessionLoad);
  useReactRenderWatchdog("SessionSurface", {
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    messageCount: renderedMessages.length,
    liveStatus: liveStatus.type,
    sending,
    pendingSessionLoad,
    showAssistantWaitState,
    hasSnapshot: Boolean(snapshot),
  });

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedLoading(true), 2000);
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (assistantOutputAfterAwaitStart) {
      setAwaitingAssistantBaseline(null);
      return;
    }
    if (sending || liveStatus.type !== "idle" || renderedMessages.length <= awaitingAssistantBaseline) return;
    const id = window.setTimeout(() => setAwaitingAssistantBaseline(null), 1200);
    return () => window.clearTimeout(id);
  }, [assistantOutputAfterAwaitStart, awaitingAssistantBaseline, liveStatus.type, renderedMessages.length, sending]);

  const model = deriveSessionRenderModel({
    intendedSessionId: props.sessionId,
    renderedSessionId: renderedMessages.length > 0 || snapshot ? props.sessionId : null,
    hasSnapshot: Boolean(snapshot) || renderedMessages.length > 0,
    isFetching: snapshotQuery.isFetching,
    isError: snapshotQuery.isError || Boolean(error),
  });

  const buildDraft = useCallback((text: string, nextAttachments: ComposerAttachment[]): ComposerDraft => {
    const trimmed = text.trim();
    const slashMatch = trimmed.match(/^\/([^\s]+)\s*(.*)$/);
    const parts: ComposerPart[] = text.split(/(\[pasted text [^\]]+\]|@[^\s@]+)/).flatMap((segment) => {
      if (!segment) return [] as ComposerDraft["parts"];
      if (segment.startsWith("@")) {
        const value = segment.slice(1);
        const kind = mentions[value];
        if (kind === "agent") return [{ type: "agent", name: value } satisfies ComposerDraft["parts"][number]];
        if (kind === "file") return [{ type: "file", path: value, label: value } satisfies ComposerDraft["parts"][number]];
      }
      return [{ type: "text", text: segment } satisfies ComposerDraft["parts"][number]];
    });
    return {
      mode: "prompt",
      parts,
      attachments: nextAttachments,
      text,
      resolvedText: text,
      command: slashMatch ? { name: slashMatch[1] ?? "", arguments: slashMatch[2] ?? "" } : undefined,
    };
  }, [mentions]);

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptToText(renderedMessages));
    } catch (nextError) {
      setError({ message: nextError instanceof Error ? nextError.message : "Failed to copy transcript." });
    }
  };

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    // User explicitly sent a new turn — resume follow-latest so streaming deltas scroll into view.
    scrollToLatestAfterSendRef.current?.();
    // Intentionally allow sending while the assistant is still streaming.
    // OpenCode accepts follow-up user turns mid-run and queues them; if the
    // backend can't accept the follow-up it'll surface an error via the
    // catch below. This restores the "append a prompt while it's still
    // talking" behavior that the Solid composer had.
    setError(null);
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    try {
      const nextDraft = buildDraft(text, attachments);
      await props.onSendDraft(nextDraft);
      setDraft("");
      attachments.forEach(revokeAttachmentPreview);
      setAttachments([]);
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      getReactQueryClient().setQueryData<UIMessage[]>(
        reactTranscriptKey(props.workspaceId, props.sessionId),
        (current = []) => [...current, buildLocalAssistantErrorMessage(formatSessionErrorMessage(parsed))],
      );
      setDraft("");
      setAwaitingAssistantBaseline(null);
      setSending(false);
    }
  }, [
    attachments,
    buildDraft,
    draft,
    props.onDraftChange,
    props.onSendDraft,
    props.sessionId,
    props.workspaceId,
    renderedMessages.length,
  ]);

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    setError(null);
    try {
      await abortSessionSafe(opencodeClient, props.sessionId);
      await snapshotQuery.refetch();
      // If we were waiting on an AskQuestion prompt, aborting won't always
      // emit question.replied; clear UI state immediately so the prompt
      // doesn't linger after Stop/close.
      getReactQueryClient().removeQueries({
        queryKey: reactQuestionKey(props.workspaceId, props.sessionId),
        exact: true,
      });
    } catch (nextError) {
      setError({ message: nextError instanceof Error ? nextError.message : "Failed to stop run." });
    }
  }, [chatStreaming, opencodeClient, props.sessionId, snapshotQuery.refetch]);

  useEffect(() => {
    if (liveStatus.type === "idle") {
      setSending(false);
    }
  }, [liveStatus.type]);

  useEffect(() => {
    props.onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, props.onDraftChange]);

  const handleAttachFiles = (files: File[]) => {
    if (!props.attachmentsEnabled) {
      setNotice({ title: props.attachmentsDisabledReason ?? "Attachments are unavailable.", tone: "warning" });
      return;
    }
    const oversized = files.filter((file) => file.size > 25 * 1024 * 1024);
    const accepted = files.filter((file) => file.size <= 25 * 1024 * 1024);
    if (oversized.length) {
      setNotice({
        title: oversized.length === 1 ? `${oversized[0]?.name ?? "File"} is too large` : `${oversized.length} files are too large`,
        description: "Files over 25 MB were skipped.",
        tone: "warning",
      });
    }
    if (!accepted.length) return;
    const next = accepted.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" as const : "file" as const,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((current) => [...current, ...next]);
    setNotice({
      title: next.length === 1 ? `Attached ${next[0]?.name ?? "file"}` : `Attached ${next.length} files`,
      tone: "success",
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handleInsertMention = (kind: "agent" | "file", value: string) => {
    setDraft((current) => current.replace(/@([^\s@]*)$/, `@${value} `));
    setMentions((current) => ({ ...current, [value]: kind }));
  };

  const handleUnsupportedFileLinks = (links: string[]) => {
    if (!links.length) return;
    setDraft((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${links.join("\n")}`);
  };

  const typeComposerText = useCallback(async (text: string) => {
    window.dispatchEvent(new Event("aiwork:focusPrompt"));
    setDraft(text);
    await waitForControl(40);
  }, []);

  const composerSetTextControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "composer.set_text",
    label: "Type into the composer",
    description: "Replace the current session draft and type the supplied text visibly.",
    sideEffect: "none",
    requiresArgs: true,
    args: [{ name: "text", type: "string", required: true, description: "Prompt text to place in the composer." }],
    previewArgs: { text: DEFAULT_COMPOSER_CONTROL_TEXT },
    targetRef: composerShellRef,
    execute: async (args, helpers) => {
      const text = controlTextArgument(args);
      helpers.setNarration(`Typing ${text.length.toLocaleString()} characters into the composer…`);
      await typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      return { draftLength: text.length };
    },
  }), [attachments, buildDraft, props.onDraftChange, typeComposerText]);
  useControlAction(composerSetTextControlAction);

  const composerSendControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "composer.send",
    label: "Send the composer prompt",
    description: "Send the currently visible composer draft to the active session.",
    sideEffect: "mutation",
    disabled: (!draft.trim() && attachments.length === 0) || model.transitionState !== "idle",
    targetRef: composerShellRef,
    execute: async () => {
      await handleSend();
      return true;
    },
  }), [attachments.length, draft, handleSend, model.transitionState]);
  useControlAction(composerSendControlAction);

  const composerStopControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "composer.stop",
    label: "Stop the current run",
    description: "Stop the current streaming session run.",
    sideEffect: "mutation",
    disabled: !chatStreaming,
    targetRef: composerShellRef,
    execute: async () => {
      await handleAbort();
      return true;
    },
  }), [chatStreaming, handleAbort]);
  useControlAction(composerStopControlAction);

  const listSkills = async (): Promise<SkillCard[]> => {
    const response = await props.client.listSkills(props.workspaceId, { includeGlobal: true });
    const next = (response.items ?? []).map((skill) => ({
      name: skill.name,
      path: skill.path,
      description: skill.description,
      trigger: skill.trigger,
    } satisfies SkillCard));
    setToolSkills(next);
    return next;
  };

  const listMcp = async (): Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }> => {
    const response = await props.client.listMcp(props.workspaceId);
    const servers = (response.items ?? []).map((entry) => ({
      name: entry.name,
      config: entry.config as McpServerEntry["config"],
    } satisfies McpServerEntry));

    let statuses: McpStatusMap = {};
    try {
      if (props.workspaceRoot.trim()) {
        statuses = unwrap(await opencodeClient.mcp.status({ directory: props.workspaceRoot.trim() })) as McpStatusMap;
      }
    } catch {
      statuses = {};
    }

    const status = servers.length ? null : "No MCP servers loaded.";
    setToolMcpServers(servers);
    setToolMcpStatuses(statuses);
    setToolMcpStatus(status);
    return { servers, statuses, status };
  };

  const listImportedPlugins = async (): Promise<CloudImportedPlugin[]> => {
    const response = await props.client.getConfig(props.workspaceId);
    const plugins = Object.values(readWorkspaceCloudImports(response.aiwork).plugins)
      .sort((left, right) => left.name.localeCompare(right.name));
    setToolImportedPlugins(plugins);
    return plugins;
  };

  const handleUploadInboxFiles = async (files: File[], options?: { notify?: boolean }) => {
    const input = files.filter(Boolean);
    if (!input.length) return;
    try {
      const results = await Promise.all(input.map((file) => props.client.uploadInbox(props.workspaceId, file)));
      if (options?.notify !== false) {
        const summary = results.map((item) => item.path.split("/").filter(Boolean).slice(-1)[0] ?? item.path).join(", ");
        setNotice({
          title: input.length === 1 ? "Uploaded to the shared folder." : `Uploaded ${input.length} files to the shared folder.`,
          description: summary || undefined,
          tone: "success",
        });
      }
      return results;
    } catch (nextError) {
      setNotice({
        title: nextError instanceof Error ? nextError.message : "Shared folder upload failed",
        tone: "warning",
      });
      throw nextError;
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages,
    containerRef: scrollRef,
    contentRef,
  });
  scrollToLatestAfterSendRef.current = () => {
    sessionScroll.jumpToLatest("auto");
  };

  const todos = useSharedQueryState<TodoItem[]>(
    reactTodoKey(props.workspaceId, props.sessionId),
    [],
  );
  // TS/JSX can fail to pick up memo'd prop types in some editor setups.
  // Cast so we can still pass live todo state to the transcript renderer.
  const SessionTranscriptUnsafe = SessionTranscript as unknown as (props: any) => any;

  const sessionScrollTopControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "session.scroll_top",
    label: "Go to the top of the session",
    description: "Scroll the visible session transcript to the first messages.",
    sideEffect: "none",
    execute: () => {
      const container = scrollRef.current;
      if (!container) return { ok: false, error: "Session transcript is not mounted" };
      container.scrollTo({ top: 0, behavior: "smooth" });
      return { ok: true, position: "top" };
    },
  }), []);
  useControlAction(sessionScrollTopControlAction);

  const sessionScrollBottomControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "session.scroll_bottom",
    label: "Go to the bottom of the session",
    description: "Scroll the visible session transcript to the newest messages and composer area.",
    sideEffect: "none",
    execute: () => {
      sessionScroll.jumpToLatest("smooth");
      return { ok: true, position: "bottom" };
    },
  }), [sessionScroll.jumpToLatest]);
  useControlAction(sessionScrollBottomControlAction);

  const sessionLatestMessageControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "session.latest_message",
    label: "Read the latest session message",
    description: "Return the latest visible message in the current session transcript.",
    sideEffect: "none",
    execute: () => {
      const message = renderedMessages[renderedMessages.length - 1];
      if (!message) return { ok: false, error: "No messages are visible in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        index: renderedMessages.length - 1,
        role: message.role,
        text: messageToReadableText(message),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionLatestMessageControlAction);

  const sessionReadTranscriptControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "session.read_transcript",
    label: "Read the current session transcript",
    description: "Return the last messages from the current session transcript as readable text, including the session ID, title, and message count.",
    sideEffect: "none",
    args: [{ name: "count", type: "number", required: false, description: "Number of recent messages to return, from 1 to 30. Defaults to 10." }],
    execute: (args) => {
      const count = typeof args === "object" && args !== null && "count" in args && typeof (args as { count?: unknown }).count === "number"
        ? Math.min(Math.max(1, (args as { count: number }).count), 30)
        : 10;
      const total = renderedMessages.length;
      const slice = renderedMessages.slice(-count);
      if (!slice.length) return { ok: false, error: "No messages in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        messageCount: total,
        returned: slice.length,
        messages: slice.map((message, index) => ({
          index: total - slice.length + index,
          role: message.role,
          text: messageToReadableText(message),
        })),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionReadTranscriptControlAction);

  return (
    <DevProfiler id="SessionSurface">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ minWidth: MIN_CHAT_COLUMN_WIDTH }}>
      {model.transitionState === "switching" && showDelayedLoading ? (
        <div className="flex justify-center px-6 pt-4">
          <div className="rounded-full border border-dls-border bg-dls-hover/80 px-3 py-1 text-xs text-dls-secondary">
            {model.renderSource === "cache" ? "Switching session from cache..." : "Switching session..."}
          </div>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onWheel={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchStart={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchMove={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            sessionScroll.markScrollGesture(event.currentTarget);
          }}
          onScroll={sessionScroll.handleScroll}
          className={`absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain py-4 px-4 md:px-8${
            showEmptyTranscriptWelcome ? " flex min-h-0 flex-col" : ""
          }`}
        >
          {/* Chat column: same max width as composer panel (800px). */}
          <div
            ref={contentRef}
            className={`mx-auto w-full max-w-[800px]${
              showEmptyTranscriptWelcome ? " flex min-h-0 flex-1 flex-col" : ""
            }`}
          >
            {showDelayedLoading && pendingSessionLoad ? (
              <div className="px-6 py-16">
                <div className="mx-auto max-w-sm rounded-3xl border border-dls-border bg-dls-hover/60 px-8 py-10 text-center">
                  <div className="text-sm text-dls-secondary">Opening session…</div>
                </div>
              </div>
            ) : (snapshotQuery.isError || error) && !snapshot && renderedMessages.length === 0 ? (
              <div className="px-6 py-8">
                {error ? (
                  <SessionErrorCard
                    error={error}
                    onDismiss={() => setError(null)}
                    onChangeModel={props.onChangeModel}
                    onOpenModelPicker={props.onModelClick}
                  />
                ) : (
                  <div className="mx-auto max-w-xl rounded-3xl border border-red-6/40 bg-red-3/20 px-6 py-5 text-sm text-red-11">
                    {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : "Failed to load session."}
                  </div>
                )}
              </div>
            ) : renderedMessages.length === 0 && showAssistantWaitState ? (
              <div className="px-6 py-12">
                <AssistantWaitingCard />
              </div>
            ) : renderedMessages.length === 0 && snapshot && snapshot.messages.length === 0 ? (
              error ? (
                <SessionErrorCard
                  error={error}
                  onDismiss={() => setError(null)}
                  onChangeModel={props.onChangeModel}
                  onOpenModelPicker={props.onModelClick}
                />
              ) : (
                <div
                  className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-16"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-center text-2xl font-medium leading-relaxed text-dls-text">
                    {t("session.empty_transcript_prompt")}
                  </p>
                  <p className="max-w-lg text-center text-[15px] leading-relaxed text-dls-secondary">
                    {t("session.empty_transcript_hint")}
                  </p>
                </div>
              )
            ) : (
              <DevProfiler id="SessionTranscript">
                <>
                  <SessionTranscriptUnsafe
                    messages={renderedMessages}
                    isStreaming={chatStreaming}
                    developerMode={props.developerMode}
                    showThinking={props.showThinking}
                    todos={todos}
                    scrollElement={() => scrollRef.current}
                    workspaceRoot={props.workspaceRoot}
                    onAiWorkspaceRelativePath={AiWorkspaceRelativePath}
                    fetchWorkspaceFileText={fetchWorkspaceFileText}
                    writtenFileSvgQueryKey={props.workspaceId}
                    assistantReplyMetaById={assistantReplyMetaById}
                    aiworkServerBaseUrl={props.client.baseUrl}
                  />
                  {error ? (
                    <SessionErrorCard
                      error={error}
                      onDismiss={() => setError(null)}
                      onChangeModel={props.onChangeModel}
                      onOpenModelPicker={props.onModelClick}
                    />
                  ) : null}
                  {showAssistantWaitState ? <AssistantWaitingCard /> : null}
                </>
              </DevProfiler>
            )}
          </div>
        </div>
        {!sessionScroll.isAtBottom || sessionScroll.topClippedMessageId ? (
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 justify-center">
            {!sessionScroll.isAtBottom ? (
              <button
                type="button"
                className="pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-dls-surface text-dls-text transition-colors hover:bg-dls-hover"
                style={{ boxShadow: JUMP_TO_LATEST_BOX_SHADOW }}
                title={t("session.jump_to_latest")}
                aria-label={t("session.jump_to_latest")}
                onClick={() => {
                  sessionScroll.jumpToLatest("smooth");
                }}
              >
                <JumpToLatestGlyph />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        ref={composerShellRef}
        className="relative z-10 shrink-0 bg-white px-0 pb-1 pt-0 dark:bg-gray-1"
        style={{ boxShadow: COMPOSER_SHELL_TOP_SHADOW }}
      >
        {props.activeQuestion && props.respondQuestion ? (
          <InlineQuestionPrompt
            active={{ id: props.activeQuestion.id, questions: props.activeQuestion.questions ?? [] }}
            busy={Boolean(props.questionReplyBusy)}
            onReply={(answers) => props.respondQuestion?.(props.activeQuestion!.id, answers)}
            onDismiss={() => {
              void handleAbort();
            }}
          />
        ) : null}
        <DevProfiler id="SessionComposer">
        <ReactSessionComposer
          draft={draft}
          mentions={mentions}
          onDraftChange={setDraft}
        onSend={handleSend}
        onStop={handleAbort}
        busy={chatStreaming}
        disabled={model.transitionState !== "idle"}
        statusLabel={statusLabel(snapshot ?? undefined, chatStreaming)}
        modelLabel={props.modelLabel}
        onModelClick={props.onModelClick}
        attachments={attachments}
        onAttachFiles={handleAttachFiles}
        onRemoveAttachment={handleRemoveAttachment}
        attachmentsEnabled={props.attachmentsEnabled}
        attachmentsDisabledReason={props.attachmentsDisabledReason}
        modelVariantLabel={props.modelVariantLabel}
        modelVariant={props.modelVariant}
        modelBehaviorOptions={props.modelBehaviorOptions}
        onModelVariantChange={props.onModelVariantChange}
        agentLabel={props.agentLabel}
        selectedAgent={props.selectedAgent}
        listAgents={props.listAgents}
        onSelectAgent={props.onSelectAgent}
        listCommands={props.listCommands}
        listSkills={listSkills}
        skills={toolSkills}
        listMcp={listMcp}
        mcpServers={toolMcpServers}
        mcpStatus={toolMcpStatus}
        mcpStatuses={toolMcpStatuses}
        listImportedPlugins={listImportedPlugins}
        importedPlugins={toolImportedPlugins}
        onOpenSettingsSection={props.onOpenSettingsSection}
        recentFiles={props.recentFiles}
        searchFiles={props.searchFiles}
        onInsertMention={handleInsertMention}
        notice={notice}
        onNotice={setNotice}
        onUnsupportedFileLinks={handleUnsupportedFileLinks}
          onUploadInboxFiles={props.onUploadInboxFiles ?? handleUploadInboxFiles}
        />
        </DevProfiler>
      </div>
      </div>
      {props.workspaceSidePanelOpen ? (
        <SessionWorkspacePanel
          ref={workspacePanelRef}
          client={props.client}
          workspaceId={props.workspaceId}
          workspaceRoot={props.workspaceRoot}
          attachments={attachments}
          mentions={mentions}
          messages={renderedMessages}
          liveWorkspacePreview={chatStreaming}
        />
      ) : null}
      </div>
      {/* Error display moved inline into the session conversation area */}
      {props.developerMode ? <SessionDebugPanel model={model} snapshot={snapshot} /> : null}
    </div>
    </DevProfiler>
  );
}
