/** @jsxImportSource react */
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
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { shell } from "@codemirror/legacy-modes/mode/shell";

export type WorkspaceCodePreviewProps = {
  /** Workspace-relative POSIX path (used for language detection). */
  filePath: string;
  content: string;
  className?: string;
};

function languageExtensionsForPath(relativePosix: string): Extension[] {
  const base = relativePosix.split("/").pop() ?? "";
  const lowerBase = base.toLowerCase();
  if (
    lowerBase === "dockerfile" ||
    lowerBase.startsWith("dockerfile.") ||
    lowerBase === "makefile" ||
    lowerBase === "gnumakefile" ||
    lowerBase === "rakefile" ||
    lowerBase === "jenkinsfile" ||
    lowerBase === "gemfile" ||
    lowerBase === "podfile" ||
    lowerBase === "vagrantfile"
  ) {
    return [javascript({ jsx: false, typescript: false })];
  }

  const dot = lowerBase.lastIndexOf(".");
  const ext = dot >= 0 ? lowerBase.slice(dot) : "";

  switch (ext) {
    case ".json":
      return [json()];
    case ".jsonc":
      return [javascript({ jsx: false, typescript: true })];
    case ".py":
      return [python()];
    case ".java":
      return [java()];
    case ".go":
      return [go()];
    case ".rs":
      return [rust()];
    case ".sql":
      return [sql()];
    case ".yaml":
    case ".yml":
      return [yaml()];
    case ".css":
      return [css()];
    case ".scss":
    case ".sass":
    case ".less":
      return [css()];
    case ".xml":
    case ".plist":
    case ".svg":
      return [xml()];
    case ".c":
    case ".h":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".hh":
    case ".hpp":
      return [cpp()];
    case ".sh":
    case ".bash":
    case ".zsh":
      return [StreamLanguage.define(shell)];
    case ".ts":
    case ".mts":
    case ".cts":
      return [javascript({ jsx: false, typescript: true })];
    case ".tsx":
      return [javascript({ jsx: true, typescript: true })];
    case ".js":
    case ".mjs":
    case ".cjs":
      return [javascript({ jsx: false, typescript: false })];
    case ".jsx":
      return [javascript({ jsx: true, typescript: false })];
    case ".vue":
      return [javascript({ jsx: true, typescript: true })];
    default:
      return [];
  }
}

const workspaceCodeTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "var(--dls-surface, var(--card))",
      /* Do not set `color` on the editor root — it overrides syntax token colors from HighlightStyle. */
    },
    ".cm-editor": { height: "100%" },
    ".cm-scroller": {
      overflow: "auto",
      overflowX: "auto",
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: "1.55",
    },
    ".cm-content": {
      padding: "12px 0",
      caretColor: "transparent",
      color: "var(--dls-text-primary, var(--foreground))",
    },
    ".cm-cursor": { display: "none" },
    ".cm-gutters": {
      backgroundColor: "var(--dls-surface, var(--card))",
      borderRight: "1px solid var(--dls-border, var(--border))",
      color: "var(--dls-text-secondary, var(--muted-foreground))",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "3ch" },
    ".cm-activeLineGutter": { backgroundColor: "var(--dls-surface, var(--card))" },
  },
  { dark: false },
);

function buildExtensions(filePath: string): Extension[] {
  return [
    ...languageExtensionsForPath(filePath),
    syntaxHighlighting(defaultHighlightStyle),
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    workspaceCodeTheme,
  ];
}

/**
 * Read-only workspace file viewer with CodeMirror syntax highlighting.
 */
export function WorkspaceCodePreview(props: WorkspaceCodePreviewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    viewRef.current?.destroy();
    const state = EditorState.create({
      doc: props.content,
      extensions: buildExtensions(props.filePath),
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [props.filePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === props.content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.content },
    });
  }, [props.content]);

  return <div ref={parentRef} className={props.className ?? "min-h-0 min-w-0 flex-1"} />;
}
