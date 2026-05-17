/** @jsxImportSource react */
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MemoExoticComponent,
  type ReactNode,
} from "react";
import { isToolUIPart, type DynamicToolUIPart, type UIMessage } from "ai";
import type { Part } from "@aiwork-engine/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Atom, Check, ChevronDown, ChevronUp, CircleAlert, Copy, File as FileIcon, Pencil } from "lucide-react";

import { resolveWorkspaceApiUrl } from "../../../../app/lib/aiwork-server";
import { joinDesktopPath, openDesktopPath, revealDesktopItemInDir } from "../../../../app/lib/desktop";
import {
  looksAbsoluteWorkspacePath,
  workspaceRelativePathForServerRead,
} from "../../../../app/lib/workspace-relative-path";
import { WorkspacePanelFileGlyph } from "./workspace-panel-file-glyph";
import {
  SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX,
  type MessageGroup,
  type StepGroupMode,
  type TodoItem,
  type WorkspaceWriteTouch,
} from "../../../../app/types";
import { deriveWorkspaceWriteTouchesFromUIMessage } from "../../../../app/utils/workspace-write-touches";
import { groupMessageParts, summarizeStep } from "../../../../app/utils";
import { currentLocale, t } from "../../../../i18n";
import type { AssistantReplyFooterMeta } from "./session-render-state";
import { MarkdownBlock } from "./markdown";
import { ToolStepTitleGlyph } from "./tool-step-title-glyph";
import { applyTextHighlights } from "./text-highlights";
import { buildWebPreviewSrcDoc } from "./web-preview-srcdoc";
import { DiffCodePreview } from "./diff-code-preview";

type TranscriptPart = Part;

type TranscriptMessage = {
  id: string;
  role: UIMessage["role"];
  source: UIMessage;
  parts: TranscriptPart[];
};

type StepTimelineGroup = {
  id: string;
  parts: TranscriptPart[];
  mode: StepGroupMode;
};

type StepClusterBlock = {
  kind: "steps-cluster";
  id: string;
  stepGroups: StepTimelineGroup[];
  messageIds: string[];
  isUser: boolean;
};

type MessageBlock = {
  kind: "message";
  message: UIMessage;
  renderableParts: TranscriptPart[];
  attachments: Array<{
    url: string;
    filename: string;
    mime: string;
  }>;
  groups: MessageGroup[];
  isUser: boolean;
  messageId: string;
};

type MessageBlockItem = MessageBlock | StepClusterBlock;

/**
 * Stable-key used to match a block across renders. For message blocks the
 * messageId is stable. For step clusters we reuse the cluster id (which is
 * derived from its first step group) as the identity anchor.
 */
function blockIdentityKey(block: MessageBlockItem): string {
  if (block.kind === "steps-cluster") return `cluster:${block.id}`;
  return `msg:${block.messageId}`;
}

/**
 * Returns true when a newly-computed block is content-equivalent to the
 * previous block we rendered under the same identity key. We compare the
 * underlying UIMessage reference (`message.source`) for message blocks and
 * the messageIds array + stepGroups identity for step clusters. If equal,
 * the caller reuses the previous block reference so React.memo'd children
 * downstream can skip work.
 *
 * This is the structural-sharing trick from T3Tools' MessagesTimeline: on
 * every streaming token, `props.messages` is a fresh array, but only the
 * *currently-streaming* message has a new `source` reference — everything
 * else is still pointer-equal to last tick. Rebuilding blocks from the new
 * array gives fresh block objects for every message, so downstream memo
 * checks all fail by default. Reusing the previous block reference when
 * its content hasn't actually changed gives every non-streaming row a free
 * bailout during a streaming burst.
 */
function blocksAreEquivalent(
  previous: MessageBlockItem | undefined,
  next: MessageBlockItem,
): boolean {
  if (!previous) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.isUser !== next.isUser) return false;

  if (previous.kind === "steps-cluster" && next.kind === "steps-cluster") {
    if (previous.id !== next.id) return false;
    if (previous.messageIds.length !== next.messageIds.length) return false;
    for (let i = 0; i < previous.messageIds.length; i += 1) {
      if (previous.messageIds[i] !== next.messageIds[i]) return false;
    }
    if (previous.stepGroups.length !== next.stepGroups.length) return false;
    for (let i = 0; i < previous.stepGroups.length; i += 1) {
      const prevGroup = previous.stepGroups[i];
      const nextGroup = next.stepGroups[i];
      if (!prevGroup || !nextGroup) return false;
      if (prevGroup.id !== nextGroup.id) return false;
      if (prevGroup.mode !== nextGroup.mode) return false;
      if (prevGroup.parts.length !== nextGroup.parts.length) return false;
      for (let p = 0; p < prevGroup.parts.length; p += 1) {
        if (prevGroup.parts[p] !== nextGroup.parts[p]) return false;
      }
    }
    return true;
  }

  if (previous.kind === "message" && next.kind === "message") {
    if (previous.messageId !== next.messageId) return false;
    // The single most important check. The session sync layer keeps
    // UIMessage references stable for every non-streaming message across
    // rerenders; only the actively-streaming message gets a fresh
    // `source` reference per token. If the source is pointer-equal, the
    // block hasn't changed and we can reuse the previous object.
    if (previous.message !== next.message) return false;
    if (previous.attachments.length !== next.attachments.length) return false;
    if (previous.renderableParts.length !== next.renderableParts.length) return false;
    if (previous.groups.length !== next.groups.length) return false;
    return true;
  }

  return false;
}

function formatReplyStartedAt(ms: number): string {
  const loc = currentLocale();
  const localeTag = loc === "zh" ? "zh-CN" : "en-US";
  return new Date(ms).toLocaleString(localeTag, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatReplyDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  return `${m}m ${rs}s`;
}

function formatReplyTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function AssistantReplyMetaRow(props: {
  meta: AssistantReplyFooterMeta;
  showDurationPending: boolean;
}) {
  const { meta, showDurationPending } = props;
  const sepClass = "text-dls-secondary/50";

  type Segment = { key: string; node: ReactNode };
  const segments: Segment[] = [
    {
      key: "start",
      node: <span className="whitespace-nowrap">{formatReplyStartedAt(meta.startedAtMs)}</span>,
    },
  ];

  if (meta.durationMs !== undefined && meta.durationMs >= 0) {
    segments.push({
      key: "dur",
      node: <span className="whitespace-nowrap">{formatReplyDuration(meta.durationMs)}</span>,
    });
  } else if (showDurationPending) {
    segments.push({
      key: "dur-pending",
      node: <span className="whitespace-nowrap">{t("session.assistant_reply_duration_pending")}</span>,
    });
  }

  if (meta.tokenTotal !== undefined && meta.tokenTotal > 0) {
    segments.push({
      key: "tok",
      node: (
        <span className="whitespace-nowrap">
          {formatReplyTokens(meta.tokenTotal)} {t("session.assistant_reply_tokens_suffix")}
        </span>
      ),
    });
  }

  segments.push({
    key: "model",
    node: (
      <span className="min-w-0 max-w-[14rem] truncate font-medium text-dls-secondary" title={meta.modelKey}>
        {meta.modelKey}
      </span>
    ),
  });

  const ariaParts: string[] = [
    `${t("session.assistant_reply_meta_started")} ${formatReplyStartedAt(meta.startedAtMs)}`,
  ];
  if (meta.durationMs !== undefined && meta.durationMs >= 0) {
    ariaParts.push(`${t("session.assistant_reply_meta_duration")} ${formatReplyDuration(meta.durationMs)}`);
  } else if (showDurationPending) {
    ariaParts.push(t("session.assistant_reply_meta_duration_pending"));
  }
  if (meta.tokenTotal !== undefined && meta.tokenTotal > 0) {
    ariaParts.push(`${t("session.assistant_reply_meta_tokens")} ${meta.tokenTotal}`);
  }
  ariaParts.push(`${t("session.assistant_reply_meta_model")} ${meta.modelKey}`);

  return (
    <div
      className="pointer-events-auto flex min-w-0 w-full flex-wrap items-center justify-start gap-x-1 gap-y-0.5 text-[11px] leading-snug text-dls-secondary tabular-nums"
      aria-label={ariaParts.join(". ")}
    >
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? (
            <span className={`${sepClass} shrink-0`} aria-hidden>
              ·
            </span>
          ) : null}
          {segment.node}
        </Fragment>
      ))}
    </div>
  );
}

export type SessionTranscriptProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  developerMode: boolean;
  todos?: TodoItem[];
  showThinking?: boolean;
  expandedStepIds?: Set<string>;
  onExpandedStepIdsChange?: (updater: (current: Set<string>) => Set<string>) => void;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  scrollElement?: () => HTMLElement | null | undefined;
  setScrollToMessageById?: (
    handler: ((messageId: string, behavior?: ScrollBehavior) => boolean) | null,
  ) => void;
  footer?: ReactNode;
  variant?: "default" | "nested";
  /** Resolves relative tool paths when opening files from the transcript footer */
  workspaceRoot?: string;
  /** Routes “View” into the workspace side panel (same rules as clicking a file there). */
  onAiWorkspaceRelativePath?: (relativePath: string) => void;
  /** Loads workspace-relative file text for SVG inline previews on written-file cards */
  fetchWorkspaceFileText?: (relativePath: string) => Promise<string | undefined>;
  /**
   * Loads file text from the checkpoint associated with a specific message.
   * Uses shadow git to read the file version at message time, falling back
   * to the live workspace file when checkpoint data is unavailable.
   * Signature: (messageId, relativePath) => Promise<string | undefined>
   */
  fetchCheckpointFileText?: (messageId: string, relativePath: string) => Promise<string | undefined>;
  /** Prefix for SVG preview cache keys (typically `workspaceId`) */
  writtenFileSvgQueryKey?: string;
  /** Per-message timing/usage/model for assistant replies (from session snapshot). */
  assistantReplyMetaById?: ReadonlyMap<string, AssistantReplyFooterMeta>;
  /**
   * AiWork server root (e.g. `http://127.0.0.1:PORT`). Used to resolve root-relative
   * `/workspace/...` URLs in file parts and markdown so they target the API in Vite dev.
   */
  aiworkServerBaseUrl?: string;
  /** ID of the user message currently being edited inline (or null). */
  editingMessageId?: string | null;
  /** Begin editing the given user message; receives the prefilled text. */
  onEditMessage?: (input: { messageId: string; initialText: string }) => void;
  /** When the editing user message is rendered, this slot replaces its bubble. */
  renderInlineEditComposer?: (input: { messageId: string }) => ReactNode;
  /** Disable the edit button (e.g. while a run is streaming). */
  editingDisabled?: boolean;
  /** Tooltip when edit is disabled. */
  editingDisabledReason?: string | null;
};

