/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { SUGGESTED_PLUGINS } from "../../app/constants";
import { createClient, unwrap } from "../../app/lib/opencode";
import {
  buildAiWorkWorkspaceBaseUrl,
  createAiWorkServerClient,
  isLoopbackAiWorkServerUrl,
  readAiWorkServerSettings,
  type AiWorkServerCapabilities,
  type AiWorkServerClient,
  type AiWorkWorkspaceInfo,
} from "../../app/lib/aiwork-server";
import { buildAiWorkEnvRuntimeKey } from "../../app/lib/aiwork-env-runtime";
import type {
  Client,
  ProviderListItem,
  SettingsTab,
  WorkspaceConnectionState,
  WorkspaceDisplay,
  WorkspacePreset,
  WorkspaceSessionGroup,
} from "../../app/types";
import { currentLocale, t, setLocale, type Language } from "../../i18n";
import { createConnectionsStore, useConnectionsStoreSnapshot } from "../domains/connections/store";
import { createAiWorkServerStore, useAiWorkServerStoreSnapshot } from "../domains/connections/aiwork-server-store";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "../domains/connections/provider-auth/store";
import ProviderAuthModal from "../domains/connections/provider-auth/provider-auth-modal";
import ConnectionsModals from "../domains/connections/modals";
import { GeneralSettingsView } from "../domains/settings/pages/general-view";
import { AdvancedView } from "../domains/settings/pages/advanced-view";
import { AppearanceView } from "../domains/settings/pages/appearance-view";
import { DebugView } from "../domains/settings/pages/debug-view";
import { EnvironmentView } from "../domains/settings/pages/environment-view";
import { ExtensionsView } from "../domains/settings/pages/extensions-view";
import { McpView } from "../domains/settings/pages/mcp-view";
import { RecoveryView } from "../domains/settings/pages/recovery-view";
import { MessagingView } from "../domains/settings/pages/messaging-view";
import { SkillsView } from "../domains/settings/pages/skills-view";
import { UsageView } from "../domains/settings/pages/usage-view";
import { useDebugViewModel } from "../domains/settings/state/debug-view-model";
import { useMessagingViewProps } from "../domains/settings/state/messaging-view-state";
import { useBootState } from "./boot-state";
import { SettingsSessionOverlayFrame, SettingsShell } from "../domains/settings/shell/settings-shell";
import { createExtensionsStore, useExtensionsStoreSnapshot } from "../domains/settings/state/extensions-store";
import { usePlatform } from "../kernel/platform";
import { useLocal } from "../kernel/local-provider";
import {
  DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  useWorkspaceShellLayout,
} from "./workspace-shell-layout";
import {
  aiworkServerInfo,
  aiworkServerRestart,
  engineStart,
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  workspaceCreate,
  workspaceForget,
  workspaceReorder,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  type WorkspaceInfo,
  revealDesktopItemInDir,
} from "../../app/lib/desktop";
import { isDesktopRuntime, normalizeDirectoryPath, safeStringify } from "../../app/utils";
import { CreateWorkspaceModal } from "../domains/workspace/create-workspace-modal";
import { RenameWorkspaceModal } from "../domains/workspace/rename-workspace-modal";
import { ModelPickerModal } from "../domains/session/modals/model-picker-modal";
import type { ModelOption, ModelRef } from "../../app/types";
import { recordInspectorEvent } from "./app-inspector";
import { ensureDesktopLocalAiWorkConnection } from "./desktop-local-aiwork";
import { resolveAiWorkConnection } from "./aiwork-connection";
import { abortSessionSafe } from "../../app/lib/opencode-session";
import { useReloadCoordinator } from "./reload-coordinator";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "./session-memory";
import { workspaceSessionRoute, workspaceSettingsRoute } from "./workspace-routes";
import { toSessionTransportDirectory } from "../../app/lib/session-scope";


function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.log("[settings-route]", ...args);
  }
}

type RouteWorkspace = AiWorkWorkspaceInfo & {
  displayNameResolved: string;
};

const ROUTE_AIWORK_CAPABILITIES: AiWorkServerCapabilities = {
  skills: { read: true, write: true, source: "aiwork" },
  plugins: { read: true, write: true },
  mcp: { read: true, write: true },
  commands: { read: true, write: true },
  config: { read: true, write: true },
};

function mapDesktopWorkspace(workspace: WorkspaceInfo): RouteWorkspace {
  return {
    ...workspace,
    displayNameResolved:
      workspace.displayName?.trim() ||
      workspace.name?.trim() ||
      workspace.path?.trim() ||
      t("session.workspace_fallback"),
  };
}

function describeRouteError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : t("app.unknown_error");
}

function describeWorkspaceCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("operation timed out") ||
    lower.includes("os error 60") ||
    lower.includes("etimedout")
  ) {
    return `${message}\n\nAiWork could not read the workspace config before the filesystem timed out. This often happens when the folder is still syncing from iCloud Drive or another remote folder. Wait for the folder to finish downloading, move the workspace to a local folder, or try again.`;
  }
  return message;
}

function mergeRouteWorkspaces(
  serverWorkspaces: AiWorkWorkspaceInfo[],
  desktopWorkspaces: RouteWorkspace[],
): RouteWorkspace[] {
  const desktopById = new Map(desktopWorkspaces.map((workspace) => [workspace.id, workspace]));
  const desktopByPath = new Map(
    desktopWorkspaces
      .map((workspace) => [normalizeDirectoryPath(workspace.path ?? ""), workspace] as const)
      .filter(([path]) => path.length > 0),
  );

  const mergedServer = serverWorkspaces.map((workspace) => {
    const match =
      desktopById.get(workspace.id) ??
      desktopByPath.get(normalizeDirectoryPath(workspace.path ?? ""));
    const merged = match
      ? {
          ...workspace,
          displayName: workspace.displayName?.trim()
            ? workspace.displayName
            : match.displayName,
          name: match.name?.trim() ? match.name : workspace.name,
        }
      : workspace;
    return {
      ...merged,
      displayNameResolved: workspaceLabel(merged),
    };
  });

  const mergedIds = new Set(mergedServer.map((workspace) => workspace.id));
  const mergedPaths = new Set(
    mergedServer
      .map((workspace) => normalizeDirectoryPath(workspace.path ?? ""))
      .filter((path) => path.length > 0),
  );

  const missingDesktop = desktopWorkspaces.filter((workspace) => {
    if (mergedIds.has(workspace.id)) return false;
    const normalizedPath = normalizeDirectoryPath(workspace.path ?? "");
    if (normalizedPath && mergedPaths.has(normalizedPath)) return false;
    return true;
  });

  return [...mergedServer, ...missingDesktop];
}

function reconcileSelectedWorkspaceId(
  currentId: string,
  serverList: { activeId?: string | null },
  desktopList: Awaited<ReturnType<typeof workspaceBootstrap>> | null,
  workspaces: RouteWorkspace[],
) {
  const current = currentId.trim();
  const serverIds = new Set(workspaces.map((workspace) => workspace.id));
  if (current && serverIds.has(current)) return current;

  const desktopSelectedId = resolveWorkspaceListSelectedId(desktopList);
  const desktopSelected = desktopSelectedId
    ? desktopList?.workspaces?.find((workspace) => workspace.id === desktopSelectedId)
    : null;
  const currentDesktop = current
    ? desktopList?.workspaces?.find((workspace) => workspace.id === current)
    : null;
  const selectedPath = normalizeDirectoryPath((currentDesktop ?? desktopSelected)?.path ?? "");

  if (selectedPath) {
    const pathMatch = workspaces.find(
      (workspace) => normalizeDirectoryPath(workspace.path ?? "") === selectedPath,
    );
    if (pathMatch) return pathMatch.id;
  }

  return serverList.activeId?.trim() || desktopSelectedId || workspaces[0]?.id || "";
}

