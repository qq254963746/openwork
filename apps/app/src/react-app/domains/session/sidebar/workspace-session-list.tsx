/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
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
  isSandboxWorkspace,
  isTauriRuntime,
  isWindowsPlatform,
} from "../../../../app/utils";
import { t } from "../../../../i18n";

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
  onOpenRenameSession?: () => void;
  onOpenDeleteSession?: () => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Session shell only: collapse the entire workspace sidebar (icon in top strip). */
  onCollapseWorkspaceSidebar?: () => void;
  /** Rendered below “Add workspace” (e.g. connection status + settings). */
  sessionStatusFooter?: ReactNode;
  /**
   * Called when a workspace section becomes expanded (including auto-expand for
   * the selected workspace). Used to lazy-load session lists for workspaces
   * that were not the active one at boot.
   */
  onWorkspaceSectionOpened?: (workspaceId: string) => void;
  /** Persist workspace order (desktop + OpenWork server when connected). */
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
  activeIds: Set<string>;
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

const buildSessionTreeState = (
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
): SessionTreeState => {
  const childrenByParent = new Map<string, SessionListItem[]>();
  const ancestorIdsBySessionId = new Map<string, string[]>();
  const descendantCountBySessionId = new Map<string, number>();
  const activeIds = new Set<string>();
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
    let subtreeActive = (sessionStatusById?.[session.id] ?? "idle") !== "idle";

    children.forEach((child) => {
      const childState = walk(child, [...ancestors, session.id]);
      descendantCount += 1 + childState.descendantCount;
      subtreeActive = subtreeActive || childState.subtreeActive;
    });

    descendantCountBySessionId.set(session.id, descendantCount);
    if (subtreeActive) activeIds.add(session.id);
    return { descendantCount, subtreeActive };
  };

  getRootSessions(sessions).forEach((session) => {
    walk(session, []);
  });

  return {
    childrenByParent,
    ancestorIdsBySessionId,
    descendantCountBySessionId,
    activeIds,
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
  workspace.openworkWorkspaceName?.trim() ||
  workspace.name?.trim() ||
  workspace.path?.trim() ||
  t("workspace_list.workspace_fallback");

const workspaceKindLabel = (workspace: WorkspaceInfo) =>
  workspace.workspaceType === "remote"
    ? isSandboxWorkspace(workspace)
      ? t("workspace.sandbox_badge")
      : t("workspace.remote_badge")
    : t("workspace.local_badge");

const OPENWORK_MARK_SRC = `${import.meta.env.BASE_URL}openwork-mark.svg`;

/** Workspace row glyph (grid / tiling mark). */
function WorkspaceSidebarGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M380.043636 118.923636H173.149091a82.618182 82.618182 0 0 0-82.618182 82.850909v206.894546a82.618182 82.618182 0 0 0 82.618182 82.618182h206.894545a82.618182 82.618182 0 0 0 82.850909-82.618182V201.774545a82.850909 82.850909 0 0 0-82.850909-82.850909zm13.032728 289.745455a13.032727 13.032727 0 0 1-13.032728 12.8H173.149091a12.8 12.8 0 0 1-12.8-12.8V201.774545a13.032727 13.032727 0 0 1 12.8-13.032727h206.894545a13.032727 13.032727 0 0 1 13.032728 13.032727zM910.894545 250.414545l-137.30909-137.30909a77.730909 77.730909 0 0 0-109.614546 0l-137.076364 137.30909a77.498182 77.498182 0 0 0 0 109.614546l137.076364 137.076364a77.265455 77.265455 0 0 0 109.614546 0l137.30909-137.076364a77.498182 77.498182 0 0 0 0-109.614546zM861.090909 310.690909l-137.309091 137.076364a6.749091 6.749091 0 0 1-5.352727 2.327272 7.68 7.68 0 0 1-5.585455-2.327272l-137.076363-137.076364a7.68 7.68 0 0 1 0-10.938182L713.309091 162.909091a8.378182 8.378182 0 0 1 5.585454-2.094546 7.447273 7.447273 0 0 1 5.352728 2.094546l137.309091 137.309091a7.68 7.68 0 0 1-.465455 10.472727zM822.225455 561.105455h-206.894546a82.618182 82.618182 0 0 0-82.618182 82.850909v206.894545a82.618182 82.618182 0 0 0 82.618182 82.618182h206.894546a82.618182 82.618182 0 0 0 82.850909-82.618182v-206.894545a82.850909 82.850909 0 0 0-82.850909-82.850909zm13.032727 289.745454a13.032727 13.032727 0 0 1-13.032727 12.8h-206.894546a12.8 12.8 0 0 1-12.8-12.8v-206.894545a13.032727 13.032727 0 0 1 12.8-13.032728h206.894546a13.032727 13.032727 0 0 1 13.032727 13.032728zM380.043636 561.105455H173.149091a82.618182 82.618182 0 0 0-82.618182 82.850909v206.894545a82.618182 82.618182 0 0 0 82.618182 82.618182h206.894545a82.618182 82.618182 0 0 0 82.850909-82.618182v-206.894545a82.850909 82.850909 0 0 0-82.850909-82.850909zm13.032728 289.745454a13.032727 13.032727 0 0 1-13.032728 12.8H173.149091a12.8 12.8 0 0 1-12.8-12.8v-206.894545a13.032727 13.032727 0 0 1 12.8-13.032728h206.894545a13.032727 13.032727 0 0 1 13.032728 13.032728z"
      />
    </svg>
  );
}