// 500 was too high for real-world AiWork sessions: a handful of giant
// messages (emails, legal docs, pasted transcripts) can still produce a
// massive DOM even when the block count is low. Lowering the threshold means
// we switch to react-virtual much earlier and keep the main thread lighter
// during workspace/session switches.
// Virtualize aggressively. A session with 20+ message blocks already pays
// more to render eagerly than to run the virtualizer, so there's no reason
// to defer. The only reason the threshold exists at all is to avoid the
// virtualizer's baseline overhead for tiny sessions.
const VIRTUALIZATION_THRESHOLD = 20;
const VIRTUAL_OVERSCAN = 4;

function partIdFromUiPart(part: UIMessage["parts"][number], fallbackId: string) {
  const metadata = (part as { providerMetadata?: { opencode?: { partId?: unknown } } })
    .providerMetadata?.opencode;
  if (typeof metadata?.partId === "string" && metadata.partId.trim()) {
    return metadata.partId;
  }
  return fallbackId;
}

function toDynamicToolPart(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    return part;
  }
  if (!isToolUIPart(part)) return null;
  return {
    ...part,
    toolName: part.type.replace(/^tool-/, ""),
    type: "dynamic-tool",
  } as DynamicToolUIPart;
}

function toLegacyPart(
  part: UIMessage["parts"][number],
  fallbackId: string,
): TranscriptPart | null {
  const id = partIdFromUiPart(part, fallbackId);

  if (part.type === "text") {
    return { id, type: "text", text: part.text } as TranscriptPart;
  }

  if (part.type === "reasoning") {
    const record = part as { text: string; state?: "streaming" | "done" };
    return {
      id,
      type: "reasoning",
      text: record.text,
      ...(record.state ? { state: record.state } : {}),
    } as TranscriptPart;
  }

  if (part.type === "file") {
    return {
      id,
      type: "file",
      url: part.url,
      filename: part.filename,
      mime: part.mediaType,
    } as TranscriptPart;
  }

  if (part.type === "step-start") {
    return { id, type: "step-start" } as TranscriptPart;
  }

  const toolPart = toDynamicToolPart(part);
  if (toolPart) {
    const state: Record<string, unknown> = {
      input: toolPart.input,
    };

    if (toolPart.state === "output-available") {
      state.output = toolPart.output;
    }

    if (toolPart.state === "output-error") {
      state.error = toolPart.errorText;
    }

    return {
      id: toolPart.toolCallId || id,
      type: "tool",
      tool: toolPart.toolName,
      state,
    } as TranscriptPart;
  }

  return null;
}

function isAttachmentPart(part: TranscriptPart) {
  if (part.type !== "file") return false;
  const url = (part as { url?: string }).url;
  return typeof url === "string" && !url.startsWith("file://");
}

function attachmentsForParts(parts: TranscriptPart[]) {
  return parts
    .filter(isAttachmentPart)
    .map((part) => {
      const record = part as {
        url?: string;
        filename?: string;
        mime?: string;
      };
      return {
        url: record.url ?? "",
        filename: record.filename ?? "attachment",
        mime: record.mime ?? "application/octet-stream",
      };
    })
    .filter((attachment) => Boolean(attachment.url));
}

function partToText(part: TranscriptPart) {
  if (part.type === "text") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "reasoning") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "agent") {
    const name = (part as { name?: string }).name ?? "";
    return name ? `@${name}` : "@agent";
  }
  if (part.type === "file") {
    const record = part as {
      label?: string;
      path?: string;
      filename?: string;
      url?: string;
    };
    const label = record.label ?? record.path ?? record.filename ?? record.url ?? "";
    return label ? `@${label}` : "@file";
  }
  if (part.type === "tool") {
    return summarizeStep(part).title;
  }
  return "";
}

function messageToText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "file") return [part.filename ?? part.url];
      const toolPart = toDynamicToolPart(part);
      if (toolPart) {
        if (toolPart.state === "output-error") {
          return [`[tool:${toolPart.toolName}] ${toolPart.errorText}`];
        }
        if (toolPart.state === "output-available") {
          return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.output)}`];
        }
        return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.input)}`];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

/**
 * Extracts editable text from a user message (text parts only, no tool/file parts).
 * Used to pre-fill the inline edit composer.
 */
function userMessageEditableText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      return [];
    })
    .join("\n\n")
    .trim();
}

/** Last assistant message id in each QA segment → copy callback that joins every assistant bubble in that segment. */
function buildAssistantQaCopyTextByLastId(messages: UIMessage[]): Map<string, () => string> {
  const map = new Map<string, () => string>();
  let group: UIMessage[] = [];
  const flush = () => {
    if (group.length === 0) return;
    /** Snapshot — lazy getters must not close over `group`, which is cleared after each flush. */
    const segment = group.slice();
    const last = segment[segment.length - 1]!;
    map.set(last.id, () => {
      const segments = segment.map((m) => messageToText(m)).filter((text) => text.trim().length > 0);
      return segments.join("\n\n");
    });
    group = [];
  };
  for (const m of messages) {
    if (m.role === "assistant") group.push(m);
    else flush();
  }
  flush();
  return map;
}

function isImageAttachment(mime: string) {
  return mime.startsWith("image/");
}