function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

type PersistedThemeMode = "light" | "dark" | "system";

const SETTINGS_THEME_KEY = "aiwork.react.settings.theme-mode";
function workspaceLabel(workspace: AiWorkWorkspaceInfo) {
  return (
    workspace.displayName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    t("session.workspace_fallback")
  );
}

function toSessionGroups(
  workspaces: RouteWorkspace[],
  sessionsByWorkspaceId: Record<string, any[]>,
  errorsByWorkspaceId: Record<string, string | null>,
): WorkspaceSessionGroup[] {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: (sessionsByWorkspaceId[workspace.id] ?? []) as WorkspaceSessionGroup["sessions"],
    status: errorsByWorkspaceId[workspace.id] ? "error" : "ready",
    error: errorsByWorkspaceId[workspace.id],
  }));
}

function isActiveSessionStatus(status: unknown) {
  return status === "running" || status === "retry" || status === "busy";
}

function getSessionStatus(session: any) {
  return session?.status ?? session?.state ?? session?.runStatus ?? null;
}

function parseSettingsPath(pathname: string): {
  tab: SettingsTab;
  redirectPath: string | null;
  extensionsSection?: "all" | "mcp" | "plugins";
} {
  const trimmed = pathname
    .replace(/^\/workspace\/[^/]+\/settings\/?/, "")
    .replace(/^\/settings\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { tab: "general", redirectPath: "general" };
  }

  const [head, tail] = trimmed.split("/");
  if (head === "den") {
    return { tab: "appearance", redirectPath: "appearance" };
  }
  if (head === "updates") {
    return { tab: "appearance", redirectPath: "appearance" };
  }
  switch (head) {
    case "general":
    case "skills":
    case "advanced":
    case "appearance":
    case "environment":
    case "recovery":
    case "debug":
    case "messaging":
    case "usage":
      return { tab: head, redirectPath: null };
    case "extensions":
      if (tail === "mcp") return { tab: "extensions", redirectPath: null, extensionsSection: "mcp" };
      if (tail === "plugins") return { tab: "extensions", redirectPath: null, extensionsSection: "plugins" };
      return { tab: "extensions", redirectPath: null, extensionsSection: "all" };
    default:
      return { tab: "general", redirectPath: "general" };
  }
}

function readNavigationWorkspaceId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { workspaceId?: unknown }).workspaceId;
  return typeof value === "string" ? value.trim() || null : null;
}

function readNavigationSessionId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value.trim() || null : null;
}

/** Session route location preserved when opening settings as an overlay (see AppRoutes modal stack). */
function readBackgroundLocation(state: unknown): { pathname: string; search: string; hash: string } | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as { backgroundLocation?: unknown }).backgroundLocation;
  if (!raw || typeof raw !== "object") return null;
  const pathname = (raw as { pathname?: unknown }).pathname;
  if (typeof pathname !== "string" || pathname.length === 0) return null;
  const search = (raw as { search?: unknown }).search;
  const hash = (raw as { hash?: unknown }).hash;
  return {
    pathname,
    search: typeof search === "string" ? search : "",
    hash: typeof hash === "string" ? hash : "",
  };
}

function findSessionWorkspaceId(
  sessionId: string | null,
  entries: Array<{ workspaceId: string; sessions: any[] }>,
) {
  const id = sessionId?.trim();
  if (!id) return null;
  return entries.find((entry) => entry.sessions.some((session: any) => session?.id === id))?.workspaceId ?? null;
}

function settingsPathForRoute(route: ReturnType<typeof parseSettingsPath>) {
  if (route.tab === "extensions" && route.extensionsSection && route.extensionsSection !== "all") {
    return `extensions/${route.extensionsSection}`;
  }
  return route.tab;
}

