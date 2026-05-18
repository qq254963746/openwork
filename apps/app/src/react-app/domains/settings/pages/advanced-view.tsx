/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { CircleAlert, Cpu, RefreshCcw, Server, Zap } from "lucide-react";

import type { EngineConnectStatus } from "../../../../app/types";
import type { AiWorkServerStatus } from "../../../../app/lib/aiwork-server";
import type { EngineInfo } from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import { Button } from "../../../design-system/button";

import { ConfigView, type ConfigViewProps } from "./config-view";

const settingsPanelClass = "rounded-[28px] border border-dls-border bg-dls-surface p-5 md:p-6";
const settingsPanelSoftClass = "rounded-2xl border border-gray-6/60 bg-gray-1/40 p-4";

type RuntimeStatusCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
  statusLabel: string;
  statusStyle: string;
  statusDot: string;
  detailLines?: string[];
};

export type AdvancedViewProps = {
  busy: boolean;
  baseUrl: string;
  headerStatus: string;
  clientConnected: boolean;
  engineConnectStatus: EngineConnectStatus | null;
  aiworkServerStatus: AiWorkServerStatus;
  aiworkServerUrl: string;
  aiworkReconnectBusy: boolean;
  reconnectAiWorkServer: () => Promise<boolean>;
  engineInfo: EngineInfo | null;
  restartLocalServer: () => Promise<boolean>;
  stopHost: () => void;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  engineDevModeEnabled: boolean;
  openDebugDeepLink: (rawUrl: string) => Promise<{ ok: boolean; message: string }>;
  configView: ConfigViewProps;
};

