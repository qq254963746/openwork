import { useSyncExternalStore } from "react";

import { t } from "../../../i18n";
import type { StartupPreference, WorkspaceDisplay } from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import {
  aiworkServerInfo,
  aiworkServerRestart,
  type AiWorkServerInfo,
} from "../../../app/lib/desktop";
import {
  clearAiWorkServerSettings,
  createAiWorkServerClient,
  isLoopbackAiWorkServerUrl,
  normalizeAiWorkServerUrl,
  readAiWorkServerSettings,
  writeAiWorkServerSettings,
  type AiWorkAuditEntry,
  type AiWorkServerCapabilities,
  type AiWorkServerClient,
  type AiWorkServerDiagnostics,
  type AiWorkServerError,
  type AiWorkServerSettings,
  type AiWorkServerStatus,
} from "../../../app/lib/aiwork-server";

type SetStateAction<T> = T | ((current: T) => T);

export type AiWorkServerStoreSnapshot = {
  aiworkServerSettings: AiWorkServerSettings;
  aiworkServerUrl: string;
  aiworkServerBaseUrl: string;
  aiworkServerAuth: { token?: string; hostToken?: string };
  aiworkServerClient: AiWorkServerClient | null;
  aiworkServerStatus: AiWorkServerStatus;
  aiworkServerCapabilities: AiWorkServerCapabilities | null;
  aiworkServerReady: boolean;
  aiworkServerWorkspaceReady: boolean;
  resolvedAiWorkCapabilities: AiWorkServerCapabilities | null;
  aiworkServerCanWriteSkills: boolean;
  aiworkServerCanWritePlugins: boolean;
  aiworkServerHostInfo: AiWorkServerInfo | null;
  aiworkServerDiagnostics: AiWorkServerDiagnostics | null;
  aiworkReconnectBusy: boolean;
  aiworkAuditEntries: AiWorkAuditEntry[];
  aiworkAuditStatus: "idle" | "loading" | "error";
  aiworkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

export type AiWorkServerStore = ReturnType<typeof createAiWorkServerStore>;

type CreateAiWorkServerStoreOptions = {
  startupPreference: () => StartupPreference | null;
  documentVisible: () => boolean;
  developerMode: () => boolean;
  runtimeWorkspaceId: () => string | null;
  activeClient: () => unknown | null;
  selectedWorkspaceDisplay: () => WorkspaceDisplay;
  restartLocalServer: () => Promise<boolean>;
};

type MutableState = {
  aiworkServerSettings: AiWorkServerSettings;
  aiworkServerUrl: string;
  aiworkServerStatus: AiWorkServerStatus;
  aiworkServerCapabilities: AiWorkServerCapabilities | null;
  aiworkServerCheckedAt: number | null;
  aiworkServerHostInfo: AiWorkServerInfo | null;
  aiworkServerHostInfoReady: boolean;
  aiworkServerDiagnostics: AiWorkServerDiagnostics | null;
  aiworkReconnectBusy: boolean;
  aiworkAuditEntries: AiWorkAuditEntry[];
  aiworkAuditStatus: "idle" | "loading" | "error";
  aiworkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
  typeof next === "function" ? (next as (value: T) => T)(current) : next;

export function createAiWorkServerStore(options: CreateAiWorkServerStoreOptions) {
  const bootStartedAt = Date.now();
  const listeners = new Set<() => void>();
  const intervals = new Map<string, number>();

  let clientCacheKey = "";
  let clientCacheValue: AiWorkServerClient | null = null;
  let started = false;
  let disposed = false;
  let healthTimeoutId: number | null = null;
  let healthBusy = false;
  let healthDelayMs = 10_000;
  let snapshot: AiWorkServerStoreSnapshot;

  let state: MutableState = {
    aiworkServerSettings: readAiWorkServerSettings(),
    aiworkServerUrl: "",
    aiworkServerStatus: "disconnected",
    aiworkServerCapabilities: null,
    aiworkServerCheckedAt: null,
    aiworkServerHostInfo: null,
    aiworkServerHostInfoReady: !isDesktopRuntime(),
    aiworkServerDiagnostics: null,
    aiworkReconnectBusy: false,
    aiworkAuditEntries: [],
    aiworkAuditStatus: "idle",
    aiworkAuditError: null,
    devtoolsWorkspaceId: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getBaseUrl = () => {
    const pref = options.startupPreference();
    const hostInfo = state.aiworkServerHostInfo;
    const settingsUrl = normalizeAiWorkServerUrl(state.aiworkServerSettings.urlOverride ?? "") ?? "";

    if (pref === "local") return hostInfo?.baseUrl ?? "";
    if (pref === "server" && settingsUrl && isLoopbackAiWorkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return hostInfo.baseUrl;
    }
    if (pref === "server") return settingsUrl;
    return hostInfo?.baseUrl ?? settingsUrl;
  };

  const getAuth = () => {
    const pref = options.startupPreference();
    const hostInfo = state.aiworkServerHostInfo;
    const settingsUrl = normalizeAiWorkServerUrl(state.aiworkServerSettings.urlOverride ?? "") ?? "";
    const settingsToken = state.aiworkServerSettings.token?.trim() ?? "";
    const settingsHostToken = state.aiworkServerSettings.hostToken?.trim() ?? "";
    const clientToken = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";

    if (pref === "local") {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    if (pref === "server" && settingsUrl && isLoopbackAiWorkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return {
        token: clientToken || settingsToken || undefined,
        hostToken: hostToken || settingsHostToken || undefined,
      };
    }
    if (pref === "server") {
      return {
        token: settingsToken || undefined,
        hostToken: settingsUrl && isLoopbackAiWorkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
      };
    }
    if (hostInfo?.baseUrl) {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    return {
      token: settingsToken || undefined,
      hostToken: settingsUrl && isLoopbackAiWorkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
    };
  };

  const getClient = () => {
    const baseUrl = getBaseUrl().trim();
    if (!baseUrl) {
      clientCacheKey = "";
      clientCacheValue = null;
      return null;
    }

    const auth = getAuth();
    const key = `${baseUrl}::${auth.token ?? ""}::${auth.hostToken ?? ""}`;
    if (key !== clientCacheKey) {
      clientCacheKey = key;
      clientCacheValue = createAiWorkServerClient({
        baseUrl,
        token: auth.token,
        hostToken: auth.hostToken,
      });
    }
    return clientCacheValue;
  };

  const refreshSnapshot = () => {
    const aiworkServerBaseUrl = getBaseUrl().trim();
    const aiworkServerAuth = getAuth();
    const aiworkServerClient = getClient();
    const aiworkServerReady = state.aiworkServerStatus === "connected";
    const aiworkServerWorkspaceReady = Boolean(options.runtimeWorkspaceId());
    const resolvedAiWorkCapabilities = state.aiworkServerCapabilities;

    const pref = options.startupPreference();
    const info = state.aiworkServerHostInfo;
    const hostUrl = info?.connectUrl ?? info?.lanUrl ?? info?.mdnsUrl ?? info?.baseUrl ?? "";
    const settingsUrl = normalizeAiWorkServerUrl(state.aiworkServerSettings.urlOverride ?? "") ?? "";

    let aiworkServerUrl = hostUrl || settingsUrl;
    if (pref === "local") aiworkServerUrl = hostUrl;
    if (pref === "server") aiworkServerUrl = settingsUrl;
    state.aiworkServerUrl = aiworkServerUrl;

    snapshot = {
      aiworkServerSettings: state.aiworkServerSettings,
      aiworkServerUrl,
      aiworkServerBaseUrl,
      aiworkServerAuth,
      aiworkServerClient,
      aiworkServerStatus: state.aiworkServerStatus,
      aiworkServerCapabilities: state.aiworkServerCapabilities,
      aiworkServerReady,
      aiworkServerWorkspaceReady,
      resolvedAiWorkCapabilities,
      aiworkServerCanWriteSkills:
        aiworkServerReady &&
        (resolvedAiWorkCapabilities?.skills?.write ?? false),
      aiworkServerCanWritePlugins:
        aiworkServerReady &&
        (resolvedAiWorkCapabilities?.plugins?.write ?? false),
      aiworkServerHostInfo: state.aiworkServerHostInfo,
      aiworkServerDiagnostics: state.aiworkServerDiagnostics,
      aiworkReconnectBusy: state.aiworkReconnectBusy,
      aiworkAuditEntries: state.aiworkAuditEntries,
      aiworkAuditStatus: state.aiworkAuditStatus,
      aiworkAuditError: state.aiworkAuditError,
      devtoolsWorkspaceId: state.devtoolsWorkspaceId,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const setAiWorkServerSettings = (next: SetStateAction<AiWorkServerSettings>) => {
    const resolved = applyStateAction(state.aiworkServerSettings, next);
    mutateState((current) => ({ ...current, aiworkServerSettings: resolved }));
    queueHealthCheck(0);
  };

  const updateAiWorkServerSettings = (next: AiWorkServerSettings) => {
    const stored = writeAiWorkServerSettings(next);
    mutateState((current) => ({ ...current, aiworkServerSettings: stored }));
    queueHealthCheck(0);
  };

  const resetAiWorkServerSettings = () => {
    clearAiWorkServerSettings();
    mutateState((current) => ({ ...current, aiworkServerSettings: {} }));
    queueHealthCheck(0);
  };

  const shouldWaitForLocalHostInfo = () =>
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    !state.aiworkServerHostInfoReady;

  const shouldRetryStartupCheck = (status: AiWorkServerStatus) =>
    status !== "connected" &&
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    Date.now() - bootStartedAt < 5_000;

  const checkAiWorkServer = async (url: string, token?: string, hostToken?: string) => {
    const client = createAiWorkServerClient({ baseUrl: url, token, hostToken });
    try {
      await client.health();
    } catch (error) {
      const resolved = error as AiWorkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as AiWorkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as AiWorkServerStatus, capabilities: null };
    }

    if (!token) {
      return { status: "limited" as AiWorkServerStatus, capabilities: null };
    }

    try {
      const capabilities = await client.capabilities();
      return { status: "connected" as AiWorkServerStatus, capabilities };
    } catch (error) {
      const resolved = error as AiWorkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as AiWorkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as AiWorkServerStatus, capabilities: null };
    }
  };

  const clearHealthTimeout = () => {
    if (healthTimeoutId !== null) {
      window.clearTimeout(healthTimeoutId);
      healthTimeoutId = null;
    }
  };

  const queueHealthCheck = (delayMs: number) => {
    if (disposed || typeof window === "undefined") return;
    clearHealthTimeout();
    healthTimeoutId = window.setTimeout(() => {
      healthTimeoutId = null;
      void runHealthCheck();
    }, Math.max(0, delayMs));
  };

  const runHealthCheck = async () => {
    if (disposed || typeof window === "undefined") return;
    if (!options.documentVisible()) return;
    if (shouldWaitForLocalHostInfo()) return;
    if (healthBusy) return;

    const url = getBaseUrl().trim();
    const auth = getAuth();
    if (!url) {
      mutateState((current) => ({
        ...current,
        aiworkServerStatus: "disconnected",
        aiworkServerCapabilities: null,
        aiworkServerCheckedAt: Date.now(),
      }));
      return;
    }

    healthBusy = true;
    try {
      let result = await checkAiWorkServer(url, auth.token, auth.hostToken);

      if (shouldRetryStartupCheck(result.status)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        if (disposed) return;

        try {
          const info = await aiworkServerInfo();
          if (disposed) return;

          mutateState((current) => ({
            ...current,
            aiworkServerHostInfo: info,
            aiworkServerHostInfoReady: true,
          }));

          const retryUrl = info.baseUrl?.trim() ?? "";
          const retryToken = info.clientToken?.trim() || undefined;
          const retryHostToken = info.hostToken?.trim() || undefined;
          if (retryUrl) {
            result = await checkAiWorkServer(retryUrl, retryToken, retryHostToken);
          }
        } catch {
          // Preserve the original check result when the retry probe fails.
        }
      }

      if (disposed) return;
      healthDelayMs =
        result.status === "connected" || result.status === "limited"
          ? 10_000
          : Math.min(healthDelayMs * 2, 60_000);

      mutateState((current) => ({
        ...current,
        aiworkServerStatus: result.status,
        aiworkServerCapabilities: result.capabilities,
        aiworkServerCheckedAt: Date.now(),
      }));
    } catch {
      healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      mutateState((current) => ({
        ...current,
        aiworkServerCheckedAt: Date.now(),
      }));
    } finally {
      healthBusy = false;
      if (!disposed) queueHealthCheck(healthDelayMs);
    }
  };

  const syncFromOptions = () => {
    refreshSnapshot();
    emitChange();

    if (!isDesktopRuntime()) return;
    const port = state.aiworkServerHostInfo?.port;
    if (!port) return;
    if (state.aiworkServerSettings.portOverride === port) return;

    updateAiWorkServerSettings({
      ...state.aiworkServerSettings,
      portOverride: port,
    });
  };

  const startInterval = (key: string, fn: () => void, ms: number) => {
    if (typeof window === "undefined") return;
    if (intervals.has(key)) return;
    intervals.set(key, window.setInterval(fn, ms));
  };

  const stopInterval = (key: string) => {
    const id = intervals.get(key);
    if (id === undefined) return;
    window.clearInterval(id);
    intervals.delete(key);
  };

  const start = () => {
    if (typeof window === "undefined") return;
    if (started) return;
    // Allow restart after a prior dispose() (React 18 StrictMode double-mounts
    // each effect in dev: mount → dispose → re-mount). If we early-return when
    // `disposed` is true, the real mount never arms polling and the UI stays
    // on stale/empty state forever.
    disposed = false;
    started = true;

    syncFromOptions();
    queueHealthCheck(0);

    const refreshHostInfo = () => {
      if (!isDesktopRuntime()) return;
      if (!options.documentVisible()) return;
      void (async () => {
        try {
          const info = await aiworkServerInfo();
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            aiworkServerHostInfo: info,
            aiworkServerHostInfoReady: true,
          }));
        } catch {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            aiworkServerHostInfo: null,
            aiworkServerHostInfoReady: true,
          }));
        }
      })();
    };
    refreshHostInfo();
    startInterval("hostInfo", refreshHostInfo, 10_000);

    const refreshDiagnostics = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("aiworkServerDiagnostics", null);
        return;
      }

      const client = getClient();
      if (!client || state.aiworkServerStatus === "disconnected") {
        setStateField("aiworkServerDiagnostics", null);
        return;
      }

      void (async () => {
        try {
          const status = await client.status();
          if (!disposed) setStateField("aiworkServerDiagnostics", status);
        } catch {
          if (!disposed) setStateField("aiworkServerDiagnostics", null);
        }
      })();
    };
    refreshDiagnostics();
    startInterval("diagnostics", refreshDiagnostics, 10_000);

    const refreshDevtoolsWorkspace = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      const client = getClient();
      if (!client) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      void (async () => {
        try {
          const response = await client.listWorkspaces();
          if (disposed) return;
          const items = Array.isArray(response.items) ? response.items : [];
          const activeMatch = response.activeId
            ? items.find((item) => item.id === response.activeId)
            : null;
          setStateField("devtoolsWorkspaceId", activeMatch?.id ?? items[0]?.id ?? null);
        } catch {
          if (!disposed) setStateField("devtoolsWorkspaceId", null);
        }
      })();
    };
    refreshDevtoolsWorkspace();
    startInterval("devtoolsWorkspace", refreshDevtoolsWorkspace, 20_000);

    const refreshAudit = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        mutateState((current) => ({
          ...current,
          aiworkAuditEntries: [],
          aiworkAuditStatus: "idle",
          aiworkAuditError: null,
        }));
        return;
      }

      const client = getClient();
      const workspaceId = state.devtoolsWorkspaceId;
      if (!client || !workspaceId) {
        mutateState((current) => ({
          ...current,
          aiworkAuditEntries: [],
          aiworkAuditStatus: "idle",
          aiworkAuditError: null,
        }));
        return;
      }

      mutateState((current) => ({
        ...current,
        aiworkAuditStatus: "loading",
        aiworkAuditError: null,
      }));

      void (async () => {
        try {
          const result = await client.listAudit(workspaceId, 50);
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            aiworkAuditEntries: Array.isArray(result.items) ? result.items : [],
            aiworkAuditStatus: "idle",
          }));
        } catch (error) {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            aiworkAuditEntries: [],
            aiworkAuditStatus: "error",
            aiworkAuditError:
              error instanceof Error
                ? error.message
                : t("app.error_audit_load"),
          }));
        }
      })();
    };
    refreshAudit();
    startInterval("audit", refreshAudit, 15_000);
  };

  const dispose = () => {
    disposed = true;
    started = false;
    clearHealthTimeout();
    for (const key of [...intervals.keys()]) stopInterval(key);
  };

  const testAiWorkServerConnection = async (next: AiWorkServerSettings) => {
    const derived = normalizeAiWorkServerUrl(next.urlOverride ?? "");
    if (!derived) {
      mutateState((current) => ({
        ...current,
        aiworkServerStatus: "disconnected",
        aiworkServerCapabilities: null,
        aiworkServerCheckedAt: Date.now(),
      }));
      return false;
    }

    const result = await checkAiWorkServer(derived, next.token);
    mutateState((current) => ({
      ...current,
      aiworkServerStatus: result.status,
      aiworkServerCapabilities: result.capabilities,
      aiworkServerCheckedAt: Date.now(),
    }));

    const ok = result.status === "connected" || result.status === "limited";
    return ok;
  };

  const reconnectAiWorkServer = async () => {
    if (state.aiworkReconnectBusy) return false;
    setStateField("aiworkReconnectBusy", true);

    try {
      let hostInfo = state.aiworkServerHostInfo;
      if (isDesktopRuntime()) {
        try {
          hostInfo = await aiworkServerInfo();
          mutateState((current) => ({ ...current, aiworkServerHostInfo: hostInfo }));
        } catch {
          hostInfo = null;
          setStateField("aiworkServerHostInfo", null);
        }
      }

      if (hostInfo?.clientToken?.trim() && options.startupPreference() !== "server") {
        const liveToken = hostInfo.clientToken.trim();
        const settings = state.aiworkServerSettings;
        if ((settings.token?.trim() ?? "") !== liveToken) {
          updateAiWorkServerSettings({ ...settings, token: liveToken });
        }
      }

      const url = getBaseUrl().trim();
      const auth = getAuth();
      if (!url) {
        mutateState((current) => ({
          ...current,
          aiworkServerStatus: "disconnected",
          aiworkServerCapabilities: null,
          aiworkServerCheckedAt: Date.now(),
        }));
        return false;
      }

      const result = await checkAiWorkServer(url, auth.token, auth.hostToken);
      mutateState((current) => ({
        ...current,
        aiworkServerStatus: result.status,
        aiworkServerCapabilities: result.capabilities,
        aiworkServerCheckedAt: Date.now(),
      }));
      return result.status === "connected" || result.status === "limited";
    } finally {
      setStateField("aiworkReconnectBusy", false);
    }
  };

  async function ensureLocalAiWorkServerClient(): Promise<AiWorkServerClient | null> {
    let hostInfo = state.aiworkServerHostInfo;
    if (hostInfo?.baseUrl?.trim() && hostInfo.clientToken?.trim()) {
      const existing = createAiWorkServerClient({
        baseUrl: hostInfo.baseUrl.trim(),
        token: hostInfo.clientToken.trim(),
        hostToken: hostInfo.hostToken?.trim() || undefined,
      });
      try {
        await existing.health();
        if (options.startupPreference() !== "server") {
          await reconnectAiWorkServer();
        }
        return existing;
      } catch {
        // Fall through to a local restart.
      }
    }

    if (!isDesktopRuntime()) return null;

    try {
      hostInfo = await aiworkServerRestart();
      mutateState((current) => ({ ...current, aiworkServerHostInfo: hostInfo }));
    } catch {
      return null;
    }

    const baseUrl = hostInfo?.baseUrl?.trim() ?? "";
    const token = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";
    if (!baseUrl || !token) return null;

    if (options.startupPreference() !== "server") {
      await reconnectAiWorkServer();
    }

    return createAiWorkServerClient({
      baseUrl,
      token,
      hostToken: hostToken || undefined,
    });
  }

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    setAiWorkServerSettings,
    updateAiWorkServerSettings,
    resetAiWorkServerSettings,
    checkAiWorkServer,
    testAiWorkServerConnection,
    reconnectAiWorkServer,
    ensureLocalAiWorkServerClient,
  };
}

export function useAiWorkServerStoreSnapshot(store: AiWorkServerStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
