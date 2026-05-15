/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react";
import type { AiWorkServerClient, AiWorkWorkspaceDirEntry } from "../../../../../app/lib/aiwork-server";
import { WorkspacePanelFileGlyph } from "../workspace-panel-file-glyph";
import {
  joinRelativePath,
  gitStatusColor,
  gitStatusBadge,
  directoryGitStatus,
} from "./workspace-utils";

export function WorkspaceTreeNode(props: {
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
  /** Flat map of workspace-relative POSIX path → git status code. */
  gitStatusMap?: Record<string, string>;
}) {
  const isDirectory = props.entry.kind === "directory";
  const isExpanded = props.expandedPaths.has(props.relativePath);
  const isSelected = !isDirectory && props.selectedPath === props.relativePath;

  const rawStatus = props.gitStatusMap
    ? isDirectory
      ? directoryGitStatus(props.gitStatusMap, props.relativePath)
      : props.gitStatusMap[props.relativePath]
    : undefined;
  const gitColor = gitStatusColor(rawStatus);
  const gitBadge = gitStatusBadge(rawStatus);

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
              className={`shrink-0 text-[#000000] dark:text-gray-12 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
          ) : (
            <WorkspacePanelFileGlyph filename={props.entry.name} className="shrink-0 text-[#000000] dark:text-gray-12" />
          )}
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={14} className={`shrink-0 ${gitColor || "text-[#000000] dark:text-gray-12"}`} aria-hidden />
            ) : (
              <Folder size={14} className={`shrink-0 ${gitColor || "text-[#000000] dark:text-gray-12"}`} aria-hidden />
            )
          ) : null}
          <span className={`min-w-0 flex-1 truncate font-mono ${gitColor}`}>{props.entry.name}</span>
          {gitBadge && !isDirectory ? (
            <span className={`ml-1 shrink-0 font-mono text-[10px] font-semibold ${gitColor}`}>{gitBadge}</span>
          ) : null}
          {isDirectory && isExpanded && childrenQuery.isFetching ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-dls-secondary" />
          ) : null}
        </button>
      </li>
      {isDirectory && isExpanded && childrenQuery.data ? (
        childrenQuery.data.entries.map((child: AiWorkWorkspaceDirEntry) => {
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
              gitStatusMap={props.gitStatusMap}
            />
          );
        })
      ) : null}
    </>
  );
}
