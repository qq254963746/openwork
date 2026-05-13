/** @jsxImportSource react */
/**
 * DiffCodePreview — renders a unified diff string with:
 *   • Full syntax highlighting (CodeMirror, same language detection as WorkspaceCodePreview)
 *   • Per-line background tinting for + / - / @@ lines
 *   • No line numbers, no scrollbar (parent controls overflow)
 */
import { useEffect, useRef } from "react";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { shell } from "@codemirror/legacy-modes/mode/shell";

// ── Language detection (mirrors workspace-code-preview.tsx) ────────────────

function languageExtensionsForPath(filePath: string): Extension[] {
  const base = (filePath.split("/").pop() ?? "").toLowerCase();

  if (
    base === "dockerfile" || base.startsWith("dockerfile.") ||
    base === "makefile"   || base === "gnumakefile" ||
    base === "rakefile"   || base === "jenkinsfile" ||
    base === "gemfile"    || base === "podfile"     || base === "vagrantfile"
  ) {
    return [javascript({ jsx: false, typescript: false })];
  }

  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot) : "";

  switch (ext) {
    case ".json":                        return [json()];
    case ".jsonc":                       return [javascript({ jsx: false, typescript: true })];
    case ".py": case ".pyw": case ".pyi": return [python()];
    case ".java": case ".kt":            return [java()];
    case ".go":                          return [go()];
    case ".rs":                          return [rust()];
    case ".sql":                         return [sql()];
    case ".yaml": case ".yml":           return [yaml()];
    case ".css": case ".scss": case ".sass": case ".less": return [css()];
    case ".xml": case ".plist": case ".svg": case ".html": case ".htm": return [xml()];
    case ".c": case ".h": case ".cc": case ".cpp": case ".cxx":
    case ".hh": case ".hpp":            return [cpp()];
    case ".sh": case ".bash": case ".zsh": return [StreamLanguage.define(shell)];
    case ".ts": case ".mts": case ".cts": return [javascript({ jsx: false, typescript: true })];
    case ".tsx":                         return [javascript({ jsx: true,  typescript: true })];
    case ".js": case ".mjs": case ".cjs": return [javascript({ jsx: false, typescript: false })];
    case ".jsx":                         return [javascript({ jsx: true,  typescript: false })];
    case ".vue":                         return [javascript({ jsx: true,  typescript: true })];
    default:                             return [];
  }
}

// ── Diff line classification ────────────────────────────────────────────────

type DiffLineKind = "added" | "removed" | "hunk" | "header" | "context";

function classifyDiffLine(rawLine: string): DiffLineKind {
  if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) return "added";
  if (rawLine.startsWith("-") && !rawLine.startsWith("---")) return "removed";
  if (rawLine.startsWith("@@")) return "hunk";
  if (rawLine.startsWith("---") || rawLine.startsWith("+++")) return "header";
  return "context";
}

/** Strip the leading diff sigil (+/-/ ) from a line to get the raw code. */
function stripSigil(rawLine: string): string {
  if (rawLine.startsWith("+") || rawLine.startsWith("-") || rawLine.startsWith(" ")) {
    return rawLine.slice(1);
  }
  return rawLine;
}

// ── Decoration marks for diff line backgrounds ──────────────────────────────

const addedLineMark    = Decoration.line({ attributes: { style: "background: var(--diff-added-bg)"   } });
const removedLineMark  = Decoration.line({ attributes: { style: "background: var(--diff-removed-bg)" } });
const hunkLineMark     = Decoration.line({ attributes: { style: "background: var(--diff-hunk-bg)"    } });
const headerLineMark   = Decoration.line({ attributes: { style: "background: var(--diff-header-bg)"  } });

/**
 * ViewPlugin that applies per-line background decorations based on the
 * `data-diff-kinds` attribute stored on the editor DOM element.
 */
function makeDiffLinePlugin(kinds: DiffLineKind[]) {
  return ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) { this.decorations = buildDecorations(view, kinds); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, kinds);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function buildDecorations(view: EditorView, kinds: DiffLineKind[]) {
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
    const kind = kinds[lineNo - 1];
    const line = view.state.doc.line(lineNo);
    if (kind === "added")   builder.add(line.from, line.from, addedLineMark);
    if (kind === "removed") builder.add(line.from, line.from, removedLineMark);
    if (kind === "hunk")    builder.add(line.from, line.from, hunkLineMark);
    if (kind === "header")  builder.add(line.from, line.from, headerLineMark);
  }
  return builder.finish();
}

// ── Theme ───────────────────────────────────────────────────────────────────

const diffTheme = EditorView.theme(
  {
    "&": {
      fontSize: "11.5px",
      backgroundColor: "transparent",
    },
    ".cm-editor": { backgroundColor: "transparent" },
    ".cm-scroller": {
      overflow: "hidden",          // parent controls scrolling
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: "1.6",
    },
    ".cm-content": {
      padding: "0",
      caretColor: "transparent",
    },
    ".cm-cursor": { display: "none" },
    ".cm-gutters": { display: "none" },
    ".cm-line": { padding: "0.5px 12px" },
  },
  { dark: false },
);

// CSS variables injected once into <head>
const DIFF_CSS_VARS = `
:root {
  --diff-added-bg:   rgba(46,160,67,0.15);
  --diff-removed-bg: rgba(248,81,73,0.15);
  --diff-hunk-bg:    rgba(88,166,255,0.10);
  --diff-header-bg:  transparent;
}
@media (prefers-color-scheme: dark) {
  :root {
    --diff-added-bg:   rgba(46,160,67,0.20);
    --diff-removed-bg: rgba(248,81,73,0.20);
    --diff-hunk-bg:    rgba(88,166,255,0.12);
  }
}
`;

let cssInjected = false;
function ensureDiffCssVars() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = DIFF_CSS_VARS;
  document.head.appendChild(style);
}

// ── Public component ─────────────────────────────────────────────────────────

export type DiffCodePreviewProps = {
  /** Workspace-relative path — used only for language detection. */
  filePath: string;
  /** Raw unified diff string (lines starting with +, -, @@, ---, +++, or space). */
  diffText: string;
  className?: string;
};

export function DiffCodePreview({ filePath, diffText, className }: DiffCodePreviewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef   = useRef<EditorView | null>(null);

  useEffect(() => {
    ensureDiffCssVars();
    const parent = parentRef.current;
    if (!parent) return;

    const rawLines = diffText.split("\n");
    const kinds    = rawLines.map(classifyDiffLine);
    // Build the document: strip sigils so CodeMirror syntax-highlights pure code
    const codeLines = rawLines.map(stripSigil);
    const doc = codeLines.join("\n");

    viewRef.current?.destroy();

    const state = EditorState.create({
      doc,
      extensions: [
        ...languageExtensionsForPath(filePath),
        syntaxHighlighting(defaultHighlightStyle),
        makeDiffLinePlugin(kinds),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        diffTheme,
      ],
    });

    viewRef.current = new EditorView({ state, parent });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  // Re-create whenever filePath or diffText changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, diffText]);

  return <div ref={parentRef} className={className ?? ""} />;
}
