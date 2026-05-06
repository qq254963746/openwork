/** @jsxImportSource react */
import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { ChevronRight, File as FileIcon, Folder, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../i18n";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import type { ComposerAttachment } from "../../../../app/types";
import { isDesktopRuntime } from "../../../../app/utils";
import { usePlatform } from "../../../kernel/platform";

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
    if (isSvgFileName(name)) {
      openSvgInDefaultBrowser(rel);
      setSelectedFile(rel);
      return;
    }
    setSelectedFile(rel);
  };

  return (
    <aside className="hidden min-h-0 w-[min(100%,300px)] shrink-0 flex-col border-l border-dls-border bg-dls-sidebar/60 xl:flex">
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
          <div className="text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">
            {t("session.workspace_panel_files")}
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

        {selectedFile ? (
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
    </aside>
  );
}
