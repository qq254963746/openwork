/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Minimize2, PanelLeftOpen, PanelRightIcon, Zap } from "lucide-react";

import { t } from "../../../../i18n";
import { buildAiWorkWorkspaceBaseUrl, type AiWorkServerClient, type AiWorkServerStatus } from "../../../../app/lib/aiwork-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import type {
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import { Button } from "../../../design-system/button";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import ProviderAuthModal, { type ProviderAuthModalProps } from "../../connections/provider-auth/provider-auth-modal";
import { PermissionApprovalModal } from "./permission-approval-modal";
import { openAppLogWindow } from "../../../shell/open-app-log-window";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { WorkspaceSessionList } from "../sidebar/workspace-session-list";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import { StatusBar, type StatusBarProps } from "./status-bar";
import {
  DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  useWorkspaceShellLayout,
} from "../../../shell/workspace-shell-layout";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import { isMacPlatform } from "../../../../app/utils";

/** Title bar WebViews often show I‑beam over headings unless this is explicit. */
const SESSION_MAIN_HEADER_DRAG_CHROME_STYLE: CSSProperties = {
  cursor: "default",
  userSelect: "none",
  WebkitUserSelect: "none",
};

/** Session glyph for main header (speech bubble + dots; matches sidebar session row; viewBox 24×24). */
function SessionTitleGlyph(props: { className?: string }) {
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

/** Full-window-drag hits fail on nested title text in WKWebView (incl. release); use an underlay + pointer-events pass-through. */
const SESSION_MAIN_HEADER_USES_DRAG_PASS_THROUGH = true;

type StatusBarOverrides = Pick<
  StatusBarProps,
  | "statusLabel"
  | "statusDetail"
  | "statusDotClass"
  | "statusPingClass"
  | "statusPulse"
  | "showSettingsButton"
  | "settingsOpen"
>;

export type SessionPageSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Lazy-load tasks when a workspace group is expanded without selecting it. */
  onWorkspaceSectionOpened?: (workspaceId: string) => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void | Promise<void>;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  | "client"
  | "workspaceId"
  | "sessionId"
  | "engineBaseUrl"
  | "aiworkToken"
  | "workspaceSidePanelOpen"
  | "requestWorkspaceSidePanelOpen"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
  };
  selectedWorkspaceRoot: string;
  runtimeWorkspaceId: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  aiworkServerStatus: AiWorkServerStatus;
  aiworkServerClient: AiWorkServerClient | null;
  aiworkServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onOpenSettings: () => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  statusBar?: Partial<StatusBarOverrides>;
  notFoundMessage?: string | null;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
};

function getSidebarInitialLoading(props: SessionPageSidebarProps) {
  if (props.workspaceSessionGroups.some((group) => group.sessions.length > 0)) {
    return false;
  }
  if (props.sidebarHydratedFromCache) return false;
  if (
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready"
  ) {
    return true;
  }
  return props.workspaceSessionGroups.some(
    (group) => group.status === "loading" || group.status === "idle",
  );
}

function sessionTitleForId(groups: WorkspaceSessionGroup[], id: string | null | undefined) {
  if (!id) return "";
  for (const group of groups) {
    const match = group.sessions.find((session) => session.id === id);
    if (match) return getDisplaySessionTitle(match.title);
  }
  return "";
}