function RuntimeStatusCard(props: RuntimeStatusCardProps) {
  return (
    <div className={`${settingsPanelSoftClass} space-y-3`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-6/60 bg-gray-1/70 text-gray-12">
          {props.icon}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-12">{props.title}</div>
          <div className="text-xs text-gray-9">{props.description}</div>
        </div>
      </div>
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${props.statusStyle}`}
      >
        <span className={`h-2 w-2 rounded-full ${props.statusDot}`} />
        {props.statusLabel}
      </div>
      {props.detailLines?.length ? (
        <div className="space-y-1 border-t border-gray-6/50 pt-2 text-[11px] text-gray-9">
          {props.detailLines.map((line) => (
            <div key={line} className="truncate" title={line}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatEngineBinary(info: EngineInfo | null) {
  const binary = info?.engineBinPath?.trim();
  if (!binary) return "—";
  const source = info?.engineBinSource?.trim();
  return source ? `${binary} (${source})` : binary;
}

export function AdvancedView(props: AdvancedViewProps) {
  const [aiworkReconnectStatus, setAiWorkReconnectStatus] = useState<string | null>(null);
  const [aiworkReconnectError, setAiWorkReconnectError] = useState<string | null>(null);
  const [aiworkRestartBusy, setAiWorkRestartBusy] = useState(false);
  const [aiworkRestartStatus, setAiWorkRestartStatus] = useState<string | null>(null);
  const [aiworkRestartError, setAiWorkRestartError] = useState<string | null>(null);

  const clientStatusLabel = (() => {
    const status = props.engineConnectStatus?.status;
    if (status === "connecting") return t("status.connecting");
    if (status === "error") return t("settings.connection_failed");
    return props.clientConnected ? t("status.connected") : t("config.status_not_connected");
  })();

  const clientStatusStyle = (() => {
    const status = props.engineConnectStatus?.status;
    if (status === "connecting") return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    if (status === "error") return "bg-red-7/10 text-red-11 border-red-7/20";
    return props.clientConnected
      ? "bg-green-7/10 text-green-11 border-green-7/20"
      : "bg-gray-4/60 text-gray-11 border-gray-7/50";
  })();

  const clientStatusDot = (() => {
    const status = props.engineConnectStatus?.status;
    if (status === "connecting") return "bg-amber-9";
    if (status === "error") return "bg-red-9";
    return props.clientConnected ? "bg-green-9" : "bg-gray-6";
  })();

  const aiworkStatusLabel = (() => {
    switch (props.aiworkServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const aiworkStatusStyle = (() => {
    switch (props.aiworkServerStatus) {
      case "connected":
        return "bg-green-7/10 text-green-11 border-green-7/20";
      case "limited":
        return "bg-amber-7/10 text-amber-11 border-amber-7/20";
      default:
        return "bg-gray-4/60 text-gray-11 border-gray-7/50";
    }
  })();

  const aiworkStatusDot = (() => {
    switch (props.aiworkServerStatus) {
      case "connected":
        return "bg-green-9";
      case "limited":
        return "bg-amber-9";
      default:
        return "bg-gray-6";
    }
  })();

  const isLocalEngineRunning = Boolean(props.engineInfo?.running);

  const handleReconnectAiWorkServer = async () => {
    if (props.busy || props.aiworkReconnectBusy || !props.aiworkServerUrl.trim()) return;
    setAiWorkReconnectStatus(null);
    setAiWorkReconnectError(null);
    try {
      const ok = await props.reconnectAiWorkServer();
      if (!ok) {
        setAiWorkReconnectError(t("settings.reconnect_failed"));
        return;
      }
      setAiWorkReconnectStatus(t("settings.reconnected"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiWorkReconnectError(message || t("settings.reconnect_server_failed"));
    }
  };

  const handleRestartLocalServer = async () => {
    if (props.busy || aiworkRestartBusy) return;
    setAiWorkRestartStatus(null);
    setAiWorkRestartError(null);
    setAiWorkRestartBusy(true);
    try {
      const ok = await props.restartLocalServer();
      if (!ok) {
        setAiWorkRestartError(t("settings.restart_failed"));
        return;
      }
      setAiWorkRestartStatus(t("settings.restarted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiWorkRestartError(message || t("settings.restart_server_failed"));
    } finally {
      setAiWorkRestartBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`${settingsPanelClass} space-y-4`}>
        <div>
          <div className="text-sm font-medium text-gray-12">{t("settings.runtime_title")}</div>
          <div className="text-xs text-gray-9">{t("settings.runtime_desc")}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RuntimeStatusCard
            icon={<Cpu size={18} />}
            title={t("settings.engine_label")}
            description={t("settings.aiwork_engine_desc")}
            statusLabel={clientStatusLabel}
            statusStyle={clientStatusStyle}
            statusDot={clientStatusDot}
            detailLines={[
              t("settings.diag_aiwork_binary", undefined, {
                binary: formatEngineBinary(props.engineInfo),
              }),
            ]}
          />
          <RuntimeStatusCard
            icon={<Server size={18} />}
            title={t("settings.aiwork_server_label")}
            description={t("settings.aiwork_server_desc")}
            statusLabel={aiworkStatusLabel}
            statusStyle={aiworkStatusStyle}
            statusDot={aiworkStatusDot}
          />
        </div>
      </div>

      <div className={`${settingsPanelClass} space-y-3`}>
        <div className="text-sm font-medium text-gray-12">{t("settings.developer_mode_title")}</div>
        <div className="text-xs text-gray-9">{t("settings.developer_mode_desc")}</div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              props.developerMode
                ? "border-blue-7/35 bg-blue-3/20 text-blue-11 hover:bg-blue-3/35 hover:text-blue-11 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)]"
                : "border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)]"
            }`}
            onClick={props.toggleDeveloperMode}
          >
            <Zap size={14} className={props.developerMode ? "text-blue-10" : "text-dls-secondary"} />
            {props.developerMode
              ? t("settings.disable_developer_mode")
              : t("settings.enable_developer_mode")}
          </button>
          <div className="text-xs text-gray-10">
            {props.developerMode
              ? t("settings.developer_panel_enabled")
              : t("settings.developer_panel_disabled")}
          </div>
        </div>
      </div>

      <div className={`${settingsPanelClass} space-y-3`}>
        <div className="text-sm font-medium text-gray-12">{t("settings.connection_title")}</div>
        <div className="text-xs text-gray-9">{props.headerStatus}</div>
        <div className="break-all font-mono text-xs text-gray-8">{props.baseUrl}</div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-secondary shadow-sm transition-colors duration-150 hover:bg-dls-hover hover:text-dls-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleReconnectAiWorkServer()}
            disabled={props.busy || props.aiworkReconnectBusy || !props.aiworkServerUrl.trim()}
          >
            <RefreshCcw size={14} className={`text-dls-secondary ${props.aiworkReconnectBusy ? "animate-spin" : ""}`} />
            {props.aiworkReconnectBusy ? t("settings.reconnecting") : t("settings.reconnect_server")}
          </button>

          {isLocalEngineRunning ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-secondary shadow-sm transition-colors duration-150 hover:bg-dls-hover hover:text-dls-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleRestartLocalServer()}
              disabled={props.busy || aiworkRestartBusy}
            >
              <RefreshCcw size={14} className={`text-dls-secondary ${aiworkRestartBusy ? "animate-spin" : ""}`} />
              {aiworkRestartBusy ? t("settings.restarting") : t("settings.restart_aiwork_server")}
            </button>
          ) : null}

          {isLocalEngineRunning ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-red-7/35 bg-red-3/25 px-3 py-1.5 text-xs font-medium text-red-11 transition-colors duration-150 hover:border-red-7/50 hover:bg-red-3/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-7/35 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={props.stopHost}
              disabled={props.busy}
            >
              <CircleAlert size={14} />
              {t("settings.stop_local_server")}
            </button>
          ) : null}

          {!isLocalEngineRunning && props.aiworkServerStatus === "connected" ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-secondary shadow-sm transition-colors duration-150 hover:bg-dls-hover hover:text-dls-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={props.stopHost}
              disabled={props.busy}
            >
              {t("settings.disconnect_server")}
            </button>
          ) : null}
        </div>

        {aiworkReconnectStatus ? <div className="text-xs text-gray-10">{aiworkReconnectStatus}</div> : null}
        {aiworkReconnectError ? <div className="text-xs text-red-11">{aiworkReconnectError}</div> : null}
        {aiworkRestartStatus ? <div className="text-xs text-gray-10">{aiworkRestartStatus}</div> : null}
        {aiworkRestartError ? <div className="text-xs text-red-11">{aiworkRestartError}</div> : null}
      </div>

      {props.developerMode ? <ConfigView {...props.configView} /> : null}
    </div>
  );
}
