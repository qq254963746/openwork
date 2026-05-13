/** @jsxImportSource react */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { UIMessage } from "ai";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { t } from "../../../../i18n";
import { openDesktopPath, workspaceAddAuthorizedRoot } from "../../../../app/lib/desktop";
import type { AiWorkServerClient, AiWorkWorkspaceDirEntry } from "../../../../app/lib/aiwork-server";
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
import { MarkdownBlock } from "./markdown";
import { WorkspaceCodePreview } from "./workspace-code-preview";
import { WorkspacePanelFileGlyph } from "./workspace-panel-file-glyph";

/** Inline styles so drag chrome avoids text I‑beam / selection in Tauri WebViews. */
const WORKSPACE_PANEL_HEADER_DRAG_STYLE: CSSProperties = {
  cursor: "default",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const WORKSPACE_PANEL_WIDTH_KEY = "aiwork.session.workspacePanelWidth.v1";
const DEFAULT_WORKSPACE_PANEL_WIDTH = 300;
const MIN_WORKSPACE_PANEL_WIDTH = 240;
// Keep the chat transcript usable when the right panel grows.
const MIN_CHAT_COLUMN_WIDTH = 420;

function readStoredWorkspacePanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY);
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_WORKSPACE_PANEL_WIDTH;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
    const maxAllowed = Math.max(MIN_WORKSPACE_PANEL_WIDTH, viewportWidth - MIN_CHAT_COLUMN_WIDTH);
    return Math.min(maxAllowed, Math.max(MIN_WORKSPACE_PANEL_WIDTH, n));
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

/** Matches server `isSupportedWorkspaceTextFilePath` — UTF-8 workspace file previews. */
function isWorkspacePreviewablePath(path: string): boolean {
  const lowered = path.trim().toLowerCase();
  const base = lowered.split("/").pop() ?? lowered;

  // ── Exact basenames (no extension) ──────────────────────────────────────
  if (base.startsWith("dockerfile.")) return true;
  const KNOWN_EXACT_NAMES = new Set([
    // Build / make
    "dockerfile", "gnumakefile", "makefile", "rakefile",
    "jenkinsfile", "gemfile", "podfile", "vagrantfile",
    // Git
    ".gitignore", ".gitattributes", ".gitmodules", ".gitkeep",
    ".gitmessage", ".gitconfig",
    // Node / JS tooling
    ".npmrc", ".npmignore", ".nvmrc", ".node-version",
    ".babelrc", ".browserslistrc", ".eslintignore",
    ".prettierignore", ".prettierrc", ".stylelintignore",
    ".nycrc", ".jshintrc", ".jshintignore",
    // Python
    ".python-version", "pipfile", "requirements",
    // Ruby
    ".rubocop.yml", ".ruby-version", "gemfile.lock",
    // Shell / environment
    ".env", ".env.local", ".env.development", ".env.production",
    ".env.test", ".env.example", ".env.sample",
    ".bashrc", ".bash_profile", ".bash_logout",
    ".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout",
    ".profile", ".inputrc", ".vimrc", ".vim", ".emacs",
    ".editorconfig", ".direnvrc", ".envrc",
    // Linting / formatting
    ".eslintrc", ".eslintrc.js", ".eslintrc.cjs",
    ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml",
    ".stylelintrc", ".markdownlint", ".commitlintrc",
    ".lintstagedrc",
    // Package managers / lockfiles (text)
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "pipfile.lock", "composer.lock",
    // CI / CD
    ".travis.yml", "procfile",
    // Misc config
    ".htaccess", ".curlrc", ".wgetrc", ".netrc",
    "license", "licence", "copying", "notice",
    "authors", "contributors", "changelog", "history",
    "readme", "todo", "install", "news",
  ]);
  if (KNOWN_EXACT_NAMES.has(base)) return true;

  // ── Extension-based matching ─────────────────────────────────────────────
  return [
    // Markdown
    ".md", ".mdx", ".markdown",
    // Data / config
    ".json", ".jsonc", ".json5",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".properties", ".env", ".envrc",
    ".xml", ".plist", ".xhtml",
    // TypeScript / JavaScript
    ".ts", ".tsx", ".mts", ".cts",
    ".js", ".jsx", ".mjs", ".cjs",
    // Web
    ".html", ".htm", ".htmlx", ".svg",
    ".css", ".scss", ".sass", ".less", ".styl",
    // Scripting
    ".sh", ".bash", ".zsh", ".fish", ".ksh", ".csh",
    ".ps1", ".psm1", ".psd1",
    ".py", ".pyw", ".pyi",
    ".rb", ".rake", ".gemspec",
    ".pl", ".pm",
    ".lua",
    ".r",
    // Systems / compiled
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx",
    ".rs",
    ".go",
    ".java", ".kt", ".kts",
    ".swift",
    ".cs", ".vb",
    ".php",
    ".scala",
    ".clj", ".cljs", ".cljc",
    ".ex", ".exs",
    ".erl", ".hrl",
    ".elm",
    ".ml", ".mli",
    ".hs", ".lhs",
    ".dart",
    // Templates
    ".erb", ".haml", ".slim",
    ".jinja", ".jinja2", ".j2",
    ".ejs", ".mustache", ".hbs",
    ".liquid",
    // Infrastructure / build
    ".tf", ".tfvars",
    ".gradle", ".groovy",
    ".bazel", ".bzl",
    ".cmake",
    ".nix",
    // Data / text
    ".sql", ".graphql", ".gql",
    ".csv", ".tsv",
    ".txt", ".log", ".diff", ".patch",
    ".rst", ".adoc", ".asciidoc", ".org",
    // Misc
    ".lock", ".sum", ".mod",
    ".vue", ".svelte",
    ".astro",
    ".mdoc",
    ".tex", ".sty", ".cls", ".bib",
  ].some((ext) => lowered.endsWith(ext));
}

