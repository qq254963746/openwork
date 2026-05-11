/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  SquarePen,
} from "lucide-react";

import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import {
  getWorkspaceTaskLoadErrorDisplay,
  isElectronRuntime,
  isTauriRuntime,
  isWindowsPlatform,
} from "../../../../app/utils";
import { t } from "../../../../i18n";

import { sidebarSessionRunningKey, useSidebarSessionsRunning } from "./use-sidebar-session-running";

type Props = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  showInitialLoading?: boolean;
  selectedWorkspaceId: string;
  developerMode: boolean;
  selectedSessionId: string | null;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  /** Pass `workspaceId` + `sessionId` when invoking from a row so non-selected sessions can switch first. */
  onOpenRenameSession?: (workspaceId?: string, sessionId?: string) => void;
  onOpenDeleteSession?: (workspaceId?: string, sessionId?: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Session shell only: collapse the entire workspace sidebar (icon in top strip). */
  onCollapseWorkspaceSidebar?: () => void;
  /** Sidebar footer below the workspace list (e.g. connection status + settings). */
  sessionStatusFooter?: ReactNode;
  /**
   * Called when a workspace section becomes expanded (including auto-expand for
   * the selected workspace). Used to lazy-load session lists for workspaces
   * that were not the active one at boot.
   */
  onWorkspaceSectionOpened?: (workspaceId: string) => void;
  /** Persist workspace order (desktop + AiWork server when connected). */
  onReorderWorkspaces?: (workspaceIds: string[]) => void | Promise<void>;
};

const MAX_SESSIONS_PREVIEW = 6;

