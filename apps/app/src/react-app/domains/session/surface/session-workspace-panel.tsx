/** @jsxImportSource react */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { UIMessage } from "ai";
import {
  ChevronRight,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../i18n";
import { openDesktopPath, workspaceAddAuthorizedRoot } from "../../../../app/lib/desktop";
import type { AiWorkServerClient } from "../../../../app/lib/aiwork-server";
import { AiWorkServerError } from "../../../../app/lib/aiwork-server";
import {
  looksAbsoluteWorkspacePath,
  workspaceRelativePathForServerRead,
} from "../../../../app/lib/workspace-relative-path";
import type { ComposerAttachment } from "../../../../app/types";
import {
  isMacPlatform,
  isWindowsPlatform,
} from "../../../../app/utils";
import {
  readStoredWorkspacePanelWidth,
  DEFAULT_WORKSPACE_PANEL_WIDTH,
  MIN_WORKSPACE_PANEL_WIDTH,
  MIN_CHAT_COLUMN_WIDTH,
  workspaceFolderLabel,
  joinRelativePath,
  isMarkdownDocumentPath,
  isWorkspacePreviewablePath,
  isWorkspaceCodeDocumentPath,
  isWebPreviewDocumentPath,
  buildWebPreviewSrcDoc,
  absoluteWorkspaceFilePath,
  collectSessionToolNames,
  WORKSPACE_PANEL_HEADER_DRAG_STYLE,
  WORKSPACE_PANEL_WIDTH_KEY,
} from "./session/workspace-utils";
import { WorkspaceTreeNode } from "./session/workspace-tree-node";
import { WorkspaceContextPanel } from "./session/workspace-context-panel";
import { WorkspacePreviewPane } from "./session/workspace-preview-pane";

export type SessionWorkspacePanelProps = {
  client: AiWorkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, "agent" | "file">;
  messages: UIMessage[];
  /** When true (e.g. assistant streaming / session busy), poll file list, markdown preview, and keep context in sync. */
  liveWorkspacePreview?: boolean;
};

export type SessionWorkspacePanelHandle = {
  /** Same behavior as clicking a file row in the workspace file list (preview vs open on disk). */
  selectWorkspaceRelativePath: (relativePath: string) => void;
};

export const SessionWorkspacePanel = forwardRef<SessionWorkspacePanelHandle, SessionWorkspacePanelProps>(
  function SessionWorkspacePanel(props, ref) {
  const [dirPath, setDirPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [copyContentSuccess, setCopyContentSuccess] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(readStoredWorkspacePanelWidth);
  const panelWidthRef = useRef(panelWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  /** When the window narrows, clamp stored panel width so chat + panel fit (flex-shrink alone is not enough if width is fixed in px). */
  useEffect(() => {
    const clampWidth = () => {
      const vw = document.documentElement?.clientWidth || window.innerWidth;
      const maxAllowed = Math.max(MIN_WORKSPACE_PANEL_WIDTH, vw - MIN_CHAT_COLUMN_WIDTH);
      setPanelWidth((w) => Math.min(Math.max(MIN_WORKSPACE_PANEL_WIDTH, w), maxAllowed));
    };
    clampWidth();
    window.addEventListener("resize", clampWidth);
    return () => window.removeEventListener("resize", clampWidth);
  }, []);

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
        const container = (grip.parentElement?.parentElement as HTMLElement | null) ?? null;
        const containerWidth = container?.getBoundingClientRect().width ?? (document.documentElement?.clientWidth || window.innerWidth);
        const maxAllowed = Math.max(MIN_WORKSPACE_PANEL_WIDTH, containerWidth - MIN_CHAT_COLUMN_WIDTH);
        const next = Math.min(maxAllowed, Math.max(MIN_WORKSPACE_PANEL_WIDTH, initialW - delta));
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

  /** While the session is busy, re-render periodically so prompt-context props stay fresh even if parents memoize aggressively. */
  const [, setContextSyncTick] = useState(0);
  useEffect(() => {
    if (!props.liveWorkspacePreview) return;
    const id = window.setInterval(() => setContextSyncTick((n) => n + 1), 800);
    return () => clearInterval(id);
  }, [props.liveWorkspacePreview]);

  const folderTitle = useMemo(() => workspaceFolderLabel(props.workspaceRoot), [props.workspaceRoot]);

  const markdownPreviewOpen = useMemo(
    () => Boolean(selectedFile && isMarkdownDocumentPath(selectedFile)),
    [selectedFile],
  );

  const webPreviewOpen = useMemo(
    () => Boolean(selectedFile && isWebPreviewDocumentPath(selectedFile)),
    [selectedFile],
  );

  const codeDocumentPreviewOpen = useMemo(
    () => Boolean(selectedFile && isWorkspaceCodeDocumentPath(selectedFile)),
    [selectedFile],
  );

  const pollRichPreviewWhileSessionBusy = Boolean(
    props.liveWorkspacePreview &&
      selectedFile &&
      (markdownPreviewOpen || webPreviewOpen || codeDocumentPreviewOpen),
  );
  const pollWhileSessionBusy = Boolean(props.liveWorkspacePreview);

  const workspaceRoot = props.workspaceRoot.trim();
  const attemptedWorkspaceAuthorizeRef = useRef(false);
  const lastWorkspaceListErrorRef = useRef<string>("");
  const showWorkspaceListErrorDetails =
    typeof import.meta !== "undefined" &&
    Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

  const listQuery = useQuery({
    queryKey: ["workspaceDirList", props.workspaceId, dirPath],
    queryFn: async () => {
      try {
        return await props.client.listWorkspaceDirectory(props.workspaceId, dirPath || undefined);
      } catch (error) {
        const looksUnauthorized =
          error instanceof AiWorkServerError
            ? error.status === 403 && (error.code === "workspace_unauthorized" || error.code === "forbidden")
            : (() => {
                const message = error instanceof Error ? error.message : String(error ?? "");
                return (
                  message.includes("workspace_unauthorized") ||
                  message.includes("Workspace is not authorized") ||
                  message.includes('"workspace_unauthorized"') ||
                  message.includes("403")
                );
              })();

        if (error instanceof AiWorkServerError) {
          // Always keep a terse summary visible (safe for prod); detailed messages remain dev-only.
          let location = "";
          const url = (error.details &&
          typeof error.details === "object" &&
          "url" in error.details &&
          typeof (error.details as { url?: unknown }).url === "string"
            ? (error.details as { url: string }).url
            : "") as string;
          if (url) {
            try {
              const parsed = new URL(url);
              const port = parsed.port ? `:${parsed.port}` : "";
              location = `${parsed.hostname}${port}${parsed.pathname}`;
            } catch {
              // ignore
            }
          }
          lastWorkspaceListErrorRef.current = `${error.status} ${error.code}${location ? ` ${location}` : ""}`;
          if (showWorkspaceListErrorDetails) {
            lastWorkspaceListErrorRef.current = `${error.status} ${error.code}: ${error.message}`;
          }
        } else if (error instanceof Error) {
          lastWorkspaceListErrorRef.current = error.message;
        } else {
          lastWorkspaceListErrorRef.current = String(error ?? "");
        }

        if (looksUnauthorized && workspaceRoot && !attemptedWorkspaceAuthorizeRef.current) {
          attemptedWorkspaceAuthorizeRef.current = true;
          await workspaceAddAuthorizedRoot({ workspacePath: workspaceRoot, folderPath: workspaceRoot }).catch(
            () => undefined,
          );
          return await props.client.listWorkspaceDirectory(props.workspaceId, dirPath || undefined);
        }
        throw error;
      }
    },
    enabled: Boolean(props.workspaceId && workspaceRoot),
    staleTime: pollWhileSessionBusy ? 0 : 15_000,
    refetchInterval: pollWhileSessionBusy ? 800 : false,
  });

  const previewQuery = useQuery({
    queryKey: ["workspaceFilePreview", props.workspaceId, selectedFile],
    queryFn: () => props.client.readWorkspaceFile(props.workspaceId, selectedFile!),
    enabled:
      Boolean(props.workspaceId && selectedFile) &&
      Boolean(selectedFile && isWorkspacePreviewablePath(selectedFile)),
    staleTime: pollRichPreviewWhileSessionBusy ? 0 : 30_000,
    refetchInterval: pollRichPreviewWhileSessionBusy ? 800 : false,
  });

  /** Git status for all files in the workspace — polled while session is live, otherwise refreshed every 10 s. */
  const gitStatusQuery = useQuery({
    queryKey: ["workspaceGitStatus", props.workspaceId],
    queryFn: () => props.client.getWorkspaceGitStatus(props.workspaceId),
    enabled: Boolean(props.workspaceId && workspaceRoot),
    staleTime: pollWhileSessionBusy ? 0 : 10_000,
    refetchInterval: pollWhileSessionBusy ? 2_000 : 10_000,
    // Never throw — non-git workspaces silently return empty map
    retry: false,
  });
  const gitStatusMap = gitStatusQuery.data?.entries ?? {};

  /** Only rebuild iframe document when raw file bytes change — avoids remount/flash on identical poll results. */
  const webPreviewSrcDoc = useMemo(
    () => buildWebPreviewSrcDoc(previewQuery.data?.content ?? ""),
    [previewQuery.data?.content],
  );

  const refreshWorkspaceFiles = () => {
    void listQuery.refetch();
    if (selectedFile && isWorkspacePreviewablePath(selectedFile)) {
      void previewQuery.refetch();
    }
  };

  const openCurrentFolderOnDesktop = () => {
    if (!workspaceRoot) return;
    const abs = absoluteWorkspaceFilePath(workspaceRoot, dirPath);
    if (!abs) return;
    void openDesktopPath(abs).catch(() => undefined);
  };

  const canOpenCurrentFolderOnDesktop = Boolean(workspaceRoot) && Boolean(props.workspaceId);

  const openFolderTitle = isWindowsPlatform()
    ? t("session.workspace_panel_open_current_folder_explorer")
    : isMacPlatform()
      ? t("session.workspace_panel_open_current_folder_finder")
      : t("session.workspace_panel_open_current_folder_generic");

  // Recompute every render so streaming transcripts that mutate message objects in place still refresh tool chips.
  const toolsUsed = collectSessionToolNames(props.messages);

  const breadcrumbSegments = dirPath ? dirPath.split("/").filter(Boolean) : [];

  const navigateToSegment = (index: number) => {
    if (index < 0) {
      setDirPath("");
      return;
    }
    setDirPath(breadcrumbSegments.slice(0, index + 1).join("/"));
    setSelectedFile(null);
  };

  const selectWorkspaceRelativePath = useCallback(
    (relativePath: string) => {
      const raw = relativePath.trim().replace(/\\/g, "/");
      if (!raw) return;

      const root = props.workspaceRoot.trim();
      const apiRel = root ? workspaceRelativePathForServerRead(raw, root) : null;
      /** Workspace-relative POSIX path for list/preview APIs — never pass OS-absolute `/Users/...` through. */
      const sel = apiRel ?? raw;

      if (apiRel == null && looksAbsoluteWorkspacePath(raw)) {
        void openDesktopPath(raw).catch(() => undefined);
        return;
      }

      // Always open text files inside the App — never call the OS opener for any file.
      // isWorkspacePreviewablePath covers the known-text whitelist; everything else
      // falls through to setSelectedFile so we at least attempt an in-app text preview.
      setSelectedFile(sel);
    },
    [props.workspaceRoot],
  );

  useImperativeHandle(ref, () => ({ selectWorkspaceRelativePath }), [selectWorkspaceRelativePath]);

  const toggleExpandPath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  /** Whether a file preview pane should be shown alongside the file list — true for any selected file */
  const previewPaneOpen = Boolean(selectedFile);

  /** Minimum width of the file-list column when preview is open */
  const FILE_LIST_MIN_WIDTH = 180;
  /** Default width of the file-list column when preview is open */
  const FILE_LIST_DEFAULT_WIDTH = 200;

  const [fileListWidth, setFileListWidth] = useState(FILE_LIST_DEFAULT_WIDTH);
  const fileListWidthRef = useRef(fileListWidth);
  const previewDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    fileListWidthRef.current = fileListWidth;
  }, [fileListWidth]);

  const stopPreviewDividerResize = useCallback(() => {
    previewDragCleanupRef.current?.();
    previewDragCleanupRef.current = null;
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const startPreviewDividerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || typeof window === "undefined") return;
      event.preventDefault();
      const grip = event.currentTarget;
      stopPreviewDividerResize();
      const pointerId = event.pointerId;
      try { grip.setPointerCapture(pointerId); } catch { /* ignore */ }
      const initialX = event.clientX;
      const initialW = fileListWidthRef.current;

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - initialX;
        const next = Math.max(FILE_LIST_MIN_WIDTH, initialW + delta);
        fileListWidthRef.current = next;
        setFileListWidth(next);
      };

      const handleStop = (stopEvent: PointerEvent) => {
        try {
          if (grip.hasPointerCapture(stopEvent.pointerId)) grip.releasePointerCapture(stopEvent.pointerId);
        } catch { /* ignore */ }
        stopPreviewDividerResize();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleStop);
      window.addEventListener("pointercancel", handleStop);
      previewDragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleStop);
        window.removeEventListener("pointercancel", handleStop);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [stopPreviewDividerResize],
  );

  useEffect(() => () => stopPreviewDividerResize(), [stopPreviewDividerResize]);

  /** Shared file-list column JSX — always rendered */
  const fileListColumn = (
    <div
      className={`flex min-h-0 min-w-0 flex-col bg-dls-sidebar${previewPaneOpen ? " border-r border-dls-divider" : ""}`}
      style={previewPaneOpen ? { width: fileListWidth, minWidth: FILE_LIST_MIN_WIDTH, flexShrink: 0 } : { flex: 1 }}
    >
      <div className="shrink-0 border-b border-dls-divider px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#000000] dark:text-gray-12">
          {t("session.workspace_panel_context")}
        </div>
        <div className="mt-2 space-y-2 text-[12px] text-dls-text">
          <WorkspaceContextPanel
            attachments={props.attachments}
            mentions={props.mentions}
            toolsUsed={toolsUsed}
          />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Drag region must not wrap toolbar buttons (WKWebView hit-testing); mirror workspace-session-list. */}
        <div className="shrink-0 border-b border-dls-divider px-3 py-2">
          <div className="flex min-h-[28px] cursor-default items-center gap-2">
            <div
              className="flex min-w-0 flex-1 cursor-default items-center select-none text-[11px] font-semibold uppercase tracking-wide text-[#000000] dark:text-gray-12"
              data-tauri-drag-region={true}
              style={{ ...WORKSPACE_PANEL_HEADER_DRAG_STYLE }}
            >
              {t("session.workspace_panel_files")}
            </div>
            <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-[#000000] dark:text-gray-12 transition-colors hover:bg-dls-hover hover:text-[#000000] dark:hover:text-gray-12 disabled:pointer-events-none disabled:opacity-40"
                onClick={openCurrentFolderOnDesktop}
                disabled={!canOpenCurrentFolderOnDesktop}
                title={openFolderTitle}
                aria-label={openFolderTitle}
              >
                <FolderOpen size={14} />
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-[#000000] dark:text-gray-12 transition-colors hover:bg-dls-hover hover:text-[#000000] dark:hover:text-gray-12 disabled:pointer-events-none disabled:opacity-40"
                onClick={refreshWorkspaceFiles}
                disabled={!props.workspaceId || listQuery.isFetching}
                title={t("session.workspace_panel_refresh")}
                aria-label={t("session.workspace_panel_refresh")}
              >
                <RefreshCw size={14} className={listQuery.isFetching ? "animate-spin" : undefined} />
              </button>
            </div>
          </div>
          <div className="mt-1 flex min-w-0 cursor-default flex-wrap items-center gap-x-0.5 gap-y-0.5 text-[11px] text-dls-secondary">
            <button
              type="button"
              className="inline-flex max-w-full min-w-0 shrink cursor-pointer select-none truncate rounded px-1 py-0.5 hover:bg-dls-hover hover:text-dls-text"
              data-tauri-drag-region="false"
              style={{ cursor: "pointer", userSelect: "none", WebkitUserSelect: "none" }}
              onClick={() => { setDirPath(""); setSelectedFile(null); }}
            >
              {folderTitle}
            </button>
            {breadcrumbSegments.map((segment, index) => (
              <span
                key={`${segment}-${index}`}
                className="inline-flex max-w-full min-w-0 shrink-0 items-center gap-0.5"
              >
                <ChevronRight size={12} className="pointer-events-none shrink-0 opacity-60" />
                <button
                  type="button"
                  className="inline-flex max-w-full min-w-0 shrink cursor-pointer select-none truncate rounded px-1 py-0.5 hover:bg-dls-hover hover:text-dls-text"
                  data-tauri-drag-region="false"
                  style={{ cursor: "pointer", userSelect: "none", WebkitUserSelect: "none" }}
                  onClick={() => navigateToSegment(index)}
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto px-2 py-2">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-dls-secondary" size={18} />
            </div>
          ) : listQuery.isError ? (
            <div className="space-y-1 px-1 text-[11px] text-red-11">
              <div>{t("session.workspace_panel_list_error")}</div>
              {lastWorkspaceListErrorRef.current ? (
                <div className="font-mono text-[10px] text-red-11/80">{lastWorkspaceListErrorRef.current}</div>
              ) : null}
            </div>
          ) : listQuery.data && listQuery.data.entries.length === 0 ? (
            <div className="px-1 text-[11px] text-dls-secondary">{t("session.workspace_panel_empty_dir")}</div>
          ) : (
            <ul className="space-y-0.5">
              {listQuery.data?.entries.map((entry) => {
                const entryRelativePath = joinRelativePath(dirPath, entry.name);
                return (
                  <WorkspaceTreeNode
                    key={entryRelativePath}
                    entry={entry}
                    relativePath={entryRelativePath}
                    depth={0}
                    client={props.client}
                    workspaceId={props.workspaceId}
                    selectedPath={selectedFile}
                    expandedPaths={expandedPaths}
                    onToggleExpand={toggleExpandPath}
                    onSelectEntry={(relPath) => selectWorkspaceRelativePath(relPath)}
                    liveWorkspacePreview={props.liveWorkspacePreview}
                    gitStatusMap={gitStatusMap}
                  />
                );
              })}
            </ul>
          )}
          {listQuery.data?.truncated ? (
            <div className="mt-2 px-1 text-[10px] text-dls-secondary">{t("session.workspace_panel_truncated")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <aside
      className="relative flex min-h-0 h-full min-w-0 shrink flex-col border-l border-dls-divider bg-dls-sidebar"
      style={{ width: panelWidth, minWidth: MIN_WORKSPACE_PANEL_WIDTH, maxWidth: "100%" }}
    >
      {/* Left-edge drag handle to resize the whole workspace panel */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("session.resize_workspace_column")}
        className="absolute left-0 top-0 z-40 h-full w-1 -translate-x-1/2 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-gray-6/40 touch-none"
        onPointerDown={startPanelResize}
      />

      {/* Main horizontal layout: file list always visible, preview alongside when open */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {fileListColumn}

        {previewPaneOpen && selectedFile ? (
          <>
            {/* Divider between file list and preview — same look & feel as the left-edge panel resize handle */}
            <div className="relative w-0 shrink-0">
              <div
                role="separator"
                aria-orientation="vertical"
                className="absolute top-0 left-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-gray-6/40 touch-none"
                onPointerDown={startPreviewDividerResize}
              />
            </div>

            <WorkspacePreviewPane
              selectedFile={selectedFile}
              workspaceRoot={workspaceRoot}
              workspaceId={props.workspaceId}
              previewContent={previewQuery.data?.content}
              previewLoading={previewQuery.isLoading}
              previewError={previewQuery.isError}
              onRefresh={() => { void previewQuery.refetch(); }}
              onClose={() => setSelectedFile(null)}
              webPreviewSrcDoc={webPreviewSrcDoc}
              copySuccess={copyContentSuccess}
              onCopySuccess={setCopyContentSuccess}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
});
SessionWorkspacePanel.displayName = "SessionWorkspacePanel";
