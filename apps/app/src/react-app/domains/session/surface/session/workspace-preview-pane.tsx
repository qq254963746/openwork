/** @jsxImportSource react */
import { useState, useEffect, useRef } from "react";
import {
  Code,
  Copy,
  ExternalLink,
  Eye,
  FileQuestion,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  X,
} from "lucide-react";
import { t } from "../../../../../i18n";
import { openDesktopPath } from "../../../../../app/lib/desktop";
import { WorkspacePanelFileGlyph } from "../workspace-panel-file-glyph";
import { MarkdownBlock } from "../markdown";
import { WorkspaceCodePreview } from "../workspace-code-preview";
import {
  isMarkdownDocumentPath,
  isWebPreviewDocumentPath,
  isWorkspacePreviewablePath,
  isWorkspaceCodeDocumentPath,
  absoluteWorkspaceFilePath,
} from "./workspace-utils";

export interface WorkspacePreviewPaneProps {
  selectedFile: string;
  workspaceRoot: string;
  workspaceId: string;
  previewContent: string | undefined;
  previewLoading: boolean;
  previewError: boolean;
  onRefresh: () => void;
  onClose: () => void;
  webPreviewSrcDoc: string;
  copySuccess: boolean;
  onCopySuccess: (v: boolean) => void;
}

export function WorkspacePreviewPane(props: WorkspacePreviewPaneProps) {
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  const selectedFileTitle = props.selectedFile
    ? props.selectedFile.split("/").filter(Boolean).pop() ?? props.selectedFile
    : "";

  const isMarkdown = isMarkdownDocumentPath(props.selectedFile);
  const isWeb = isWebPreviewDocumentPath(props.selectedFile);
  const isCode = isWorkspaceCodeDocumentPath(props.selectedFile);
  const canTogglePreviewMode = isMarkdown || isWeb;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-dls-sidebar">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-dls-divider bg-dls-surface/95 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <WorkspacePanelFileGlyph
            filename={props.selectedFile}
            size={16}
            className="shrink-0 text-[#000000] dark:text-gray-12"
          />
          <span className="min-w-0 truncate font-mono text-[13px] font-medium text-dls-text" title={props.selectedFile}>
            {selectedFileTitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Three-dots menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors text-[#000000] dark:text-gray-12 hover:bg-dls-hover ${menuOpen ? "bg-dls-hover" : ""}`}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
            </button>

            {props.copySuccess ? (
              <div className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 whitespace-nowrap rounded-md bg-gray-12 px-2.5 py-1 text-[12px] text-gray-1 shadow-sm dark:bg-gray-1 dark:text-gray-12">
                {t("session.workspace_panel_copy_success")}
              </div>
            ) : null}

            {menuOpen ? (
              <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-max min-w-[160px] rounded-[14px] border border-dls-border bg-dls-surface p-1.5 shadow-[var(--dls-shell-shadow)]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    props.onRefresh();
                    setMenuOpen(false);
                  }}
                >
                  <RefreshCw size={14} strokeWidth={1.75} className="shrink-0 text-dls-secondary" aria-hidden />
                  {t("session.workspace_panel_refresh")}
                </button>

                {canTogglePreviewMode ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-dls-text transition-colors hover:bg-dls-hover"
                    onClick={() => {
                      setPreviewMode((m) => (m === "preview" ? "source" : "preview"));
                      setMenuOpen(false);
                    }}
                  >
                    {previewMode === "preview" ? (
                      <Code size={14} strokeWidth={1.75} className="shrink-0 text-dls-secondary" aria-hidden />
                    ) : (
                      <Eye size={14} strokeWidth={1.75} className="shrink-0 text-dls-secondary" aria-hidden />
                    )}
                    {previewMode === "preview"
                      ? t("session.workspace_panel_view_source")
                      : t("session.workspace_panel_view_preview")}
                  </button>
                ) : null}

                {props.workspaceRoot ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-dls-text transition-colors hover:bg-dls-hover"
                    onClick={() => {
                      const abs = absoluteWorkspaceFilePath(props.workspaceRoot, props.selectedFile);
                      if (abs) void openDesktopPath(abs).catch(() => undefined);
                      setMenuOpen(false);
                    }}
                  >
                    <ExternalLink size={14} strokeWidth={1.75} className="shrink-0 text-dls-secondary" aria-hidden />
                    {t("session.workspace_panel_open_with_system")}
                  </button>
                ) : null}

                {props.previewContent ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-dls-text transition-colors hover:bg-dls-hover"
                    onClick={() => {
                      void navigator.clipboard.writeText(props.previewContent ?? "").then(() => {
                        props.onCopySuccess(true);
                        window.setTimeout(() => props.onCopySuccess(false), 1500);
                      });
                      setMenuOpen(false);
                    }}
                  >
                    <Copy size={14} strokeWidth={1.75} className="shrink-0 text-dls-secondary" aria-hidden />
                    {t("session.workspace_panel_copy_content")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#000000] dark:text-gray-12 transition-colors hover:bg-dls-hover hover:text-[#000000] dark:hover:text-gray-12"
            onClick={props.onClose}
            aria-label={t("session.workspace_panel_close_preview")}
            title={t("session.workspace_panel_close_preview")}
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      {/* Content */}
      {!isWorkspacePreviewablePath(props.selectedFile) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-dls-surface p-6 text-center">
          <FileQuestion size={36} className="shrink-0 text-dls-secondary/60" strokeWidth={1.25} />
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-dls-text">
              {t("session.workspace_panel_preview_unsupported")}
            </p>
            <p className="text-[11px] text-dls-secondary">
              {selectedFileTitle}
            </p>
          </div>
          {props.workspaceRoot ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-[12px] text-dls-text transition-colors hover:bg-dls-hover"
              onClick={() => {
                const abs = absoluteWorkspaceFilePath(props.workspaceRoot, props.selectedFile);
                if (abs) void openDesktopPath(abs).catch(() => undefined);
              }}
            >
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
              {t("session.workspace_panel_open_with_system")}
            </button>
          ) : null}
        </div>
      ) : props.previewLoading ? (
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-dls-secondary" size={22} />
        </div>
      ) : props.previewError ? (
        <div className="flex-1 p-4 text-[12px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
      ) : isMarkdown && previewMode === "preview" ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-dls-surface px-4 py-4">
          <div className="min-w-0 max-w-full">
            <MarkdownBlock text={props.previewContent ?? ""} />
          </div>
        </div>
      ) : isWeb && previewMode === "preview" ? (
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-dls-surface">
          <iframe
            key={`${props.workspaceId}:${props.selectedFile}`}
            title={selectedFileTitle}
            className="absolute inset-0 h-full w-full border-0 bg-dls-surface"
            srcDoc={props.webPreviewSrcDoc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          />
        </div>
      ) : (
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-dls-surface">
          <WorkspaceCodePreview
            filePath={props.selectedFile}
            content={props.previewContent ?? ""}
            className="absolute inset-0 min-h-0 min-w-0"
          />
        </div>
      )}
    </div>
  );
}
