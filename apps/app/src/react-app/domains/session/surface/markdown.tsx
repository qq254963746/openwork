/** @jsxImportSource react */
import * as React from "react";
import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, Options as ReactMarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Streamdown } from "streamdown";

import "katex/dist/katex.min.css";
import "highlight.js/styles/github.min.css";

import { applyTextHighlights } from "./text-highlights";

/** GFM + LaTeX ($...$, $$...$$); KaTeX won't throw on incomplete streams */
const remarkMarkdownPlugins = [remarkGfm, remarkMath];
const rehypeMarkdownPlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  [rehypeKatex, { throwOnError: false }],
  rehypeHighlight,
];

function nodeToPlainText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return nodeToPlainText(props?.children);
  }
  return "";
}

function MarkdownCodeBlock(props: { className?: string; children: React.ReactNode }) {
  const text = nodeToPlainText(props.children);
  const [copied, setCopied] = useState(false);

  return (
    <div className="my-4 overflow-hidden rounded-[18px] border border-dls-border/70 bg-dls-surface">
      <div className="flex items-center justify-end border-b border-dls-border/70 bg-dls-surface px-3 py-2">
        <button
          type="button"
          className="rounded-full border border-dls-border bg-dls-surface px-3 py-1 text-[11px] font-medium text-dls-text transition-colors hover:bg-dls-hover"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[12px] leading-6 text-gray-12 !bg-transparent">
        <code className={props.className} style={{ backgroundColor: "transparent" }}>
          {props.children}
        </code>
      </pre>
    </div>
  );
}

