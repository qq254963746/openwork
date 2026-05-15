/** @jsxImportSource react */
import { useState } from "react";
import type { CheckpointDiffFile } from "../../../../../app/lib/checkpoints";

export function statusBadgeChar(status: CheckpointDiffFile["status"]): string {
  switch (status) {
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "type-changed": return "T";
    case "modified": return "M";
    default: return "?";
  }
}

export function statusBadgeClass(status: CheckpointDiffFile["status"]): string {
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold";
  switch (status) {
    case "added": return `${base} bg-green-9 text-white`;
    case "deleted": return `${base} bg-red-9 text-white`;
    case "renamed": return `${base} bg-blue-9 text-white`;
    case "type-changed": return `${base} bg-purple-9 text-white`;
    case "modified": return `${base} bg-amber-9 text-white`;
    default: return `${base} bg-gray-7 text-white`;
  }
}

/**
 * Compact diff summary shown in the edit-confirm modal: list of file paths +
 * line-level diff body collapsed by default.
 */
export function EditDiffSummary(props: { files: CheckpointDiffFile[] }) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const totalAdditions = props.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = props.files.reduce((sum, f) => sum + f.deletions, 0);
  return (
    <div className="rounded-lg border border-amber-6/40 bg-amber-3/10 p-3 text-xs text-gray-12">
      <div className="mb-2 font-medium">
        {props.files.length === 1
          ? `1 file changed`
          : `${props.files.length} files changed`}
        {(totalAdditions > 0 || totalDeletions > 0) ? (
          <>
            {" "}
            <span className="text-green-11">+{totalAdditions}</span>{" "}
            <span className="text-red-11">-{totalDeletions}</span>
          </>
        ) : null}
      </div>
      <div className="max-h-[260px] overflow-y-auto rounded-md border border-amber-6/30 bg-white/40 dark:bg-gray-1/40">
        {props.files.map((file) => {
          const isExpanded = expandedPath === file.path;
          return (
            <div key={file.path} className="border-b border-amber-6/20 last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-amber-3/20"
                onClick={() => setExpandedPath((cur) => (cur === file.path ? null : file.path))}
              >
                <span className={statusBadgeClass(file.status)}>{statusBadgeChar(file.status)}</span>
                <code className="flex-1 truncate text-[11px] font-mono">{file.path}</code>
                <span className="shrink-0 text-[10px] text-green-11">+{file.additions}</span>
                <span className="shrink-0 text-[10px] text-red-11">-{file.deletions}</span>
              </button>
              {isExpanded && !file.binary && file.hunks.length > 0 ? (
                <div className="bg-gray-2/50 px-2 py-1 font-mono text-[11px] leading-tight">
                  {file.hunks.map((hunk: CheckpointDiffFile["hunks"][number], hi: number) => (
                    <div key={hi} className="mb-1">
                      <div className="text-gray-10">{hunk.header}</div>
                      {hunk.lines.map((line: CheckpointDiffFile["hunks"][number]["lines"][number], li: number) => (
                        <div
                          key={li}
                          className={
                            line.kind === "add"
                              ? "bg-green-3/30 text-green-11"
                              : line.kind === "del"
                                ? "bg-red-3/30 text-red-11"
                                : "text-gray-11"
                          }
                        >
                          {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                          {line.text}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
              {isExpanded && file.binary ? (
                <div className="bg-gray-2/50 px-2 py-1 text-[11px] text-gray-10">Binary file (no preview)</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