/** Full-screen CodeMirror preview (non-markdown, non-web-preview files). */
function isWorkspaceCodeDocumentPath(path: string): boolean {
  return (
    isWorkspacePreviewablePath(path) &&
    !isMarkdownDocumentPath(path) &&
    !isWebPreviewDocumentPath(path)
  );
}

/** SVG / HTML family: fullscreen iframe preview in the workspace panel. */
function isWebPreviewDocumentPath(relativePosix: string): boolean {
  const lowered = relativePosix.trim().toLowerCase();
  return [".svg", ".html", ".htm", ".htmlx"].some((ext) => lowered.endsWith(ext));
}

/**
 * Injected into iframe srcDoc: matches app scrollbars (index.css + ScrollbarOnScrollReveal),
 * slightly narrower (6px) thumbs, hidden until scroll then fade like the shell.
 */
const WEB_PREVIEW_SCROLLBAR_HEAD_INJECTION = `<meta charset="utf-8" />
<style>
  :root {
    --ow-scrollbar-thumb: rgba(140, 148, 158, 0.42);
    --ow-scrollbar-thumb-hover: rgba(120, 128, 138, 0.58);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ow-scrollbar-thumb: rgba(170, 178, 188, 0.38);
      --ow-scrollbar-thumb-hover: rgba(190, 198, 208, 0.52);
    }
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  *.ow-scrollbar-scrolling {
    scrollbar-color: var(--ow-scrollbar-thumb) transparent;
  }
  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 100px;
  }
  *.ow-scrollbar-scrolling::-webkit-scrollbar-thumb {
    background-color: var(--ow-scrollbar-thumb);
  }
  *.ow-scrollbar-scrolling::-webkit-scrollbar-thumb:hover {
    background-color: var(--ow-scrollbar-thumb-hover);
  }
</style>
<script>
(function () {
  var HIDE_MS = 900;
  var CLASS = "ow-scrollbar-scrolling";
  var timers = new WeakMap();
  function pulse(el) {
    if (!el || !el.classList) return;
    el.classList.add(CLASS);
    var p = timers.get(el);
    if (p !== undefined) clearTimeout(p);
    var id = setTimeout(function () {
      el.classList.remove(CLASS);
      timers.delete(el);
    }, HIDE_MS);
    timers.set(el, id);
  }
  function onScroll(e) {
    var t = e.target;
    if (t === document || t === document.documentElement) {
      pulse(document.documentElement);
      return;
    }
    if (t && t.classList) pulse(t);
  }
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
})();
</script>`;