function reorderWorkspaceIds(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return ids;
  const next = [...ids];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

type SessionListItem = WorkspaceSessionGroup["sessions"][number];
type FlattenedSessionRow = { session: SessionListItem; depth: number };
type SessionTreeState = {
  childrenByParent: Map<string, SessionListItem[]>;
  ancestorIdsBySessionId: Map<string, string[]>;
  descendantCountBySessionId: Map<string, number>;
};

const normalizeSessionParentID = (session: SessionListItem) => {
  const parentID = session.parentID?.trim();
  return parentID || "";
};

const getRootSessions = (sessions: WorkspaceSessionGroup["sessions"]) => {
  const byID = new Set(sessions.map((session) => session.id));
  return sessions.filter((session) => {
    const parentID = normalizeSessionParentID(session);
    return !parentID || !byID.has(parentID);
  });
};

const buildSessionTreeState = (sessions: WorkspaceSessionGroup["sessions"]): SessionTreeState => {
  const childrenByParent = new Map<string, SessionListItem[]>();
  const ancestorIdsBySessionId = new Map<string, string[]>();
  const descendantCountBySessionId = new Map<string, number>();
  const sessionIds = new Set(sessions.map((session) => session.id));

  sessions.forEach((session) => {
    const parentID = normalizeSessionParentID(session);
    if (!parentID || !sessionIds.has(parentID)) return;
    const siblings = childrenByParent.get(parentID) ?? [];
    siblings.push(session);
    childrenByParent.set(parentID, siblings);
  });

  const walk = (session: SessionListItem, ancestors: string[]) => {
    ancestorIdsBySessionId.set(session.id, ancestors);
    const children = childrenByParent.get(session.id) ?? [];
    let descendantCount = 0;

    children.forEach((child) => {
      const childState = walk(child, [...ancestors, session.id]);
      descendantCount += 1 + childState.descendantCount;
    });

    descendantCountBySessionId.set(session.id, descendantCount);
    return { descendantCount };
  };

  getRootSessions(sessions).forEach((session) => {
    walk(session, []);
  });

  return {
    childrenByParent,
    ancestorIdsBySessionId,
    descendantCountBySessionId,
  };
};

const flattenSessionRows = (
  sessions: WorkspaceSessionGroup["sessions"],
  rootLimit: number,
  tree: SessionTreeState,
  expandedSessionIds: Set<string>,
  forcedExpandedSessionIds: Set<string>,
) => {
  const roots = getRootSessions(sessions).slice(0, rootLimit);
  const rows: FlattenedSessionRow[] = [];
  const visited = new Set<string>();

  const walk = (session: SessionListItem, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    rows.push({ session, depth });
    const children = tree.childrenByParent.get(session.id) ?? [];
    if (!children.length) return;
    const expanded = expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
    if (!expanded) return;
    children.forEach((child) => walk(child, depth + 1));
  };

  roots.forEach((root) => walk(root, 0));
  return rows;
};

const workspaceLabel = (workspace: WorkspaceInfo) =>
  workspace.displayName?.trim() ||
  workspace.name?.trim() ||
  workspace.path?.trim() ||
  t("workspace_list.workspace_fallback");

const workspaceKindLabel = (_workspace: WorkspaceInfo) => t("workspace.local_badge");

const AIWORK_MARK_SRC = `${import.meta.env.BASE_URL}aiwork-mark.svg`;

const SESSION_ROW_SELECTED_BOX_SHADOW =
  "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.02) 0px 2px 4px 0px, rgba(0, 0, 0, 0.02) 0px 4px 10px 0px";

function AddWorkspaceShortcutGlyph(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 29 14"
      fill="none"
      className={props.className}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M2.3 13.797q-1.03 0-1.563-.524-.522-.523-.523-1.554V2.664q0-1.031.523-1.555Q1.27.586 2.3.586h9.031q1.04 0 1.563.531.531.525.531 1.547v9.055q0 1.016-.531 1.547-.524.53-1.563.53zm.016-.742h9q.648 0 1.007-.352.36-.343.36-1.023V2.703q0-.68-.36-1.023-.36-.352-1.007-.352h-9q-.665 0-1.016.352-.344.344-.344 1.023v8.977q0 .68.344 1.023.351.352 1.016.352m2.922-6.766h-.766q-.586 0-1.016-.422a1.4 1.4 0 0 1-.422-1.015q0-.594.422-1.016t1.016-.422 1.015.422.422 1.016v.773h1.782v-.773q0-.594.414-1.016.421-.422 1.015-.422t1.016.422q.43.422.43 1.016 0 .586-.43 1.015-.422.422-1.016.422h-.765V8.07h.765q.594 0 1.016.422.43.422.43 1.008 0 .594-.43 1.016-.422.421-1.016.422-.594 0-1.015-.422A1.4 1.4 0 0 1 7.69 9.5v-.773H5.909V9.5q0 .594-.421 1.016-.423.421-1.016.422-.594 0-1.016-.422A1.38 1.38 0 0 1 3.034 9.5q0-.586.422-1.008a1.4 1.4 0 0 1 1.016-.422h.765zm.671 1.781h1.782V6.281H5.909zM4.472 5.633h.765v-.781a.74.74 0 0 0-.226-.54.7.7 0 0 0-.54-.234.75.75 0 0 0-.546.227.75.75 0 0 0-.227.547q0 .32.227.554a.75.75 0 0 0 .547.227m4.648 0a.75.75 0 0 0 .547-.227.76.76 0 0 0 .235-.554.73.73 0 0 0-.235-.547.75.75 0 0 0-.547-.227.72.72 0 0 0-.539.234.74.74 0 0 0-.226.54v.78zM4.472 8.719a.73.73 0 0 0-.547.234.75.75 0 0 0-.227.547q0 .32.227.547a.75.75 0 0 0 .547.226.72.72 0 0 0 .539-.226.76.76 0 0 0 .226-.547v-.781zm4.648 0h-.765V9.5q0 .312.226.547.226.226.54.226a.75.75 0 0 0 .546-.226.73.73 0 0 0 .235-.547.73.73 0 0 0-.235-.547.73.73 0 0 0-.547-.234m8.549 5.078q-1.032 0-1.563-.524-.523-.523-.523-1.554V2.664q0-1.031.523-1.555.531-.523 1.563-.523H26.7q1.039 0 1.563.531.53.525.53 1.547v9.055q0 1.016-.53 1.547-.524.53-1.563.53zm.015-.742h9q.65 0 1.008-.352.36-.343.36-1.023V2.703q0-.68-.36-1.023-.36-.352-1.008-.352h-9q-.663 0-1.015.352-.344.344-.344 1.023v8.977q0 .68.344 1.023.352.352 1.015.352m2.578-2.547a.35.35 0 0 1-.265-.11.42.42 0 0 1-.102-.296V4.195a.42.42 0 0 1 .102-.297.35.35 0 0 1 .265-.109q.18 0 .282.11a.42.42 0 0 1 .101.296v2.977h.032l3.195-3.227a.6.6 0 0 1 .148-.117.35.35 0 0 1 .172-.039q.141 0 .242.094a.3.3 0 0 1 .102.226q0 .078-.031.149a.4.4 0 0 1-.086.125l-2.274 2.305 2.47 3.156a1 1 0 0 1 .077.148.3.3 0 0 1 .04.156q0 .157-.11.258a.35.35 0 0 1-.258.102.36.36 0 0 1-.187-.047.6.6 0 0 1-.165-.156l-2.414-3.117-.953.976v1.938a.42.42 0 0 1-.101.296.36.36 0 0 1-.282.11"
      />
    </svg>
  );
}

