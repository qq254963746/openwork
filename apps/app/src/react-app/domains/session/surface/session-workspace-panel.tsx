/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { UIMessage } from "ai";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../i18n";
import { openDesktopPath } from "../../../../app/lib/desktop";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import type { ComposerAttachment } from "../../../../app/types";
import { isDesktopRuntime, isMacPlatform, isWindowsPlatform } from "../../../../app/utils";
import { usePlatform } from "../../../kernel/platform";
import { MarkdownBlock } from "./markdown";

const WORKSPACE_PANEL_WIDTH_KEY = "openwork.session.workspacePanelWidth.v1";
const DEFAULT_WORKSPACE_PANEL_WIDTH = 300;
const MIN_WORKSPACE_PANEL_WIDTH = 240;
const MAX_WORKSPACE_PANEL_WIDTH = 720;

function readStoredWorkspacePanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY);
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_WORKSPACE_PANEL_WIDTH;
    return Math.min(MAX_WORKSPACE_PANEL_WIDTH, Math.max(MIN_WORKSPACE_PANEL_WIDTH, n));
  } catch {
    return DEFAULT_WORKSPACE_PANEL_WIDTH;
  }
}

/** Workspace-relative paths only (.md / .mdx / .markdown). */
function isMarkdownDocumentPath(relativePosix: string): boolean {
  const lowered = relativePosix.trim().toLowerCase();
  return [".md", ".mdx", ".markdown"].some((ext) => lowered.endsWith(ext));
}

function workspaceFolderLabel(root: string): string {
  const trimmed = root.trim().replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return (parts[parts.length - 1] ?? trimmed) || t("session.workspace_fallback");
}

function joinRelativePath(dir: string, name: string): string {
  const d = dir.trim();
  if (!d) return name;
  return `${d.replace(/\/+$/, "")}/${name}`;
}

/** Matches OpenWork server `GET .../files/content` supported extensions. */
function isWorkspacePreviewablePath(path: string): boolean {
  const lowered = path.toLowerCase();
  return [".md", ".mdx", ".markdown", ".json", ".jsonc", ".ts", ".js", ".mjs", ".cjs", ".txt"].some((ext) =>
    lowered.endsWith(ext),
  );
}

function isSvgFileName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".svg");
}

/** Join workspace root (host path) with POSIX relative segments from the file tree. */
function absoluteWorkspaceFilePath(workspaceRoot: string, relativePosix: string): string | null {
  const root = workspaceRoot.trim();
  if (!root) return null;
  const segments = relativePosix.split("/").filter(Boolean);
  const rootClean = root.replace(/[/\\]+$/, "");
  const isWin = /^[a-zA-Z]:/.test(rootClean) || rootClean.startsWith("\\\\");
  const sep = isWin ? "\\" : "/";
  return [rootClean, ...segments].join(sep);
}

/** Build a file:// URL for shell.openExternal (no node:url — browser bundle friendly). */
function hrefFromAbsoluteFsPath(absPath: string): string {
  const posix = absPath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(posix)) {
    return `file:///${encodeURI(posix)}`;
  }
  const withSlash = posix.startsWith("/") ? posix : `/${posix}`;
  return `file://${encodeURI(withSlash)}`;
}

function collectSessionToolNames(messages: UIMessage[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "dynamic-tool") {
        const name =
          "toolName" in part && typeof (part as { toolName?: string }).toolName === "string"
            ? (part as { toolName: string }).toolName
            : "";
        if (name && !seen.has(name)) {
          seen.add(name);
          ordered.push(name);
        }
      }
    }
  }
  return ordered;
}

export type SessionWorkspacePanelProps = {
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, "agent" | "file">;
  pasteParts: Array<{ id: string; label: string; text: string; lines: number }>;
  messages: UIMessage[];
};

