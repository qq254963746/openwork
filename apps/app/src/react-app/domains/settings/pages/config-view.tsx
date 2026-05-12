/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";

import { readDevLogs } from "../../../../app/lib/dev-log";
import { readPerfLogs } from "../../../../app/lib/perf-log";
import {
  type AiWorkServerSettings,
  type AiWorkServerStatus,
} from "../../../../app/lib/aiwork-server";
import type { AiWorkServerInfo } from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import { Button } from "../../../design-system/button";

export type ConfigViewProps = {
  busy: boolean;
  clientConnected: boolean;
  anyActiveRuns: boolean;

  aiworkServerStatus: AiWorkServerStatus;
  aiworkServerUrl: string;
  aiworkServerSettings: AiWorkServerSettings;
  aiworkServerHostInfo: AiWorkServerInfo | null;
  runtimeWorkspaceId: string | null;

  updateAiWorkServerSettings: (next: AiWorkServerSettings) => void;
  resetAiWorkServerSettings: () => void;
  testAiWorkServerConnection: (
    next: AiWorkServerSettings,
  ) => Promise<boolean>;

  canReloadWorkspace: boolean;
  reloadWorkspaceEngine: () => Promise<void>;
  reloadBusy: boolean;
  reloadError: string | null;

  developerMode: boolean;
};

type AiWorkTestState = "idle" | "testing" | "success" | "error";