/** Workspace row control: new session in this workspace (viewBox 24×24). */
function WorkspaceAddSessionGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
      aria-hidden
    >
      <path d="M11.9995 1.9314C12.4494 1.93151 12.8148 2.29678 12.8148 2.74666C12.8145 3.19632 12.4492 3.56087 11.9995 3.56098C10.1902 3.56099 8.52242 3.70673 7.17162 3.88109C5.43247 4.1056 4.10513 5.43294 3.88062 7.17209C3.70627 8.52283 3.56052 10.1908 3.56051 12C3.56054 13.8093 3.70625 15.4781 3.88062 16.8288C4.10549 18.5675 5.43278 19.8954 7.17162 20.1198C8.52238 20.2942 10.1903 20.439 11.9995 20.439C13.8089 20.439 15.4775 20.2942 16.8284 20.1198C18.567 19.8952 19.8946 18.5674 20.1194 16.8288C20.2937 15.4781 20.4385 13.8093 20.4385 12C20.4387 11.5503 20.8032 11.1859 21.2529 11.1857C21.7027 11.1858 22.068 11.5502 22.0681 12C22.0681 13.8936 21.9161 15.6331 21.7349 17.0366C21.4154 19.51 19.5095 21.416 17.0362 21.7354C15.6325 21.9166 13.8932 22.0686 11.9995 22.0686C10.1058 22.0686 8.36656 21.9166 6.96289 21.7354C4.48948 21.4161 2.58364 19.51 2.26414 17.0366C2.08297 15.6331 1.93189 13.8936 1.93186 12C1.93187 10.1063 2.08297 8.36699 2.26414 6.96336C2.58346 4.48977 4.4893 2.58393 6.96289 2.26461C8.36657 2.08342 10.1057 1.93141 11.9995 1.9314Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.1011 3.40373C17.3529 2.27275 19.2863 2.31078 20.4928 3.51699L20.607 3.6368C21.7011 4.84834 21.7005 6.69736 20.6061 7.90872L20.4938 8.0276L14.157 14.3634L14.0279 14.487C13.7632 14.728 13.4661 14.9311 13.1452 15.0898L12.9833 15.1646L10.1154 16.4198C8.56697 17.0974 6.99293 15.593 7.53198 14.0452L7.59095 13.8954L8.84519 11.0266C9.01288 10.6435 9.24184 10.2905 9.52286 9.98197L9.64735 9.85374L15.9832 3.51699L16.1011 3.40373ZM19.3406 4.66921C18.7316 4.06057 17.7445 4.06071 17.1354 4.66921L10.7996 11.006C10.6053 11.2003 10.4483 11.4291 10.3381 11.6808L9.08294 14.5487C9.04688 14.6313 9.05012 14.684 9.05767 14.7191C9.06736 14.7637 9.09391 14.8189 9.14284 14.8679C9.19192 14.9169 9.24701 14.9435 9.29167 14.9531C9.32682 14.9606 9.3794 14.963 9.46202 14.9269L12.3299 13.6726C12.5816 13.5625 12.8105 13.4055 13.0048 13.2112L19.3416 6.87537C19.9502 6.26617 19.9496 5.27819 19.3406 4.66921Z"
      />
    </svg>
  );
}

/** Session row glyph (speech bubble + typing dots), viewBox 24×24. */
function SessionSidebarGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
      aria-hidden
    >
      <path d="M7.25 9.75C7.94036 9.75 8.5 10.3096 8.5 11C8.5 11.6904 7.94036 12.25 7.25 12.25C6.55964 12.25 6 11.6904 6 11C6 10.3096 6.55964 9.75 7.25 9.75Z" />
      <path d="M12 9.75C12.6904 9.75 13.25 10.3096 13.25 11C13.25 11.6904 12.6904 12.25 12 12.25C11.3096 12.25 10.75 11.6904 10.75 11C10.75 10.3096 11.3096 9.75 12 9.75Z" />
      <path d="M16.75 9.75C17.4404 9.75 18 10.3096 18 11C18 11.6904 17.4404 12.25 16.75 12.25C16.0596 12.25 15.5 11.6904 15.5 11C15.5 10.3096 16.0596 9.75 16.75 9.75Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 1.73633C14.1692 1.73633 16.1557 1.89992 17.7285 2.08887C19.9229 2.35249 21.6506 3.98709 21.958 6.17578C22.1467 7.51917 22.2998 9.15932 22.2998 10.9365C22.2998 12.7137 22.1467 14.3539 21.958 15.6973C21.6505 17.8858 19.9228 19.5206 17.7285 19.7842C16.1557 19.9731 14.1692 20.1367 12 20.1367C11.9668 20.1367 11.9335 20.1358 11.9004 20.1357L6.76465 23.0117C6.04212 23.4163 5.16911 22.8178 5.28613 21.998L5.61914 19.6621C3.74132 19.1829 2.31832 17.6639 2.04199 15.6973C1.8533 14.3539 1.70021 12.7137 1.7002 10.9365C1.7002 9.15932 1.8533 7.51917 2.04199 6.17578C2.34942 3.98709 4.07709 2.35249 6.27148 2.08887C7.84432 1.89992 9.83077 1.73633 12 1.73633ZM12 3.33594C9.90868 3.33594 7.98719 3.4945 6.46191 3.67773C4.96094 3.85824 3.82865 4.95557 3.62598 6.39844C3.46792 7.52375 3.33698 8.86201 3.30664 10.3096L3.2998 10.9365C3.29982 12.6242 3.44534 14.1885 3.62598 15.4746C3.80878 16.7756 4.7432 17.7868 6.01465 18.1113L7.40527 18.4668L7.04102 21.0215L11.1182 18.7393L11.4844 18.5352L11.9043 18.5361C11.9321 18.5362 11.9586 18.5359 11.9727 18.5361C11.9902 18.5364 11.9962 18.5371 12 18.5371C14.0913 18.5371 16.0128 18.3785 17.5381 18.1953C19.0389 18.0148 20.1713 16.9175 20.374 15.4746C20.5321 14.3493 20.663 13.011 20.6934 11.5635L20.7002 10.9365C20.7002 9.24882 20.5547 7.68455 20.374 6.39844C20.1714 4.95557 19.0391 3.85824 17.5381 3.67773C16.2034 3.51739 14.5651 3.37646 12.7754 3.34375L12 3.33594Z"
      />
    </svg>
  );
}