export function SessionWorkspacePanel(props: SessionWorkspacePanelProps) {
  const platform = usePlatform();
  const [dirPath, setDirPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(readStoredWorkspacePanelWidth);
  const panelWidthRef = useRef(panelWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_PANEL_WIDTH_KEY, String(panelWidthRef.current));
    } catch {
      // ignore
    }
  }, [panelWidth]);

  const stopPanelResize = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const startPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || typeof window === "undefined") return;
      event.preventDefault();
      const grip = event.currentTarget;
      stopPanelResize();
      const pointerId = event.pointerId;
      try {
        grip.setPointerCapture(pointerId);
      } catch {
        // setPointerCapture unsupported or element detached
      }
      const initialX = event.clientX;
      const initialW = panelWidthRef.current;

      const handleMove = (moveEvent: PointerEvent) => {
        // Left edge of the panel: moving the grip left (smaller clientX) widens the panel.
        const delta = moveEvent.clientX - initialX;
        const next = Math.min(
          MAX_WORKSPACE_PANEL_WIDTH,
          Math.max(MIN_WORKSPACE_PANEL_WIDTH, initialW - delta),
        );
        panelWidthRef.current = next;
        setPanelWidth(next);
      };

      const handleStop = (stopEvent: PointerEvent) => {
        try {
          if (grip.hasPointerCapture(stopEvent.pointerId)) {
            grip.releasePointerCapture(stopEvent.pointerId);
          }
        } catch {
          // ignore
        }
        stopPanelResize();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleStop);
      window.addEventListener("pointercancel", handleStop);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleStop);
        window.removeEventListener("pointercancel", handleStop);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [stopPanelResize],
  );

  useEffect(() => () => stopPanelResize(), [stopPanelResize]);

  const folderTitle = useMemo(() => workspaceFolderLabel(props.workspaceRoot), [props.workspaceRoot]);

  const listQuery = useQuery({
    queryKey: ["workspaceDirList", props.workspaceId, dirPath],
    queryFn: () => props.client.listWorkspaceDirectory(props.workspaceId, dirPath || undefined),
    enabled: Boolean(props.workspaceId),
    staleTime: 15_000,
  });

  const previewQuery = useQuery({
    queryKey: ["workspaceFilePreview", props.workspaceId, selectedFile],
    queryFn: () => props.client.readWorkspaceFile(props.workspaceId, selectedFile!),
    enabled:
      Boolean(props.workspaceId && selectedFile) &&
      Boolean(selectedFile && isWorkspacePreviewablePath(selectedFile)),
    staleTime: 30_000,
  });

  const refreshWorkspaceFiles = () => {
    void listQuery.refetch();
    if (selectedFile && isWorkspacePreviewablePath(selectedFile)) {
      void previewQuery.refetch();
    }
  };

  const openCurrentFolderOnDesktop = () => {
    const root = props.workspaceRoot.trim();
    if (!root || !isDesktopRuntime()) return;
    const abs = absoluteWorkspaceFilePath(root, dirPath);
    if (!abs) return;
    void openDesktopPath(abs).catch(() => undefined);
  };

  const canOpenCurrentFolderOnDesktop =
    isDesktopRuntime() && Boolean(props.workspaceRoot.trim()) && Boolean(props.workspaceId);

  const openFolderTitle = isWindowsPlatform()
    ? t("session.workspace_panel_open_current_folder_explorer")
    : isMacPlatform()
      ? t("session.workspace_panel_open_current_folder_finder")
      : t("session.workspace_panel_open_current_folder_generic");

  const toolsUsed = useMemo(() => collectSessionToolNames(props.messages), [props.messages]);

  const breadcrumbSegments = dirPath ? dirPath.split("/").filter(Boolean) : [];

  const navigateToSegment = (index: number) => {
    if (index < 0) {
      setDirPath("");
      return;
    }
    setDirPath(breadcrumbSegments.slice(0, index + 1).join("/"));
    setSelectedFile(null);
  };

  const openSvgInDefaultBrowser = (relativePosix: string) => {
    if (!isDesktopRuntime()) return;
    const abs = absoluteWorkspaceFilePath(props.workspaceRoot, relativePosix);
    if (!abs) return;
    try {
      platform.openLink(hrefFromAbsoluteFsPath(abs));
    } catch {
      // ignore malformed paths
    }
  };

  const handleEntryClick = (name: string, kind: "file" | "directory") => {
    const rel = joinRelativePath(dirPath, name);
    if (kind === "directory") {
      setDirPath(rel);
      setSelectedFile(null);
      return;
    }
    if (isMarkdownDocumentPath(rel)) {
      setSelectedFile(rel);
      return;
    }
    const root = props.workspaceRoot.trim();
    if (isDesktopRuntime() && root) {
      const abs = absoluteWorkspaceFilePath(root, rel);
      if (abs) {
        void openDesktopPath(abs).catch(() => undefined);
        return;
      }
    }
    if (isSvgFileName(name)) {
      openSvgInDefaultBrowser(rel);
      setSelectedFile(rel);
      return;
    }
    setSelectedFile(rel);
  };

  const markdownPreviewOpen = Boolean(selectedFile && isMarkdownDocumentPath(selectedFile));
  const markdownFileTitle = selectedFile
    ? selectedFile.split("/").filter(Boolean).pop() ?? selectedFile
    : "";

  return (
    <aside
      className="relative flex min-h-0 h-full shrink-0 flex-col border-l border-dls-border bg-dls-sidebar/60"
      style={{ width: panelWidth, minWidth: MIN_WORKSPACE_PANEL_WIDTH, maxWidth: MAX_WORKSPACE_PANEL_WIDTH }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("session.resize_workspace_column")}
        className="absolute left-0 top-0 z-40 h-full w-1 -translate-x-1/2 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-gray-6/40 touch-none"
        onPointerDown={startPanelResize}
      />
      {markdownPreviewOpen ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-sidebar/60">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-dls-border bg-dls-surface/95 px-3 py-2.5">
            <span className="min-w-0 truncate font-mono text-[13px] font-medium text-dls-text" title={selectedFile ?? undefined}>
              {markdownFileTitle}
            </span>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
              onClick={() => setSelectedFile(null)}
              aria-label={t("session.workspace_panel_close_preview")}
              title={t("session.workspace_panel_close_preview")}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-dls-surface px-4 py-4">
            {previewQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-dls-secondary" size={22} />
              </div>
            ) : previewQuery.isError ? (
              <div className="text-[12px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
            ) : (
              <MarkdownBlock text={previewQuery.data?.content ?? ""} />
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-dls-border px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">
          {t("session.workspace_panel_context")}
        </div>
        <div className="mt-2 space-y-2 text-[12px] text-dls-text">
          {props.attachments.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_attachments")}</div>
              <ul className="mt-1 space-y-0.5">
                {props.attachments.map((a) => (
                  <li key={a.id} className="truncate font-mono text-[11px] text-dls-text">
                    {a.name}
                    <span className="ml-1 text-dls-secondary">({a.kind})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {Object.keys(props.mentions).length > 0 ? (
            <div>
              <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_mentions")}</div>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(props.mentions).map(([token, kind]) => (
                  <li key={token} className="truncate font-mono text-[11px] text-dls-text">
                    @{token}
                    <span className="ml-1 text-dls-secondary">({kind})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {props.pasteParts.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_pastes")}</div>
              <ul className="mt-1 space-y-0.5">
                {props.pasteParts.map((p) => (
                  <li key={p.id} className="truncate text-[11px] text-dls-text">
                    {p.label}
                    <span className="ml-1 text-dls-secondary">
                      ({p.lines} {t("session.context_lines")})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {toolsUsed.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium text-dls-secondary">{t("session.context_tools")}</div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {toolsUsed.map((tool) => (
                  <li
                    key={tool}
                    className="rounded-md border border-dls-border bg-dls-hover/50 px-1.5 py-0.5 font-mono text-[10px] text-dls-text"
                  >
                    {tool}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!props.attachments.length &&
          !Object.keys(props.mentions).length &&
          !props.pasteParts.length &&
          !toolsUsed.length ? (
            <div className="text-[11px] text-dls-secondary">{t("session.context_empty")}</div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-dls-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">
              {t("session.workspace_panel_files")}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-40"
                onClick={openCurrentFolderOnDesktop}
                disabled={!canOpenCurrentFolderOnDesktop}
                title={openFolderTitle}
                aria-label={openFolderTitle}
              >
                <FolderOpen size={14} />
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-40"
                onClick={refreshWorkspaceFiles}
                disabled={!props.workspaceId || listQuery.isFetching}
                title={t("session.workspace_panel_refresh")}
                aria-label={t("session.workspace_panel_refresh")}
              >
                <RefreshCw size={14} className={listQuery.isFetching ? "animate-spin" : undefined} />
              </button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-0.5 text-[11px] text-dls-secondary">
            <button
              type="button"
              className="truncate rounded px-1 py-0.5 hover:bg-dls-hover hover:text-dls-text"
              onClick={() => {
                setDirPath("");
                setSelectedFile(null);
              }}
            >
              {folderTitle}
            </button>
            {breadcrumbSegments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={12} className="shrink-0 opacity-60" />
                <button
                  type="button"
                  className="truncate rounded px-1 py-0.5 hover:bg-dls-hover hover:text-dls-text"
                  onClick={() => navigateToSegment(index)}
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-dls-secondary" size={18} />
            </div>
          ) : listQuery.isError ? (
            <div className="px-1 text-[11px] text-red-11">{t("session.workspace_panel_list_error")}</div>
          ) : listQuery.data && listQuery.data.entries.length === 0 ? (
            <div className="px-1 text-[11px] text-dls-secondary">{t("session.workspace_panel_empty_dir")}</div>
          ) : (
            <ul className="space-y-0.5">
              {listQuery.data?.entries.map((entry) => (
                <li key={`${entry.kind}:${entry.name}`}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                      selectedFile === joinRelativePath(dirPath, entry.name) && entry.kind === "file"
                        ? "bg-dls-accent/15 text-dls-text"
                        : "hover:bg-dls-hover text-dls-text"
                    }`}
                    onClick={() => handleEntryClick(entry.name, entry.kind)}
                  >
                    {entry.kind === "directory" ? (
                      <Folder size={14} className="shrink-0 text-amber-11" />
                    ) : (
                      <FileIcon size={14} className="shrink-0 text-dls-secondary" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {listQuery.data?.truncated ? (
            <div className="mt-2 px-1 text-[10px] text-dls-secondary">{t("session.workspace_panel_truncated")}</div>
          ) : null}
        </div>

        {selectedFile && !markdownPreviewOpen ? (
          <div className="flex max-h-[42%] min-h-[120px] shrink-0 flex-col border-t border-dls-border bg-dls-surface/90">
            <div className="shrink-0 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-dls-secondary">
              {selectedFile.toLowerCase().endsWith(".svg")
                ? t("session.workspace_panel_svg_preview_title")
                : t("session.workspace_panel_preview")}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {selectedFile.toLowerCase().endsWith(".svg") ? (
                <div className="text-[11px] leading-relaxed text-dls-secondary">
                  {isDesktopRuntime() && props.workspaceRoot.trim()
                    ? t("session.workspace_panel_svg_opened_browser")
                    : t("session.workspace_panel_svg_web_unavailable")}
                </div>
              ) : !isWorkspacePreviewablePath(selectedFile) ? (
                <div className="text-[11px] text-dls-secondary">{t("session.workspace_panel_preview_unsupported")}</div>
              ) : previewQuery.isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="animate-spin text-dls-secondary" size={16} />
                </div>
              ) : previewQuery.isError ? (
                <div className="text-[11px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-dls-text">
                  {previewQuery.data?.content ?? ""}
                </pre>
              )}
            </div>
          </div>
        ) : null}
      </div>
        </>
      )}
    </aside>
  );
}