export function SessionPage(props: SessionPageProps) {
  const { leftSidebarWidth, startLeftSidebarResize } = useWorkspaceShellLayout({
    defaultLeftWidth: DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    expandedRightWidth: 280,
  });
  useReactRenderWatchdog("SessionPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [todoExpanded, setTodoExpanded] = useState(true);
  const [workspaceSidePanelOpen, setWorkspaceSidePanelOpen] = useState(false);
  const [leftWorkspaceSidebarCollapsed, setLeftWorkspaceSidebarCollapsed] = useState(false);
  /** Narrow viewports hide the inline sidebar by layout; this opens it as a drawer. */
  const [narrowWorkspaceSidebarOpen, setNarrowWorkspaceSidebarOpen] = useState(false);
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] = useState(false);

  /** After sidebar picks rename/delete on another session, open modal once selection catches up. */
  const pendingSidebarRenameSessionIdRef = useRef<string | null>(null);
  const pendingSidebarDeleteSessionIdRef = useRef<string | null>(null);

  const toggleWorkspaceSidePanel = useCallback(() => {
    setWorkspaceSidePanelOpen((current) => !current);
  }, []);

  const macDesktopChrome =
    isMacPlatform();

  const selectedSessionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, props.selectedSessionId),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceName =
    props.selectedWorkspaceDisplay.displayName?.trim() ||
    props.selectedWorkspaceDisplay.name?.trim() ||
    t("session.workspace_fallback");
  const providerCount = props.providerConnectedIds.length;
  const messageCountVisible = props.selectedSessionId ? 1 : 0;
  const showWorkspaceSetupEmptyState = props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) && props.sessionLoadingById(props.selectedSessionId) && !showWorkspaceSetupEmptyState;
  const todos = useMemo(() => props.todos.filter((todo) => todo.content.trim()), [props.todos]);
  const completedTodos = useMemo(
    () => todos.filter((todo) => todo.status === "completed").length,
    [todos],
  );
  const sidebarInitialLoading = useMemo(() => getSidebarInitialLoading(props.sidebar), [props.sidebar]);

  const reactSessionBaseUrl = useMemo(() => {
    const workspaceId = props.runtimeWorkspaceId?.trim() ?? "";
    const baseUrl = props.aiworkServerClient?.baseUrl?.trim() ?? "";
    if (!workspaceId || !baseUrl) return "";
    const mounted = buildAiWorkWorkspaceBaseUrl(baseUrl, workspaceId) ?? baseUrl;
    return `${mounted.replace(/\/+$/, "")}/engine`;
  }, [props.aiworkServerClient?.baseUrl, props.runtimeWorkspaceId]);

  const reactSessionToken = props.aiworkServerClient?.token?.trim() || props.aiworkServerToken?.trim() || "";
  const canRenderReactSurface = Boolean(
    props.selectedSessionId &&
      props.runtimeWorkspaceId &&
      props.aiworkServerClient &&
      reactSessionBaseUrl &&
      reactSessionToken &&
      props.surface,
  );

  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => {
      setShowDelayedSessionLoadingState(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
  }, [props.selectedSessionId]);

  const openRenameModal = useCallback(() => {
    if (!props.selectedSessionId || !props.onRenameSession) return;
    setRenameTitle(selectedSessionTitle);
    setRenameOpen(true);
  }, [props.onRenameSession, props.selectedSessionId, selectedSessionTitle]);

  useEffect(() => {
    const pending = pendingSidebarRenameSessionIdRef.current;
    if (!pending || props.selectedSessionId !== pending) return;
    pendingSidebarRenameSessionIdRef.current = null;
    if (!props.onRenameSession || !props.selectedSessionId) return;
    setRenameTitle(sessionTitleForId(props.sidebar.workspaceSessionGroups, props.selectedSessionId));
    setRenameOpen(true);
  }, [props.onRenameSession, props.selectedSessionId, props.sidebar.workspaceSessionGroups]);

  useEffect(() => {
    const pending = pendingSidebarDeleteSessionIdRef.current;
    if (!pending || props.selectedSessionId !== pending) return;
    pendingSidebarDeleteSessionIdRef.current = null;
    setDeleteOpen(true);
  }, [props.selectedSessionId]);

  const submitRename = async () => {
    const sessionId = props.selectedSessionId;
    const nextTitle = renameTitle.trim();
    if (!sessionId || !props.onRenameSession || !nextTitle || nextTitle === selectedSessionTitle.trim()) return;
    setRenameBusy(true);
    try {
      await props.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const handleSidebarRenameRequest = useCallback(
    (workspaceId?: string, sessionId?: string) => {
      if (!props.onRenameSession) return;
      if (workspaceId && sessionId && props.selectedSessionId !== sessionId) {
        pendingSidebarRenameSessionIdRef.current = sessionId;
        props.sidebar.onOpenSession(workspaceId, sessionId);
        return;
      }
      openRenameModal();
    },
    [openRenameModal, props.onRenameSession, props.selectedSessionId, props.sidebar.onOpenSession],
  );

  const handleSidebarDeleteRequest = useCallback(
    (workspaceId?: string, sessionId?: string) => {
      if (!props.onDeleteSession) return;
      if (workspaceId && sessionId && props.selectedSessionId !== sessionId) {
        pendingSidebarDeleteSessionIdRef.current = sessionId;
        props.sidebar.onOpenSession(workspaceId, sessionId);
        return;
      }
      setDeleteOpen(true);
    },
    [props.onDeleteSession, props.selectedSessionId, props.sidebar.onOpenSession],
  );

  const confirmDelete = async () => {
    const sessionId = props.selectedSessionId;
    if (!sessionId || !props.onDeleteSession) return;
    setDeleteBusy(true);
    try {
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const todoLabel =
    completedTodos > 0
      ? t("session.todo_progress_label", undefined, { completed: completedTodos, total: todos.length })
      : t("session.todo_label", undefined, { count: todos.length });

  const [layoutLg, setLayoutLg] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const fn = () => setLayoutLg(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (layoutLg) setNarrowWorkspaceSidebarOpen(false);
  }, [layoutLg]);

  const expandWorkspaceSidebar = useCallback(() => {
    if (layoutLg) {
      setLeftWorkspaceSidebarCollapsed(false);
    } else {
      setNarrowWorkspaceSidebarOpen(true);
    }
  }, [layoutLg]);

  const collapseWorkspaceSidebar = useCallback(() => {
    if (layoutLg) {
      setLeftWorkspaceSidebarCollapsed(true);
    } else {
      setNarrowWorkspaceSidebarOpen(false);
    }
  }, [layoutLg]);

  const leftWorkspaceSidebarVisible =
    (layoutLg && !leftWorkspaceSidebarCollapsed) || (!layoutLg && narrowWorkspaceSidebarOpen);

  const macHeaderTrafficInset =
    macDesktopChrome && (!layoutLg || leftWorkspaceSidebarCollapsed);

  const mainHeaderDragPassThrough = SESSION_MAIN_HEADER_USES_DRAG_PASS_THROUGH;

  const statusBarInSidebar = layoutLg && !leftWorkspaceSidebarCollapsed;

  const statusBarSharedProps = useMemo(
    () => ({
      clientConnected: props.clientConnected,
      aiworkServerStatus: props.aiworkServerStatus,
      developerMode: props.developerMode,
      settingsOpen: props.statusBar?.settingsOpen ?? false,
      onOpenSettings: props.onOpenSettings,
      onOpenAppLogs: () => {
        openAppLogWindow();
      },
      providerConnectedIds: props.providerConnectedIds,
      mcpConnectedCount: props.mcpConnectedCount,
      statusLabel: props.statusBar?.statusLabel,
      statusDetail: props.statusBar?.statusDetail,
      statusDotClass: props.statusBar?.statusDotClass,
      statusPingClass: props.statusBar?.statusPingClass,
      statusPulse: props.statusBar?.statusPulse,
      showSettingsButton: props.statusBar?.showSettingsButton,
    }),
    [
      props.clientConnected,
      props.developerMode,
      props.mcpConnectedCount,
      props.onOpenSettings,
      props.aiworkServerStatus,
      props.providerConnectedIds,
      props.statusBar?.settingsOpen,
      props.statusBar?.showSettingsButton,
      props.statusBar?.statusDetail,
      props.statusBar?.statusDotClass,
      props.statusBar?.statusLabel,
      props.statusBar?.statusPingClass,
      props.statusBar?.statusPulse,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text">
      <div className="flex min-h-0 flex-1 gap-0">
        {!layoutLg && narrowWorkspaceSidebarOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-[90] cursor-default border-0 bg-black/40 p-0"
            aria-label={t("common.close")}
            onClick={() => setNarrowWorkspaceSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={`min-h-0 shrink-0 overflow-hidden border-0 border-r border-dls-divider bg-dls-sidebar ${
            !leftWorkspaceSidebarVisible
              ? "hidden"
              : layoutLg
                ? "relative flex flex-col"
                : "fixed inset-y-0 left-0 z-[100] flex max-h-[100dvh] flex-col shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_48px_rgba(0,0,0,0.35)]"
          }`}
          style={
            leftWorkspaceSidebarVisible
              ? layoutLg
                ? { width: leftSidebarWidth }
                : { width: `min(${leftSidebarWidth}px, 85vw)` }
              : undefined
          }
        >
          <div className="flex min-h-0 flex-1">
            <WorkspaceSessionList
              workspaceSessionGroups={props.sidebar.workspaceSessionGroups}
              selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
              developerMode={props.sidebar.developerMode}
              selectedSessionId={props.sidebar.selectedSessionId}
              showInitialLoading={sidebarInitialLoading}
              showSessionActions={Boolean(props.onRenameSession || props.onDeleteSession)}
              sessionStatusById={props.sidebar.sessionStatusById}
              connectingWorkspaceId={props.sidebar.connectingWorkspaceId}
              workspaceConnectionStateById={props.sidebar.workspaceConnectionStateById}
              newTaskDisabled={props.sidebar.newTaskDisabled}
              onOpenSession={props.sidebar.onOpenSession}
              onPrefetchSession={props.sidebar.onPrefetchSession}
              onCreateTaskInWorkspace={props.sidebar.onCreateTaskInWorkspace}
              onOpenRenameSession={props.onRenameSession ? handleSidebarRenameRequest : undefined}
              onOpenDeleteSession={props.onDeleteSession ? handleSidebarDeleteRequest : undefined}
              onOpenRenameWorkspace={props.sidebar.onOpenRenameWorkspace}
              onRevealWorkspace={props.sidebar.onRevealWorkspace}
              onForgetWorkspace={props.sidebar.onForgetWorkspace}
              onOpenCreateWorkspace={props.sidebar.onOpenCreateWorkspace}
              onWorkspaceSectionOpened={props.sidebar.onWorkspaceSectionOpened}
              onReorderWorkspaces={props.sidebar.onReorderWorkspaces}
              onCollapseWorkspaceSidebar={collapseWorkspaceSidebar}
              sessionStatusFooter={
                statusBarInSidebar ? (
                  <StatusBar {...statusBarSharedProps} variant="sidebar" />
                ) : undefined
              }
            />
          </div>
          {layoutLg && leftWorkspaceSidebarVisible ? (
            <div
              className="absolute right-0 top-0 h-full w-2 translate-x-1/2 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-gray-6/40"
              onPointerDown={startLeftSidebarResize}
              title={t("session.resize_workspace_column")}
              aria-label={t("session.resize_workspace_column")}
            />
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-dls-surface">
          <header
            className={`relative z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-dls-divider bg-dls-surface pr-1.5 md:pr-2 ${
              macHeaderTrafficInset ? "pl-[76px]" : "pl-4 md:pl-6"
            } select-none`}
            data-tauri-drag-region={true}
          >
            {mainHeaderDragPassThrough ? (
              <div
                aria-hidden
                className="absolute inset-0 z-0"
                data-tauri-drag-region={true}
                style={{
                  ...SESSION_MAIN_HEADER_DRAG_CHROME_STYLE,
                }}
              />
            ) : null}
            <div
              className={`relative z-[2] flex min-w-0 flex-1 items-center gap-3 ${
                mainHeaderDragPassThrough ? "pointer-events-none" : ""
              } ${!mainHeaderDragPassThrough ? "cursor-default" : ""}`}
            >
              {!leftWorkspaceSidebarVisible ? (
                <div
                  className={`flex shrink-0 ${mainHeaderDragPassThrough ? "pointer-events-auto" : ""} ${
                    import.meta.env.PROD && macHeaderTrafficInset ? "ml-2" : ""
                  }`}
                  data-tauri-drag-region="false"
                >
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
                    onClick={expandWorkspaceSidebar}
                    title={t("session.sidebar_expand")}
                    aria-label={t("session.sidebar_expand")}
                  >
                    <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
              <div className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex min-w-0 max-w-full items-center gap-2">
                  <SessionTitleGlyph className="h-[18px] w-[18px] shrink-0 text-dls-text opacity-90" />
                  <div className="flex min-w-0 max-w-full flex-1 items-end gap-x-3">
                    <h1
                      className="max-w-full min-w-0 flex-1 cursor-default truncate text-[15px] font-semibold leading-none text-dls-text"
                    >
                      {showWorkspaceSetupEmptyState
                        ? t("session.create_or_connect_workspace")
                        : selectedSessionTitle || t("session.default_title")}
                    </h1>
                    <span
                      className="hidden max-w-[14rem] shrink-0 cursor-default truncate text-[10px] leading-none text-[rgba(0,0,0,0.2)] lg:inline dark:text-gray-11/45"
                    >
                      {workspaceName}
                    </span>
                  </div>
                </div>
                {props.developerMode ? (
                  <span
                    className="hidden max-w-full min-w-0 cursor-default truncate text-[12px] text-dls-secondary lg:inline"
                  >
                    {props.headerStatus}
                  </span>
                ) : null}
                {props.busyHint ? (
                  <span
                    className="hidden max-w-full min-w-0 cursor-default truncate text-[12px] text-dls-secondary lg:inline"
                  >
                    {props.busyHint}
                  </span>
                ) : null}
              </div>
            </div>
            <div
              className={`relative z-[2] flex shrink-0 items-center ${
                mainHeaderDragPassThrough ? "pointer-events-none" : ""
              }`}
              data-tauri-drag-region="false"
            >
              <div className={mainHeaderDragPassThrough ? "pointer-events-auto" : undefined}>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12"
                  onClick={toggleWorkspaceSidePanel}
                  title={
                    workspaceSidePanelOpen
                      ? t("session.workspace_panel_toggle_hide")
                      : t("session.workspace_panel_toggle_show")
                  }
                  aria-label={
                    workspaceSidePanelOpen
                      ? t("session.workspace_panel_toggle_hide")
                      : t("session.workspace_panel_toggle_show")
                  }
                  aria-pressed={workspaceSidePanelOpen}
                >
                  <PanelRightIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="relative min-w-0 flex-1 overflow-hidden bg-dls-surface">
              {showStartupSkeleton ? (
                <div className="px-6 py-14" role="status" aria-live="polite">
                  <div className="mx-auto max-w-2xl space-y-6">
                    <div className="space-y-2">
                      <div className="h-4 w-32 animate-pulse rounded-full bg-dls-hover/80" />
                      <div className="h-3 w-64 animate-pulse rounded-full bg-dls-hover/60" />
                    </div>
                    <div className="space-y-3">
                      {[0, 1, 2].map((idx) => (
                        <div key={idx} className="rounded-2xl border border-dls-border bg-dls-hover/40 p-4">
                          <div
                            className="mb-3 h-3 animate-pulse rounded-full bg-dls-hover/80"
                            style={{ width: idx === 0 ? "42%" : idx === 1 ? "56%" : "36%" }}
                          />
                          <div className="space-y-2">
                            <div className="h-2.5 animate-pulse rounded-full bg-dls-hover/70" />
                            <div
                              className="h-2.5 animate-pulse rounded-full bg-dls-hover/60"
                              style={{ width: idx === 2 ? "74%" : "88%" }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {showDelayedSessionLoadingState ? (
                <div className="px-6 py-16">
                  <div
                    className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <OwDotTicker size="md" />
                    <div className="text-[12px] leading-5 text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  </div>
                </div>
              ) : null}

              {!showDelayedSessionLoadingState && canRenderReactSurface ? (
                <SessionSurface
                  client={props.aiworkServerClient!}
                  workspaceId={props.runtimeWorkspaceId!}
                  sessionId={props.selectedSessionId!}
                  engineBaseUrl={reactSessionBaseUrl}
                  aiworkToken={reactSessionToken}
                  {...props.surface!}
                  workspaceSidePanelOpen={workspaceSidePanelOpen}
                  requestWorkspaceSidePanelOpen={() => setWorkspaceSidePanelOpen(true)}
                />
              ) : null}

              {!showDelayedSessionLoadingState && !canRenderReactSurface && !showStartupSkeleton ? (
                <div className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}>
                  {props.notFoundMessage ? (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto max-w-md rounded-2xl border border-dls-border bg-dls-card px-5 py-6 shadow-[var(--dls-card-shadow)]">
                        <h3 className="text-base font-medium text-dls-text">Workspace or session not found</h3>
                        <p className="mt-2 text-sm leading-6 text-dls-secondary">{props.notFoundMessage}</p>
                      </div>
                    </div>
                  ) : showWorkspaceSetupEmptyState ? (
                    <div className="space-y-6 px-6 text-center">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-dls-border bg-dls-hover">
                        <Zap className="text-dls-secondary" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-medium">{t("session.create_or_connect_workspace")}</h3>
                        <p className="mx-auto max-w-sm text-sm text-dls-secondary">
                          {t("workspace.empty_state_body")}
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <Button onClick={props.sidebar.onOpenCreateWorkspace}>{t("workspace.create_workspace")}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                      {props.selectedSessionId
                        ? t("session.loading_detail")
                        : t("session.select_or_create_session")}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {todos.length > 0 ? (
            <div className="mx-auto w-full max-w-[800px] px-4">
              <div className="rounded-t-[20px] border border-b-0 border-dls-border bg-dls-surface shadow-[var(--dls-card-shadow)]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-t-[20px] px-4 py-3 text-xs text-gray-9 transition-colors hover:bg-gray-2/50"
                  onClick={() => setTodoExpanded((current) => !current)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-11 font-medium">{todoLabel}</span>
                  </div>
                  <Minimize2 size={12} className={`text-gray-8 transition-transform ${todoExpanded ? "" : "rotate-180"}`} />
                </button>
                {todoExpanded ? (
                  <div className="space-y-2.5 border-t border-dls-border px-4 pb-3">
                    {todos.map((todo, index) => {
                      const done = todo.status === "completed";
                      const cancelled = todo.status === "cancelled";
                      const active = todo.status === "in_progress";
                      return (
                        <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5 pt-2.5 first:pt-2.5">
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <div
                              className={`flex h-4.5 w-4.5 items-center justify-center rounded-full border ${
                                done
                                  ? "border-green-6 bg-green-2 text-green-11"
                                  : active
                                    ? "border-blue-6 bg-blue-2 text-blue-11"
                                    : cancelled
                                      ? "border-gray-6 bg-gray-2 text-gray-8"
                                      : "border-gray-6 bg-gray-1 text-gray-8"
                              }`}
                            >
                              {done ? <Check size={10} /> : active ? <span className="h-1.5 w-1.5 rounded-full bg-blue-9" /> : null}
                            </div>
                          </div>
                          <div className={`flex-1 text-sm leading-relaxed ${cancelled ? "text-gray-9 line-through" : "text-gray-12"}`}>
                            <span className="mr-1.5 text-gray-9">{index + 1}.</span>
                            {todo.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!statusBarInSidebar ? <StatusBar {...statusBarSharedProps} variant="main" /> : null}
        </main>
      </div>

      {props.providerAuthModal ? <ProviderAuthModal {...props.providerAuthModal} /> : null}

      {props.onRenameSession ? (
        <RenameSessionModal
          open={renameOpen}
          title={renameTitle}
          busy={renameBusy}
          canSave={renameTitle.trim().length > 0 && renameTitle.trim() !== selectedSessionTitle.trim()}
          onClose={() => {
            if (!renameBusy) setRenameOpen(false);
          }}
          onSave={() => void submitRename()}
          onTitleChange={setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={deleteOpen}
          title={t("session.delete_session_title")}
          message={
            selectedSessionTitle.trim()
              ? t("session.delete_named_session_message", undefined, { title: selectedSessionTitle.trim() })
              : t("session.delete_session_generic")
          }
          confirmLabel={deleteBusy ? t("session.deleting") : t("session.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleteBusy) setDeleteOpen(false);
          }}
        />
      ) : null}


      {props.activePermission ? (
        <PermissionApprovalModal
          permission={props.activePermission}
          busy={props.permissionReplyBusy}
          respondPermission={props.respondPermission}
          safeStringify={props.safeStringify}
        />
      ) : null}

    </div>
  );
}