export function WorkspaceSessionList(props: Props) {
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [previewCountByWorkspaceId, setPreviewCountByWorkspaceId] = useState<Record<string, number>>({});
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
  const [sessionMenuForSessionId, setSessionMenuForSessionId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dropTargetWorkspaceIndex, setDropTargetWorkspaceIndex] = useState<number | null>(null);
  /** After HTML5 drag ends, the browser fires a click — skip expand toggle for that row. */
  const suppressWorkspaceExpandClickIndexRef = useRef<number | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);

  const sessionRunningByKey = useSidebarSessionsRunning(props.workspaceSessionGroups);

  const revealLabel = isWindowsPlatform()
    ? t("workspace_list.reveal_explorer")
    : t("workspace_list.reveal_finder");

  const expandWorkspace = (workspaceId: string) => {
    const id = workspaceId.trim();
    if (!id) return;
    const alreadyExpanded = expandedWorkspaceIds.has(id);
    setExpandedWorkspaceIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
    // Sync so parent can mark the workspace as loading before paint — avoids a
    // one-frame flash of “no tasks” while sessions are being fetched.
    if (!alreadyExpanded) props.onWorkspaceSectionOpened?.(id);
  };

  const toggleWorkspaceExpanded = (workspaceId: string) => {
    const id = workspaceId.trim();
    if (!id) return;
    const wasExpanded = expandedWorkspaceIds.has(id);
    setExpandedWorkspaceIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (!wasExpanded) props.onWorkspaceSectionOpened?.(id);
  };

  useEffect(() => {
    const id = props.selectedWorkspaceId.trim();
    if (!id) return;
    // Keep the selected workspace visible without collapsing other workspaces.
    // Collapsing the previous workspace on every cross-workspace session click
    // makes the sidebar feel jumpy and hides the context the user just left.
    expandWorkspace(id);
  }, [props.selectedWorkspaceId]);

  const previewCount = (workspaceId: string) =>
    previewCountByWorkspaceId[workspaceId] ?? MAX_SESSIONS_PREVIEW;

  const showMoreSessions = (workspaceId: string, totalRoots: number) => {
    expandWorkspace(workspaceId);
    setPreviewCountByWorkspaceId((current) => {
      const next = { ...current };
      const existing = next[workspaceId] ?? MAX_SESSIONS_PREVIEW;
      next[workspaceId] = Math.min(existing + MAX_SESSIONS_PREVIEW, totalRoots);
      return next;
    });
  };

  const showMoreLabel = (workspaceId: string, totalRoots: number) => {
    const remaining = Math.max(0, totalRoots - previewCount(workspaceId));
    const nextCount = Math.min(MAX_SESSIONS_PREVIEW, remaining);
    return nextCount > 0
      ? t("workspace_list.show_more", undefined, { count: nextCount })
      : t("workspace_list.show_more_fallback");
  };

  const toggleSessionExpanded = (sessionId: string) => {
    const id = sessionId.trim();
    if (!id) return;
    setExpandedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!workspaceMenuId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && workspaceMenuRef.current?.contains(target)) return;
      setWorkspaceMenuId(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
    };
  }, [workspaceMenuId]);

  useEffect(() => {
    setSessionMenuForSessionId(null);
  }, [props.selectedSessionId]);

  useEffect(() => {
    const workspaceId = props.selectedWorkspaceId.trim();
    if (!workspaceId) return;

    const group = props.workspaceSessionGroups.find(
      (entry) => entry.workspace.id === workspaceId,
    );
    if (!group?.sessions.length) return;

    const selectedId = props.selectedSessionId?.trim() ?? "";
    const selectedIndex = selectedId
      ? group.sessions.findIndex((session) => session.id === selectedId)
      : -1;
    const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 2) : 0;
    const end = selectedIndex >= 0
      ? Math.min(group.sessions.length, selectedIndex + 3)
      : Math.min(group.sessions.length, 4);

    group.sessions.slice(start, end).forEach((session) => {
      props.onPrefetchSession?.(workspaceId, session.id);
    });
  }, [
    props.onPrefetchSession,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.workspaceSessionGroups,
  ]);

  useEffect(() => {
    if (!sessionMenuForSessionId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && sessionMenuRef.current?.contains(target)) return;
      setSessionMenuForSessionId(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
    };
  }, [sessionMenuForSessionId]);

  const renderSessionRow = (
    workspaceId: string,
    row: FlattenedSessionRow,
    tree: SessionTreeState,
    forcedExpandedSessionIds: Set<string>,
  ) => {
    const session = row.session;
    const isSelected = props.selectedSessionId === session.id;
    const displayTitle = getDisplaySessionTitle(session.title);
    const hasChildren = (tree.descendantCountBySessionId.get(session.id) ?? 0) > 0;
    const isExpanded = expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
    const isRunning = Boolean(sessionRunningByKey[sidebarSessionRunningKey(workspaceId, session.id)]);
    const sessionActionsAvailable = Boolean(
      props.showSessionActions &&
      (props.onOpenRenameSession || props.onOpenDeleteSession),
    );
    const menuOpenForThisSession = sessionMenuForSessionId === session.id;

    const openSession = () => {
      setSessionMenuForSessionId(null);
      props.onOpenSession(workspaceId, session.id);
    };

    const prefetchSession = () => {
      if (workspaceId !== props.selectedWorkspaceId) return;
      props.onPrefetchSession?.(workspaceId, session.id);
    };

    return (
      <div key={session.id} className="relative">
        <div
          className="w-full rounded-[10px]"
          style={isSelected ? { boxShadow: SESSION_ROW_SELECTED_BOX_SHADOW } : undefined}
        >
        <div
          role="button"
          tabIndex={0}
          aria-busy={isRunning}
          className={`group relative flex h-[36px] w-full items-center overflow-hidden rounded-[10px] px-3.5 text-left text-[13px] font-normal transition-colors ${
            isSelected ? "bg-white dark:bg-gray-3" : "hover:bg-[#0000000a]"
          }`}
          onPointerEnter={prefetchSession}
          onFocus={prefetchSession}
          onPointerLeave={(event) => {
            const row = event.currentTarget;
            if (document.activeElement === row) row.blur();
          }}
          onClick={openSession}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            openSession();
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-9 transition-colors hover:bg-gray-3/80 hover:text-gray-11"
                aria-label={isExpanded ? t("workspace_list.hide_child_sessions") : t("workspace_list.show_child_sessions")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleSessionExpanded(session.id);
                }}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : row.depth > 0 ? (
              <span className="w-5 shrink-0" aria-hidden />
            ) : null}

            <div
              className={`flex min-w-0 flex-1 items-center gap-1 transition-[padding] duration-150 ease-out ${
                sessionActionsAvailable
                  ? menuOpenForThisSession
                    ? "pr-[12px]"
                    : "pr-0 group-hover:pr-[12px] group-focus-within:pr-[12px]"
                  : ""
              }`}
            >
              <span
                className={`relative flex size-5 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-black/[0.08] dark:bg-gray-2 dark:ring-white/12 ${
                  isSelected ? "" : "group-hover:ring-black/[0.12] dark:group-hover:ring-white/18"
                }`}
                aria-hidden
              >
                <SessionSidebarGlyph
                  className={`size-3 shrink-0 ${
                    isRunning
                      ? "ow-session-sidebar-running-icon text-blue-10 dark:text-blue-11"
                      : "text-[#00000059] dark:text-gray-11"
                  }`}
                />
              </span>

              <span
                className={`block min-w-0 flex-1 truncate text-[#000000] dark:text-gray-12 ${
                  isSelected ? "font-semibold" : "font-normal"
                }`}
                title={displayTitle}
              >
                {displayTitle}
              </span>
            </div>
          </div>

          {sessionActionsAvailable ? (
            <button
              type="button"
              className={`absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-gray-9 transition-[opacity,colors] duration-150 hover:bg-[rgba(0,0,0,0.04)] hover:text-gray-11 ${
                menuOpenForThisSession
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
              }`}
              aria-label={t("workspace_list.session_actions")}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSessionMenuForSessionId((current) =>
                  current === session.id ? null : session.id,
                );
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          ) : null}
        </div>
        </div>

        {sessionActionsAvailable && menuOpenForThisSession ? (
          <div
            ref={sessionMenuRef}
            className="absolute right-0 top-[calc(100%+6px)] z-20 w-48 rounded-[18px] border border-dls-border bg-dls-surface p-1.5 shadow-[var(--dls-shell-shadow)]"
            onClick={(event) => event.stopPropagation()}
          >
            {props.onOpenRenameSession ? (
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                onClick={() => {
                  setSessionMenuForSessionId(null);
                  props.onOpenRenameSession?.(workspaceId, session.id);
                }}
              >
                {t("workspace_list.rename_session")}
              </button>
            ) : null}

            {props.onOpenDeleteSession ? (
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-red-11 transition-colors hover:bg-red-1/40"
                onClick={() => {
                  setSessionMenuForSessionId(null);
                  props.onOpenDeleteSession?.(workspaceId, session.id);
                }}
              >
                {t("workspace_list.delete_session")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const electronMacDrag =
    isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col px-1">
      <div className="flex h-[50px] shrink-0 items-stretch gap-1">
        <div
          aria-hidden
          className="min-w-0 flex-1 select-none"
          {...(isTauriRuntime() ? ({ "data-tauri-drag-region": true } as const) : {})}
          style={
            electronMacDrag ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined
          }
        />
        {props.onCollapseWorkspaceSidebar ? (
          <div
            className="flex shrink-0 items-center pr-1.5"
            {...(isTauriRuntime() ? ({ "data-tauri-drag-region": "false" } as const) : {})}
            style={
              isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
                : undefined
            }
          >
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-gray-3/70 hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
              onClick={props.onCollapseWorkspaceSidebar}
              title={t("session.sidebar_collapse")}
              aria-label={t("session.sidebar_collapse")}
            >
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 pb-4 pt-3">
        <div className="flex min-w-0 items-center gap-2 px-3.5">
          <img
            src={AIWORK_MARK_SRC}
            alt=""
            className="h-6 w-auto max-w-[26px] shrink-0 object-contain sm:h-7 sm:max-w-[28px]"
            width={28}
            height={24}
            decoding="async"
          />
          <span className="ow-sidebar-brand-mark shrink-0 text-[12px] leading-none sm:text-[13px]">
            {t("workspace_list.sidebar_brand")}
          </span>
        </div>
        {/* Align with session list: px-1 → px-0.5 like expanded workspace body. */}
        <div className="mt-[17px] min-w-0 px-1">
          <div className="px-0.5">
            <button
              type="button"
              className="flex h-[36px] w-full items-center justify-between gap-2 rounded-[12px] border border-blue-6/70 bg-blue-2 px-3 text-left text-[12px] font-medium leading-none text-blue-11 transition-colors hover:border-blue-7 hover:bg-blue-3 dark:border-blue-7/55 dark:bg-blue-a3/25 dark:text-blue-11 dark:hover:bg-blue-a4/35"
              onClick={props.onOpenCreateWorkspace}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="inline-flex size-[15px] shrink-0 items-center justify-center" aria-hidden>
                  <SquarePen className="size-[15px] text-blue-10 dark:text-blue-11" strokeWidth={2} />
                </span>
                <span className="truncate leading-none">{t("workspace_list.add_workspace")}</span>
              </span>
              <AddWorkspaceShortcutGlyph className="h-3.5 w-[29px] shrink-0 text-blue-11/55 dark:text-blue-11/45" />
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="space-y-1 pb-2">
          {props.workspaceSessionGroups.map((group, workspaceIndex) => {
            const canReorder =
              Boolean(props.onReorderWorkspaces) && props.workspaceSessionGroups.length > 1;
            const tree = buildSessionTreeState(group.sessions);
            const forcedExpandedSessionIds = new Set(
              props.selectedSessionId
                ? tree.ancestorIdsBySessionId.get(props.selectedSessionId) ?? []
                : [],
            );
            const workspace = group.workspace;
            const isConnecting = props.connectingWorkspaceId === workspace.id;
            const connectionState = props.workspaceConnectionStateById[workspace.id] ?? {
              status: "idle" as const,
              message: null,
            };
            const isConnectionActionBusy =
              isConnecting || connectionState.status === "connecting";
            const isMenuOpen = workspaceMenuId === workspace.id;
            const taskLoadError = getWorkspaceTaskLoadErrorDisplay(workspace, group.error);
            const statusLabel = (() => {
              const connectionMessage = connectionState.message?.trim() ?? "";
              if (connectionState.status === "error") return connectionMessage || taskLoadError.message;
              if (connectionState.status === "connected") return connectionMessage || t("status.connected");
              if (group.status === "error") return taskLoadError.label;
              if (isConnectionActionBusy) return t("workspace_list.connecting");
              if (!props.developerMode) return "";
              if (props.selectedWorkspaceId === workspace.id) return t("workspace.selected");
              return workspaceKindLabel(workspace);
            })();
            const statusTone = connectionState.status === "connected"
              ? "text-green-11"
              : connectionState.status === "error" || group.status === "error"
              ? taskLoadError.tone === "offline"
                ? "text-amber-11"
                : "text-red-11"
              : "text-gray-9";
            const rootSessions = getRootSessions(group.sessions);
            const sessionRows = flattenSessionRows(
              group.sessions,
              previewCount(workspace.id),
              tree,
              expandedSessionIds,
              forcedExpandedSessionIds,
            );

            return (
              <div
                key={workspace.id}
                className={`space-y-1 ${
                  dropTargetWorkspaceIndex === workspaceIndex ? "ring-1 ring-inset ring-gray-8/45" : ""
                }`}
                onDragOver={(event) => {
                  if (!props.onReorderWorkspaces || props.workspaceSessionGroups.length < 2) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetWorkspaceIndex(workspaceIndex);
                }}
                onDragLeave={(event) => {
                  if (!props.onReorderWorkspaces) return;
                  const related = event.relatedTarget as Node | null;
                  if (related && event.currentTarget.contains(related)) return;
                  setDropTargetWorkspaceIndex(null);
                }}
                onDrop={(event) => {
                  if (!props.onReorderWorkspaces) return;
                  event.preventDefault();
                  const raw = event.dataTransfer.getData("application/x-aiwork-workspace-index");
                  const fromIndex = Number.parseInt(raw, 10);
                  setDropTargetWorkspaceIndex(null);
                  if (!Number.isFinite(fromIndex)) return;
                  const ids = props.workspaceSessionGroups.map((g) => g.workspace.id);
                  if (
                    fromIndex === workspaceIndex ||
                    fromIndex < 0 ||
                    fromIndex >= ids.length ||
                    workspaceIndex < 0 ||
                    workspaceIndex >= ids.length
                  ) {
                    return;
                  }
                  const next = reorderWorkspaceIds(ids, fromIndex, workspaceIndex);
                  void Promise.resolve(props.onReorderWorkspaces(next));
                }}
              >
                <div className="relative group">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedWorkspaceIds.has(workspace.id)}
                    className={`flex w-full min-w-0 items-center justify-between px-3.5 py-2 text-left text-[13px] transition-colors ${
                      props.selectedWorkspaceId === workspace.id
                        ? "bg-gray-2/70 dark:bg-gray-3"
                        : ""
                    } ${isConnecting ? "opacity-75" : ""}`}
                    onClick={(event) => {
                      const target = event.target as HTMLElement | null;
                      if (target?.closest("button")) return;
                      if (suppressWorkspaceExpandClickIndexRef.current === workspaceIndex) {
                        suppressWorkspaceExpandClickIndexRef.current = null;
                        return;
                      }
                      toggleWorkspaceExpanded(workspace.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      event.preventDefault();
                      toggleWorkspaceExpanded(workspace.id);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-0.5 py-0 text-left">
                      <button
                        type="button"
                        className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-9 transition-colors hover:bg-gray-3/80 hover:text-gray-11 group-hover:text-[#000000] dark:group-hover:text-gray-12"
                        aria-expanded={expandedWorkspaceIds.has(workspace.id)}
                        aria-label={
                          expandedWorkspaceIds.has(workspace.id)
                            ? t("workspace_list.collapse_workspace")
                            : t("workspace_list.expand_workspace")
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleWorkspaceExpanded(workspace.id);
                        }}
                      >
                        {expandedWorkspaceIds.has(workspace.id) ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                      </button>
                      <div
                        draggable={canReorder}
                        className={`min-w-0 flex-1 ${
                          canReorder ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                        title={canReorder ? t("workspace_list.drag_reorder") : undefined}
                        aria-label={canReorder ? t("workspace_list.drag_reorder") : undefined}
                        onDragStart={(event) => {
                          if (!canReorder) return;
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-aiwork-workspace-index",
                            String(workspaceIndex),
                          );
                        }}
                        onDragEnd={() => {
                          suppressWorkspaceExpandClickIndexRef.current = workspaceIndex;
                          setDropTargetWorkspaceIndex(null);
                        }}
                      >
                        <div className="min-w-0 truncate text-[12px] font-normal text-[#00000059] transition-colors group-hover:text-[#000000] dark:text-gray-11 dark:group-hover:text-gray-12">
                          {workspaceLabel(workspace)}
                        </div>
                        {statusLabel ? (
                          <div className={`mt-px truncate text-[11px] ${statusTone}`} title={statusLabel}>
                            {statusLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="ml-4 flex shrink-0 items-center gap-1.5">
                      {group.status === "loading" || isConnecting ? (
                        <Loader2 size={14} className="animate-spin text-gray-9" />
                      ) : null}

                      <div
                        className={`flex items-center gap-0.5 transition-opacity duration-150 ${
                          props.selectedWorkspaceId === workspace.id
                            ? "opacity-100"
                            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          className="rounded-md p-1 text-gray-9 hover:bg-[rgba(0,0,0,0.04)] hover:text-gray-11"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onCreateTaskInWorkspace(workspace.id);
                          }}
                          disabled={props.newTaskDisabled}
                          aria-label={t("session.new_task")}
                        >
                          <WorkspaceAddSessionGlyph className="size-[14px] shrink-0" />
                        </button>

                        <button
                          type="button"
                          className="rounded-md p-1 text-gray-9 hover:bg-[rgba(0,0,0,0.04)] hover:text-gray-11"
                          onClick={(event) => {
                            event.stopPropagation();
                            setWorkspaceMenuId((current) => (current === workspace.id ? null : workspace.id));
                          }}
                          aria-label={t("workspace_list.workspace_options")}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {isMenuOpen ? (
                    <div
                      ref={workspaceMenuRef}
                      className="absolute right-0 top-[calc(100%+6px)] z-20 w-48 rounded-[18px] border border-dls-border bg-dls-surface p-1.5 shadow-[var(--dls-shell-shadow)]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                        onClick={() => {
                          props.onOpenRenameWorkspace(workspace.id);
                          setWorkspaceMenuId(null);
                        }}
                      >
                        {t("workspace_list.edit_name")}
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                        onClick={() => {
                          props.onRevealWorkspace(workspace.id);
                          setWorkspaceMenuId(null);
                        }}
                      >
                        {revealLabel}
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-red-11 transition-colors hover:bg-red-1/40"
                        onClick={() => {
                          props.onForgetWorkspace(workspace.id);
                          setWorkspaceMenuId(null);
                        }}
                      >
                        {t("workspace_list.remove_workspace")}
                      </button>
                    </div>
                  ) : null}
                </div>

                {expandedWorkspaceIds.has(workspace.id) ? (
                  <div className="px-1 pb-1">
                    <div className="flex flex-col gap-1 px-0.5">
                      {props.showInitialLoading ? (
                        <div className="space-y-2">
                          {[0, 1, 2].map((idx) => (
                            <div
                              key={`${workspace.id}:skeleton:${idx}`}
                              className="w-full rounded-[15px] border border-dls-border/70 bg-dls-hover/30 px-3 py-2.5"
                            >
                              <div
                                className="h-2.5 rounded-full bg-dls-hover/80 animate-pulse"
                                style={{ width: idx === 0 ? "62%" : idx === 1 ? "78%" : "54%" }}
                              />
                            </div>
                          ))}
                        </div>
                      ) : group.status === "loading" && group.sessions.length === 0 ? (
                        <div className="flex w-full items-center gap-2 rounded-[15px] px-3 py-2.5 text-left text-[11px] text-gray-10">
                          <Loader2 size={14} className="shrink-0 animate-spin text-gray-9" aria-hidden />
                          <span>{t("workspace.loading_tasks")}</span>
                        </div>
                      ) : group.sessions.length > 0 ? (
                        <>
                          {sessionRows.map((row) => renderSessionRow(workspace.id, row, tree, forcedExpandedSessionIds))}

                          {group.sessions.length === 0 && group.status === "ready" ? (
                            <button
                              type="button"
                              className="group/empty w-full rounded-[15px] border border-transparent px-3 py-2.5 text-left text-[11px] text-gray-10 transition-colors hover:bg-gray-2/60 hover:text-gray-11"
                              onClick={() => props.onCreateTaskInWorkspace(workspace.id)}
                              disabled={props.newTaskDisabled}
                            >
                              <span className="group-hover/empty:hidden">{t("workspace.no_tasks")}</span>
                              <span className="hidden group-hover/empty:inline font-medium">
                                {t("workspace.new_task_inline")}
                              </span>
                            </button>
                          ) : null}

                          {rootSessions.length > previewCount(workspace.id) ? (
                            <button
                              type="button"
                              className="w-full rounded-[15px] border border-transparent px-3 py-2.5 text-left text-[11px] text-gray-10 transition-colors hover:bg-gray-2/60 hover:text-gray-11"
                              onClick={() => showMoreSessions(workspace.id, rootSessions.length)}
                            >
                              {showMoreLabel(workspace.id, rootSessions.length)}
                            </button>
                          ) : null}
                        </>
                      ) : group.status === "error" ? (
                        <div
                          className={`w-full rounded-[15px] border px-3 py-2.5 text-left text-[11px] ${
                            taskLoadError.tone === "offline"
                              ? "border-amber-7/35 bg-amber-2/50 text-amber-11"
                              : "border-red-7/35 bg-red-1/40 text-red-11"
                          }`}
                          title={taskLoadError.title}
                        >
                          {taskLoadError.message}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="group/empty w-full rounded-[15px] border border-transparent px-3 py-2.5 text-left text-[11px] text-gray-10 transition-colors hover:bg-gray-2/60 hover:text-gray-11"
                          onClick={() => props.onCreateTaskInWorkspace(workspace.id)}
                          disabled={props.newTaskDisabled}
                        >
                          <span className="group-hover/empty:hidden">{t("workspace.no_tasks")}</span>
                          <span className="hidden group-hover/empty:inline font-medium">
                            {t("workspace.new_task_inline")}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {props.sessionStatusFooter ? (
        <div className="relative mt-auto shrink-0 bg-dls-sidebar">{props.sessionStatusFooter}</div>
      ) : null}
    </div>
  );
}