/** Session row glyph (speech bubble outline + typing dots). */
function SessionSidebarGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M509.83822222 942.64888889c-132.89244445 0-258.16177778-44.032-352.71111111-123.904C110.36444445 779.37777778 73.61422222 733.184 47.78666667 681.64266667c-27.07911111-54.04444445-40.73244445-111.38844445-40.73244445-170.66666667S20.70755555 394.24 47.78666667 340.19555555c25.82755555-51.54133333 62.57777778-97.73511111 109.34044444-137.10222222 94.54933333-79.872 219.81866667-123.904 352.71111111-123.904s258.16177778 44.032 352.71111111 123.904c46.76266667 39.48088889 83.51288889 85.67466667 109.34044445 137.10222222C998.96888889 394.24 1012.62222222 451.584 1012.62222222 510.86222222c0 80.09955555-25.37244445 157.58222222-73.61422222 225.16622223 8.30577778 23.43822222 26.73777778 62.00888889 48.128 99.89688888 8.41955555 15.01866667 7.96444445 33.33688889-1.25155555 47.78666667s-25.6 22.75555555-42.66666667 21.504c-17.74933333-1.25155555-106.60977778-7.96444445-186.02666667-18.31822222-75.09333333 36.52266667-160.31288889 55.75111111-247.35288889 55.75111111zM743.424 885.19111111h0.22755555-0.22755555zM509.83822222 170.21155555c-227.10044445 0-411.87555555 152.80355555-411.87555555 340.76444445 0 187.84711111 184.77511111 340.76444445 411.87555555 340.76444445 77.48266667 0 152.91733333-17.97688889 218.22577778-51.88266667 8.64711111-4.43733333 18.31822222-6.144 27.87555555-4.77866667 37.54666667 5.12 79.18933333 9.55733333 114.46044445 12.85688889-12.17422222-26.624-22.86933333-54.272-25.82755555-74.63822222-1.82044445-12.62933333 1.70666667-25.6 9.6711111-35.61244445 44.14577778-55.52355555 67.47022222-120.03555555 67.47022223-186.70933333 0-187.96088889-184.77511111-340.76444445-411.87555556-340.76444445z m439.97866667 644.32355556c0.11377778 0 0.11377778 0 0 0 0.11377778 0 0.11377778 0 0 0z"
      />
      <path
        fill="currentColor"
        d="M274.77333333 516.55111111m-61.78133333 0a61.78133333 61.78133333 0 1 0 123.56266667 0 61.78133333 61.78133333 0 1 0-123.56266667 0Z"
      />
      <path
        fill="currentColor"
        d="M510.06577778 516.55111111m-61.78133333 0a61.78133333 61.78133333 0 1 0 123.56266666 0 61.78133333 61.78133333 0 1 0-123.56266666 0Z"
      />
      <path
        fill="currentColor"
        d="M745.472 516.55111111m-61.78133333 0a61.78133333 61.78133333 0 1 0 123.56266666 0 61.78133333 61.78133333 0 1 0-123.56266666 0Z"
      />
    </svg>
  );
}

