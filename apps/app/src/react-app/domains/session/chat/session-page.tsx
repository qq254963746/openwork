/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Minimize2, PanelLeftOpen, PanelRightIcon, Zap } from "lucide-react";

import { t } from "../../../../i18n";
import { buildOpenworkWorkspaceBaseUrl, type OpenworkServerClient, type OpenworkServerStatus } from "../../../../app/lib/openwork-server";
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
import { QuestionModal } from "../modals/question-modal";
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
import { isElectronRuntime, isMacPlatform, isTauriRuntime } from "../../../../app/utils";

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
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  /** Lazy-load tasks when a workspace group is expanded without selecting it. */
  onWorkspaceSectionOpened?: (workspaceId: string) => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void | Promise<void>;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  "client" | "workspaceId" | "sessionId" | "opencodeBaseUrl" | "openworkToken" | "workspaceSidePanelOpen"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
    workspaceType?: WorkspaceInfo["workspaceType"];
  };
  selectedWorkspaceRoot: string;
  runtimeWorkspaceId: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerClient: OpenworkServerClient | null;
  openworkServerToken?: string | null;
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

  const toggleWorkspaceSidePanel = useCallback(() => {
    setWorkspaceSidePanelOpen((current) => !current);
  }, []);

  const macDesktopChrome =
    isMacPlatform() && (isTauriRuntime() || isElectronRuntime());

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
    const baseUrl = props.openworkServerClient?.baseUrl?.trim() ?? "";
    if (!workspaceId || !baseUrl) return "";
    const mounted = buildOpenworkWorkspaceBaseUrl(baseUrl, workspaceId) ?? baseUrl;
    return `${mounted.replace(/\/+$/, "")}/opencode`;
  }, [props.openworkServerClient?.baseUrl, props.runtimeWorkspaceId]);

  const reactSessionToken = props.openworkServerClient?.token?.trim() || props.openworkServerToken?.trim() || "";
  const canRenderReactSurface = Boolean(
    props.selectedSessionId &&
      props.runtimeWorkspaceId &&
      props.openworkServerClient &&
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

  const openRenameModal = () => {
    if (!props.selectedSessionId || !props.onRenameSession) return;
    setRenameTitle(selectedSessionTitle);
    setRenameOpen(true);
  };

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

  const statusBarInSidebar = layoutLg && !leftWorkspaceSidebarCollapsed;

  const statusBarSharedProps = useMemo(
    () => ({
      clientConnected: props.clientConnected,
      openworkServerStatus: props.openworkServerStatus,
      developerMode: props.developerMode,
      settingsOpen: props.statusBar?.settingsOpen ?? false,
      onOpenSettings: props.onOpenSettings,
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
      props.openworkServerStatus,
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
          className={`min-h-0 shrink-0 overflow-hidden border-0 border-r border-dls-border bg-dls-sidebar ${
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
              onOpenRenameSession={props.onRenameSession ? openRenameModal : undefined}
              onOpenDeleteSession={props.onDeleteSession ? () => setDeleteOpen(true) : undefined}
              onOpenRenameWorkspace={props.sidebar.onOpenRenameWorkspace}
              onRevealWorkspace={props.sidebar.onRevealWorkspace}
              onRecoverWorkspace={props.sidebar.onRecoverWorkspace}
              onTestWorkspaceConnection={props.sidebar.onTestWorkspaceConnection}
              onEditWorkspaceConnection={props.sidebar.onEditWorkspaceConnection}
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
            className={`z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-dls-border bg-dls-surface pr-1.5 md:pr-2 ${
              macHeaderTrafficInset ? "pl-[76px]" : "pl-4 md:pl-6"
            }`}
            {...(isTauriRuntime() ? ({ "data-tauri-drag-region": true } as const) : {})}
            style={
              isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                ? ({ WebkitAppRegion: "drag" } as CSSProperties)
                : undefined
            }
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {!leftWorkspaceSidebarVisible ? (
                <div
                  className="flex shrink-0"
                  {...(isTauriRuntime() ? ({ "data-tauri-drag-region": "false" } as const) : {})}
                  style={
                    isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                      ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
                    onClick={expandWorkspaceSidebar}
                    title={t("session.sidebar_expand")}
                    aria-label={t("session.sidebar_expand")}
                  >
                    <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
              <h1 className="truncate text-[15px] font-semibold text-dls-text">
                {showWorkspaceSetupEmptyState
                  ? t("session.create_or_connect_workspace")
                  : selectedSessionTitle || t("session.default_title")}
              </h1>
              <span className="hidden truncate text-[13px] text-dls-secondary lg:inline">
                {workspaceName}
              </span>
              {props.developerMode ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.headerStatus}
                </span>
              ) : null}
              {props.busyHint ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.busyHint}
                </span>
              ) : null}
            </div>
            <div
              className="flex shrink-0 items-center"
              {...(isTauriRuntime() ? ({ "data-tauri-drag-region": "false" } as const) : {})}
              style={
                isElectronRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
                  ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
                  : undefined
              }
            >
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
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
                  client={props.openworkServerClient!}
                  workspaceId={props.runtimeWorkspaceId!}
                  sessionId={props.selectedSessionId!}
                  opencodeBaseUrl={reactSessionBaseUrl}
                  openworkToken={reactSessionToken}
                  workspaceSidePanelOpen={workspaceSidePanelOpen}
                  {...props.surface!}
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
                  <div className="max-h-60 space-y-2.5 overflow-auto border-t border-dls-border px-4 pb-3">
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
                                    ? "border-amber-6 bg-amber-2 text-amber-11"
                                    : cancelled
                                      ? "border-gray-6 bg-gray-2 text-gray-8"
                                      : "border-gray-6 bg-gray-1 text-gray-8"
                              }`}
                            >
                              {done ? <Check size={10} /> : active ? <span className="h-1.5 w-1.5 rounded-full bg-amber-9" /> : null}
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

      <QuestionModal
        open={Boolean(props.activeQuestion)}
        questions={props.activeQuestion?.questions ?? []}
        busy={props.questionReplyBusy ?? false}
        onReply={(answers) => {
          if (props.activeQuestion) {
            props.respondQuestion?.(props.activeQuestion.id, answers);
          }
        }}
      />
    </div>
  );
}
