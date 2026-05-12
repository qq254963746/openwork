/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appBuildInfo as appBuildInfoCmd,
  engineInfo as engineInfoCmd,
  engineStart as engineStartCmd,
  nukeAiWorkAndOpencodeConfigAndExit,
  openDesktopUrl,
  aiworkServerInfo as aiworkServerInfoCmd,
  aiworkServerRestart as aiworkServerRestartCmd,
  pickFile,
  revealDesktopItemInDir,
  resetAiWorkState,
  desktopAppPaths as desktopAppPathsCmd,
  workspaceBootstrap as workspaceBootstrapCmd,
  type AppBuildInfo,
  type EngineInfo,
  type AiWorkServerInfo,
} from "../../../../app/lib/desktop";
import {
  ELECTRON_ALPHA_RELEASE_PAGE_URL,
  resolveElectronAlphaArtifact,
  type ElectronAlphaArtifact,
} from "../../../../app/lib/electron-alpha";
import {
  writeAiWorkServerSettings,
} from "../../../../app/lib/aiwork-server";
import {
  clearStartupPreference,
  safeStringify,
} from "../../../../app/utils";
import { t } from "../../../../i18n";
import type { DebugViewProps } from "../pages/debug-view";
import type { AiWorkServerStore, AiWorkServerStoreSnapshot } from "../../connections/aiwork-server-store";

const ENGINE_SOURCE_KEY = "aiwork.engineSource";
const ENGINE_CUSTOM_BIN_KEY = "aiwork.engineCustomBinPath";

type ResetModalMode = "onboarding" | "all";

type UseDebugViewModelOptions = {
  developerMode: boolean;
  aiworkServerStore: AiWorkServerStore;
  aiworkServerSnapshot: AiWorkServerStoreSnapshot;
  runtimeWorkspaceId: string | null;
  selectedWorkspaceRoot: string;
  setRouteError: (value: string | null) => void;
};

function readStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredString(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore persistence failures
  }
}

function clearStoredString(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore persistence failures
  }
}

