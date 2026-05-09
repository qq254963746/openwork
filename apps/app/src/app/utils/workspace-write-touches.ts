import type { DynamicToolUIPart, UIMessage } from "ai";
import { isToolUIPart } from "ai";

import type { WorkspaceWriteTouch, WorkspaceWriteTouchKind } from "../types";

import { cleanArtifactPath } from "./artifact-path";

function toDynamicToolSlice(part: UIMessage["parts"][number]): {
  toolName: string;
  state: string;
  input: unknown;
  output: unknown;
} | null {
  if (part.type === "dynamic-tool") {
    const p = part as DynamicToolUIPart;
    return {
      toolName: p.toolName,
      state: p.state,
      input: "input" in p ? p.input : undefined,
      output: "output" in p ? p.output : undefined,
    };
  }
  if (isToolUIPart(part)) {
    const toolName = part.type.replace(/^tool-/, "");
    const state = (part as { state?: string }).state ?? "";
    return {
      toolName,
      state,
      input: (part as { input?: unknown }).input,
      output: (part as { output?: unknown }).output,
    };
  }
  return null;
}

/** Maps OpenCode-style tool names to file mutation categories */
function fileMutationRole(toolName: string): "apply_patch" | "edit" | "write" | null {
  const l = toolName.toLowerCase();
  if (l === "apply_patch") return "apply_patch";
  if (l === "todowrite" || l === "todoread") return null;
  if (l.includes("edit") || l.includes("replace")) return "edit";
  if (l.includes("write") || l.includes("create")) return "write";
  if (l.endsWith("patch") || l === "patch") return "apply_patch";
  return null;
}

function pickPathFromToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  for (const key of ["filePath", "path", "file", "target_file", "targetFile", "target"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractPathFromStructuredOutput(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    for (const key of ["path", "file", "filePath", "target", "targetPath"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function coerceToolOutputToString(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Parse git-style flags and common "Success… M path" transcripts from patch tools.
 */
function parseApplyPatchPaths(output: unknown): Array<{ raw: string; kind: WorkspaceWriteTouchKind }> {
  const text = coerceToolOutputToString(output);
  const results: Array<{ raw: string; kind: WorkspaceWriteTouchKind }> = [];
  const re = /\b([MADRU?])\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const flag = m[1].toUpperCase();
    let raw = m[2].trim().replace(/[,;:)}'\]"`.]+$/g, "");
    if (!raw || raw.length > 500) continue;
    if (flag === "D") continue;
    const kind: WorkspaceWriteTouchKind = flag === "A" ? "created" : "modified";
    results.push({ raw, kind });
  }
  return results;
}

function buildTouch(displayPath: string, kind: WorkspaceWriteTouchKind): WorkspaceWriteTouch {
  const filename = displayPath.split("/").pop() ?? displayPath;
  const dot = filename.lastIndexOf(".");
  const extLabel = dot > 0 ? filename.slice(dot + 1).toUpperCase() : "";
  return { displayPath, filename, kind, extLabel };
}

function appendTouchDedupe(list: WorkspaceWriteTouch[], touch: WorkspaceWriteTouch) {
  const key = touch.displayPath.toLowerCase();
  const idx = list.findIndex((t) => t.displayPath.toLowerCase() === key);
  if (idx >= 0) list.splice(idx, 1);
  list.push(touch);
}

/**
 * Collect workspace-relative file paths touched by successful write / edit / patch tools
 * in one assistant message (for UI footers).
 */
export function deriveWorkspaceWriteTouchesFromUIMessage(message: UIMessage): WorkspaceWriteTouch[] {
  if (message.role !== "assistant") return [];
  const list: WorkspaceWriteTouch[] = [];

  const append = (rawPath: string, kind: WorkspaceWriteTouchKind) => {
    const cleaned = cleanArtifactPath(rawPath);
    if (!cleaned) return;
    appendTouchDedupe(list, buildTouch(cleaned, kind));
  };

  for (const part of message.parts) {
    const dt = toDynamicToolSlice(part);
    if (!dt || dt.state !== "output-available") continue;

    const role = fileMutationRole(dt.toolName);
    if (!role) continue;

    if (role === "apply_patch") {
      const parsed = parseApplyPatchPaths(dt.output);
      if (parsed.length > 0) {
        for (const row of parsed) {
          append(row.raw, row.kind);
        }
      }
      continue;
    }

    const path =
      pickPathFromToolInput(dt.input) ??
      extractPathFromStructuredOutput(dt.output);
    if (!path) continue;

    if (role === "edit") {
      append(path, "modified");
    } else {
      append(path, "created");
    }
  }

  return list;
}
