/** @jsxImportSource react */
import type { CSSProperties } from "react";
import type { UIMessage } from "ai";
import { isWindowsPlatform } from "../../../../../app/utils";

export const WORKSPACE_PANEL_HEADER_DRAG_STYLE: CSSProperties = {
  cursor: "default",
  userSelect: "none",
  WebkitUserSelect: "none",
};

export const WORKSPACE_PANEL_WIDTH_KEY = "aiwork.session.workspacePanelWidth.v1";
export const DEFAULT_WORKSPACE_PANEL_WIDTH = 300;
export const MIN_WORKSPACE_PANEL_WIDTH = 240;
/** Keep the chat transcript usable when the right panel grows. */
export const MIN_CHAT_COLUMN_WIDTH = 420;

export function readStoredWorkspacePanelWidth(): number {
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
export function isMarkdownDocumentPath(relativePosix: string): boolean {
  const lowered = relativePosix.trim().toLowerCase();
  return [".md", ".mdx", ".markdown"].some((ext) => lowered.endsWith(ext));
}

export function workspaceFolderLabel(root: string): string {
  const trimmed = root.trim().replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return (parts[parts.length - 1] ?? trimmed) || "Workspace";
}

export function joinRelativePath(dir: string, name: string): string {
  const d = dir.trim();
  if (!d) return name;
  return `${d.replace(/\/+$/, "")}/${name}`;
}

/** Matches server `isSupportedWorkspaceTextFilePath` — UTF-8 workspace file previews. */
export function isWorkspacePreviewablePath(path: string): boolean {
  const lowered = path.trim().toLowerCase();
  const base = lowered.split("/").pop() ?? lowered;

  if (base.startsWith("dockerfile.")) return true;
  const KNOWN_EXACT_NAMES = new Set([
    "dockerfile", "gnumakefile", "makefile", "rakefile",
    "jenkinsfile", "gemfile", "podfile", "vagrantfile",
    ".gitignore", ".gitattributes", ".gitmodules", ".gitkeep",
    ".gitmessage", ".gitconfig",
    ".npmrc", ".npmignore", ".nvmrc", ".node-version",
    ".babelrc", ".browserslistrc", ".eslintignore",
    ".prettierignore", ".prettierrc", ".stylelintignore",
    ".nycrc", ".jshintrc", ".jshintignore",
    ".python-version", "pipfile", "requirements",
    ".rubocop.yml", ".ruby-version", "gemfile.lock",
    ".env", ".env.local", ".env.development", ".env.production",
    ".env.test", ".env.example", ".env.sample",
    ".bashrc", ".bash_profile", ".bash_logout",
    ".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout",
    ".profile", ".inputrc", ".vimrc", ".vim", ".emacs",
    ".editorconfig", ".direnvrc", ".envrc",
    ".eslintrc", ".eslintrc.js", ".eslintrc.cjs",
    ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml",
    ".stylelintrc", ".markdownlint", ".commitlintrc",
    ".lintstagedrc",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "pipfile.lock", "composer.lock",
    ".travis.yml", "procfile",
    ".htaccess", ".curlrc", ".wgetrc", ".netrc",
    "license", "licence", "copying", "notice",
    "authors", "contributors", "changelog", "history",
    "readme", "todo", "install", "news",
  ]);
  if (KNOWN_EXACT_NAMES.has(base)) return true;

  return [
    ".md", ".mdx", ".markdown",
    ".json", ".jsonc", ".json5",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".properties", ".env", ".envrc",
    ".xml", ".plist", ".xhtml",
    ".ts", ".tsx", ".mts", ".cts",
    ".js", ".jsx", ".mjs", ".cjs",
    ".html", ".htm", ".htmlx", ".svg",
    ".css", ".scss", ".sass", ".less", ".styl",
    ".sh", ".bash", ".zsh", ".fish", ".ksh", ".csh",
    ".ps1", ".psm1", ".psd1",
    ".py", ".pyw", ".pyi",
    ".rb", ".rake", ".gemspec",
    ".pl", ".pm",
    ".lua",
    ".r",
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
    ".erb", ".haml", ".slim",
    ".jinja", ".jinja2", ".j2",
    ".ejs", ".mustache", ".hbs",
    ".liquid",
    ".tf", ".tfvars",
    ".gradle", ".groovy",
    ".bazel", ".bzl",
    ".cmake",
    ".nix",
    ".sql", ".graphql", ".gql",
    ".csv", ".tsv",
    ".txt", ".log", ".diff", ".patch",
    ".rst", ".adoc", ".asciidoc", ".org",
    ".lock", ".sum", ".mod",
    ".vue", ".svelte",
    ".astro",
    ".mdoc",
    ".tex", ".sty", ".cls", ".bib",
  ].some((ext) => lowered.endsWith(ext));
}

/** Full-screen CodeMirror preview (non-markdown, non-web-preview files). */
export function isWorkspaceCodeDocumentPath(path: string): boolean {
  return (
    isWorkspacePreviewablePath(path) &&
    !isMarkdownDocumentPath(path) &&
    !isWebPreviewDocumentPath(path)
  );
}

/** SVG / HTML family: fullscreen iframe preview in the workspace panel. */
export function isWebPreviewDocumentPath(relativePosix: string): boolean {
  const lowered = relativePosix.trim().toLowerCase();
  return [".svg", ".html", ".htm", ".htmlx"].some((ext) => lowered.endsWith(ext));
}

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

export function buildWebPreviewSrcDoc(raw: string): string {
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
export function absoluteWorkspaceFilePath(workspaceRoot: string, relativePosix: string): string | null {
  let root = workspaceRoot.trim();
  if (!root) return null;
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

export function collectSessionToolNames(messages: UIMessage[]): string[] {
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

/**
 * Returns Tailwind text-color class for a git status code.
 * Palette matches VS Code's default Git decoration colors:
 *   green  — new / untracked / staged-add
 *   yellow — modified, renamed, copied
 *   red    — deleted, conflict/unmerged
 */
export function gitStatusColor(status: string | undefined): string {
  if (!status) return "";
  switch (status) {
    case "?": return "text-[#73c991]";
    case "A": return "text-[#73c991]";
    case "M": return "text-[#e2c08d]";
    case "R": return "text-[#e2c08d]";
    case "C": return "text-[#e2c08d]";
    case "D": return "text-[#c74e39]";
    case "U": return "text-[#c74e39]";
    default:  return "";
  }
}

/**
 * Right-side badge letter shown next to file names, matching VS Code convention:
 *   U — untracked  M — modified  D — deleted  A — staged add  C — conflict
 */
export function gitStatusBadge(status: string | undefined): string {
  if (!status) return "";
  switch (status) {
    case "?": return "U";
    case "A": return "A";
    case "M": return "M";
    case "R": return "M";
    case "C": return "M";
    case "D": return "D";
    case "U": return "C";
    default:  return "";
  }
}

/**
 * Given a git status map (file path → code) and a directory path,
 * returns the representative status for that directory by scanning all
 * files underneath it and picking the highest-priority one.
 */
export function directoryGitStatus(
  gitStatusMap: Record<string, string>,
  dirPath: string,
): string | undefined {
  const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  const score: Record<string, number> = { U: 4, D: 3, M: 2, A: 2, R: 2, C: 2, "?": 1 };
  let best: string | undefined;
  let bestScore = 0;
  for (const [filePath, code] of Object.entries(gitStatusMap)) {
    if (!filePath.startsWith(prefix)) continue;
    const s = score[code] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = code;
    }
  }
  return best;
}