function slugifyHeading(text: string): string {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return "";

  // Keep most unicode letters/numbers (including CJK), normalize whitespace to dashes.
  // This is "GitHub-ish" enough for in-app TOC anchors without adding another dependency.
  const dashed = value.replace(/\s+/g, "-");
  return dashed
    .replace(
      // remove punctuation/symbols except dash/underscore
      // eslint-disable-next-line no-control-regex
      /[^\p{Letter}\p{Number}\u4e00-\u9fff\-_]+/gu,
      "",
    )
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findScrollParent(start: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = start;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    const isScrollable = (overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight;
    if (isScrollable) return node;
    node = node.parentElement;
  }
  return null;
}

function normalizeHashId(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const noHash = value.startsWith("#") ? value.slice(1) : value;
  try {
    return decodeURIComponent(noHash);
  } catch {
    return noHash;
  }
}

function createMarkdownComponents(): Components {
  const slugCounts = new Map<string, number>();
  const getUniqueId = (raw: string) => {
    const base = slugifyHeading(raw);
    if (!base) return "";
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  const createHeading =
    (tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    ({ children }: { children?: React.ReactNode }) => {
      const text = nodeToPlainText(children);
      const id = getUniqueId(text);
      return React.createElement(tag, { id: id || undefined }, children);
    };

  return {
    a({ href, children }) {
      const rawHref = href ?? "";
      const isHashLink = rawHref.startsWith("#");

      return (
        <a
          href={rawHref}
          target={isHashLink ? undefined : "_blank"}
          rel={isHashLink ? undefined : "noreferrer noopener"}
          className="underline underline-offset-2 text-dls-accent hover:text-[var(--dls-accent-hover)]"
          onClick={(event) => {
            if (!isHashLink) return;
            event.preventDefault();

            const id = normalizeHashId(rawHref);
            if (!id) return;

            // Escape for querySelector while still supporting old browsers gracefully.
            const selector = `#${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id}`;
            const linkEl = event.currentTarget as HTMLElement;
            const markdownRoot = linkEl.closest(".markdown-content") as HTMLElement | null;
            let el =
              (markdownRoot?.querySelector(selector) as HTMLElement | null) ??
              (document.querySelector(selector) as HTMLElement | null);

            // Fallback: if the target id doesn't exist (common when TOC slug rules
            // differ), match by heading text slug.
            if (!el) {
              const searchRoot = markdownRoot ?? document.body;
              const headings = Array.from(
                searchRoot.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
              );
              el =
                headings.find((node) => (node.id || "") === id) ??
                headings.find((node) => slugifyHeading(node.textContent ?? "") === id) ??
                null;
            }

            if (!el) {
              // Last resort: allow default hash navigation
              try {
                window.location.hash = `#${id}`;
              } catch {
                // ignore
              }
              return;
            }

            const scrollParent = findScrollParent(markdownRoot ?? linkEl.parentElement);
            if (scrollParent) {
              const parentRect = scrollParent.getBoundingClientRect();
              const targetRect = el.getBoundingClientRect();
              const delta = targetRect.top - parentRect.top;
              scrollParent.scrollTo({
                top: scrollParent.scrollTop + delta - 12,
                behavior: "smooth",
              });
            } else {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            }

            try {
              history.pushState(null, "", rawHref);
            } catch {
              // ignore
            }
          }}
        >
          {children}
        </a>
      );
    },
    h1: createHeading("h1"),
    h2: createHeading("h2"),
    h3: createHeading("h3"),
    h4: createHeading("h4"),
    h5: createHeading("h5"),
    h6: createHeading("h6"),
    pre({ children }) {
      return (
        <pre className="my-4 overflow-x-auto rounded-[18px] border border-dls-border/70 bg-dls-surface px-4 py-3 text-[12px] leading-6 text-gray-12 !bg-transparent">
          {children}
        </pre>
      );
    },
    code({ className, children }) {
      const isBlock = Boolean(className?.includes("language-"));
      if (isBlock) {
        return <MarkdownCodeBlock className={className}>{children}</MarkdownCodeBlock>;
      }
      return (
        <code className="rounded-md bg-gray-2/70 px-1.5 py-0.5 font-mono text-[0.92em] text-gray-12">
          {children}
        </code>
      );
    },
    blockquote({ children }) {
      return (
        <blockquote className="my-4 border-l-4 border-dls-border pl-4 italic text-gray-11">{children}</blockquote>
      );
    },
    table({ children }) {
      return <table className="my-4 w-full border-collapse">{children}</table>;
    },
    th({ children }) {
      return <th className="border border-dls-border bg-dls-hover p-2 text-left">{children}</th>;
    },
    td({ children }) {
      return <td className="border border-dls-border p-2 align-top">{children}</td>;
    },
    hr() {
      return <hr className="my-6 border-none h-px bg-gray-4" />;
    },
  };
}

const markdownClassName = `markdown-content max-w-none text-gray-12
  [&_strong]:font-semibold
  [&_em]:italic
  [&_h1]:my-5 [&_h1]:text-xl [&_h1]:font-semibold
  [&_h2]:my-4 [&_h2]:text-lg [&_h2]:font-semibold
  [&_h3]:my-3 [&_h3]:text-base [&_h3]:font-semibold
  [&_p]:my-3 [&_p]:leading-relaxed
  [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6
  [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6
  [&_li]:my-1
  [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto
  [&_pre]:!bg-transparent
  [&_pre_code]:!bg-transparent
  [&_.hljs]:!bg-transparent
`.trim();

function MarkdownBlockInner(props: {
  text: string;
  streaming?: boolean;
  highlightQuery?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const components = createMarkdownComponents();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [props.highlightQuery, props.streaming, props.text]);

  if (!props.text.trim()) return null;

  if (props.streaming) {
    return (
      <div ref={rootRef} className={markdownClassName}>
        <Streamdown
          remarkPlugins={remarkMarkdownPlugins}
          rehypePlugins={rehypeMarkdownPlugins}
          components={components}
          skipHtml
        >
          {props.text}
        </Streamdown>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={markdownClassName}>
      <ReactMarkdown
        remarkPlugins={remarkMarkdownPlugins}
        rehypePlugins={rehypeMarkdownPlugins}
        components={components}
        skipHtml
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoize so a message block that has already been rendered — the usual
 * case for every assistant bubble above the currently-streaming one —
 * doesn't re-parse its markdown on every token. Only re-renders when its
 * own text / streaming / highlightQuery props change.
 */
export const MarkdownBlock = memo(MarkdownBlockInner);
MarkdownBlock.displayName = "MarkdownBlock";
