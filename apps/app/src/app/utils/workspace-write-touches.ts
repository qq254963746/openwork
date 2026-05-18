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

/** Maps Engine-style tool names to file mutation categories */
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

function coerceToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Parse git-style flags and common "Success… M path" transcripts from patch tools.
 */
function parseApplyPatchPaths(output: unknown): Array<{ raw: string; kind: WorkspaceWriteTouchKind }> {
  const text = coerceToString(output);
  const results: Array<{ raw: string; kind: WorkspaceWriteTouchKind }> = [];
  const re = /\b([MADRU?])\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const flag = m[1].toUpperCase();
    const raw = m[2].trim().replace(/[,;:)}'\]"`.]+$/g, "");
    if (!raw || raw.length > 500) continue;
    if (flag === "D") continue;
    const kind: WorkspaceWriteTouchKind = flag === "A" ? "created" : "modified";
    results.push({ raw, kind });
  }
  return results;
}

/**
 * Try to extract a meaningful unified diff string from a tool's input and output.
 *
 * Sources tried in order:
 * 1. output string that already contains unified diff markers (@@, +++, ---)
 * 2. input fields oldString/newString (or old_string/new_string) → synthetic diff
 * 3. input field `patch` or `diff` that looks like a unified diff
 * 4. input field `content` (write tool) → build an all-additions diff
 */
function extractDiffText(
  input: unknown,
  output: unknown,
  filePath: string,
  role: "apply_patch" | "edit" | "write",
): string | undefined {
  const outputStr = coerceToString(output);

  // 1. output already is a unified diff
  if (
    outputStr.includes("@@") ||
    outputStr.includes("+++ ") ||
    outputStr.includes("--- ")
  ) {
    return outputStr.trim() || undefined;
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;

    // 2. input contains old/new string pair → build a simple diff (edit tool)
    const oldStr =
      typeof o["oldString"] === "string" ? o["oldString"] :
      typeof o["old_string"] === "string" ? o["old_string"] :
      typeof o["old"] === "string" ? o["old"] : null;
    const newStr =
      typeof o["newString"] === "string" ? o["newString"] :
      typeof o["new_string"] === "string" ? o["new_string"] :
      typeof o["new"] === "string" ? o["new"] : null;

    if (oldStr !== null && newStr !== null) {
      return buildSimpleDiff(filePath, oldStr, newStr);
    }

    // 3. input has a `patch` or `diff` field that looks like a unified diff
    for (const key of ["patch", "diff"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim() && (
        v.includes("@@") || v.includes("+++ ") || v.includes("--- ")
      )) {
        return v.trim();
      }
    }

    // 4. write tool with `content` → build an all-additions diff for new files
    //    or a content-only diff for modified files
    if (role === "write") {
      const content = typeof o["content"] === "string" ? o["content"] : null;
      if (content !== null) {
        return buildSimpleDiff(filePath, "", content);
      }
    }
  }

  return undefined;
}

/**
 * Build a minimal unified diff from old/new strings.
 *
 * Special cases:
 * - oldStr empty → all-additions diff (new file)
 * - newStr empty → all-deletions diff (deleted file)
 * - Both non-empty → line-by-line diff with 3 lines of context
 */