function humanMediaType(raw: string) {
  if (!raw || raw === "application/octet-stream") return null;
  const short = raw.replace(/^application\//, "").replace(/^text\//, "");
  return short.toUpperCase();
}

function cleanReasoningPreview(value: string) {
  return value
    .replace(/\[REDACTED\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function ThinkingCollapsible(props: { text: string; thinkingActive: boolean }) {
  /** After streaming ends, stay collapsed unless the user opens the block. */
  const [manualOpen, setManualOpen] = useState(false);
  const prevThinkingRef = useRef<boolean | null>(null);

  useEffect(() => {
    const prev = prevThinkingRef.current;
    if (prev === true && !props.thinkingActive) {
      setManualOpen(false);
    }
    prevThinkingRef.current = props.thinkingActive;
  }, [props.thinkingActive]);

  const expanded = props.thinkingActive || manualOpen;
  const paragraphs = useMemo(() => {
    const cleaned = cleanReasoningPreview(props.text);
    const blocks = cleaned
      .split(/\n\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    return blocks.length > 0 ? blocks : cleaned.trim() ? [cleaned.trim()] : [];
  }, [props.text]);

  return (
    <div className="w-full max-w-[800px]">
      <button
        type="button"
        className={`flex w-full items-center gap-2 rounded-lg py-0.5 text-left [font-size:inherit] [line-height:inherit] text-gray-9 transition-colors ${
          props.thinkingActive ? "cursor-default" : "hover:text-dls-text"
        }`}
        aria-expanded={expanded}
        aria-busy={props.thinkingActive}
        aria-label={
          expanded ? t("session.thinking_collapse_aria") : t("session.thinking_expand_aria")
        }
        onClick={() => {
          if (props.thinkingActive) return;
          setManualOpen((value) => !value);
        }}
      >
        <svg className="size-[14px] shrink-0" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" aria-hidden fill="currentColor">
          <path d="M66.688 957.248c-61.568-61.44-69.632-166.656-18.88-298.496a835.2 835.2 0 0 1 72.96-143.488L122.88 512l-1.984-3.264A848.256 848.256 0 0 1 47.68 365.44c-50.624-132.032-42.56-237.184 19.008-298.816 33.92-33.92 82.688-52.096 141.696-52.096 86.4 0 192 38.464 300.48 106.432l3.264 1.984 3.2-1.92C623.68 53.12 729.344 14.464 815.744 14.464c59.008 0 107.776 18.176 141.568 52.096 61.44 61.632 69.632 166.848 18.944 298.688-19.776 49.984-44.16 97.984-73.088 143.36L901.12 512l1.92 3.2c30.4 48.448 55.296 96.768 73.216 143.36 50.688 131.84 42.624 237.12-18.944 298.688-33.792 33.92-82.56 52.16-141.44 52.16-86.528 0-192.064-38.592-300.544-106.496L512 900.992l-3.2 1.92c-108.416 67.968-214.08 106.56-300.48 106.56-59.008 0-107.712-18.176-141.568-52.096v-0.128z m826.432-266.624c-12.16-31.168-26.496-61.44-42.944-90.56l-4.608-7.936-5.568 7.232a1339.648 1339.648 0 0 1-240.64 240.64l-7.232 5.632 8 4.48c79.296 44.48 155.2 70.4 215.616 70.4 34.112 0 60.992-8.32 78.592-26.048 18.304-18.176 26.56-46.976 26.048-81.6-0.512-34.816-9.6-76.608-27.264-122.368v0.128z m-384.64 99.968l3.456 2.56 3.584-2.56a1205.248 1205.248 0 0 0 275.904-275.008l2.56-3.584-2.56-3.456a1196.352 1196.352 0 0 0-275.84-275.2l-3.648-2.432-3.456 2.56a1205.504 1205.504 0 0 0-276.032 275.072L229.888 512l2.56 3.584a1196.928 1196.928 0 0 0 276.032 275.136v-0.128z m385.92-660.992c-17.792-17.664-44.608-26.048-78.72-26.048-60.416 0-136.32 25.856-215.552 70.4l-8 4.48 7.296 5.632a1333.504 1333.504 0 0 1 240.64 240.576l5.504 7.232 4.48-7.936c17.152-30.528 31.872-60.864 43.072-90.56 17.6-45.568 26.88-87.36 27.264-122.176 0.512-34.688-7.744-63.36-25.92-81.6zM130.752 333.504c12.288 31.168 26.688 61.44 43.072 90.56l4.608 7.808 5.568-7.232a1330.304 1330.304 0 0 1 240.512-240.64l7.36-5.504-8-4.48c-79.36-44.608-155.2-70.464-215.68-70.464-34.112 0-60.992 8.32-78.592 26.048-18.24 18.24-26.496 46.912-25.984 81.6 0.384 34.816 9.6 76.608 27.136 122.24z m0 357.12c-17.6 45.632-26.752 87.424-27.136 122.24-0.512 34.624 7.68 63.36 25.856 81.6 17.792 17.728 44.672 26.048 78.72 26.048 60.48 0 136.32-25.856 215.616-70.4l7.936-4.48-7.232-5.696a1330.368 1330.368 0 0 1-240.512-240.576l-5.696-7.232-4.48 7.936c-16.512 29.12-30.784 59.392-43.072 90.56z" />
          <path d="M554.752 615.36a111.744 111.744 0 0 1-95.36-201.984 111.872 111.872 0 1 1 95.232 202.112l0.128-0.128z" />
        </svg>
        <span className="flex min-w-0 max-w-[800px] flex-1 items-center gap-1.5 [line-height:inherit]">
          <span
            className={`min-w-0 break-words font-medium ${
              props.thinkingActive ? "thinking-title-shimmer" : ""
            }`}
          >
            {t("session.thinking_block_title")}
          </span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden
          />
        </span>
      </button>
      {expanded && paragraphs.length > 0 ? (
        <div className="mt-2 flex items-stretch gap-2 text-[#61666b] [font-size:inherit] [line-height:inherit]">
            <div className="relative flex w-[14px] shrink-0 flex-col items-center" aria-hidden>
            <div className="flex min-h-[1lh] w-full shrink-0 items-center justify-center">
              <span className="h-1 w-1 rounded-full bg-gray-8" />
            </div>
            <div className="relative min-h-0 w-full flex-1">
              <div className="absolute bottom-0 left-1/2 top-1 w-[0.5px] -translate-x-1/2 bg-gray-6" />
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-3 [&>p]:leading-relaxed">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatStructuredValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasStructuredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

async function openFileWithOS(path: string) {
  try {
    await openDesktopPath(path);
  } catch {
    // silently fail on web
  }
}

async function revealFileInFinder(path: string) {
  try {
    await revealDesktopItemInDir(path);
  } catch {
    // silently fail on web
  }
}

function fallbackCopyPlainText(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

async function copyPlainTextToClipboard(text: string): Promise<boolean> {
  const payload = text ?? "";
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
      return true;
    }
  } catch {
    // Clipboard API can fail (permissions / embedded WebView); fall back below.
  }
  return fallbackCopyPlainText(payload);
}

function CopyButton(props: { getText: () => string; variant?: "bordered" | "ghost" }) {
  const [copied, setCopied] = useState(false);
  const ghost = props.variant === "ghost";

  return (
    <button
      type="button"
      className={
        ghost
          ? "inline-flex items-center justify-center rounded-lg p-1.5 text-dls-secondary transition-colors hover:bg-dls-hover/90 hover:text-dls-text"
          : "inline-flex items-center justify-center rounded-lg border border-dls-border bg-dls-surface p-1.5 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
      }
      title="Copy message"
      onClick={async () => {
        const ok = await copyPlainTextToClipboard(props.getText());
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/**
 * Edit button shown alongside CopyButton on user message hover. Clicking turns
 * the user message into an inline composer (handled by SessionSurface).
 */
function EditButton(props: {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  return (
    <button
      type="button"
      className={
        "inline-flex items-center justify-center rounded-lg p-1.5 text-dls-secondary transition-colors " +
        (props.disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-dls-hover/90 hover:text-dls-text")
      }
      title={props.disabled ? props.disabledReason ?? t("session.edit_disabled") : t("session.edit_message")}
      aria-label={t("session.edit_message")}
      disabled={props.disabled}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      <Pencil size={14} />
    </button>
  );
}

/** Expandable chip for collapsed pasted text in sent messages. */
function PastedTextChip(props: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = props.text.split(/\r?\n/).length;

  return (
    <span className="inline">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border border-amber-6/35 bg-amber-3/15 px-2.5 py-0.5 text-xs font-medium text-amber-11 transition-colors hover:bg-amber-3/30"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Collapse pasted text" : "Expand pasted text"}
      >
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
        <span>Pasted · {lineCount} line{lineCount === 1 ? "" : "s"}</span>
      </button>
      {expanded ? (
        <div className="mt-1.5 mb-1.5 rounded-xl border border-amber-6/20 bg-amber-3/10 px-4 py-3 text-xs leading-5 text-dls-text">
          <pre className="whitespace-pre-wrap break-words font-mono">{props.text}</pre>
        </div>
      ) : null}
    </span>
  );
}

const PASTE_TOKEN_RE = /(\[pasted text [^\]]+\])/;

function HighlightedPlainText(props: {
  text: string;
  className: string;
  highlightQuery?: string;
  /** Map of paste label -> full text for expandable chips */
  pastedTextMap?: Map<string, string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [props.highlightQuery, props.text]);

  // If no paste tokens present, render as plain text (fast path).
  if (!props.pastedTextMap?.size || !PASTE_TOKEN_RE.test(props.text)) {
    return (
      <div ref={rootRef} className={props.className}>
        {props.text}
      </div>
    );
  }

  // Split on paste tokens and render chips inline.
  const segments = props.text.split(PASTE_TOKEN_RE);
  return (
    <div ref={rootRef} className={props.className}>
      {segments.map((segment, index) => {
        const match = segment.match(/^\[pasted text (.+)\]$/);
        if (match?.[1]) {
          const pastedBody = props.pastedTextMap?.get(match[1]);
          if (pastedBody) {
            return <PastedTextChip key={index} label={match[1]} text={pastedBody} />;
          }
        }
        return <span key={index}>{segment}</span>;
      })}
    </div>
  );
}

function FileCard(props: {
  part: { filename?: string; url: string; mediaType: string };
  tone: "assistant" | "user";
  aiworkServerBaseUrl?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rawUrl = props.part.url ?? "";
  const displayUrl =
    props.aiworkServerBaseUrl?.trim() && rawUrl
      ? resolveWorkspaceApiUrl(rawUrl, props.aiworkServerBaseUrl)
      : rawUrl;
  const isDataUrl = rawUrl.startsWith("data:");
  const isWorkspaceApiPath = rawUrl.startsWith("/workspace/");
  const title = props.part.filename || (isDataUrl ? "Attached file" : rawUrl) || "File";
  const ext = props.part.filename?.split(".").pop()?.toLowerCase();
  const badge = humanMediaType(props.part.mediaType) ?? (ext ? ext.toUpperCase() : null);
  const isImage = isImageAttachment(props.part.mediaType ?? "");
  const isDesktop = true;
  const hasPath = !isDataUrl && !isWorkspaceApiPath && rawUrl && !rawUrl.startsWith("http");

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
        props.tone === "user"
          ? "border-gray-6/60 bg-gray-3/40 hover:bg-gray-3/70 dark:bg-gray-3/20 dark:hover:bg-gray-3/35"
          : "border-gray-6/40 bg-gray-3/40 hover:bg-gray-3/70 dark:bg-gray-3/20 dark:hover:bg-gray-3/35"
      }`}
    >
      {isImage && displayUrl ? (
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-dls-border/60 bg-dls-surface">
          <img src={displayUrl} alt={title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            props.tone === "user" ? "bg-gray-3/60 text-gray-11" : "bg-gray-2/60 text-gray-10"
          }`}
        >
          <FileIcon size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-snug text-gray-12">{title}</div>
        {badge ? (
          <div className="mt-1 inline-flex rounded-md bg-gray-3/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-10">
            {badge}
          </div>
        ) : null}
      </div>

      {isDesktop && hasPath ? (
        <div className="relative">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-9 opacity-0 transition-all hover:bg-gray-3/60 hover:text-gray-12 group-hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            title="File actions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-2xl border border-dls-border bg-dls-surface p-1.5 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3/60"
                  onClick={() => {
                    void openFileWithOS(rawUrl);
                    setMenuOpen(false);
                  }}
                >
                  Open with default app
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3/60"
                  onClick={() => {
                    void revealFileInFinder(rawUrl);
                    setMenuOpen(false);
                  }}
                >
                  Reveal in Finder
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3/60"
                  onClick={() => {
                    void navigator.clipboard.writeText(displayUrl || rawUrl);
                    setMenuOpen(false);
                  }}
                >
                  Copy path
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Mutate root `<svg>` so the preview spans the card width (inline render + intrinsic sizing). */
function prepareWrittenFileSvgForFullWidthRender(svgText: string): string {
  const trimmed = svgText.trim();
  let replaced = false;
  return trimmed.replace(/<svg\b[\s\S]*?>/i, (openTag) => {
    if (replaced) return openTag;
    replaced = true;
    const inner = openTag.slice(4, -1);
    let attrs = inner
      .replace(/\swidth\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .replace(/\sheight\s*=\s*("[^"]*"|'[^']*')/gi, "");
    const inject =
      "display:block;margin:0;padding:0;max-width:100%;width:100%;height:auto;vertical-align:top";
    const dq = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
    const sq = attrs.match(/\sstyle\s*=\s*'([^']*)'/i);
    if (dq) {
      const prev = dq[1].trim().replace(/;+\s*$/, "");
      attrs = attrs.replace(/\sstyle\s*=\s*"[^"]*"/i, ` style="${prev};${inject}"`);
    } else if (sq) {
      const prev = sq[1].trim().replace(/;+\s*$/, "");
      attrs = attrs.replace(/\sstyle\s*=\s*'[^']*'/i, ` style='${prev};${inject}'`);
    } else {
      attrs += ` style="${inject}"`;
    }
    return `<svg${attrs}>`;
  });
}

function writtenFileRichPreviewKind(filename: string): "svg" | "html" | null {
  const l = filename.toLowerCase();
  if (l.endsWith(".svg")) return "svg";
  // HTML/Htmlx files no longer show rich previews in conversation cards — they fall back to
  // the standard file row with optional diff panel, same as other code file types.
  return null;
}

function WrittenFileRow(props: {
  touch: WorkspaceWriteTouch;
  workspaceRoot: string;
  desktop: boolean;
  onAiWorkspaceRelativePath?: (relativePath: string) => void;
  fetchWorkspaceFileText?: (relativePath: string) => Promise<string | undefined>;
  /** Pre-bound SVG fetcher that reads from checkpoint (already has messageId bound) */
  fetchCheckpointSvgText?: (relativePath: string) => Promise<string | undefined>;
  /** Unique key for SVG preview cache (typically workspaceId) */
  writtenFileSvgQueryKey?: string;
  /** Message-specific key to distinguish checkpoint SVG cache per message (typically messageId) */
  writtenFileSvgCheckpointKey?: string;
}) {
  const [diffExpanded, setDiffExpanded] = useState(false);

  const badge =
    props.touch.kind === "created"
      ? t("session.written_file_badge_new")
      : t("session.written_file_badge_modified");
  const metaLine = props.touch.extLabel ? `${badge} · ${props.touch.extLabel}` : badge;

  const canTryOpen =
    Boolean(props.onAiWorkspaceRelativePath) ||
    (props.desktop &&
      (looksAbsoluteWorkspacePath(props.touch.displayPath) || Boolean(props.workspaceRoot.trim())));

  const hasDiff = Boolean(props.touch.diffText?.trim());

  /** Parse additions/deletions count and rename info from diffText */
  const diffStats = useMemo(() => {
    if (!props.touch.diffText) return null;
    let additions = 0;
    let deletions = 0;
    let renamedFrom: string | null = null;
    for (const line of props.touch.diffText.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) { additions++; continue; }
      if (line.startsWith("-") && !line.startsWith("---")) { deletions++; continue; }
      // Detect rename: "--- a/old/path" and "+++ b/new/path" differ
      if (line.startsWith("--- ")) {
        const old = line.slice(4).replace(/^a\//, "");
        const newFilename = props.touch.filename;
        if (old && old !== newFilename && !old.startsWith("/dev/null")) {
          renamedFrom = old.split("/").pop() ?? old;
        }
      }
    }
    return { additions, deletions, renamedFrom };
  }, [props.touch.diffText, props.touch.filename]);

  const previewKind = writtenFileRichPreviewKind(props.touch.filename);
  const previewFetchPath = useMemo(() => {
    if (!previewKind) return null;
    // Always normalize to workspace-relative path: `git show <sha>:<path>` and
    // `readWorkspaceFile()` both expect workspace-relative, not absolute paths.
    const rel = workspaceRelativePathForServerRead(props.touch.displayPath, props.workspaceRoot);
    if (!rel) return null;
    if (!props.fetchWorkspaceFileText && !(props.fetchCheckpointSvgText && previewKind === "svg")) return null;
    return rel;
  }, [previewKind, props.fetchWorkspaceFileText, props.fetchCheckpointSvgText, props.touch.displayPath, props.workspaceRoot]);

  /** When checkpoint SVG fetcher is available, prefer it for SVG files */
  const useCheckpointSvg = Boolean(
    previewKind === "svg" &&
    props.fetchCheckpointSvgText &&
    previewFetchPath,
  );

  const filePreviewQuery = useQuery({
    queryKey: [
      "sessionWrittenFilePreview",
      props.writtenFileSvgQueryKey ?? "",
      props.touch.displayPath,
      previewKind ?? "",
      useCheckpointSvg ? "checkpoint" : "live",
      props.writtenFileSvgCheckpointKey ?? "",
    ],
    queryFn: async () => {
      if (useCheckpointSvg) {
        // Try checkpoint first for the SVG version at message time
        const checkpointText = await props.fetchCheckpointSvgText!(previewFetchPath!);
        if (typeof checkpointText === "string" && checkpointText.trim()) {
          return checkpointText;
        }
        // Fall back to live file if checkpoint is unavailable
        if (props.fetchWorkspaceFileText) {
          const livePath = workspaceRelativePathForServerRead(props.touch.displayPath, props.workspaceRoot);
          if (livePath) {
            const liveText = await props.fetchWorkspaceFileText(livePath);
            if (typeof liveText === "string" && liveText.trim()) return liveText;
          }
        }
        throw new Error("empty file");
      }
      const text = await props.fetchWorkspaceFileText!(previewFetchPath!);
      if (typeof text !== "string" || !text.trim()) throw new Error("empty file");
      return text;
    },
    enabled: Boolean(
      previewKind &&
      previewFetchPath &&
      (useCheckpointSvg || props.fetchWorkspaceFileText),
    ),
    staleTime: 20_000,
    /** Virtualized transcript rows unmount off-screen observers; keep payload long enough to survive scroll-away/back. */
    gcTime: 1000 * 60 * 60,
    retry: 2,
  });

  const previewRaw = filePreviewQuery.data;
  const hasPreviewContent = typeof previewRaw === "string" && previewRaw.trim().length > 0;

  const svgMarkup = useMemo(() => {
    if (previewKind !== "svg" || !hasPreviewContent || typeof previewRaw !== "string") return null;
    return prepareWrittenFileSvgForFullWidthRender(previewRaw);
  }, [previewKind, hasPreviewContent, previewRaw]);

  const htmlSrcDoc = useMemo(() => {
    if (previewKind !== "html" || !hasPreviewContent || typeof previewRaw !== "string") return null;
    return buildWebPreviewSrcDoc(previewRaw);
  }, [previewKind, hasPreviewContent, previewRaw]);

  const showRichPreview =
    Boolean(previewKind && previewFetchPath && (useCheckpointSvg || props.fetchWorkspaceFileText)) &&
    hasPreviewContent &&
    (previewKind === "html" || Boolean(svgMarkup));

  const handleView = () => {
    if (props.onAiWorkspaceRelativePath) {
      props.onAiWorkspaceRelativePath(props.touch.displayPath);
      return;
    }
    void (async () => {
      try {
        const raw = props.touch.displayPath.trim();
        let absolute: string;
        if (looksAbsoluteWorkspacePath(raw)) {
          absolute = raw;
        } else {
          const root = props.workspaceRoot.trim();
          if (!root) return;
          absolute = await joinDesktopPath(root, props.touch.displayPath);
        }
        await openDesktopPath(absolute);
      } catch {
        // Desktop-only or permission
      }
    })();
  };

  /**
   * Diff panel — always visible for non-rich-preview files when diff exists.
   * Collapsed to 200px by default, expand button appears on hover.
   * Uses CodeMirror-based DiffCodePreview for syntax highlighting.
   */
  const diffPanel = hasDiff && !showRichPreview ? (
    <div className="group/diff relative border-t border-gray-6/20">
      {/* Syntax-highlighted diff — no padding, fills the card edge-to-edge */}
      <div className={`overflow-hidden ${diffExpanded ? "" : "max-h-[200px]"}`}>
        <DiffCodePreview
          filePath={props.touch.displayPath}
          diffText={props.touch.diffText!}
        />
      </div>

      {/* Expand button — fades in on panel hover, hidden when already expanded */}
      {!diffExpanded ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1.5 opacity-0 transition-opacity group-hover/diff:opacity-100 group-hover/diff:pointer-events-auto">
          {/* gradient fade to mask clipped content */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-gray-3/60 to-transparent dark:from-gray-2/60 rounded-b-2xl" />
          <button
            type="button"
            className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-6/50 bg-dls-surface text-gray-10 shadow-sm transition-colors hover:bg-gray-3/60 hover:text-gray-12"
            onClick={() => setDiffExpanded(true)}
            title="Expand diff"
          >
            <ChevronDown size={13} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1.5 opacity-0 transition-opacity group-hover/diff:opacity-100 group-hover/diff:pointer-events-auto">
          <button
            type="button"
            className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-6/50 bg-dls-surface text-gray-10 shadow-sm transition-colors hover:bg-gray-3/60 hover:text-gray-12"
            onClick={() => setDiffExpanded(false)}
            title="Collapse diff"
          >
            <ChevronUp size={13} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  ) : null;

  /** Buttons row — View only (Diff button removed) */
  const actionButtons = (
    <div className="flex shrink-0 items-center gap-2">
      {canTryOpen ? (
        <button
          type="button"
          className="shrink-0 rounded-xl border border-gray-6/60 bg-dls-surface px-3 py-1.5 text-[13px] font-medium text-gray-12 transition-colors hover:bg-gray-3/40 dark:border-gray-6/50"
          onClick={handleView}
        >
          {t("session.written_file_view")}
        </button>
      ) : null}
    </div>
  );

  if (showRichPreview) {
    return (
      <div
        role="listitem"
        className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-gray-6/40 bg-gray-3/40 transition-colors hover:bg-gray-3/70 dark:bg-gray-3/20 dark:hover:bg-gray-3/35"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden>
            <WorkspacePanelFileGlyph filename={props.touch.displayPath} size={18} className="shrink-0 text-[#000000] dark:text-gray-12" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-[13px] font-medium leading-snug text-gray-12">{props.touch.filename}</div>
              {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) ? (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[12px]">
                  {diffStats.additions > 0 ? <span className="text-green-11">+{diffStats.additions}</span> : null}
                  {diffStats.deletions > 0 ? <span className="text-red-11">-{diffStats.deletions}</span> : null}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-gray-9">
              {diffStats?.renamedFrom ? `${diffStats.renamedFrom} → ${props.touch.filename} · ` : ""}{metaLine}
            </div>
          </div>
          {actionButtons}
        </div>
        {previewKind === "svg" && svgMarkup ? (
          <div
            className="w-full min-w-0 overflow-x-hidden leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : previewKind === "html" && htmlSrcDoc ? (
          <div className="max-h-[min(75vh,1200px)] w-full min-w-0 overflow-hidden bg-white dark:bg-gray-1">
            <iframe
              title={props.touch.filename}
              className="m-0 block h-[min(75vh,1200px)] w-full min-w-0 border-0"
              srcDoc={htmlSrcDoc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            />
          </div>
        ) : null}
      </div>
    );
  }

  const previewWaiting =
    Boolean(previewKind && previewFetchPath && (useCheckpointSvg || props.fetchWorkspaceFileText)) &&
    !hasPreviewContent &&
    (filePreviewQuery.isPending || filePreviewQuery.isFetching);

  return (
    <div
      role="listitem"
      className="relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-6/40 bg-gray-3/40 transition-colors hover:bg-gray-3/70 dark:bg-gray-3/20 dark:hover:bg-gray-3/35"
    >
      <div className="flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden>
          <WorkspacePanelFileGlyph filename={props.touch.displayPath} size={18} className="shrink-0 text-[#000000] dark:text-gray-12" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[13px] font-medium leading-snug text-gray-12">{props.touch.filename}</div>
            {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) ? (
              <span className="flex shrink-0 items-center gap-1 font-mono text-[12px]">
                {diffStats.additions > 0 ? <span className="text-green-11">+{diffStats.additions}</span> : null}
                {diffStats.deletions > 0 ? <span className="text-red-11">-{diffStats.deletions}</span> : null}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-gray-9">
            {diffStats?.renamedFrom ? `${diffStats.renamedFrom} → ${props.touch.filename} · ` : ""}{metaLine}
          </div>
        </div>
        {actionButtons}
      </div>
      {diffPanel}
      {previewWaiting ? (
        <div className="border-t border-gray-6/25 px-4 pb-3 pt-2">
          <div
            className="h-24 w-full animate-pulse rounded-xl bg-gray-3/40 dark:bg-gray-3/25"
            aria-busy
            aria-label={props.touch.filename}
          />
        </div>
      ) : null}
    </div>
  );
}

const AssistantWrittenFiles = memo(function AssistantWrittenFiles(props: {
  message: UIMessage;
  workspaceRoot: string;
  onAiWorkspaceRelativePath?: (relativePath: string) => void;
  fetchWorkspaceFileText?: (relativePath: string) => Promise<string | undefined>;
  fetchCheckpointFileText?: (messageId: string, relativePath: string) => Promise<string | undefined>;
  writtenFileSvgQueryKey?: string;
  /**
   * The ID of the user message that preceded this assistant message.
   * Checkpoints are tagged with user message IDs (created before each user send),
   * so we need the user ID — not the assistant ID — to look up the right checkpoint.
   */
  precedingUserMessageId?: string;
  /** Reserve space when a floating copy control sits at the bottom-right of the bubble */
  clearFloatingCopySlot?: boolean;
}) {
  const touches = useMemo(
    () => deriveWorkspaceWriteTouchesFromUIMessage(props.message),
    [props.message],
  );
  const desktop = true;

  /**
   * Use the PRECEDING USER message ID for checkpoint lookup.
   * Checkpoints are created before each user send and tagged with the user's messageID.
   * The assistant's own message.id will never match any checkpoint entry.
   */
  const checkpointLookupId = props.precedingUserMessageId;

  /** Pre-bind checkpointLookupId so WrittenFileRow only needs (relativePath) -> string | undefined */
  const checkpointSvgFetcher = useMemo(() => {
    if (!props.fetchCheckpointFileText || !checkpointLookupId) return undefined;
    return (relativePath: string) =>
      props.fetchCheckpointFileText!(checkpointLookupId, relativePath);
  }, [props.fetchCheckpointFileText, checkpointLookupId]);

  if (touches.length === 0) return null;

  return (
    <div
      className={`mt-4 w-full space-y-2 ${props.clearFloatingCopySlot ? "pb-9" : ""}`.trim()}
      role="list"
      aria-label={t("session.written_files_list_aria")}
    >
      {touches.map((touch) => (
        <WrittenFileRow
          key={touch.displayPath}
          touch={touch}
          workspaceRoot={props.workspaceRoot}
          desktop={desktop}
          onAiWorkspaceRelativePath={props.onAiWorkspaceRelativePath}
          fetchWorkspaceFileText={props.fetchWorkspaceFileText}
          fetchCheckpointSvgText={checkpointSvgFetcher}
          writtenFileSvgQueryKey={props.writtenFileSvgQueryKey}
          writtenFileSvgCheckpointKey={checkpointSvgFetcher ? checkpointLookupId : undefined}
        />
      ))}
    </div>
  );
});
AssistantWrittenFiles.displayName = "AssistantWrittenFiles";

type ReasoningStreamContext = {
  isStreaming: boolean;
  messageId: string;
  latestAssistantMessageId: string;
  isLastReasoningPart: boolean;
};

function StepRow(props: {
  id: string;
  part: TranscriptPart;
  expanded: boolean;
  onToggle: () => void;
  todos: TodoItem[];
  reasoningStreamContext?: ReasoningStreamContext;
}) {
  const summary = useMemo(() => summarizeStep(props.part), [props.part]);
  const toolState = useMemo(() => {
    if (props.part.type !== "tool") return {} as Record<string, unknown>;
    return (((props.part as { state?: unknown }).state ?? {}) as Record<string, unknown>);
  }, [props.part]);
  const toolName = props.part.type === "tool" ? String((props.part as { tool?: unknown }).tool ?? "") : "";
  const toolNameLower = toolName.toLowerCase();
  const toolInput = toolState.input && typeof toolState.input === "object"
    ? (toolState.input as Record<string, unknown>)
    : undefined;
  const toolOutput = toolState.output;
  const toolError = typeof toolState.error === "string" ? toolState.error : null;
  /** Tool call still in flight until transcript carries output or error (matches UI part → legacy mapping). */
  const toolExecuting =
    props.part.type === "tool" && toolOutput === undefined && toolError === null;
  const expandable =
    props.part.type === "tool" &&
    (hasStructuredValue(toolInput) || hasStructuredValue(toolOutput) || Boolean(toolError));
  const headline = summary.title?.trim() || "Step updates progress";

  if (props.part.type === "reasoning") {
    const raw = typeof (props.part as { text?: unknown }).text === "string"
      ? (props.part as { text: string }).text
      : "";
    const rState = (props.part as { state?: string }).state;
    let thinkingActive = rState === "streaming";
    const ctx = props.reasoningStreamContext;
    if (
      !thinkingActive &&
      rState !== "done" &&
      ctx &&
      ctx.isStreaming &&
      ctx.messageId === ctx.latestAssistantMessageId &&
      ctx.isLastReasoningPart
    ) {
      thinkingActive = true;
    }
    return <ThinkingCollapsible text={raw || headline} thinkingActive={thinkingActive} />;
  }

  if (props.part.type === "tool" && (toolNameLower === "todowrite" || toolNameLower === "todoread")) {
    /**
     * Prefer the per-call todos snapshot stored in the tool part itself, so historical
     * cards show what the tool wrote/read AT THAT TIME. Falls back to the session-wide
     * live `props.todos` only when the snapshot can't be parsed (e.g. corrupted data).
     *
     * Why: `props.todos` is a single live cache of the session's CURRENT todo list.
     * Without this fallback ladder, every old todoread/todowrite card on the timeline
     * flips to "No tasks" the moment the agent later clears or replaces the todo list.
     */
    const parseTodosSnapshot = (value: unknown): TodoItem[] | null => {
      if (!value) return null;
      let candidate: unknown = value;
      // Output may be a JSON string (some providers return text); try to JSON.parse it.
      if (typeof candidate === "string") {
        try {
          candidate = JSON.parse(candidate);
        } catch {
          return null;
        }
      }
      // Accept either { todos: [...] } or a raw array.
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        const next = (candidate as { todos?: unknown }).todos;
        if (Array.isArray(next)) candidate = next;
      }
      if (!Array.isArray(candidate)) return null;
      const result: TodoItem[] = [];
      for (let i = 0; i < candidate.length; i++) {
        const entry = candidate[i];
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const content = typeof e.content === "string" ? e.content : "";
        if (!content.trim()) continue;
        result.push({
          id: typeof e.id === "string" ? e.id : `${i}-${content}`,
          content,
          status: typeof e.status === "string" ? e.status : "pending",
          priority: typeof e.priority === "string" ? e.priority : "medium",
        });
      }
      return result.length > 0 ? result : null;
    };

    // todowrite: input.todos is the snapshot being written.
    // todoread:  output is the snapshot being read.
    const snapshotFromInput =
      toolNameLower === "todowrite" && toolInput
        ? parseTodosSnapshot((toolInput as { todos?: unknown }).todos ?? toolInput)
        : null;
    const snapshotFromOutput =
      !snapshotFromInput && toolOutput !== undefined ? parseTodosSnapshot(toolOutput) : null;

    const sourceTodos = snapshotFromInput ?? snapshotFromOutput ?? props.todos;
    const todos = sourceTodos.filter((todo) => todo.content.trim());
    const completed = todos.filter((todo) => todo.status === "completed").length;
    const total = todos.length;

    return (
      <div className="text-[14px] text-gray-9">
        <button
          type="button"
          className="w-full py-0.5 text-left transition-colors hover:text-dls-text"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          <span className="flex w-full max-w-[800px] items-center gap-2 leading-relaxed">
            <ToolStepTitleGlyph className="size-[14px] shrink-0 text-gray-10" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`min-w-0 break-words font-medium ${toolExecuting ? "thinking-title-shimmer" : ""}`}
              >
                {headline}
              </span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-gray-8 transition-transform ${
                  props.expanded ? "" : "-rotate-90"
                }`}
              />
            </span>
          </span>
        </button>

        <div className="mt-3 w-full">
          {props.expanded ? (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-3">
              {hasStructuredValue(toolInput) ? (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-8">
                    Request
                  </div>
                  <pre className="overflow-x-auto rounded-[16px] border border-dls-border/70 bg-dls-surface px-4 py-3 text-[12px] leading-6 text-gray-10">
                    {formatStructuredValue(toolInput)}
                  </pre>
                </div>
              ) : null}
              {hasStructuredValue(toolOutput) ? (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-8">
                    Result
                  </div>
                  <pre className="overflow-x-auto rounded-[16px] border border-dls-border/70 bg-dls-surface px-4 py-3 text-[12px] leading-6 text-gray-10">
                    {formatStructuredValue(toolOutput)}
                  </pre>
                </div>
              ) : null}
              {toolError ? (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-red-10">
                    Error
                  </div>
                  <pre className="overflow-x-auto rounded-[16px] border border-red-6/40 bg-red-3/20 px-4 py-3 text-[12px] leading-6 text-red-11">
                    {toolError}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            className={`w-full rounded-[20px] border border-dls-border bg-dls-surface ${
              props.expanded ? "mt-3" : ""
            }`}
          >
            <div className="border-b border-dls-border px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-12">Todo</div>
                <div className="mt-0.5 text-[11px] text-gray-11">
                  {total > 0 ? `${completed} / ${total} completed` : "No tasks"}
                </div>
              </div>
            </div>
            <div className="space-y-2.5 px-4 pb-3">
              {todos.map((todo, index) => {
                const done = todo.status === "completed";
                const cancelled = todo.status === "cancelled";
                const active = todo.status === "in_progress";
                return (
                  <div
                    key={todo.id || `${todo.content}-${index}`}
                    className="flex items-start gap-2.5 pt-2.5 first:pt-2.5"
                  >
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <div
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded-full border ${
                          done
                            ? "border-green-6 bg-green-2 text-green-11"
                            : active
                              ? "border-blue-6 bg-blue-2 text-blue-11"
                              : cancelled
                                ? "border-gray-6 bg-gray-2 text-gray-8"
                                : "border-gray-6 bg-gray-1 text-gray-8"
                        }`}
                      >
                        {done ? (
                          <Check size={10} />
                        ) : active ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-9" />
                        ) : null}
                      </div>
                    </div>
                    <div
                      className={`flex-1 text-sm leading-relaxed ${
                        cancelled ? "text-gray-9 line-through" : "text-gray-12"
                      }`}
                    >
                      <span className="mr-1.5 text-gray-9">{index + 1}.</span>
                      {todo.content}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-[14px] text-gray-9">
      <button
        type="button"
        className="w-full py-0.5 text-left transition-colors hover:text-dls-text disabled:cursor-default"
        aria-expanded={expandable ? props.expanded : undefined}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          props.onToggle();
        }}
      >
        <span className="flex w-full max-w-[800px] items-center gap-2 leading-relaxed">
          {props.part.type === "tool" ? (
            <ToolStepTitleGlyph className="size-[14px] shrink-0 text-gray-10" />
          ) : null}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`min-w-0 break-words font-medium ${toolExecuting ? "thinking-title-shimmer" : ""}`}
            >
              {headline}
            </span>
            {expandable ? (
              <ChevronDown
                size={14}
                className={`shrink-0 text-gray-8 transition-transform ${
                  props.expanded ? "" : "-rotate-90"
                }`}
              />
            ) : null}
          </span>
        </span>
      </button>
      {props.expanded ? (
        <div
          className="mt-3 ml-[22px] max-h-[420px] space-y-3 overflow-y-auto pr-3"
          data-scrollable="true"
        >
          {hasStructuredValue(toolInput) ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-8">Request</div>
              <pre className="overflow-x-auto rounded-[16px] border border-dls-border/70 bg-dls-surface px-4 py-3 text-[12px] leading-6 text-gray-10">
                {formatStructuredValue(toolInput)}
              </pre>
            </div>
          ) : null}
          {hasStructuredValue(toolOutput) ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-8">Result</div>
              <pre className="overflow-x-auto rounded-[16px] border border-dls-border/70 bg-dls-surface px-4 py-3 text-[12px] leading-6 text-gray-10">
                {formatStructuredValue(toolOutput)}
              </pre>
            </div>
          ) : null}
          {toolError ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-red-10">Error</div>
              <pre className="overflow-x-auto rounded-[16px] border border-red-6/40 bg-red-3/20 px-4 py-3 text-[12px] leading-6 text-red-11">
                {toolError}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StepsContainer(props: {
  stepGroups: StepTimelineGroup[];
  isUser: boolean;
  isInline?: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  todos: TodoItem[];
  reasoningStreamContext?: Omit<ReasoningStreamContext, "isLastReasoningPart">;
}) {
  const reasoningPartIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of props.stepGroups) {
      for (const part of group.parts) {
        if (part.type === "reasoning") {
          ids.push(part.id);
        }
      }
    }
    return ids;
  }, [props.stepGroups]);

  const toggleSteps = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const stepRow = (groupId: string, part: TranscriptPart, index: number) => {
    const rowId = `${groupId}:${index}`;
    const baseCtx = props.reasoningStreamContext;
    const isLastReasoning =
      part.type === "reasoning" &&
      reasoningPartIds.length > 0 &&
      part.id === reasoningPartIds[reasoningPartIds.length - 1];
    const reasoningCtx =
      baseCtx && part.type === "reasoning"
        ? { ...baseCtx, isLastReasoningPart: Boolean(isLastReasoning) }
        : undefined;
    return (
      <StepRow
        key={rowId}
        id={rowId}
        part={part}
        expanded={props.expandedStepIds.has(rowId)}
        onToggle={() => toggleSteps(rowId)}
        todos={props.todos}
        reasoningStreamContext={reasoningCtx}
      />
    );
  };

  return (
    <div className={props.isInline ? (props.isUser ? "mt-3" : "mt-4") : ""}>
      <div className="flex flex-col gap-4">
        {props.stepGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-4">
            {group.parts.map((part, index) => stepRow(group.id, part, index))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionTranscriptInner(props: SessionTranscriptProps) {
  const showThinking = props.showThinking ?? props.developerMode;
  const isNestedVariant = props.variant === "nested";
  const todos = props.todos ?? [];
  const [internalExpandedStepIds, setInternalExpandedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedStepIds = props.expandedStepIds ?? internalExpandedStepIds;
  const onExpandedStepIdsChange =
    props.onExpandedStepIdsChange ??
    ((updater: (current: Set<string>) => Set<string>) => {
      setInternalExpandedStepIds((current) => updater(current));
    });

  const assistantQaCopyByLastId = useMemo(
    () => buildAssistantQaCopyTextByLastId(props.messages),
    [props.messages],
  );

  const resolveRemoteHref = useMemo(() => {
    const base = props.aiworkServerBaseUrl?.trim();
    if (!base) return undefined;
    return (href: string) => resolveWorkspaceApiUrl(href, base);
  }, [props.aiworkServerBaseUrl]);

  const transcriptMessages = useMemo<TranscriptMessage[]>(() => {
    return props.messages.map((message) => ({
      id: message.id,
      role: message.role,
      source: message,
      parts: message.parts
        .map((part, index) => toLegacyPart(part, `${message.id}:${index}`))
        .filter((part): part is TranscriptPart => Boolean(part)),
    }));
  }, [props.messages]);

  // Cache of the previous messageBlocks array, indexed by identity key.
  // Used by useStableBlocks below so structurally-equivalent blocks keep
  // their previous object reference across renders.
  const previousBlocksRef = useRef<Map<string, MessageBlockItem>>(new Map());

  const rawMessageBlocks = useMemo<MessageBlockItem[]>(() => {
    const blocks: MessageBlockItem[] = [];

    transcriptMessages.forEach((message) => {
      const renderableParts = message.parts.filter((part) => {
        if (part.type === "reasoning") {
          return showThinking;
        }

        if (part.type === "step-start" || part.type === "step-finish") {
          return false;
        }

        return (
          part.type === "text" ||
          part.type === "tool" ||
          part.type === "agent" ||
          part.type === "file" ||
          props.developerMode
        );
      });

      if (!renderableParts.length) return;

      const isUser = message.role === "user";
      const attachments = attachmentsForParts(renderableParts);
      const nonAttachmentParts = renderableParts.filter((part) => !isAttachmentPart(part));
      const groups = groupMessageParts(nonAttachmentParts, message.id);
      const isStepsOnly = groups.length > 0 && groups.every((group) => group.kind === "steps");
      const stepGroups = isStepsOnly
        ? (groups as Array<{
            kind: "steps";
            id: string;
            parts: TranscriptPart[];
            segment: "execution";
            mode: StepGroupMode;
          }>).map((group) => ({
            id: group.id,
            parts: group.parts,
            mode: group.mode,
          }))
        : [];

      if (isStepsOnly && stepGroups.length > 0) {
        blocks.push({
          kind: "steps-cluster",
          id: stepGroups[0].id,
          stepGroups,
          messageIds: [message.id],
          isUser,
        });
        return;
      }

      blocks.push({
        kind: "message",
        message: message.source,
        renderableParts,
        attachments,
        groups,
        isUser,
        messageId: message.id,
      });
    });

    return blocks;
  }, [props.developerMode, showThinking, transcriptMessages]);

  // Structural sharing: reuse the previous block object reference for any
  // block whose content is equivalent. During streaming, only the active
  // assistant message's block is actually new — every other block in the
  // transcript keeps its previous reference, which means every
  // React.memo'd descendant (MarkdownBlock, SessionTranscript itself, and
  // any future per-row components) gets a pointer-equal prop and can bail
  // out of rendering entirely.
  const messageBlocks = useMemo<MessageBlockItem[]>(() => {
    const prev = previousBlocksRef.current;
    const next = new Map<string, MessageBlockItem>();
    const stable: MessageBlockItem[] = rawMessageBlocks.map((block) => {
      const key = blockIdentityKey(block);
      const prevBlock = prev.get(key);
      const reused = blocksAreEquivalent(prevBlock, block) ? (prevBlock as MessageBlockItem) : block;
      next.set(key, reused);
      return reused;
    });
    previousBlocksRef.current = next;
    return stable;
  }, [rawMessageBlocks]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if (message?.role === "assistant") {
        return message.id;
      }
    }
    return "";
  }, [props.messages]);

  const blockIndexByMessageId = useMemo(() => {
    const next = new Map<string, number>();
    messageBlocks.forEach((block, index) => {
      if (block.kind === "steps-cluster") {
        block.messageIds.forEach((id) => {
          if (id) next.set(id, index);
        });
        return;
      }

      if (block.messageId) {
        next.set(block.messageId, index);
      }
    });
    return next;
  }, [messageBlocks]);

  // Decide to virtualize based only on block count. Do NOT gate on whether
  // the scrollElement ref has already attached — that's false on the first
  // render of a session, which used to make us render every message
  // eagerly (freezing the UI on large sessions) for one tick before
  // switching to virtualization.
  const shouldVirtualize = messageBlocks.length >= VIRTUALIZATION_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: messageBlocks.length,
    getScrollElement: () => props.scrollElement?.() ?? null,
    // Give react-virtual a shape-aware estimate so the initial scroll
    // height is closer to reality. Small steps-cluster rows are much
    // shorter than full assistant message blocks; a good estimate means
    // fewer measurement-driven scroll corrections as rows come into view.
    estimateSize: (index) => {
      const block = messageBlocks[index];
      if (!block) return 180;
      if (block.kind === "steps-cluster") return 80;
      return block.isUser ? 96 : 320;
    },
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => {
      const block = messageBlocks[index];
      if (!block) return `block-${index}`;
      if (block.kind === "steps-cluster") {
        return `steps-${block.messageIds.join(",")}`;
      }
      return `message-${block.messageId}`;
    },
  });

  const virtualRows = shouldVirtualize ? virtualizer.getVirtualItems() : [];

  useEffect(() => {
    const register = props.setScrollToMessageById;
    if (!register) return;

    register((messageId, behavior = "smooth") => {
      const index = blockIndexByMessageId.get(messageId);
      if (index === undefined) return false;

      if (shouldVirtualize) {
        virtualizer.scrollToIndex(index, { align: "center" });
        return true;
      }

      const container = props.scrollElement?.();
      if (!container) return false;
      const escapedId = messageId.replace(/"/g, '\\"');
      const target = container.querySelector(`[data-message-id="${escapedId}"]`) as HTMLElement | null;
      if (!target) return false;
      target.scrollIntoView({ behavior, block: "center" });
      return true;
    });

    return () => {
      register(null);
    };
  }, [blockIndexByMessageId, props.scrollElement, props.setScrollToMessageById, shouldVirtualize, virtualizer]);

  // NOTE: we intentionally do NOT call virtualizer.measure() on every
  // messageBlocks change. react-virtual already invalidates and
  // re-measures rows whose refs remount or whose content changes. Calling
  // measure() explicitly on each streaming token forces a synchronous
  // getBoundingClientRect() pass over every measured row, which made
  // streaming into large sessions feel like the UI was frozen.

  // Apply content-visibility earlier too. Even when the transcript is below
  // the virtualization threshold, hiding distant blocks from layout/paint
  // work reduces the chance that one large session makes the UI feel frozen.
  const shouldUseContentVisibility = !shouldVirtualize && messageBlocks.length > 24;

  const blockPerfStyle = (index: number): CSSProperties | undefined => {
    if (!shouldUseContentVisibility) return undefined;
    const total = messageBlocks.length;
      if (index >= total - 12) return undefined;
      return {
        contentVisibility: "auto",
        containIntrinsicSize: "180px",
      };
    };

  const renderBlock = (block: MessageBlockItem, blockIndex: number) => {
    const blockMessageIds = block.kind === "steps-cluster" ? block.messageIds : [block.messageId];
    const hasSearchMatch = blockMessageIds.some((id) => props.searchMatchMessageIds?.has(id));
    const hasActiveSearchMatch = blockMessageIds.some((id) => id === props.activeSearchMessageId);
    const searchOutlineClass = hasActiveSearchMatch
      ? "outline outline-2 outline-amber-8/70 outline-offset-2 rounded-2xl"
      : hasSearchMatch
        ? "outline outline-1 outline-amber-7/50 outline-offset-1 rounded-2xl"
        : "";

    if (block.kind === "steps-cluster") {
      const clusterMessage =
        !block.isUser && block.messageIds[0]
          ? props.messages.find((m) => m.id === block.messageIds[0])
          : undefined;
      const clusterMsgId = block.messageIds[0] ?? "";
      const showClusterQaFooter =
        !isNestedVariant && !block.isUser && assistantQaCopyByLastId.has(clusterMsgId);
      /** Hide copy/meta hover chrome while the latest assistant message is still streaming. */
      const showClusterQaFooterChrome =
        showClusterQaFooter && !(props.isStreaming && clusterMsgId === latestAssistantMessageId);
      const clusterFooterMeta = showClusterQaFooter
        ? props.assistantReplyMetaById?.get(clusterMsgId)
        : undefined;

      return (
        <div
          key={`steps-${block.id}`}
          className={`flex group ${block.isUser ? "justify-end" : "justify-start"}`.trim()}
          data-message-role={block.isUser ? "user" : "assistant"}
          data-message-id={block.messageIds[0] ?? ""}
          style={{ contain: "layout style paint", marginBottom: 0, marginTop: 10, ...blockPerfStyle(blockIndex) }}
        >
          <div
            className={`${
              block.isUser
                ? isNestedVariant
                  ? "relative max-w-[92%] rounded-[12px] bg-[rgba(0,0,0,0.04)] px-4 py-[9px] text-[14px] leading-relaxed text-[rgba(0,0,0,0.85)] dark:bg-white/[0.08] dark:text-gray-12"
                  : "relative max-w-[85%] rounded-[12px] bg-[rgba(0,0,0,0.04)] px-4 py-[9px] text-[15px] leading-relaxed text-[rgba(0,0,0,0.85)] dark:bg-white/[0.08] dark:text-gray-12"
                : isNestedVariant
                  ? "w-full relative text-[14px] leading-[1.65] text-dls-text group"
                  : `w-full relative max-w-[800px] text-[15px] leading-[1.7] text-dls-text group${
                      showClusterQaFooterChrome ? " pb-7" : ""
                    }`
            } ${searchOutlineClass}`}
          >
            <StepsContainer
              stepGroups={block.stepGroups}
              isUser={block.isUser}
              expandedStepIds={expandedStepIds}
              onExpandedStepIdsChange={onExpandedStepIdsChange}
              todos={todos}
              reasoningStreamContext={{
                isStreaming: props.isStreaming,
                messageId: block.messageIds[0] ?? "",
                latestAssistantMessageId,
              }}
            />
            {clusterMessage ? (
              <AssistantWrittenFiles
                message={clusterMessage}
                workspaceRoot={props.workspaceRoot ?? ""}
                onAiWorkspaceRelativePath={props.onAiWorkspaceRelativePath}
                fetchWorkspaceFileText={props.fetchWorkspaceFileText}
                fetchCheckpointFileText={props.fetchCheckpointFileText}
                writtenFileSvgQueryKey={props.writtenFileSvgQueryKey}
                precedingUserMessageId={(() => {
                  const clusterMsgIdx = props.messages.findIndex((m) => m.id === block.messageIds[0]);
                  for (let i = clusterMsgIdx - 1; i >= 0; i--) {
                    if (props.messages[i]?.role === "user") return props.messages[i].id;
                  }
                  return undefined;
                })()}
                clearFloatingCopySlot={showClusterQaFooterChrome}
              />
            ) : null}
            {showClusterQaFooterChrome ? (
              <div className="absolute bottom-px left-0 right-2 flex items-center gap-3 opacity-0 pointer-events-none transition-opacity select-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                <div className="pointer-events-auto min-w-0 flex-1">
                  {clusterFooterMeta ? (
                    <AssistantReplyMetaRow
                      meta={clusterFooterMeta}
                      showDurationPending={
                        props.isStreaming &&
                        clusterMsgId === latestAssistantMessageId &&
                        clusterFooterMeta.durationMs === undefined
                      }
                    />
                  ) : (
                    <span className="min-w-0 shrink" aria-hidden />
                  )}
                </div>
                <div className="pointer-events-auto shrink-0">
                  <CopyButton
                    variant="ghost"
                    getText={() =>
                      assistantQaCopyByLastId.get(clusterMsgId)?.() ??
                      (clusterMessage ? messageToText(clusterMessage) : "")
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    const groupSpacing = block.isUser ? "mb-3" : "mb-4";
    const isSyntheticSessionError =
      !block.isUser && block.messageId.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);

    if (isSyntheticSessionError) {
      const messageText = block.renderableParts
        .map((part) => partToText(part))
        .join(" ")
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      return (
        <div
          key={`error-${block.messageId}`}
          className="flex group justify-start"
          data-message-role="assistant"
          data-message-id={block.messageId}
          style={{ contain: "layout style paint", ...blockPerfStyle(blockIndex) }}
        >
          <div className={`w-full relative ${isNestedVariant ? "" : "max-w-[650px]"} ${searchOutlineClass}`}>
            <div
              className="inline-flex max-w-full items-start gap-2 rounded-[18px] border border-red-7/20 bg-red-1/35 px-3 py-2 text-[13px] leading-5 text-red-11 shadow-sm"
              role="alert"
            >
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-red-11" />
              <div className="min-w-0 break-words">{messageText}</div>
            </div>
          </div>
        </div>
      );
    }

    const showAssistantQaFooter =
      !block.isUser && assistantQaCopyByLastId.has(block.messageId);
    /** Hide copy/meta hover chrome while the latest assistant message is still streaming. */
    const showAssistantQaFooterChrome =
      showAssistantQaFooter &&
      !(props.isStreaming && block.messageId === latestAssistantMessageId);
    const assistantFooterMeta = showAssistantQaFooter
      ? props.assistantReplyMetaById?.get(block.messageId)
      : undefined;

    const isEditingThisMessage =
      block.isUser && props.editingMessageId != null && props.editingMessageId === block.messageId;

    if (isEditingThisMessage && props.renderInlineEditComposer) {
      return (
        <div
          key={`message-${block.messageId}`}
          className="flex justify-stretch"
          data-message-role="user"
          data-message-id={block.messageId}
          data-editing="true"
          style={{ contain: "layout style", ...blockPerfStyle(blockIndex) }}
        >
          <div className="w-full max-w-[800px] mx-auto">
            {props.renderInlineEditComposer({ messageId: block.messageId })}
          </div>
        </div>
      );
    }

    return (
      <div
        key={`message-${block.messageId}`}
        className={`flex group ${block.isUser ? "justify-end pb-9 -mb-[6px]" : "justify-start"}`.trim()}
        data-message-role={block.isUser ? "user" : "assistant"}
        data-message-id={block.messageId}
        style={{ contain: "layout style", marginBottom:0, ...blockPerfStyle(blockIndex) }}
      >
        <div
          className={`${
            block.isUser
              ? isNestedVariant
                ? "relative max-w-[92%] rounded-[12px] bg-[rgba(0,0,0,0.04)] px-4 py-[9px] text-[14px] leading-relaxed text-[rgba(0,0,0,0.85)] dark:bg-white/[0.08] dark:text-gray-12"
                : "relative max-w-[85%] rounded-[12px] bg-[rgba(0,0,0,0.04)] px-4 py-[9px] text-[15px] leading-relaxed text-[rgba(0,0,0,0.85)] dark:bg-white/[0.08] dark:text-gray-12"
              : isNestedVariant
                ? "w-full relative text-[14px] leading-[1.65] text-dls-text antialiased group"
                : `w-full relative max-w-[800px] text-[15px] leading-[1.72] text-dls-text antialiased group${
                    showAssistantQaFooterChrome ? " pb-7" : ""
                  }`
          } ${searchOutlineClass}`}
        >
          {block.attachments.length > 0 ? (
            <div className={block.isUser ? "mb-3 flex flex-wrap gap-2" : "mb-4 flex flex-wrap gap-2"}>
              {block.attachments.map((attachment) => (
                <FileCard
                  key={`${block.messageId}:${attachment.url}`}
                  part={{
                    filename: attachment.filename,
                    url: attachment.url,
                    mediaType: attachment.mime,
                  }}
                  tone={block.isUser ? "user" : "assistant"}
                  aiworkServerBaseUrl={props.aiworkServerBaseUrl}
                />
              ))}
            </div>
          ) : null}

          {block.groups.map((group, index) => {
            const highlightQuery = hasSearchMatch ? props.searchHighlightQuery : undefined;
            const isStreamingLatestAssistant =
              !block.isUser && props.isStreaming && block.messageId === latestAssistantMessageId;

            return (
              <div key={`${block.messageId}:${group.kind}:${index}`} className={index === block.groups.length - 1 ? "" : groupSpacing}>
                {group.kind === "text" ? (() => {
                  if (group.part.type === "file") {
                    const filePart = group.part as {
                      filename?: string;
                      url?: string;
                      mime?: string;
                    };
                    return (
                      <FileCard
                        part={{
                          filename: filePart.filename,
                          url: filePart.url ?? "",
                          mediaType: filePart.mime ?? "application/octet-stream",
                        }}
                        tone={block.isUser ? "user" : "assistant"}
                        aiworkServerBaseUrl={props.aiworkServerBaseUrl}
                      />
                    );
                  }

                  const text = partToText(group.part);
                  if (block.isUser) {
                    return (
                      <HighlightedPlainText
                        text={text}
                        className="whitespace-pre-wrap break-words text-[rgba(0,0,0,0.85)] dark:text-gray-12"
                        highlightQuery={highlightQuery}
                      />
                    );
                  }

                  return (
                    <MarkdownBlock
                      text={text}
                      streaming={isStreamingLatestAssistant}
                      highlightQuery={highlightQuery}
                      resolveRemoteHref={resolveRemoteHref}
                    />
                  );
                })() : null}

                {group.kind === "steps" ? (
                  <StepsContainer
                    stepGroups={[{
                      id: group.id,
                      parts: group.parts,
                      mode: group.mode,
                    }]}
                    isUser={block.isUser}
                    isInline={true}
                    expandedStepIds={expandedStepIds}
                    onExpandedStepIdsChange={onExpandedStepIdsChange}
                    todos={todos}
                    reasoningStreamContext={{
                      isStreaming: props.isStreaming,
                      messageId: block.messageId,
                      latestAssistantMessageId,
                    }}
                  />
                ) : null}
              </div>
            );
          })}

          {!block.isUser ? (
            <AssistantWrittenFiles
              message={block.message}
              workspaceRoot={props.workspaceRoot ?? ""}
              onAiWorkspaceRelativePath={props.onAiWorkspaceRelativePath}
              fetchWorkspaceFileText={props.fetchWorkspaceFileText}
              fetchCheckpointFileText={props.fetchCheckpointFileText}
              writtenFileSvgQueryKey={props.writtenFileSvgQueryKey}
              precedingUserMessageId={(() => {
                const msgIdx = props.messages.findIndex((m) => m.id === block.messageId);
                for (let i = msgIdx - 1; i >= 0; i--) {
                  if (props.messages[i]?.role === "user") return props.messages[i].id;
                }
                return undefined;
              })()}
              clearFloatingCopySlot={!isNestedVariant && showAssistantQaFooterChrome}
            />
          ) : null}

          {!isNestedVariant ? (
            block.isUser ? (
              <div className="absolute top-full right-0 mt-1.5 flex items-center justify-end gap-1.5 opacity-0 pointer-events-none transition-opacity select-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                {props.onEditMessage ? (
                  <EditButton
                    disabled={Boolean(props.editingDisabled)}
                    disabledReason={props.editingDisabledReason ?? null}
                    onClick={() => {
                      const initialText = userMessageEditableText(block.message);
                      props.onEditMessage?.({ messageId: block.messageId, initialText });
                    }}
                  />
                ) : null}
                <CopyButton getText={() => messageToText(block.message)} variant="ghost" />
              </div>
            ) : showAssistantQaFooterChrome ? (
              <div className="absolute bottom-px left-0 right-2 flex items-center gap-3 opacity-0 pointer-events-none transition-opacity select-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                <div className="pointer-events-auto min-w-0 flex-1">
                  {assistantFooterMeta ? (
                    <AssistantReplyMetaRow
                      meta={assistantFooterMeta}
                      showDurationPending={
                        props.isStreaming &&
                        block.messageId === latestAssistantMessageId &&
                        assistantFooterMeta.durationMs === undefined
                      }
                    />
                  ) : (
                    <span className="min-w-0 shrink" aria-hidden />
                  )}
                </div>
                <div className="pointer-events-auto shrink-0">
                  <CopyButton
                    variant="ghost"
                    getText={() =>
                      assistantQaCopyByLastId.get(block.messageId)?.() ?? messageToText(block.message)
                    }
                  />
                </div>
              </div>
            ) : null
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={isNestedVariant ? "pb-0" : "pb-10"} style={{ contain: "layout paint style" }}>
      {shouldVirtualize ? (
        // Always render the virtualized container once we've decided to
        // virtualize — even if virtualRows is empty on the very first tick
        // (e.g. scrollElement ref hasn't attached yet). A fallback to
        // rendering every message would re-introduce the eager-render
        // freeze on huge sessions.
        <div
          className="relative"
          style={{
            height: `${Math.max(virtualizer.getTotalSize(), 1)}px`,
            width: "100%",
          }}
        >
          {virtualRows.map((virtualRow) => {
            const block = messageBlocks[virtualRow.index];
            if (!block) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={(element) => {
                  if (element) {
                    virtualizer.measureElement(element);
                  }
                }}
                className="absolute left-0 top-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderBlock(block, virtualRow.index)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={isNestedVariant ? "space-y-2" : "space-y-2.5"}>
          {messageBlocks.map((block, index) => renderBlock(block, index))}
        </div>
      )}

      {!isNestedVariant && props.footer ? props.footer : null}
    </div>
  );
}

/**
 * Memoize at the transcript boundary so SessionSurface state churn (e.g.
 * sending=true flipping while the assistant streams) doesn't force a full
 * transcript re-render on every parent commit. Re-renders now happen only
 * when the transcript's own props actually change (messages array
 * identity, isStreaming, developerMode, etc.).
 */
export const SessionTranscript: MemoExoticComponent<(props: SessionTranscriptProps) => ReactNode> =
  memo(SessionTranscriptInner);
SessionTranscript.displayName = "SessionTranscript";