function downloadTextAsFile(filename: string, content: string, mimeType: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readEngineSource(): "path" | "sidecar" | "custom" {
  const raw = readStoredString(ENGINE_SOURCE_KEY, "sidecar");
  return raw === "path" || raw === "sidecar" || raw === "custom" ? raw : "sidecar";
}

function readOpencodeEnableExa(): boolean {
  return readStoredString(OPENCODE_ENABLE_EXA_KEY, "0") === "1";
}

function statusPill(
  running: boolean,
  connectedLabel?: string,
  disconnectedLabel?: string,
): { label: string; className: string } {
  return running
    ? {
        label: connectedLabel ?? t("status.connected"),
        className: "border-green-7/30 bg-green-7/10 text-green-11",
      }
    : {
        label: disconnectedLabel ?? t("status.disconnected_label"),
        className: "border-gray-7/30 bg-gray-4/50 text-gray-11",
      };
}

function auditStatusPill(status: "idle" | "loading" | "error"): {
  label: string;
  className: string;
} {
  if (status === "loading") {
    return {
      label: t("settings.loading"),
      className: "border-blue-7/30 bg-blue-7/10 text-blue-11",
    };
  }
  if (status === "error") {
    return {
      label: t("settings.error"),
      className: "border-red-7/30 bg-red-7/10 text-red-11",
    };
  }
  return {
    label: t("settings.idle"),
    className: "border-gray-7/30 bg-gray-4/50 text-gray-11",
  };
}

function describeEngine(info: EngineInfo | null) {
  const running = Boolean(info?.running);
  return {
    ...statusPill(running),
    lines: [
      t("settings.debug_base_url", { url: info?.baseUrl ?? "—" }),
      t("settings.debug_runtime", { runtime: info?.runtime ?? "—" }),
      t("settings.diag_opencode_binary", { binary: formatOpencodeBinary(info) }),
      t("settings.debug_pid", { pid: info?.pid ? String(info.pid) : "—" }),
      t("settings.debug_hostname", { hostname: info?.hostname ?? "—" }),
      t("settings.debug_port", { port: info?.port ? String(info.port) : "—" }),
    ],
    stdout: info?.lastStdout ?? null,
    stderr: info?.lastStderr ?? null,
    error: null as string | null,
  };
}

function formatOpencodeBinary(info: EngineInfo | null) {
  return formatBinaryWithSource(info?.opencodeBinPath, info?.opencodeBinSource);
}

function formatManagedOpencodeBinary(info: AiWorkServerInfo | null) {
  return formatBinaryWithSource(
    info?.managedOpencodeBinPath,
    info?.managedOpencodeBinSource,
  );
}

function formatBinaryWithSource(path: string | null | undefined, source: string | null | undefined) {
  const binary = path?.trim();
  if (!binary) return "—";
  const sourceLabel = source?.trim();
  return sourceLabel ? `${binary} (${sourceLabel})` : binary;
}

function describeAiWorkServer(info: AiWorkServerInfo | null) {
  const running = Boolean(info?.running);
  return {
    ...statusPill(running),
    lines: [
      t("settings.debug_base_url", { url: info?.baseUrl ?? "—" }),
      t("settings.diag_opencode_binary", { binary: formatManagedOpencodeBinary(info) }),
      t("settings.debug_connect_url", { url: info?.connectUrl ?? "—" }),
      t("settings.debug_lan_url", { url: info?.lanUrl ?? "—" }),
      t("settings.debug_mdns_url", { url: info?.mdnsUrl ?? "—" }),
      t("settings.debug_pid", { pid: info?.pid ? String(info.pid) : "—" }),
    ],
    stdout: info?.lastStdout ?? null,
    stderr: info?.lastStderr ?? null,
    error: null as string | null,
  };
}

function describeOpencodeConnect(engine: EngineInfo | null) {
  const running = Boolean(engine?.baseUrl);
  return {
    ...statusPill(running),
    lines: [
      t("settings.debug_base_url", { url: engine?.baseUrl ?? "—" }),
      t("settings.debug_project_dir", { path: engine?.projectDir ?? "—" }),
      t("settings.debug_runtime", { runtime: engine?.runtime ?? "—" }),
    ],
    metricsLines: [] as string[],
    error: null as string | null,
  };
}

export function useDebugViewModel(options: UseDebugViewModelOptions) {
  const {
    developerMode,
    aiworkServerStore,
    aiworkServerSnapshot,
    runtimeWorkspaceId,
    selectedWorkspaceRoot,
    setRouteError,
  } = options;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [engineInfoState, setEngineInfoState] = useState<EngineInfo | null>(null);
  const [appBuild, setAppBuild] = useState<AppBuildInfo | null>(null);
  const [runtimeDebugStatus, setRuntimeDebugStatus] = useState<string | null>(null);
  const [opencodeRestarting, setOpencodeRestarting] = useState(false);
  const [aiworkServerRestarting, setAiWorkServerRestarting] = useState(false);
  const [opencodeServiceStatus, setOpencodeServiceStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [aiworkServiceStatus, setAiWorkServiceStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [opencodeLogStatus, setOpencodeLogStatus] = useState<string | null>(null);
  const [aiworkLogStatus, setAiWorkLogStatus] = useState<string | null>(null);
  const [serviceRestartError, setServiceRestartError] = useState<string | null>(null);
  const [resetModalBusy, setResetModalBusy] = useState(false);
  const [nukeConfigBusy, setNukeConfigBusy] = useState(false);
  const [nukeConfigStatus, setNukeConfigStatus] = useState<string | null>(null);
  const [engineSource, setEngineSourceState] = useState<"path" | "sidecar" | "custom">(readEngineSource);
  const [engineCustomBinPath, setEngineCustomBinPath] = useState<string>(() =>
    readStoredString(ENGINE_CUSTOM_BIN_KEY, ""),
  );
  const [developerLog, setDeveloperLog] = useState<string[]>([]);
  const [developerLogStatus, setDeveloperLogStatus] = useState<string | null>(null);
  const refreshEngineInfo = useCallback(async () => {
    try {
      const info = await engineInfoCmd();
      setEngineInfoState(info);
    } catch {
      setEngineInfoState(null);
    }
  }, []);

  useEffect(() => {
    if (!developerMode) return;
    void (async () => {
      try {
        const build = await appBuildInfoCmd();
        setAppBuild(build);
      } catch {
        setAppBuild(null);
      }
    })();
  }, [developerMode]);

  useEffect(() => {
    if (!developerMode) return;
    void refreshEngineInfo();
    const interval = window.setInterval(() => {
      void refreshEngineInfo();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [developerMode, refreshEngineInfo]);

  const pushDeveloperLog = useCallback((message: string) => {
    const timestamp = new Date().toISOString();
    setDeveloperLog((current) => {
      const next = [...current, `${timestamp} ${message}`];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const runtimeSummary = useMemo(
    () => ({
      appVersionLabel: appBuild?.version ?? "—",
      appCommitLabel: appBuild?.gitSha ?? "—",
      opencodeVersionLabel: engineInfoState?.baseUrl ? "managed" : "—",
      aiworkServerVersionLabel: aiworkServerSnapshot.aiworkServerDiagnostics?.version ?? "—",
    }),
    [
      appBuild?.gitSha,
      appBuild?.version,
      engineInfoState?.baseUrl,
      aiworkServerSnapshot.aiworkServerDiagnostics?.version,
    ],
  );

  const runtimeDebugReport = useMemo(() => {
    return {
      collectedAt: new Date().toISOString(),
      app: appBuild ?? null,
      engine: engineInfoState,
      aiworkServer: {
        hostInfo: aiworkServerSnapshot.aiworkServerHostInfo,
        diagnostics: aiworkServerSnapshot.aiworkServerDiagnostics,
        capabilities: aiworkServerSnapshot.aiworkServerCapabilities,
        settings: aiworkServerSnapshot.aiworkServerSettings,
        status: aiworkServerSnapshot.aiworkServerStatus,
        url: aiworkServerSnapshot.aiworkServerUrl,
      },
      runtimeWorkspaceId,
      selectedWorkspaceRoot,
    };
  }, [
    appBuild,
    engineInfoState,
    aiworkServerSnapshot.aiworkServerCapabilities,
    aiworkServerSnapshot.aiworkServerDiagnostics,
    aiworkServerSnapshot.aiworkServerHostInfo,
    aiworkServerSnapshot.aiworkServerSettings,
    aiworkServerSnapshot.aiworkServerStatus,
    aiworkServerSnapshot.aiworkServerUrl,
    runtimeWorkspaceId,
    selectedWorkspaceRoot,
  ]);

  const runtimeDebugReportJson = useMemo(
    () => safeStringify(runtimeDebugReport),
    [runtimeDebugReport],
  );

  const engineCard = useMemo(() => describeEngine(engineInfoState), [engineInfoState]);
  const aiworkCard = useMemo(
    () => describeAiWorkServer(aiworkServerSnapshot.aiworkServerHostInfo),
    [aiworkServerSnapshot.aiworkServerHostInfo],
  );
  const opencodeConnectCard = useMemo(
    () => describeOpencodeConnect(engineInfoState),
    [engineInfoState],
  );

  const onCopyRuntimeDebugReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(runtimeDebugReportJson);
      setRuntimeDebugStatus(t("settings.copied_debug_report"));
    } catch (error) {
      setRuntimeDebugStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [runtimeDebugReportJson]);

  const onExportRuntimeDebugReport = useCallback(async () => {
    try {
      downloadTextAsFile(
        `aiwork-runtime-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        runtimeDebugReportJson,
        "application/json",
      );
      setRuntimeDebugStatus(t("settings.exported_debug_report"));
    } catch (error) {
      setRuntimeDebugStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [runtimeDebugReportJson]);

  const onClearDeveloperLog = useCallback(() => {
    setDeveloperLog([]);
    setDeveloperLogStatus("Cleared developer log.");
  }, []);

  const onCopyDeveloperLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(developerLog.join("\n"));
      setDeveloperLogStatus("Copied developer log to clipboard.");
    } catch (error) {
      setDeveloperLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [developerLog]);

  const onExportDeveloperLog = useCallback(async () => {
    try {
      downloadTextAsFile(
        `aiwork-developer-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
        developerLog.join("\n"),
        "text/plain",
      );
      setDeveloperLogStatus("Exported developer log.");
    } catch (error) {
      setDeveloperLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [developerLog]);

  const [startupStatus, setStartupStatus] = useState<string | null>(null);

  const onStopHost = useCallback(async () => {
    clearStartupPreference();
    setStartupStatus(t("settings.startup_reset_hint"));
  }, []);

  const onResetStartupPreference = useCallback(async () => {
    clearStartupPreference();
    setStartupStatus(t("settings.startup_reset_hint"));
  }, []);

  const onSetEngineSource = useCallback((value: "path" | "sidecar" | "custom") => {
    setEngineSourceState(value);
    writeStoredString(ENGINE_SOURCE_KEY, value);
  }, []);

  const onPickEngineBinary = useCallback(async () => {
    try {
      const target = await pickFile({ title: t("settings.custom_binary_label"), multiple: false });
      if (typeof target === "string" && target.trim()) {
        setEngineCustomBinPath(target);
        writeStoredString(ENGINE_CUSTOM_BIN_KEY, target);
      }
    } catch (error) {
      setServiceRestartError(error instanceof Error ? error.message : safeStringify(error));
    }
  }, []);

  const onClearEngineCustomBinPath = useCallback(() => {
    setEngineCustomBinPath("");
    clearStoredString(ENGINE_CUSTOM_BIN_KEY);
  }, []);

  const bootFullEngineStack = useCallback(async () => {
    const workspacePath = optionsRef.current.selectedWorkspaceRoot.trim();
    if (!workspacePath) {
      throw new Error(
        "Select a local workspace before starting the local server/engine.",
      );
    }

    // Collect ALL local workspace paths so aiwork-server is started with
    // --workspace <path> for every registered local workspace. Mirrors the
    // Solid reference (context/workspace.ts::resolveWorkspacePaths) so that
    // `client.listWorkspaces()` later returns the full set, not just the
    // active one.
    const workspacePaths = [workspacePath];
    try {
      const list = await workspaceBootstrapCmd();
      for (const entry of list?.workspaces ?? []) {
        const path = entry.path?.trim() ?? "";
        if (path && !workspacePaths.includes(path)) workspacePaths.push(path);
      }
    } catch {
      // best-effort: fall back to just the active workspace path
    }

    const info = await engineStartCmd(workspacePath, {
      runtime: "direct",
      workspacePaths
    });

    // engine_start restarts aiwork-server on a NEW port and lets that server
    // manage OpenCode. Re-read host info and persist the fresh URL/token.
    try {
      const hostInfo = await aiworkServerInfoCmd();
      if (hostInfo?.baseUrl) {
        writeAiWorkServerSettings({
          urlOverride: hostInfo.baseUrl,
          token: hostInfo.ownerToken?.trim() || hostInfo.clientToken?.trim() || undefined,
          hostToken: hostInfo.hostToken?.trim() || undefined,
          portOverride: hostInfo.port ?? undefined,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("aiwork-server-settings-changed"));
        }
      }
    } catch {
      // best-effort: if this fails, the host-info poller will catch up in ~10s.
    }

    await aiworkServerStore.reconnectAiWorkServer();
    await refreshEngineInfo();
    return info;
  }, [aiworkServerStore, refreshEngineInfo]);

  const onRestartOpencode = useCallback(async () => {
    setOpencodeRestarting(true);
    setOpencodeServiceStatus(null);
    setServiceRestartError(null);
    try {
      await bootFullEngineStack();
      setOpencodeServiceStatus({
        tone: "success",
        message: t("settings.restart_succeeded_template", { service: "OpenCode" }),
      });
      pushDeveloperLog("Restarted OpenCode via engine_start");
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setOpencodeServiceStatus({
        tone: "error",
        message: `${t("settings.restart_failed_template", { service: "OpenCode" })} ${message}`,
      });
      setServiceRestartError(message);
    } finally {
      setOpencodeRestarting(false);
    }
  }, [bootFullEngineStack, pushDeveloperLog]);

  const onRestartAiWorkServer = useCallback(async () => {
    setAiWorkServerRestarting(true);
    setAiWorkServiceStatus(null);
    setServiceRestartError(null);
    try {
      await aiworkServerRestartCmd();
      setAiWorkServiceStatus({
        tone: "success",
        message: t("settings.restart_succeeded_template", { service: "AiWork server" }),
      });
      pushDeveloperLog("Restarted aiwork-server");
      await aiworkServerStore.reconnectAiWorkServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAiWorkServiceStatus({
        tone: "error",
        message: `${t("settings.restart_failed_template", { service: "AiWork server" })} ${message}`,
      });
      setServiceRestartError(message);
    } finally {
      setAiWorkServerRestarting(false);
    }
  }, [aiworkServerStore, pushDeveloperLog]);

  const formatServiceLogs = useCallback(
    (stdout: string | null | undefined, stderr: string | null | undefined): string => {
      const out = (stdout ?? "").toString().trim();
      const err = (stderr ?? "").toString().trim();
      const sections: string[] = [];
      if (out) sections.push(`# stdout\n${out}`);
      if (err) sections.push(`# stderr\n${err}`);
      return sections.join("\n\n");
    },
    [],
  );

  const onCopyOpencodeLogs = useCallback(async () => {
    const text = formatServiceLogs(engineInfoState?.lastStdout, engineInfoState?.lastStderr);
    if (!text) {
      setOpencodeLogStatus(t("settings.no_logs_captured"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setOpencodeLogStatus(t("settings.copied_service_logs", { service: "OpenCode" }));
    } catch (error) {
      setOpencodeLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [engineInfoState?.lastStderr, engineInfoState?.lastStdout, formatServiceLogs]);

  const onExportOpencodeLogs = useCallback(async () => {
    const text = formatServiceLogs(engineInfoState?.lastStdout, engineInfoState?.lastStderr);
    if (!text) {
      setOpencodeLogStatus(t("settings.no_logs_captured"));
      return;
    }
    try {
      downloadTextAsFile(
        `aiwork-opencode-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
        text,
        "text/plain",
      );
      setOpencodeLogStatus(t("settings.exported_developer_log"));
    } catch (error) {
      setOpencodeLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [engineInfoState?.lastStderr, engineInfoState?.lastStdout, formatServiceLogs]);

  const onCopyAiWorkLogs = useCallback(async () => {
    const info = aiworkServerSnapshot.aiworkServerHostInfo;
    const text = formatServiceLogs(info?.lastStdout, info?.lastStderr);
    if (!text) {
      setAiWorkLogStatus(t("settings.no_logs_captured"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setAiWorkLogStatus(t("settings.copied_service_logs", { service: "AiWork server" }));
    } catch (error) {
      setAiWorkLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [formatServiceLogs, aiworkServerSnapshot.aiworkServerHostInfo]);

  const onExportAiWorkLogs = useCallback(async () => {
    const info = aiworkServerSnapshot.aiworkServerHostInfo;
    const text = formatServiceLogs(info?.lastStdout, info?.lastStderr);
    if (!text) {
      setAiWorkLogStatus(t("settings.no_logs_captured"));
      return;
    }
    try {
      downloadTextAsFile(
        `aiwork-server-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
        text,
        "text/plain",
      );
      setAiWorkLogStatus(t("settings.exported_developer_log"));
    } catch (error) {
      setAiWorkLogStatus(error instanceof Error ? error.message : safeStringify(error));
    }
  }, [formatServiceLogs, aiworkServerSnapshot.aiworkServerHostInfo]);

  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const onOpenResetModal = useCallback(
    (mode: ResetModalMode) => {
      const message =
        mode === "all"
          ? "Reset ALL AiWork app data? Open sessions and workspaces will be removed."
          : "Reset onboarding state only?";
      if (typeof window !== "undefined" && !window.confirm(message)) {
        return;
      }
      setResetModalBusy(true);
      setResetStatus(null);
      void resetAiWorkState(mode)
        .then(() => {
          setResetStatus(
            mode === "all"
              ? "Reset AiWork state. Restart the app to see changes."
              : "Reset onboarding state.",
          );
          pushDeveloperLog(`reset_aiwork_state mode=${mode}`);
        })
        .catch((error) => {
          setRouteError(error instanceof Error ? error.message : safeStringify(error));
        })
        .finally(() => {
          setResetModalBusy(false);
        });
    },
    [pushDeveloperLog, setRouteError],
  );

  const onNukeAiWorkAndOpencodeConfig = useCallback(async () => {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            "Delete ALL local AiWork + OpenCode config and quit? This cannot be undone.",
          );
    if (!confirmed) return;
    setNukeConfigBusy(true);
    setNukeConfigStatus(null);
    try {
      await nukeAiWorkAndOpencodeConfigAndExit();
    } catch (error) {
      setNukeConfigStatus(error instanceof Error ? error.message : safeStringify(error));
    } finally {
      setNukeConfigBusy(false);
    }
  }, []);

  const [workspaceDebugEventsStatus, setWorkspaceDebugEventsStatus] = useState<string | null>(null);
  const onClearWorkspaceDebugEvents = useCallback(async () => {
    setWorkspaceDebugEventsStatus("Workspace debug events are not retained in the React route yet.");
  }, []);

  const debugProps: DebugViewProps = useMemo(
    () => ({
      developerMode,
      busy: false,
      anyActiveRuns: false,
      startupPreference: "server",
      startupLabel:
        aiworkServerSnapshot.aiworkServerStatus === "connected"
          ? t("settings.aiwork_server_label")
          : t("status.disconnected_label"),
      runtimeSummary,
      runtimeDebugReportJson,
      runtimeDebugStatus,
      onCopyRuntimeDebugReport,
      onExportRuntimeDebugReport,
      developerLogRecordCount: developerLog.length,
      developerLogText: developerLog.join("\n"),
      developerLogStatus,
      onClearDeveloperLog,
      onCopyDeveloperLog,
      onExportDeveloperLog,
      electronPreviewReleaseUrl: ELECTRON_ALPHA_RELEASE_PAGE_URL,
      onStopHost,
      onResetStartupPreference,
      engineSource,
      onSetEngineSource,
      engineCustomBinPath,
      engineCustomBinPathLabel: engineCustomBinPath.trim() || t("settings.no_custom_path_set"),
      onPickEngineBinary,
      onClearEngineCustomBinPath,
      onOpenResetModal,
      resetModalBusy,
      resetStatus,
      startupStatus,
      workspaceDebugEventsStatus,
      opencodeRestarting,
      aiworkServerRestarting,
      opencodeServiceStatus,
      aiworkServiceStatus,
      opencodeLogStatus,
      aiworkLogStatus,
      onCopyOpencodeLogs,
      onExportOpencodeLogs,
      onCopyAiWorkLogs,
      onExportAiWorkLogs,
      serviceRestartError,
      onRestartOpencode,
      onRestartAiWorkServer,
      engineCard,
      opencodeConnectCard,
      aiworkCard,
      aiworkServerDiagnostics: aiworkServerSnapshot.aiworkServerDiagnostics,
      runtimeWorkspaceId,
      aiworkServerCapabilities: aiworkServerSnapshot.aiworkServerCapabilities,
      pendingPermissions: {},
      events: [],
      workspaceDebugEvents: [],
      safeStringify,
      onClearWorkspaceDebugEvents,
      aiworkAuditEntries: aiworkServerSnapshot.aiworkAuditEntries,
      aiworkAuditStatus: auditStatusPill(aiworkServerSnapshot.aiworkAuditStatus),
      aiworkAuditError: aiworkServerSnapshot.aiworkAuditError,
      opencodeConnectStatus: null,
      opencodeDevModeEnabled: appBuild?.aiworkDevMode === true,
      nukeConfigBusy,
      nukeConfigStatus,
      onNukeAiWorkAndOpencodeConfig,
    }),
    [
      appBuild?.aiworkDevMode,
      developerLog,
      developerLogStatus,
      developerMode,
      engineCard,
      engineCustomBinPath,
      engineSource,
      nukeConfigBusy,
      nukeConfigStatus,
      onClearDeveloperLog,
      onClearEngineCustomBinPath,
      onClearWorkspaceDebugEvents,
      onCopyDeveloperLog,
      onCopyRuntimeDebugReport,
      onExportDeveloperLog,
      onExportRuntimeDebugReport,
      onNukeAiWorkAndOpencodeConfig,
      onOpenResetModal,
      onPickEngineBinary,
      onResetStartupPreference,
      onRestartOpencode,
      onRestartAiWorkServer,
      onSetEngineSource,
      onStopHost,
      onCopyOpencodeLogs,
      onCopyAiWorkLogs,
      onExportOpencodeLogs,
      onExportAiWorkLogs,
      opencodeConnectCard,
      opencodeLogStatus,
      opencodeRestarting,
      opencodeServiceStatus,
      aiworkCard,
      aiworkLogStatus,
      aiworkServiceStatus,
      aiworkServerRestarting,
      resetStatus,
      startupStatus,
      workspaceDebugEventsStatus,
      aiworkServerSnapshot.aiworkAuditEntries,
      aiworkServerSnapshot.aiworkAuditError,
      aiworkServerSnapshot.aiworkAuditStatus,
      aiworkServerSnapshot.aiworkServerCapabilities,
      aiworkServerSnapshot.aiworkServerDiagnostics,
      aiworkServerSnapshot.aiworkServerStatus,
      resetModalBusy,
      runtimeDebugReportJson,
      runtimeDebugStatus,
      runtimeSummary,
      runtimeWorkspaceId,
      serviceRestartError,
    ],
  );

  return debugProps;
}