function RemoteConnectionIssueCard(props: {
  message: string;
  tone: "error" | "offline";
  canRecover: boolean;
  busy: boolean;
  onRecover: () => void;
  onTest: () => void;
  onEdit: () => void;
}) {
  const isOffline = props.tone === "offline";
  const shellClass = isOffline
    ? "border-amber-7/35 bg-amber-2/45"
    : "border-red-7/35 bg-red-1/40";
  const iconClass = isOffline
    ? "bg-amber-3/60 text-amber-11"
    : "bg-red-3/60 text-red-11";
  const detailClass = isOffline
    ? "border-amber-7/25 bg-amber-1/40 text-amber-11"
    : "border-red-7/25 bg-red-1/40 text-red-11";

  return (
    <div className={`w-full rounded-[15px] border px-3 py-3 text-left ${shellClass}`}>
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          <AlertCircle size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-dls-text">
            {t("workspace_list.remote_worker_unavailable")}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-gray-10">
            {t("workspace_list.remote_worker_unavailable_hint")}
          </div>
          <div
            className={`mt-2 rounded-lg border px-2 py-1.5 text-[11px] leading-4 ${detailClass}`}
            title={props.message}
          >
            {props.message}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.canRecover ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-[11px] font-medium text-gray-11 transition-colors hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={props.onRecover}
                disabled={props.busy}
              >
                <RotateCcw size={12} />
                {t("workspace_list.recover")}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-[11px] font-medium text-gray-11 transition-colors hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={props.onTest}
              disabled={props.busy}
            >
              <RefreshCw size={12} />
              {t("workspace_list.test_connection")}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface px-2 py-1 text-[11px] font-medium text-gray-11 transition-colors hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={props.onEdit}
              disabled={props.busy}
            >
              <Settings2 size={12} />
              {t("common.edit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSessionList(props: Props) {
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [previewCountByWorkspaceId, setPreviewCountByWorkspaceId] = useState<Record<string, number>>({});
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dropTargetWorkspaceIndex, setDropTargetWorkspaceIndex] = useState<number | null>(null);
  /** After HTML5 drag ends, the browser fires a click — skip expand toggle for that row. */
  const suppressWorkspaceExpandClickIndexRef = useRef<number | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);

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
    setSessionMenuOpen(false);
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
    if (!sessionMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && sessionMenuRef.current?.contains(target)) return;
      setSessionMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
    };
  }, [sessionMenuOpen]);

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
    const isSessionActive = tree.activeIds.has(session.id);
    const canManageSession = Boolean(
      props.showSessionActions &&
      isSelected &&
      (props.onOpenRenameSession || props.onOpenDeleteSession),
    );

    const openSession = () => {
      setSessionMenuOpen(false);
      props.onOpenSession(workspaceId, session.id);
    };

    const prefetchSession = () => {
      if (workspaceId !== props.selectedWorkspaceId) return;
      props.onPrefetchSession?.(workspaceId, session.id);
    };

    return (
      <div key={session.id} className="relative">
        <div
          role="button"
          tabIndex={0}
          className={`group flex min-h-8 w-full items-center justify-between rounded-xl px-3 py-1 text-left text-[13px] font-normal transition-colors ${
            isSelected
              ? "bg-gray-3 text-gray-12"
              : "text-gray-10 hover:bg-gray-1/70 hover:text-gray-11"
          }`}
          style={{ marginLeft: `${Math.min(row.depth, 4) * 16}px` }}
          onPointerEnter={prefetchSession}
          onFocus={prefetchSession}
          onClick={openSession}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            openSession();
          }}
        >
          <div className="mr-2.5 flex min-w-0 flex-1 items-center gap-2">
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
              <span className="h-[1px] w-3 shrink-0 rounded-full bg-dls-border" />
            ) : null}

            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              <SessionSidebarGlyph
                className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-gray-10" : "text-gray-9 group-hover:text-gray-10"}`}
              />

              <span className="flex h-1.5 w-1.5 shrink-0 items-center justify-center" aria-hidden>
                {isSessionActive ? <span className="h-1.5 w-1.5 rounded-full bg-amber-9" /> : null}
              </span>
              <span className="block min-w-0 flex-1 truncate text-current" title={displayTitle}>
                {displayTitle}
              </span>
            </div>
          </div>

          {/* Fixed slot when session menus exist: avoids horizontal jump when selection moves. */}
          {props.showSessionActions ? (
            <div className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center">
              {canManageSession ? (
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-gray-9 transition-colors hover:bg-gray-3/80 hover:text-gray-11"
                  aria-label={t("workspace_list.session_actions")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSessionMenuOpen((current) => !current);
                  }}
                >
                  <MoreHorizontal size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {canManageSession && sessionMenuOpen ? (
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
                  setSessionMenuOpen(false);
                  props.onOpenRenameSession?.();
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
                  setSessionMenuOpen(false);
                  props.onOpenDeleteSession?.();
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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3/70 hover:text-gray-12"
              onClick={props.onCollapseWorkspaceSidebar}
              title={t("session.sidebar_collapse")}
              aria-label={t("session.sidebar_collapse")}
            >
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-dls-border/80 px-3.5 pb-3 pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={OPENWORK_MARK_SRC}
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
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
        <div className="space-y-1 pb-2">
          {props.workspaceSessionGroups.map((group, workspaceIndex) => {
            const canReorder =
              Boolean(props.onReorderWorkspaces) && props.workspaceSessionGroups.length > 1;
            const tree = buildSessionTreeState(group.sessions, props.sessionStatusById);
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
            const canRecover =
              workspace.workspaceType === "remote" && connectionState.status === "error";
            const isMenuOpen = workspaceMenuId === workspace.id;
            const taskLoadError = getWorkspaceTaskLoadErrorDisplay(workspace, group.error);
            const connectionIssueMessage =
              connectionState.status === "error"
                ? connectionState.message?.trim() || taskLoadError.message
                : taskLoadError.message;
            const showRemoteConnectionIssue =
              workspace.workspaceType === "remote" &&
              Boolean(connectionIssueMessage) &&
              (connectionState.status === "error" || group.status === "error");
            const statusLabel = (() => {
              const connectionMessage = connectionState.message?.trim() ?? "";
              if (showRemoteConnectionIssue) return t("workspace_list.unavailable");
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
                className={`space-y-1 rounded-xl ${
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
                  const raw = event.dataTransfer.getData("application/x-openwork-workspace-index");
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
                    className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-left text-[13px] transition-colors ${
                      props.selectedWorkspaceId === workspace.id
                        ? "bg-gray-2/70 text-gray-12"
                        : "text-gray-10 hover:bg-gray-1/70 hover:text-gray-12"
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
                    <div className="flex min-w-0 flex-1 items-center gap-3 py-0 text-left">
                      <div
                        draggable={canReorder}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center text-[#3e3e3e] ${
                          canReorder ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                        title={canReorder ? t("workspace_list.drag_reorder") : undefined}
                        aria-label={canReorder ? t("workspace_list.drag_reorder") : undefined}
                        onDragStart={(event) => {
                          if (!canReorder) return;
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-openwork-workspace-index",
                            String(workspaceIndex),
                          );
                        }}
                        onDragEnd={() => {
                          suppressWorkspaceExpandClickIndexRef.current = workspaceIndex;
                          setDropTargetWorkspaceIndex(null);
                        }}
                      >
                        <WorkspaceSidebarGlyph className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="min-w-0 truncate text-[14px] font-normal text-dls-text">
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
                          className="rounded-md p-1 text-gray-9 hover:bg-gray-3/80 hover:text-gray-11"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onCreateTaskInWorkspace(workspace.id);
                          }}
                          disabled={props.newTaskDisabled}
                          aria-label={t("session.new_task")}
                        >
                          <Plus size={14} />
                        </button>

                        <button
                          type="button"
                          className="rounded-md p-1 text-gray-9 hover:bg-gray-3/80 hover:text-gray-11"
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
                      {workspace.workspaceType === "local" ? (
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
                      ) : null}
                      {workspace.workspaceType === "remote" ? (
                        <>
                          {canRecover ? (
                            <button
                              type="button"
                              className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                              onClick={() => {
                                void Promise.resolve(props.onRecoverWorkspace(workspace.id));
                                setWorkspaceMenuId(null);
                              }}
                              disabled={isConnectionActionBusy}
                            >
                              {t("workspace_list.recover")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                            onClick={() => {
                              void Promise.resolve(props.onTestWorkspaceConnection(workspace.id));
                              setWorkspaceMenuId(null);
                            }}
                            disabled={isConnectionActionBusy}
                          >
                            {t("workspace_list.test_connection")}
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-11 transition-colors hover:bg-gray-2"
                            onClick={() => {
                              props.onEditWorkspaceConnection(workspace.id);
                              setWorkspaceMenuId(null);
                            }}
                            disabled={isConnectionActionBusy}
                          >
                            {t("workspace_list.edit_connection")}
                          </button>
                        </>
                      ) : null}
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
                    <div className="relative flex flex-col gap-1 pl-2.5 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[2px] before:bg-gray-3 before:content-['']">
                      {showRemoteConnectionIssue ? (
                        <RemoteConnectionIssueCard
                          message={connectionIssueMessage}
                          tone={taskLoadError.tone}
                          canRecover={canRecover}
                          busy={isConnectionActionBusy}
                          onRecover={() => {
                            void Promise.resolve(props.onRecoverWorkspace(workspace.id));
                          }}
                          onTest={() => {
                            void Promise.resolve(props.onTestWorkspaceConnection(workspace.id));
                          }}
                          onEdit={() => {
                            props.onEditWorkspaceConnection(workspace.id);
                          }}
                        />
                      ) : null}
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
                      ) : showRemoteConnectionIssue ? null : group.status === "error" ? (
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

      <div className="relative mt-auto flex shrink-0 flex-col bg-dls-sidebar">
        <div className="border-t border-dls-divider px-3 pb-4 pt-4">
          <div className="flex w-full items-center justify-center py-1">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-dls-border bg-dls-surface px-3.5 py-2 text-[12px] font-medium text-gray-11 shadow-[var(--dls-card-shadow)] transition-colors hover:bg-gray-2"
              onClick={props.onOpenCreateWorkspace}
            >
              <Plus size={14} />
              {t("workspace_list.add_workspace")}
            </button>
          </div>
        </div>
        {props.sessionStatusFooter ?? null}
      </div>
    </div>
  );
}