export function ConfigView(props: ConfigViewProps) {
  const [aiworkUrl, setAiWorkUrl] = useState("");
  const [aiworkToken, setAiWorkToken] = useState("");
  const [aiworkTestState, setAiWorkTestState] =
    useState<AiWorkTestState>("idle");
  const [copyingField, setCopyingField] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setAiWorkUrl(props.aiworkServerSettings.urlOverride ?? "");
    setAiWorkToken(props.aiworkServerSettings.token ?? "");
  }, [props.aiworkServerSettings]);

  useEffect(() => {
    setAiWorkTestState("idle");
  }, [aiworkUrl, aiworkToken]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const reloadAvailabilityReason = (() => {
    if (!props.clientConnected) return t("config.reload_connect_hint");
    if (!props.canReloadWorkspace) return t("config.reload_availability_hint");
    return null;
  })();

  const reloadButtonLabel = props.reloadBusy
    ? t("config.reloading")
    : t("config.reload_engine");
  const reloadButtonTone: "danger" | "secondary" = props.anyActiveRuns
    ? "danger"
    : "secondary";
  const reloadButtonDisabled =
    props.reloadBusy || Boolean(reloadAvailabilityReason);

  const hostInfo = props.aiworkServerHostInfo;

  const hostConnectUrl =
    hostInfo?.connectUrl ??
    hostInfo?.mdnsUrl ??
    hostInfo?.lanUrl ??
    hostInfo?.baseUrl ??
    "";
  const hostConnectUrlUsesMdns = hostConnectUrl.includes(".local");

  const diagnosticsBundleJson = useMemo(() => {
    const urlOverride = props.aiworkServerSettings.urlOverride?.trim() ?? "";
    const token = props.aiworkServerSettings.token?.trim() ?? "";
    const developerLogs = props.developerMode ? readDevLogs(80) : [];
    const perfLogs = props.developerMode ? readPerfLogs(80) : [];
    const bundle = {
      capturedAt: new Date().toISOString(),
      runtime: {
        tauri: true,
        developerMode: props.developerMode,
      },
      workspace: {
        runtimeWorkspaceId: props.runtimeWorkspaceId ?? null,
        clientConnected: props.clientConnected,
        anyActiveRuns: props.anyActiveRuns,
      },
      aiworkServer: {
        status: props.aiworkServerStatus,
        url: props.aiworkServerUrl,
        settings: {
          urlOverride: urlOverride || null,
          tokenPresent: Boolean(token),
        },
        host: hostInfo
          ? {
              running: Boolean(hostInfo.running),
              baseUrl: hostInfo.baseUrl ?? null,
              connectUrl: hostInfo.connectUrl ?? null,
              mdnsUrl: hostInfo.mdnsUrl ?? null,
              lanUrl: hostInfo.lanUrl ?? null,
            }
          : null,
      },
      reload: {
        canReloadWorkspace: props.canReloadWorkspace,
      },
      sharing: {
        hostConnectUrl: hostConnectUrl || null,
        hostConnectUrlUsesMdns,
      },
      performance: {
        retainedEntries: perfLogs.length,
        recent: perfLogs,
      },
      developerLogs: {
        retainedEntries: developerLogs.length,
        recent: developerLogs,
      },
    };
    return JSON.stringify(bundle, null, 2);
  }, [
    hostConnectUrl,
    hostConnectUrlUsesMdns,
    hostInfo,
    props.anyActiveRuns,
    props.canReloadWorkspace,
    props.clientConnected,
    props.developerMode,
    props.aiworkServerSettings.token,
    props.aiworkServerSettings.urlOverride,
    props.aiworkServerStatus,
    props.aiworkServerUrl,
    props.runtimeWorkspaceId,
  ]);

  const handleCopy = async (value: string, field: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyingField(field);
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopyingField(null);
        copyTimeoutRef.current = undefined;
      }, 2000);
    } catch {
      // ignore
    }
  };

  return (
    <section className="space-y-6">
      <div className="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-5 space-y-2">
        <div className="text-sm font-medium text-gray-12">
          {t("config.workspace_config_title")}
        </div>
        <div className="text-xs text-gray-10">
          {t("config.workspace_config_desc")}
        </div>
        {props.runtimeWorkspaceId ? (
          <div className="text-[11px] text-gray-7 font-mono truncate">
            {t("config.workspace_id_prefix")}
            {props.runtimeWorkspaceId}
          </div>
        ) : null}
      </div>

      <div className="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-5 space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-12">
            {t("config.engine_reload_title")}
          </div>
          <div className="text-xs text-gray-10">
            {t("config.engine_reload_desc")}
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-1 p-3 rounded-xl border border-gray-6 gap-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm text-gray-12">
              {t("config.reload_now_title")}
            </div>
            <div className="text-xs text-gray-7">
              {t("config.reload_now_desc")}
            </div>
            {props.anyActiveRuns ? (
              <div className="text-[11px] text-amber-11">
                {t("config.reload_active_tasks_warning")}
              </div>
            ) : null}
            {props.reloadError ? (
              <div className="text-[11px] text-red-11">{props.reloadError}</div>
            ) : null}
            {reloadAvailabilityReason ? (
              <div className="text-[11px] text-gray-9">
                {reloadAvailabilityReason}
              </div>
            ) : null}
          </div>
          <Button
            variant={reloadButtonTone}
            className="text-xs h-8 py-0 px-3 shrink-0"
            onClick={props.reloadWorkspaceEngine}
            disabled={reloadButtonDisabled}
          >
            <RefreshCcw
              size={14}
              className={props.reloadBusy ? "animate-spin" : ""}
            />
            {reloadButtonLabel}
          </Button>
        </div>
      </div>

      {props.developerMode ? (
        <div className="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-5 space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-gray-12">
                {t("config.diagnostics_title")}
              </div>
              <div className="text-xs text-gray-10">
                {t("config.diagnostics_desc")}
              </div>
            </div>
            <Button
              variant="secondary"
              className="text-xs h-8 py-0 px-3 shrink-0"
              onClick={() =>
                void handleCopy(diagnosticsBundleJson, "debug-bundle")
              }
              disabled={props.busy}
            >
              {copyingField === "debug-bundle"
                ? t("config.copied")
                : t("config.copy")}
            </Button>
          </div>
          <pre className="text-xs text-gray-12 whitespace-pre-wrap break-words max-h-64 overflow-auto bg-gray-1/20 border border-gray-6 rounded-xl p-3">
            {diagnosticsBundleJson}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