function readStoredThemeMode(): PersistedThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(SETTINGS_THEME_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

function applyThemeMode(mode: PersistedThemeMode) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId?: string }>();
  const routeWorkspaceId = params.workspaceId?.trim() || "";
  const local = useLocal();
  const platform = usePlatform();
  const reloadCoordinator = useReloadCoordinator();
  const route = parseSettingsPath(location.pathname);
  const navigationWorkspaceId = readNavigationWorkspaceId(location.state);
  const navigationSessionId = readNavigationSessionId(location.state);

  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<Record<string, any[]>>({});
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<Record<string, string | null>>({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] = useState<Record<string, WorkspaceConnectionState>>({});
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] = useState(() => navigationWorkspaceId ?? readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [aiworkClient, setAiWorkClient] = useState<AiWorkServerClient | null>(null);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const workspacesRef = useRef<RouteWorkspace[]>([]);
  const refreshInFlightRef = useRef(false);
  const reconnectAttemptedWorkspaceIdRef = useRef("");
  const refreshMcpServersRef = useRef<(() => void | Promise<void>) | null>(null);
  const notifyMcpReloadingRef = useRef<(() => void) | null>(null);
  const pollMcpServersAfterReloadRef = useRef<(() => void | Promise<void>) | null>(null);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [developerMode, setDeveloperMode] = useState(false);
  const [themeMode, setThemeMode] = useState<PersistedThemeMode>(readStoredThemeMode);
  const [configActionStatus, setConfigActionStatus] = useState<string | null>(null);
  const [revealConfigBusy, setRevealConfigBusy] = useState(false);
  const [resetConfigBusy, setResetConfigBusy] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerQuery, setModelPickerQuery] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [autoCompactContext, setAutoCompactContext] = useState(true);
  const [autoCompactContextBusy, setAutoCompactContextBusy] = useState(false);
  const emptyWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () => ({
      id: "",
      name: t("session.workspace_fallback"),
      path: "",
      preset: "starter",
    }),
    [],
  );

  const routeStateRef = useRef({
    activeClient: null as Client | null,
    selectedWorkspaceId: "",
    selectedWorkspaceRoot: "",
    runtimeWorkspaceId: null as string | null,
    aiworkServerClient: null as AiWorkServerClient | null,
    aiworkServerStatus: "disconnected" as "connected" | "disconnected",
    aiworkServerCapabilities: null as AiWorkServerCapabilities | null,
    selectedWorkspaceDisplay: emptyWorkspaceDisplay as WorkspaceDisplay,
    providerItems: [] as ProviderListItem[],
    providerDefaults: {} as Record<string, string>,
    providerConnectedIds: [] as string[],
    disabledProviders: [] as string[],
    developerMode: false,
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? (selectedWorkspaceId ? null : workspaces[0] ?? null),
    [selectedWorkspaceId, workspaces],
  );
  const workspaceConnectionStateById = useMemo(
    () => ({ ...workspaceConnectionOverrides }),
    [workspaceConnectionOverrides],
  );
  const selectedWorkspaceRoot = selectedWorkspace?.path?.trim() || "";
  const selectedWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () =>
      selectedWorkspace
        ? {
            id: selectedWorkspace.id,
            name: selectedWorkspace.name ?? selectedWorkspace.displayNameResolved,
            path: selectedWorkspace.path ?? "",
            preset: "starter",
            displayName: selectedWorkspace.displayNameResolved,
          }
        : emptyWorkspaceDisplay,
    [emptyWorkspaceDisplay, selectedWorkspace],
  );

  routeStateRef.current = {
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
    aiworkServerClient: aiworkClient,
    aiworkServerStatus: aiworkClient ? "connected" : "disconnected",
    aiworkServerCapabilities: aiworkClient ? ROUTE_AIWORK_CAPABILITIES : null,
    selectedWorkspaceDisplay,
    providerItems: providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviders,
    developerMode,
  };

  const activeReloadBlockingSessions = useMemo(
    () =>
      Object.values(sessionsByWorkspaceId)
        .flat()
        .filter((session) => isActiveSessionStatus(getSessionStatus(session)))
        .map((session: any) => ({
          id: String(session?.id ?? ""),
          title:
            String(session?.title ?? session?.slug ?? session?.id ?? "").trim() ||
            t("session.untitled"),
        }))
        .filter((session) => session.id.length > 0),
    [sessionsByWorkspaceId],
  );

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!aiworkClient || !workspaceId) {
      setRouteError(t("app.error_connect_first"));
      return false;
    }

    await aiworkClient.reloadEngine(workspaceId);

    try {
      window.dispatchEvent(new CustomEvent("aiwork-server-settings-changed"));
    } catch {
      // ignore browser event dispatch failures
    }

    // OpenCode reconnects MCPs async after dispose — the store polls until
    // statuses settle so users don't have to collapse/expand the card.
    void pollMcpServersAfterReloadRef.current?.();

    return true;
  }, [aiworkClient, selectedWorkspaceId]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () => Boolean(aiworkClient && (selectedWorkspace?.id || selectedWorkspaceId)),
      reloadWorkspaceEngine: reloadWorkspaceEngineFromUi,
      activeSessions: () => activeReloadBlockingSessions,
      stopSession: async (sessionId) => {
        if (!activeClient) return;
        await abortSessionSafe(activeClient, sessionId);
      },
    });
  }, [
    activeClient,
    activeReloadBlockingSessions,
    aiworkClient,
    reloadCoordinator,
    reloadWorkspaceEngineFromUi,
    selectedWorkspace?.id,
    selectedWorkspaceId,
  ]);

  const shellLayout = useWorkspaceShellLayout({
    expandedRightWidth: 320,
    defaultLeftWidth: DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    minLeftWidth: MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    maxLeftWidth: MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  });

  const overlayFromSession = useMemo(() => Boolean(readBackgroundLocation(location.state)), [location.state]);

  const handleCloseSettings = useCallback(() => {
    const bg = readBackgroundLocation(location.state);
    if (bg) {
      navigate({ pathname: bg.pathname, search: bg.search, hash: bg.hash }, { replace: true });
      return;
    }
    navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session");
  }, [location.state, navigate, selectedWorkspaceId]);

  useEffect(() => {
    if (!overlayFromSession) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseSettings();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCloseSettings, overlayFromSession]);

  const aiworkServerStore = useMemo(
    () =>
      createAiWorkServerStore({
        startupPreference: () => {
          // In desktop mode, loopback URLs are ephemeral local runtime details.
          // Only non-loopback stored URLs indicate an explicit remote/manual
          // server connection preference.
          if (!isDesktopRuntime()) return "server";
          const stored = readAiWorkServerSettings();
          const storedUrl = stored.urlOverride?.trim() ?? "";
          return storedUrl && !isLoopbackAiWorkServerUrl(storedUrl) ? "server" : "local";
        },
        documentVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
        developerMode: () => routeStateRef.current.developerMode,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        activeClient: () => routeStateRef.current.activeClient,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        restartLocalServer: async () => {
          if (!isDesktopRuntime()) return false;
          try {
            await aiworkServerRestart();
            return true;
          } catch {
            return false;
          }
        },
      }),
    [],
  );
  const connectionsStore = useMemo(
    () =>
      createConnectionsStore({
        client: () => routeStateRef.current.activeClient,
        setClient: setActiveClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        aiworkServer: aiworkServerStore,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        developerMode: () => routeStateRef.current.developerMode,
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [aiworkServerStore, reloadCoordinator.markReloadRequired],
  );
  refreshMcpServersRef.current = connectionsStore.refreshMcpServers;
  notifyMcpReloadingRef.current = connectionsStore.notifyMcpReloading;
  pollMcpServersAfterReloadRef.current = connectionsStore.pollMcpServersAfterReload;
  const providerAuthStore = useMemo(
    () =>
      createProviderAuthStore({
        client: () => routeStateRef.current.activeClient,
        providers: () => routeStateRef.current.providerItems,
        providerDefaults: () => routeStateRef.current.providerDefaults,
        providerConnectedIds: () => routeStateRef.current.providerConnectedIds,
        disabledProviders: () => routeStateRef.current.disabledProviders,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        aiworkServer: aiworkServerStore,
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviders,
        markOpencodeConfigReloadRequired: () => {
          setConfigActionStatus(t("settings.config_updated"));
          reloadCoordinator.markReloadRequired("config", {
            type: "config",
            name: "opencode.json",
            action: "updated",
          });
        },
        reloadWorkspaceEngine: () => reloadCoordinator.reloadWorkspaceEngine(),
      }),
    [aiworkServerStore, reloadCoordinator],
  );
  const extensionsStore = useMemo(
    () =>
      createExtensionsStore({
        client: () => routeStateRef.current.activeClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        aiworkServer: aiworkServerStore,
        aiworkServerConnection: () => ({
          aiworkServerClient: routeStateRef.current.aiworkServerClient,
          aiworkServerStatus: routeStateRef.current.aiworkServerStatus,
          aiworkServerCapabilities: routeStateRef.current.aiworkServerCapabilities,
        }),
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        setBusy,
        setBusyLabel,
        setBusyStartedAt: () => {},
        setError: setRouteError,
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [aiworkServerStore, reloadCoordinator.markReloadRequired],
  );
  const aiworkServerSnapshot = useAiWorkServerStoreSnapshot(aiworkServerStore);
  const connectionsSnapshot = useConnectionsStoreSnapshot(connectionsStore);
  const providerAuthSnapshot = useProviderAuthStoreSnapshot(providerAuthStore);
  useExtensionsStoreSnapshot(extensionsStore);

  const debugViewProps = useDebugViewModel({
    developerMode,
    aiworkServerStore,
    aiworkServerSnapshot,
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
    selectedWorkspaceRoot,
    setRouteError,
  });
  const workspaceSessionGroups = useMemo(
    () => toSessionGroups(workspaces, sessionsByWorkspaceId, errorsByWorkspaceId),
    [errorsByWorkspaceId, sessionsByWorkspaceId, workspaces],
  );

  const opencodeBaseUrl = useMemo(() => {
    if (!selectedWorkspace || !selectedWorkspaceId || !baseUrl) return "";
    const mounted = buildAiWorkWorkspaceBaseUrl(baseUrl, selectedWorkspaceId) ?? baseUrl;
    return `${mounted.replace(/\/+$/, "")}/opencode`;
  }, [baseUrl, selectedWorkspace, selectedWorkspaceId]);

  const opencodeClient = useMemo(
    () =>
      opencodeBaseUrl && token
        ? createClient(opencodeBaseUrl, selectedWorkspaceRoot || undefined, {
            token,
            mode: "aiwork",
          })
        : null,
    [opencodeBaseUrl, selectedWorkspaceRoot, token],
  );

  const handleCreateTaskInWorkspace = useCallback(
    (workspaceId: string) => {
      const id = workspaceId.trim();
      if (!id) return;

      void (async () => {
        // When rendered inside settings, the sidebar's “New Task” should create a session
        // (not just navigate to an empty session route).
        if (!opencodeClient || id !== selectedWorkspaceId) {
          navigate(workspaceSessionRoute(id));
          return;
        }

        try {
          const directory = toSessionTransportDirectory(selectedWorkspaceRoot) || undefined;
          const session = unwrap(await opencodeClient.session.create({ directory }));
          navigate(workspaceSessionRoute(id, session.id));
        } catch (error) {
          setRouteError(describeRouteError(error));
          navigate(workspaceSessionRoute(id));
        }
      })();
    },
    [navigate, opencodeClient, selectedWorkspaceId, selectedWorkspaceRoot],
  );

  useEffect(() => {
    setActiveClient(opencodeClient);
  }, [opencodeClient]);

  useEffect(() => {
    if (!modelPickerOpen || !opencodeClient) return;
    let cancelled = false;
    void providerAuthStore.refreshProviders();
    void (async () => {
      try {
        const res = await opencodeClient.config.providers({
          directory: selectedWorkspaceRoot || undefined,
        });
        devLog("modelPickerModal:config.providers", { res });
        const data = (res as { data?: { providers?: Array<{ id: string; name: string; source?: string; models: Record<string, { id: string; name: string }> }> } }).data;
        devLog("modelPickerModal:config.providers data", { data });
        if (cancelled || !data?.providers) return;
        const options: ModelOption[] = [];
        for (const provider of data.providers) {
          const modelIds = Object.keys(provider.models);
          const hasModels = modelIds.length > 0;
          for (const id of modelIds) {
            const model = provider.models[id];
            options.push({
              providerID: provider.id,
              modelID: id,
              title: model.name || id,
              description: provider.name,
              behaviorTitle: "Reasoning",
              behaviorLabel: "Default",
              behaviorDescription: "",
              behaviorValue: null,
              isFree: false,
              isConnected: hasModels,
            });
          }
        }
        setModelOptions(options);
      } catch (error) {
        setRouteError(
          error instanceof Error
            ? error.message
            : t("app.unknown_error"),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelPickerOpen, opencodeClient, selectedWorkspaceRoot]);

  useEffect(() => {
    local.setUi((previous) => ({ ...previous, view: "settings", tab: route.tab }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local is stable via context
  }, [route.tab]);

  useEffect(() => {
    applyThemeMode(themeMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SETTINGS_THEME_KEY, themeMode);
    }
  }, [themeMode]);

  const { markRouteReady: markBootRouteReady } = useBootState();
  const refreshRouteState = useMemo(() => async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setRouteError(null);
    let desktopList = null as Awaited<ReturnType<typeof workspaceBootstrap>> | null;
    let desktopWorkspaces = workspacesRef.current;
    try {
      if (isDesktopRuntime()) {
        try {
          desktopList = await workspaceBootstrap();
          desktopWorkspaces = (desktopList.workspaces ?? []).map(mapDesktopWorkspace);
        } catch (error) {
          const message = describeRouteError(error);
          console.error("[settings-route] workspaceBootstrap failed", error);
          recordInspectorEvent("route.workspace_bootstrap.error", {
            route: "settings",
            message,
            preservedWorkspaceCount: workspacesRef.current.length,
          });
          desktopWorkspaces = workspacesRef.current;
        }
      }
      const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveAiWorkConnection();

      if (!normalizedBaseUrl || !resolvedToken) {
        setAiWorkClient(null);
        setBaseUrl("");
        setToken("");
        setWorkspaces(desktopWorkspaces);
        setSessionsByWorkspaceId({});
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId((current) => {
          const next = current || readActiveWorkspaceId() || resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "";
          writeActiveWorkspaceId(next || null);
          return next;
        });
        return;
      }

      const client = createAiWorkServerClient({
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken || undefined,
      });
      const list = await client.listWorkspaces();
      const serverWorkspaceIds = new Set(list.items.map((workspace) => workspace.id));
      const nextWorkspaces = mergeRouteWorkspaces(list.items, desktopWorkspaces);
      const sessionEntries = await Promise.all(
        nextWorkspaces.map(async (workspace) => {
          if (!serverWorkspaceIds.has(workspace.id)) {
            return { workspaceId: workspace.id, sessions: [], error: null as string | null };
          }
          try {
            const response = await client.listSessions(workspace.id, { limit: 200 });
            const workspaceRoot = normalizeDirectoryPath(workspace.path ?? "");
            const items = workspaceRoot
              ? (response.items ?? []).filter((session: any) =>
                  normalizeDirectoryPath(session?.directory ?? "") === workspaceRoot,
                )
              : (response.items ?? []);
            return {
              workspaceId: workspace.id,
              sessions: items,
              error: null as string | null,
              connectionState: null as WorkspaceConnectionState | null,
            };
          } catch (error) {
            const fallback = error instanceof Error ? error.message : t("app.unknown_error");
            return {
              workspaceId: workspace.id,
              sessions: [],
              error: fallback,
              connectionState: null,
            };
          }
        }),
      );

      setAiWorkClient(client);
      setBaseUrl(normalizedBaseUrl);
      setToken(resolvedToken);
      setWorkspaces(nextWorkspaces);
      setSessionsByWorkspaceId(Object.fromEntries(sessionEntries.map((entry) => [entry.workspaceId, entry.sessions])));
      setErrorsByWorkspaceId(Object.fromEntries(sessionEntries.map((entry) => [entry.workspaceId, entry.error])));
      setWorkspaceConnectionOverrides((current) => {
        const next = { ...current };
        for (const entry of sessionEntries) {
          if (entry.connectionState) {
            next[entry.workspaceId] = entry.connectionState;
          } else if (next[entry.workspaceId]?.status === "error") {
            delete next[entry.workspaceId];
          }
        }
        return next;
      });
      setLegacySelectedWorkspaceId((current) => {
        const sessionWorkspaceId = findSessionWorkspaceId(navigationSessionId, sessionEntries);
        const preferred = routeWorkspaceId || sessionWorkspaceId || navigationWorkspaceId || current || readActiveWorkspaceId() || "";
        const next = reconcileSelectedWorkspaceId(preferred, list, desktopList, nextWorkspaces);
        writeActiveWorkspaceId(next || null);
        return next;
      });
    } catch (error) {
      const message = describeRouteError(error);
      console.error("[settings-route] refreshRouteState failed", error);
      recordInspectorEvent("route.refresh.error", {
        route: "settings",
        message,
        preservedWorkspaceCount: desktopWorkspaces.length,
      });
      setRouteError(message);
      if (desktopWorkspaces.length > 0) {
        setWorkspaces(desktopWorkspaces);
        setLegacySelectedWorkspaceId((current) => {
          const next = current || readActiveWorkspaceId() || resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "";
          writeActiveWorkspaceId(next || null);
          return next;
        });
      }
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      // Settings can be the first route a user lands on (direct link, deep
      // link, or after reload). Let the boot overlay dismiss once we've
      // completed our first data load.
      markBootRouteReady();
    }
  }, [markBootRouteReady, navigationSessionId, navigationWorkspaceId, routeWorkspaceId]);

  const handleReorderWorkspaces = useCallback(
    async (orderedIds: string[]) => {
      if (orderedIds.length < 2) return;
      try {
        if (isDesktopRuntime()) {
          await workspaceReorder(orderedIds);
        }
        if (aiworkClient) {
          await aiworkClient.reorderWorkspaces(orderedIds);
        }
        await refreshRouteState();
      } catch (error) {
        const message = describeRouteError(error);
        console.error("[settings-route] reorder workspaces failed", error);
        recordInspectorEvent("route.workspace_reorder.error", {
          route: "settings",
          message,
        });
      }
    },
    [aiworkClient, refreshRouteState],
  );

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    setWorkspaceConnectionOverrides((current) => {
      let changed = false;
      const next: Record<string, WorkspaceConnectionState> = {};
      for (const [workspaceId, state] of Object.entries(current)) {
        if (activeWorkspaceIds.has(workspaceId)) {
          next[workspaceId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workspaces]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (aiworkClient) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace) return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (!workspaceId || reconnectAttemptedWorkspaceIdRef.current === workspaceId) return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocalAiWorkConnection({
      route: "settings",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : describeRouteError(error);
      setRouteError(message);
    });
  }, [loading, aiworkClient, selectedWorkspace, workspaces]);

  useEffect(() => {
    void refreshRouteState();
    const handleSettingsChange = () => {
      void refreshRouteState();
    };
    window.addEventListener("aiwork-server-settings-changed", handleSettingsChange);
    return () => {
      window.removeEventListener("aiwork-server-settings-changed", handleSettingsChange);
    };
  }, [refreshRouteState]);

  useEffect(() => {
    aiworkServerStore.start();
    connectionsStore.start();
    providerAuthStore.start();
    extensionsStore.start();

    return () => {
      extensionsStore.dispose();
      providerAuthStore.dispose();
      connectionsStore.dispose();
      aiworkServerStore.dispose();
    };
  }, [connectionsStore, extensionsStore, aiworkServerStore, providerAuthStore]);

  useEffect(() => {
    aiworkServerStore.syncFromOptions();
    connectionsStore.syncFromOptions();
    providerAuthStore.syncFromOptions();
    extensionsStore.syncFromOptions();
  }, [
    activeClient,
    connectionsStore,
    extensionsStore,
    aiworkServerStore,
    providerAuthStore,
    selectedWorkspace?.id,
    selectedWorkspaceRoot,
  ]);

  useEffect(() => {
    if (!activeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviders([]);
      return;
    }
    void providerAuthStore.refreshProviders();
    void connectionsStore.refreshMcpServers();
  }, [
    activeClient,
    connectionsStore,
    providerAuthStore,
    selectedWorkspace?.id,
    selectedWorkspaceRoot,
  ]);

  const selectedWorkspaceName = selectedWorkspace?.displayNameResolved ?? t("session.workspace_fallback");
  const canWriteWorkspaceSkills = true;
  const canWriteWorkspacePlugins = true;
  const skillsAccessHint = null;
  const pluginsAccessHint = null;
  const defaultModelLabel = local.prefs.defaultModel
    ? `${local.prefs.defaultModel.providerID}/${local.prefs.defaultModel.modelID}`
    : t("session.default_model");
  const defaultModelRef = local.prefs.defaultModel
    ? `${local.prefs.defaultModel.providerID}/${local.prefs.defaultModel.modelID}`
    : t("settings.default_label");
  const providerStatusLabel = providerConnectedIds.length > 0 ? t("status.connected") : t("status.disconnected_label");
  const providerStatusStyle = providerConnectedIds.length > 0
    ? "bg-green-7/10 text-green-11 border-green-7/20"
    : "bg-gray-4/60 text-gray-11 border-gray-7/50";
  const providerSummary = providerConnectedIds.length > 0
    ? t("status.providers_connected", { count: providerConnectedIds.length })
    : t("settings.no_providers_connected");
  const connectedProviders = providers
    .filter((provider) => providerConnectedIds.includes(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
    }));
  const mcpConnectedAppsCount = connectionsSnapshot.mcpServers.length;
  const routeAiWorkStatus = aiworkClient ? "connected" : "disconnected";
  const notFoundRouteError = !loading && routeWorkspaceId && !selectedWorkspace
    ? "Workspace was not found. Select a new workspace from the sidebar."
    : null;
  const routeAiWorkCapabilities: AiWorkServerCapabilities | null = aiworkClient
    ? ROUTE_AIWORK_CAPABILITIES
    : null;
  const environmentRuntimeKey = buildAiWorkEnvRuntimeKey({
    baseUrl: aiworkServerSnapshot.aiworkServerBaseUrl || aiworkServerSnapshot.aiworkServerUrl,
    pid: aiworkServerSnapshot.aiworkServerHostInfo?.pid ?? null,
    port: aiworkServerSnapshot.aiworkServerHostInfo?.port ?? null,
  });

  const handleApplyEnvironmentChanges = async () => {
    if (!isDesktopRuntime()) {
      throw new Error(t("settings.environment.apply_unavailable"));
    }
    if (activeReloadBlockingSessions.length > 0) {
      throw new Error(t("settings.environment.apply_blocked_active_tasks"));
    }
    if (!selectedWorkspaceRoot) {
      throw new Error(t("settings.environment.apply_no_local_workspace"));
    }
    const workspacePaths = Array.from(
      new Set(
        workspaces
          .map((workspace) => workspace.path?.trim() ?? "")
          .filter((path) => path.length > 0),
      ),
    );
    if (!workspacePaths.includes(selectedWorkspaceRoot)) {
      workspacePaths.unshift(selectedWorkspaceRoot);
    }
    await engineStart(selectedWorkspaceRoot, {
      preferSidecar: true,
      runtime: "direct",
      workspacePaths,
    });
    const reconnected = await aiworkServerStore.reconnectAiWorkServer();
    if (!reconnected) {
      await refreshRouteState().catch(() => {});
      return { statusMessage: t("settings.environment.apply_refresh_failed") };
    }
    await refreshRouteState();
  };

  const handleOpenCreateWorkspace = () => {
    setCreateWorkspaceError(null);
    setCreateWorkspaceOpen(true);
  };

  const handleOpenRenameWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    setRenameWorkspaceId(workspaceId);
    setRenameWorkspaceTitle(workspaceLabel(workspace));
  }, [workspaces]);

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      if (isDesktopRuntime()) {
        await workspaceUpdateDisplayName({
          workspaceId: renameWorkspaceId,
          displayName: trimmed,
        }).catch(() => undefined);
      }
      if (aiworkClient) {
        await aiworkClient
          .updateWorkspaceDisplayName(renameWorkspaceId, trimmed)
          .catch(() => undefined);
      }
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
      await refreshRouteState();
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [aiworkClient, refreshRouteState, renameWorkspaceId, renameWorkspaceTitle]);

  const handleRevealWorkspace = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const path = workspace?.path?.trim();
    if (!path || !isDesktopRuntime()) return;
    await revealDesktopItemInDir(path).catch(() => undefined);
  }, [workspaces]);

  const handleForgetWorkspace = useCallback(async (workspaceId: string) => {
    if (typeof window !== "undefined") {
      const message = t("workspace_list.remove_confirm") || "Remove this workspace from the sidebar?";
      if (!window.confirm(message)) return;
    }
    if (isDesktopRuntime()) {
      await workspaceForget(workspaceId).catch(() => undefined);
    }
    if (aiworkClient) {
      await aiworkClient.deleteWorkspace(workspaceId).catch(() => undefined);
    }
    if (selectedWorkspaceId === workspaceId) {
      const nextWorkspace = workspaces.find((workspace) => workspace.id !== workspaceId);
      const nextId = nextWorkspace?.id ?? "";
      setLegacySelectedWorkspaceId(nextId);
      if (nextId) {
        await workspaceSetSelected(nextId).catch(() => undefined);
      }
    }
    await refreshRouteState();
  }, [aiworkClient, refreshRouteState, selectedWorkspaceId, workspaces]);

  const handleCreateWorkspace = async (preset: WorkspacePreset, folder: string | null) => {
    if (!folder) return;
    setCreateWorkspaceBusy(true);
    setCreateWorkspaceError(null);
    try {
      const workspaceName = folderNameFromPath(folder);
      const list = await workspaceCreate({
        folderPath: folder,
        name: workspaceName,
        preset,
      });
      const createdId = resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
      }
      // Register the workspace with the running aiwork-server so
      // listWorkspaces() reflects it immediately. Without this the UI only
      // picks up the new workspace after an app restart (because the server
      // is launched with a fixed --workspace list at boot and the bridge
      // write only updates desktop-side state).
      if (aiworkClient) {
        await aiworkClient
          .createLocalWorkspace({ folderPath: folder, name: workspaceName, preset })
          .catch(() => undefined);
      }
      setCreateWorkspaceOpen(false);
      await refreshRouteState();
    } catch (error) {
      setCreateWorkspaceError(describeWorkspaceCreateError(error));
    } finally {
      setCreateWorkspaceBusy(false);
    }
  };

  const handleReconnectMessagingServer = useCallback(async () => {
    const ok = await aiworkServerStore.reconnectAiWorkServer();
    if (ok) {
      await refreshRouteState();
    }
    return ok;
  }, [aiworkServerStore, refreshRouteState]);

  const handleRestartLocalServer = useCallback(async () => {
    if (!isDesktopRuntime()) return false;
    try {
      await aiworkServerRestart();
      await aiworkServerStore.reconnectAiWorkServer();
      await refreshRouteState();
      return true;
    } catch {
      return false;
    }
  }, [aiworkServerStore, refreshRouteState]);

  const handleRestartMessagingWorker = useCallback(async () => {
    if (!isDesktopRuntime()) return false;

    try {
      await aiworkServerRestart();
      await aiworkServerStore.reconnectAiWorkServer();
      await refreshRouteState();
      return true;
    } catch {
      return false;
    }
  }, [aiworkServerStore, refreshRouteState]);

  const messagingViewProps = useMessagingViewProps({
    busy,
    aiworkServerStatus: aiworkServerSnapshot.aiworkServerStatus,
    aiworkServerUrl: aiworkServerSnapshot.aiworkServerUrl,
    aiworkServerClient:
      aiworkClient ?? aiworkServerSnapshot.aiworkServerClient,
    aiworkReconnectBusy: aiworkServerSnapshot.aiworkReconnectBusy,
    reconnectAiWorkServer: handleReconnectMessagingServer,
    restartMessagingWorker: handleRestartMessagingWorker,
    workspaceId: selectedWorkspace?.id ?? null,
    selectedWorkspaceRoot,
  });

  const autoCompactWorkspaceId = selectedWorkspace?.id ?? "";
  useEffect(() => {
    if (!aiworkClient || !autoCompactWorkspaceId) {
      setAutoCompactContext(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const config = await aiworkClient.getConfig(autoCompactWorkspaceId);
        if (cancelled) return;
        const opencodeConfig =
          config.opencode && typeof config.opencode === "object"
            ? (config.opencode as Record<string, unknown>)
            : {};
        const compaction =
          opencodeConfig.compaction && typeof opencodeConfig.compaction === "object"
            ? (opencodeConfig.compaction as Record<string, unknown>)
            : null;
        // OpenCode treats compaction.auto as true when unset.
        const auto = compaction && typeof compaction.auto === "boolean" ? compaction.auto : true;
        setAutoCompactContext(auto);
      } catch (error) {
        if (cancelled) return;
        console.error("[settings-route] failed to read compaction.auto", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiworkClient, autoCompactWorkspaceId]);

  const handleToggleAutoCompactContext = useCallback(async () => {
    if (!aiworkClient || !autoCompactWorkspaceId) {
      setRouteError(t("app.error_connect_first"));
      return;
    }
    setAutoCompactContextBusy(true);
    setRouteError(null);
    try {
      const config = await aiworkClient.getConfig(autoCompactWorkspaceId);
      const opencodeConfig =
        config.opencode && typeof config.opencode === "object"
          ? (config.opencode as Record<string, unknown>)
          : {};
      const currentCompaction =
        opencodeConfig.compaction && typeof opencodeConfig.compaction === "object"
          ? (opencodeConfig.compaction as Record<string, unknown>)
          : {};
      const currentAuto =
        typeof currentCompaction.auto === "boolean" ? currentCompaction.auto : true;
      const nextAuto = !currentAuto;
      const nextCompaction = { ...currentCompaction, auto: nextAuto };

      await aiworkClient.patchConfig(autoCompactWorkspaceId, {
        opencode: { compaction: nextCompaction },
      });
      setAutoCompactContext(nextAuto);
      setConfigActionStatus(t("settings.config_updated"));
      reloadCoordinator.markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setRouteError(message);
    } finally {
      setAutoCompactContextBusy(false);
    }
  }, [autoCompactWorkspaceId, aiworkClient, reloadCoordinator]);

  if (route.redirectPath) {
    const target = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, route.redirectPath)
      : `/settings/${route.redirectPath}`;
    return <Navigate to={target} replace state={location.state} />;
  }

  if (!routeWorkspaceId && selectedWorkspaceId) {
    return <Navigate to={workspaceSettingsRoute(selectedWorkspaceId, settingsPathForRoute(route))} replace state={location.state} />;
  }

  const settingsView = (() => {
    switch (route.tab) {
      case "general":
        return (
          <GeneralSettingsView
            authorizedFoldersPanel={{
              aiworkServerClient: aiworkClient,
              aiworkServerStatus: routeAiWorkStatus,
              aiworkServerCapabilities: routeAiWorkCapabilities,
              runtimeWorkspaceId: selectedWorkspace?.id ?? null,
              selectedWorkspaceRoot,
              onConfigUpdated: () => {
                setConfigActionStatus(t("settings.config_updated"));
                void providerAuthStore.refreshProviders();
                void connectionsStore.refreshMcpServers();
              },
            }}
            busy={busy}
            providerAuthBusy={providerAuthSnapshot.providerAuthBusy}
            providerStatusLabel={providerStatusLabel}
            providerStatusStyle={providerStatusStyle}
            providerSummary={providerSummary}
            connectedProviders={connectedProviders}
            disconnectingProviderId={null}
            providerConnectError={providerAuthSnapshot.providerAuthError}
            providerDisconnectStatus={configActionStatus}
            providerDisconnectError={null}
            onOpenProviderAuth={() => providerAuthStore.openProviderAuthModal()}
            onEditProvider={(providerId) => void providerAuthStore.openProviderAuthModalForEdit(providerId)}
            onDisconnectProvider={async (providerId) => {
              await providerAuthStore.disconnectProvider(providerId);
            }}
            canDisconnectProvider={() => true}
            defaultModelLabel={defaultModelLabel}
            defaultModelRef={defaultModelRef}
            onChangeDefaultModel={() => {
              setModelPickerQuery("");
              setModelPickerOpen(true);
            }}
            showThinking={local.prefs.showThinking}
            onToggleShowThinking={() => {
              local.setPrefs((previous) => ({ ...previous, showThinking: !previous.showThinking }));
            }}
            autoCompactContext={autoCompactContext}
            autoCompactContextBusy={autoCompactContextBusy}
            onToggleAutoCompactContext={() => {
              void handleToggleAutoCompactContext();
            }}
          />
        );
      case "skills":
        return (
          <SkillsView
            workspaceName={selectedWorkspaceName}
            busy={busy}
            canInstallSkillCreator={canWriteWorkspaceSkills}
            canUseDesktopTools
            accessHint={skillsAccessHint}
            extensions={extensionsStore}
            onOpenLink={(url) => platform.openLink(url)}
            createSessionAndOpen={async (_command?: string): Promise<string | undefined> => {
              navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session");
              return undefined;
            }}
          />
        );
      case "extensions":
        return (
          <ExtensionsView
            busy={busy}
            selectedWorkspaceRoot={selectedWorkspaceRoot}
            canEditPlugins={canWriteWorkspacePlugins}
            canUseGlobalScope
            accessHint={pluginsAccessHint}
            suggestedPlugins={SUGGESTED_PLUGINS}
            extensions={extensionsStore}
            mcpConnectedAppsCount={mcpConnectedAppsCount}
            initialSection={route.extensionsSection}
            setSectionRoute={(section) => {
              const path = `extensions/${section}`;
              navigate(selectedWorkspaceId ? workspaceSettingsRoute(selectedWorkspaceId, path) : `/settings/${path}`, {
                replace: true,
                state: location.state,
              });
            }}
            onRefresh={() => {
              void connectionsStore.refreshMcpServers();
              void extensionsStore.refreshPlugins();
            }}
            mcpView={
              <McpView
                busy={busy}
                selectedWorkspaceRoot={selectedWorkspaceRoot}
                mcpServers={connectionsSnapshot.mcpServers}
                mcpStatus={connectionsSnapshot.mcpStatus}
                mcpLastUpdatedAt={connectionsSnapshot.mcpLastUpdatedAt}
                mcpStatuses={connectionsSnapshot.mcpStatuses}
                mcpConnectingName={connectionsSnapshot.mcpConnectingName}
                selectedMcp={connectionsSnapshot.selectedMcp}
                setSelectedMcp={(name) => connectionsStore.setSelectedMcp(name)}
                quickConnect={connectionsStore.quickConnect}
                connectMcp={(entry) => {
                  void connectionsStore.connectMcp(entry);
                }}
                authorizeMcp={(entry) => {
                  void connectionsStore.authorizeMcp(entry);
                }}
                logoutMcpAuth={(name) => connectionsStore.logoutMcpAuth(name)}
                removeMcp={(name) => {
                  void connectionsStore.removeMcp(name);
                }}
                setMcpEnabled={
                  routeAiWorkStatus === "connected" && routeAiWorkCapabilities?.mcp?.write
                    ? (name, enabled) => connectionsStore.setMcpEnabled(name, enabled)
                    : undefined
                }
                readConfigFile={(scope) => connectionsStore.readMcpConfigFile(scope)}
                showHeader={false}
              />
            }
          />
        );
      case "advanced":
        return (
          <AdvancedView
            busy={busy}
            baseUrl={opencodeBaseUrl}
            headerStatus={aiworkServerSnapshot.aiworkServerStatus}
            clientConnected={Boolean(opencodeClient)}
            opencodeConnectStatus={null}
            aiworkServerStatus={aiworkServerSnapshot.aiworkServerStatus}
            aiworkServerUrl={aiworkServerSnapshot.aiworkServerUrl}
            aiworkReconnectBusy={aiworkServerSnapshot.aiworkReconnectBusy}
            reconnectAiWorkServer={aiworkServerStore.reconnectAiWorkServer}
            engineInfo={null}
            restartLocalServer={handleRestartLocalServer}
            stopHost={() => {}}
            developerMode={developerMode}
            toggleDeveloperMode={() => setDeveloperMode((current) => !current)}
            opencodeDevModeEnabled={false}
            openDebugDeepLink={async () => ({ ok: false, message: "Debug deep links are not wired into the React settings route yet." })}
            opencodeEnableExa={false}
            toggleOpencodeEnableExa={() => {
              setRouteError("EXA controls are not wired into the React settings route yet.");
            }}
            configView={{
              busy,
              clientConnected: Boolean(opencodeClient),
              anyActiveRuns: false,
              aiworkServerStatus: aiworkServerSnapshot.aiworkServerStatus,
              aiworkServerUrl: aiworkServerSnapshot.aiworkServerUrl,
              aiworkServerSettings: aiworkServerSnapshot.aiworkServerSettings,
              aiworkServerHostInfo: aiworkServerSnapshot.aiworkServerHostInfo,
              runtimeWorkspaceId: selectedWorkspace?.id ?? null,
              updateAiWorkServerSettings: aiworkServerStore.updateAiWorkServerSettings,
              resetAiWorkServerSettings: aiworkServerStore.resetAiWorkServerSettings,
              testAiWorkServerConnection: aiworkServerStore.testAiWorkServerConnection,
              canReloadWorkspace: reloadCoordinator.canReloadWorkspaceEngine,
              reloadWorkspaceEngine: reloadCoordinator.reloadWorkspaceEngine,
              reloadBusy: false,
              reloadError: routeError,
              developerMode,
            }}
          />
        );
      case "appearance":
        return (
          <AppearanceView
            busy={busy}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            language={currentLocale() as Language}
            setLanguage={setLocale}
          />
        );
      case "recovery":
        return (
          <RecoveryView
            anyActiveRuns={false}
            workspaceConfigPath={selectedWorkspaceRoot ? `${selectedWorkspaceRoot}/opencode.json` : ""}
            revealConfigBusy={revealConfigBusy}
            onRevealWorkspaceConfig={async () => {
              setRevealConfigBusy(true);
              setConfigActionStatus("Reveal workspace config is not wired into the React settings route yet.");
              setRevealConfigBusy(false);
            }}
            resetConfigBusy={resetConfigBusy}
            onResetAppConfigDefaults={async () => {
              setResetConfigBusy(true);
              setConfigActionStatus("Reset app config defaults is not wired into the React settings route yet.");
              setResetConfigBusy(false);
            }}
            configActionStatus={configActionStatus}
            cacheRepairBusy={false}
            cacheRepairResult={null}
            onRepairOpencodeCache={() => {
              setRouteError("Cache repair is not wired into the React settings route yet.");
            }}
          />
        );
      case "environment":
        return (
          <EnvironmentView
            client={aiworkServerSnapshot.aiworkServerClient}
            onStatusMessage={setConfigActionStatus}
            onApplyChanges={isDesktopRuntime() ? handleApplyEnvironmentChanges : undefined}
            applyBlocked={activeReloadBlockingSessions.length > 0}
            applyBlockedReason={
              activeReloadBlockingSessions.length > 0
                ? t("settings.environment.apply_blocked_active_tasks")
                : null
            }
            runtimeKey={environmentRuntimeKey}
          />
        );
      case "messaging":
        return <MessagingView {...messagingViewProps} />;
      case "usage":
        return (
          <UsageView
            aiworkServerClient={aiworkClient}
            selectedWorkspaceId={selectedWorkspaceId}
            workspaceSessionGroups={workspaceSessionGroups}
          />
        );
      case "debug":
        return <DebugView {...debugViewProps} />;
      default:
        return null;
    }
  })();

  const settingsChrome = (
    <SettingsShell
      activeTab={route.tab}
      onSelectTab={(tab) =>
        navigate(selectedWorkspaceId ? workspaceSettingsRoute(selectedWorkspaceId, tab) : `/settings/${tab}`, {
          state: location.state,
        })
      }
      developerMode={developerMode}
      presentation={overlayFromSession ? "overlay-panel" : "page"}
      selectedWorkspaceName={selectedWorkspaceName}
      headerStatus={routeAiWorkStatus}
      busyHint={loading ? t("session.loading_detail") : busyLabel}
      workspaceSessionListProps={{
        workspaceSessionGroups,
        selectedWorkspaceId,
        developerMode,
        selectedSessionId: null,
        connectingWorkspaceId: null,
        workspaceConnectionStateById,
        newTaskDisabled: !opencodeClient,
        onReorderWorkspaces: isDesktopRuntime() || aiworkClient ? handleReorderWorkspaces : undefined,
        onOpenSession: (workspaceId, sessionId) => navigate(workspaceSessionRoute(workspaceId, sessionId)),
        onCreateTaskInWorkspace: handleCreateTaskInWorkspace,
        onOpenRenameWorkspace: handleOpenRenameWorkspace,
        onRevealWorkspace: (id) => void handleRevealWorkspace(id),
        onForgetWorkspace: (id) => void handleForgetWorkspace(id),
        onOpenCreateWorkspace: handleOpenCreateWorkspace,
      }}
      onClose={handleCloseSettings}
      sidebarWidth={shellLayout.leftSidebarWidth}
      onSidebarResizeStart={overlayFromSession ? undefined : shellLayout.startLeftSidebarResize}
      error={routeError ?? notFoundRouteError}
    >
      {settingsView}
    </SettingsShell>
  );

  return (
    <>
      {overlayFromSession ? (
        <SettingsSessionOverlayFrame
          sidebarWidth={shellLayout.leftSidebarWidth}
          onDismiss={handleCloseSettings}
        >
          {settingsChrome}
        </SettingsSessionOverlayFrame>
      ) : (
        settingsChrome
      )}

      <ProviderAuthModal
        open={providerAuthSnapshot.providerAuthModalOpen}
        loading={
          providerAuthSnapshot.providerAuthBusy && !providerAuthSnapshot.providerAuthEditSession
        }
        submitting={providerAuthSnapshot.providerAuthBusy}
        error={providerAuthSnapshot.providerAuthError}
        preferredProviderId={providerAuthSnapshot.providerAuthPreferredProviderId}
        workerType={providerAuthSnapshot.providerAuthWorkerType}
        editSession={providerAuthSnapshot.providerAuthEditSession}
        providers={providerAuthSnapshot.providerAuthProviders}
        connectedProviderIds={providerConnectedIds}
        authMethods={providerAuthSnapshot.providerAuthMethods}
        onSelect={providerAuthStore.startProviderAuth}
        onSubmitApiKey={providerAuthStore.submitProviderApiKey}
        onSubmitOAuth={providerAuthStore.completeProviderAuthOAuth}
        onRefreshProviders={providerAuthStore.refreshProviders}
        onClose={() => providerAuthStore.closeProviderAuthModal()}
      />
      <CreateWorkspaceModal
        open={createWorkspaceOpen}
        onClose={() => {
          setCreateWorkspaceOpen(false);
          setCreateWorkspaceError(null);
        }}
        onConfirm={handleCreateWorkspace}
        onPickFolder={() => pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<string | null>}
        submitting={createWorkspaceBusy}
        localError={createWorkspaceError}
      />
      <RenameWorkspaceModal
        open={renameWorkspaceId !== null}
        title={renameWorkspaceTitle}
        busy={renameWorkspaceBusy}
        canSave={!renameWorkspaceBusy && renameWorkspaceTitle.trim().length > 0}
        onClose={() => {
          if (renameWorkspaceBusy) return;
          setRenameWorkspaceId(null);
          setRenameWorkspaceTitle("");
        }}
        onSave={() => void handleSaveRenameWorkspace()}
        onTitleChange={setRenameWorkspaceTitle}
      />
      <ConnectionsModals
        client={activeClient}
        projectDir={selectedWorkspaceRoot}
        reloadBlocked={activeReloadBlockingSessions.length > 0}
        activeSessions={activeReloadBlockingSessions}
        onForceStopSession={(sessionId) => {
          if (!activeClient) return undefined;
          return abortSessionSafe(activeClient, sessionId);
        }}
        onReloadEngine={reloadCoordinator.reloadWorkspaceEngine}
        modalState={{
          mcpAuthModalOpen: connectionsSnapshot.mcpAuthModalOpen,
          mcpAuthEntry: connectionsSnapshot.mcpAuthEntry,
          mcpAuthNeedsReload: connectionsSnapshot.mcpAuthNeedsReload,
        }}
        onCloseMcpAuthModal={() => connectionsStore.closeMcpAuthModal()}
        onCompleteMcpAuthModal={() => connectionsStore.completeMcpAuthModal()}
      />
      <ModelPickerModal
        open={modelPickerOpen}
        options={modelOptions}
        filteredOptions={modelOptions.filter((opt) => {
          const q = modelPickerQuery.trim().toLowerCase();
          if (!q) return true;
          return (
            opt.title.toLowerCase().includes(q) ||
            opt.providerID.toLowerCase().includes(q) ||
            opt.modelID.toLowerCase().includes(q)
          );
        })}
        query={modelPickerQuery}
        setQuery={setModelPickerQuery}
        target="default"
        current={
          local.prefs.defaultModel ?? { providerID: "", modelID: "" }
        }
        onSelect={(next: ModelRef) => {
          local.setPrefs((prev) => ({ ...prev, defaultModel: next }));
          setModelPickerOpen(false);
        }}
        onBehaviorChange={() => {}}
        onOpenSettings={() => {}}
        onClose={() => setModelPickerOpen(false)}
      />
    </>
  );
}