function buildSimpleDiff(filePath: string, oldStr: string, newStr: string): string {
  const filename = filePath.split("/").pop() ?? filePath;

  // Normalize: truly empty → zero lines
  const oldLines = oldStr ? oldStr.split("\n") : [];
  const newLines = newStr ? newStr.split("\n") : [];

  if (oldLines.length === 0 && newLines.length === 0) return "";

  // ── Fast path: entirely new file ──────────────────────────
  if (oldLines.length === 0) {
    const lines = [
      `--- /dev/null`,
      `+++ b/${filename}`,
      `@@ -0,0 +1,${newLines.length} @@`,
    ];
    for (const line of newLines) lines.push(`+${line}`);
    return lines.join("\n");
  }

  // ── Fast path: entirely deleted file ──────────────────────
  if (newLines.length === 0) {
    const lines = [
      `--- a/${filename}`,
      `+++ /dev/null`,
      `@@ -1,${oldLines.length} +0,0 @@`,
    ];
    for (const line of oldLines) lines.push(`-${line}`);
    return lines.join("\n");
  }

  // ── General case: simple LCS-free line diff ───────────────
  const CONTEXT = 3;
  const changes: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];

  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }
    const startI = i;
    const startJ = j;
    let found = false;
    for (let ahead = 1; ahead <= 200; ahead++) {
      // Try advancing only old side
      if (i + ahead < oldLines.length && j < newLines.length && oldLines[i + ahead] === newLines[j]) {
        i = i + ahead;
        found = true;
        break;
      }
      // Try advancing only new side
      if (j + ahead < newLines.length && i < oldLines.length && newLines[j + ahead] === oldLines[i]) {
        j = j + ahead;
        found = true;
        break;
      }
      // Try advancing both sides equally
      if (i + ahead < oldLines.length && j + ahead < newLines.length && oldLines[i + ahead] === newLines[j + ahead]) {
        i = i + ahead;
        j = j + ahead;
        found = true;
        break;
      }
    }
    if (!found) {
      i = oldLines.length;
      j = newLines.length;
    }
    if (i > startI || j > startJ) {
      changes.push({ oldStart: startI, oldEnd: i, newStart: startJ, newEnd: j });
    }
  }

  if (changes.length === 0) return "";

  const lines: string[] = [
    `--- a/${filename}`,
    `+++ b/${filename}`,
  ];

  // Merge nearby hunks
  const mergedHunks: typeof changes = [];
  for (const ch of changes) {
    const last = mergedHunks[mergedHunks.length - 1];
    if (last && ch.oldStart - last.oldEnd <= CONTEXT * 2) {
      last.oldEnd = ch.oldEnd;
      last.newEnd = ch.newEnd;
    } else {
      mergedHunks.push({ ...ch });
    }
  }

  for (const hunk of mergedHunks) {
    const ctxBefore = Math.max(0, hunk.oldStart - CONTEXT);
    const ctxAfterOld = Math.min(oldLines.length, hunk.oldEnd + CONTEXT);
    const ctxAfterNew = Math.min(newLines.length, hunk.newEnd + CONTEXT);

    const oldCount = (ctxAfterOld - ctxBefore);
    const newCount = (hunk.newStart - hunk.oldStart) + (ctxAfterNew - ctxBefore) - (hunk.oldEnd - hunk.oldStart) + (hunk.newEnd - hunk.newStart) - (hunk.newEnd - hunk.newStart) ;

    // Simplified counts
    const removedCount = hunk.oldEnd - hunk.oldStart;
    const addedCount = hunk.newEnd - hunk.newStart;
    const ctxBeforeCount = hunk.oldStart - ctxBefore;
    const ctxAfterCount = ctxAfterOld - hunk.oldEnd;
    const hunkOldCount = ctxBeforeCount + removedCount + ctxAfterCount;
    const hunkNewCount = ctxBeforeCount + addedCount + ctxAfterCount;

    lines.push(`@@ -${ctxBefore + 1},${hunkOldCount} +${ctxBefore + 1},${hunkNewCount} @@`);

    // Context before
    for (let k = ctxBefore; k < hunk.oldStart; k++) {
      lines.push(` ${oldLines[k]}`);
    }
    // Removed lines
    for (let k = hunk.oldStart; k < hunk.oldEnd; k++) {
      lines.push(`-${oldLines[k]}`);
    }
    // Added lines
    for (let k = hunk.newStart; k < hunk.newEnd; k++) {
      lines.push(`+${newLines[k]}`);
    }
    // Context after
    for (let k = hunk.oldEnd; k < ctxAfterOld; k++) {
      lines.push(` ${oldLines[k]}`);
    }
  }

  return lines.join("\n");
}

function buildTouch(
  displayPath: string,
  kind: WorkspaceWriteTouchKind,
  diffText?: string,
): WorkspaceWriteTouch {
  const filename = displayPath.split("/").pop() ?? displayPath;
  const dot = filename.lastIndexOf(".");
  const extLabel = dot > 0 ? filename.slice(dot + 1).toUpperCase() : "";
  return { displayPath, filename, kind, extLabel, diffText };
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

  const append = (rawPath: string, kind: WorkspaceWriteTouchKind, diffText?: string) => {
    const cleaned = cleanArtifactPath(rawPath);
    if (!cleaned) return;
    appendTouchDedupe(list, buildTouch(cleaned, kind, diffText));
  };

  for (const part of message.parts) {
    const dt = toDynamicToolSlice(part);
    if (!dt || dt.state !== "output-available") continue;

    const role = fileMutationRole(dt.toolName);
    if (!role) continue;

    if (role === "apply_patch") {
      const parsed = parseApplyPatchPaths(dt.output);
      if (parsed.length > 0) {
        const sharedDiff = extractDiffText(dt.input, dt.output, parsed[0]?.raw ?? "", role);
        for (const row of parsed) {
          append(row.raw, row.kind, sharedDiff);
        }
      }
      continue;
    }

    const path =
      pickPathFromToolInput(dt.input) ??
      extractPathFromStructuredOutput(dt.output);
    if (!path) continue;

    const diffText = extractDiffText(dt.input, dt.output, path, role);

    if (role === "edit") {
      append(path, "modified", diffText);
    } else {
      append(path, "created", diffText);
    }
  }

  return list;
}