function buildWebPreviewSrcDoc(raw: string): string {
  const inject = WEB_PREVIEW_SCROLLBAR_HEAD_INJECTION;
  const t = raw.trim();
  if (!t) {
    return `<!DOCTYPE html><html><head>${inject}</head><body></body></html>`;
  }
  if (/^<\?xml/i.test(t) || /^<svg/i.test(t)) {
    return `<!DOCTYPE html><html><head>${inject}</head><body style="margin:0;min-height:100vh;overflow:auto">${t}</body></html>`;
  }
  if (/<head[\s>]/i.test(t)) {
    return t.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  }
  if (/<html[\s>]/i.test(t)) {
    return t.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`);
  }
  return `<!DOCTYPE html><html><head>${inject}</head><body style="margin:0;min-height:100vh;overflow:auto">${t}</body></html>`;
}

/** Join workspace root (host path) with POSIX relative segments from the file tree. */
function absoluteWorkspaceFilePath(workspaceRoot: string, relativePosix: string): string | null {
  let root = workspaceRoot.trim();
  if (!root) return null;
  // Desktop shells sometimes surface `file://` roots; Tauri opener expects a native filesystem path.
  if (/^file:\/\//i.test(root)) {
    try {
      const u = new URL(root);
      let pathname = decodeURIComponent(u.pathname);
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      root = isWindowsPlatform() ? pathname.replace(/\//g, "\\") : pathname;
    } catch {
      root = root.replace(/^file:\/\//i, "");
    }
  }
  const segments = relativePosix.split("/").filter(Boolean);
  const rootClean = root.replace(/[/\\]+$/, "");
  const isWin = /^[a-zA-Z]:/.test(rootClean) || rootClean.startsWith("\\\\");
  const sep = isWin ? "\\" : "/";
  return [rootClean, ...segments].join(sep);
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

function WorkspaceTreeNode(props: {
  entry: AiWorkWorkspaceDirEntry;
  relativePath: string;
  depth: number;
  client: AiWorkServerClient;
  workspaceId: string;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelectEntry: (relativePath: string) => void;
  liveWorkspacePreview?: boolean;
}) {
  const isDirectory = props.entry.kind === "directory";
  const isExpanded = props.expandedPaths.has(props.relativePath);
  const isSelected = !isDirectory && props.selectedPath === props.relativePath;

  const childrenQuery = useQuery({
    queryKey: ["workspaceTreeDir", props.workspaceId, props.relativePath],
    queryFn: () => props.client.listWorkspaceDirectory(props.workspaceId, props.relativePath),
    enabled: isDirectory && isExpanded && Boolean(props.workspaceId),
    staleTime: props.liveWorkspacePreview ? 0 : 15_000,
    refetchInterval: props.liveWorkspacePreview ? 800 : false,
  });

  const handleClick = () => {
    if (isDirectory) {
      props.onToggleExpand(props.relativePath);
    } else {
      props.onSelectEntry(props.relativePath);
    }
  };

  const indent = 8 + props.depth * 16;

  return (
    <>
      <li key={props.relativePath}>
        <button
          type="button"
          className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 text-left text-[12px] transition-colors ${
            isSelected
              ? "bg-dls-accent/15 text-dls-text"
              : "hover:bg-dls-hover text-dls-text"
          }`}
          style={{ paddingLeft: `${indent}px`, paddingRight: "8px" }}
          onClick={handleClick}
        >
          {isDirectory ? (
            <ChevronRight
              size={14}
              className={`shrink-0 text-[#000000] transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
          ) : (
            <WorkspacePanelFileGlyph filename={props.entry.name} className="shrink-0 text-[#000000]" />
          )}
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={14} className="shrink-0 text-[#000000]" aria-hidden />
            ) : (
              <Folder size={14} className="shrink-0 text-[#000000]" aria-hidden />
            )
          ) : null}
          <span className="min-w-0 flex-1 truncate font-mono">{props.entry.name}</span>
          {isDirectory && isExpanded && childrenQuery.isFetching ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-dls-secondary" />
          ) : null}
        </button>
      </li>
      {isDirectory && isExpanded && childrenQuery.data ? (
        childrenQuery.data.entries.map((child) => {
          const childRelativePath = joinRelativePath(props.relativePath, child.name);
          return (
            <WorkspaceTreeNode
              key={childRelativePath}
              entry={child}
              relativePath={childRelativePath}
              depth={props.depth + 1}
              client={props.client}
              workspaceId={props.workspaceId}
              selectedPath={props.selectedPath}
              expandedPaths={props.expandedPaths}
              onToggleExpand={props.onToggleExpand}
              onSelectEntry={props.onSelectEntry}
              liveWorkspacePreview={props.liveWorkspacePreview}
            />
          );
        })
      ) : null}
    </>
  );
}

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

  const selectedFileTitle = selectedFile
    ? selectedFile.split("/").filter(Boolean).pop() ?? selectedFile
    : "";

  /** Whether a file preview pane should be shown alongside the file list */
  const previewPaneOpen = Boolean(
    selectedFile && (markdownPreviewOpen || webPreviewOpen || codeDocumentPreviewOpen || isWorkspacePreviewablePath(selectedFile || "")),
  );

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
      className="flex min-h-0 min-w-0 flex-col border-r border-dls-divider bg-dls-sidebar"
      style={previewPaneOpen ? { width: fileListWidth, minWidth: FILE_LIST_MIN_WIDTH, flexShrink: 0 } : { flex: 1 }}
    >
      <div className="shrink-0 border-b border-dls-divider px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#000000]">
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
          !toolsUsed.length ? (
            <div className="text-[11px] text-dls-secondary">{t("session.context_empty")}</div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Drag region must not wrap toolbar buttons (WKWebView hit-testing); mirror workspace-session-list. */}
        <div className="shrink-0 border-b border-dls-divider px-3 py-2">
          <div className="flex min-h-[28px] cursor-default items-center gap-2">
            <div
              className="flex min-w-0 flex-1 cursor-default items-center select-none text-[11px] font-semibold uppercase tracking-wide text-[#000000]"
              data-tauri-drag-region={true}
              style={{ ...WORKSPACE_PANEL_HEADER_DRAG_STYLE }}
            >
              {t("session.workspace_panel_files")}
            </div>
            <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] disabled:pointer-events-none disabled:opacity-40"
                onClick={openCurrentFolderOnDesktop}
                disabled={!canOpenCurrentFolderOnDesktop}
                title={openFolderTitle}
                aria-label={openFolderTitle}
              >
                <FolderOpen size={14} />
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md p-1 text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] disabled:pointer-events-none disabled:opacity-40"
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

  /** Shared preview pane header */
  const previewPaneHeader = selectedFile ? (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-dls-divider bg-dls-surface/95 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspacePanelFileGlyph
          filename={selectedFile}
          size={16}
          className="shrink-0 text-[#000000]"
        />
        <span className="min-w-0 truncate font-mono text-[13px] font-medium text-dls-text" title={selectedFile}>
          {selectedFileTitle}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000]"
          onClick={() => void previewQuery.refetch()}
          aria-label={t("session.workspace_panel_refresh")}
          title={t("session.workspace_panel_refresh")}
        >
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000]"
          onClick={() => setSelectedFile(null)}
          aria-label={t("session.workspace_panel_close_preview")}
          title={t("session.workspace_panel_close_preview")}
        >
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  ) : null;

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
            {/* Divider between file list and preview — draggable to resize the file list column */}
            <div
              role="separator"
              aria-orientation="vertical"
              className="relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-gray-6/40 touch-none"
              onPointerDown={startPreviewDividerResize}
            />

            {/* Preview pane */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-dls-sidebar">
              {previewPaneHeader}

              {markdownPreviewOpen ? (
                <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-dls-surface px-4 py-4">
                  {previewQuery.isLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="animate-spin text-dls-secondary" size={22} />
                    </div>
                  ) : previewQuery.isError ? (
                    <div className="text-[12px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
                  ) : (
                    <div className="min-w-0 max-w-full">
                      <MarkdownBlock text={previewQuery.data?.content ?? ""} />
                    </div>
                  )}
                </div>
              ) : webPreviewOpen ? (
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-dls-surface">
                  {previewQuery.isLoading ? (
                    <div className="flex min-h-[200px] items-center justify-center py-12">
                      <Loader2 className="animate-spin text-dls-secondary" size={22} />
                    </div>
                  ) : previewQuery.isError ? (
                    <div className="p-4 text-[12px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
                  ) : (
                    <iframe
                      key={`${props.workspaceId}:${selectedFile}`}
                      title={selectedFileTitle}
                      className="absolute inset-0 h-full w-full border-0 bg-dls-surface"
                      srcDoc={webPreviewSrcDoc}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                    />
                  )}
                </div>
              ) : codeDocumentPreviewOpen ? (
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-dls-surface">
                  {previewQuery.isLoading ? (
                    <div className="flex min-h-[200px] items-center justify-center py-12">
                      <Loader2 className="animate-spin text-dls-secondary" size={22} />
                    </div>
                  ) : previewQuery.isError ? (
                    <div className="p-4 text-[12px] text-red-11">{t("session.workspace_panel_preview_error")}</div>
                  ) : (
                    <WorkspaceCodePreview
                      filePath={selectedFile}
                      content={previewQuery.data?.content ?? ""}
                      className="absolute inset-0 min-h-0 min-w-0"
                    />
                  )}
                </div>
              ) : (
                /* Generic previewable file — plain text fallback */
                <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto px-3 pb-3 pt-2">
                  {previewQuery.isLoading ? (
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
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
});
SessionWorkspacePanel.displayName = "SessionWorkspacePanel";
