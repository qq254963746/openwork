/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollText, Settings } from "lucide-react";

import { t } from "../../../../i18n";
import { useControlAction, type OpenworkControlAction } from "../../../shell/control/control-provider";
import type { OpenworkServerStatus } from "../../../../app/lib/openwork-server";

const STATUS_BAR_BOOT_STARTED_AT = Date.now();
const STATUS_BAR_INITIALIZING_MS = 15_000;

export type StatusBarProps = {
  clientConnected: boolean;
  openworkServerStatus: OpenworkServerStatus;
  developerMode: boolean;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  /** Opens in-app inspector event log (sidebar / footer). */
  onOpenAppLogs?: () => void;
  providerConnectedIds: string[];
  mcpConnectedCount: number;
  statusLabel?: string;
  statusDetail?: string;
  statusDotClass?: string;
  statusPingClass?: string;
  statusPulse?: boolean;
  showSettingsButton?: boolean;
  initializing?: boolean;
  /** Narrow sidebar footer vs full-width main column strip */
  variant?: "main" | "sidebar";
};

type StatusCopy = {
  label: string;
  detail: string;
  dotClass: string;
  pingClass: string;
  pulse: boolean;
};

function deriveStatusCopy(props: StatusBarProps): StatusCopy {
  if (props.statusLabel) {
    return {
      label: props.statusLabel,
      detail: props.statusDetail ?? "",
      dotClass: props.statusDotClass ?? "bg-green-9",
      pingClass: props.statusPingClass ?? "bg-green-9/45 animate-ping",
      pulse: props.statusPulse ?? true,
    };
  }

  const mcp = props.mcpConnectedCount;

  if (!props.clientConnected && props.openworkServerStatus === "disconnected" && props.initializing) {
    return {
      label: "Preparing workspace",
      detail: t("session.loading_detail"),
      dotClass: "bg-amber-9",
      pingClass: "bg-amber-9/35 animate-ping",
      pulse: true,
    };
  }

  if (props.clientConnected) {
    const detailBits: string[] = [];
    if (mcp > 0) {
      detailBits.push(t("status.mcp_connected", undefined, { count: mcp }));
    }
    // if (!detailBits.length) {
    //   detailBits.push(t("status.ready_for_tasks"));
    // }
    if (props.developerMode) {
      detailBits.push(t("status.developer_mode"));
    }
    return {
      label: t("status.openwork_ready"),
      detail: detailBits.join(" · "),
      dotClass: "bg-green-9",
      pingClass: "bg-green-9/45 animate-ping",
      pulse: true,
    };
  }

  if (props.openworkServerStatus === "limited") {
    return {
      label: t("status.limited_mode"),
      detail:
        mcp > 0
          ? t("status.limited_mcp_hint", undefined, { count: mcp })
          : t("status.limited_hint"),
      dotClass: "bg-amber-9",
      pingClass: "bg-amber-9/35",
      pulse: false,
    };
  }

  return {
    label: t("status.disconnected_label"),
    detail: t("status.disconnected_hint"),
    dotClass: "bg-red-9",
    pingClass: "bg-red-9/35",
    pulse: false,
  };
}

export function StatusBar(props: StatusBarProps) {
  const variant = props.variant ?? "main";
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const appLogsButtonRef = useRef<HTMLButtonElement>(null);
  const [initializing, setInitializing] = useState(
    () => Date.now() - STATUS_BAR_BOOT_STARTED_AT < STATUS_BAR_INITIALIZING_MS,
  );

  useEffect(() => {
    if (!initializing) return;
    const remaining = Math.max(
      0,
      STATUS_BAR_INITIALIZING_MS - (Date.now() - STATUS_BAR_BOOT_STARTED_AT),
    );
    const timeout = window.setTimeout(() => setInitializing(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [initializing]);

  const statusCopy = deriveStatusCopy({ ...props, initializing });

  const settingsControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "status.settings.open",
    label: props.settingsOpen ? "Go back from settings" : "Open settings from the status bar",
    description: "Use the visible settings button in the status bar.",
    sideEffect: "navigation",
    disabled: props.showSettingsButton === false,
    targetRef: settingsButtonRef,
    execute: props.onOpenSettings,
  }), [props.onOpenSettings, props.settingsOpen, props.showSettingsButton]);
  useControlAction(settingsControlAction);

  const appLogsControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "status.app_logs.open",
    label: "Open application log viewer",
    description: "Opens the in-memory application event log.",
    sideEffect: "navigation",
    disabled: typeof props.onOpenAppLogs !== "function",
    targetRef: appLogsButtonRef,
    execute: () => props.onOpenAppLogs?.(),
  }), [props.onOpenAppLogs]);
  useControlAction(appLogsControlAction);

  const sidebar = variant === "sidebar";

  return (
    <div
      className={
        sidebar
          ? "border-t border-dls-border/80 bg-dls-sidebar"
          : "border-t border-dls-border bg-dls-surface"
      }
    >
      <div
        className={`flex items-center justify-between text-[12px] text-dls-secondary ${
          sidebar
            ? "min-h-9 gap-2 px-2 py-1.5"
            : "h-12 gap-3 px-4 md:px-6"
        }`}
      >
        <div className={`flex min-w-0 items-center ${sidebar ? "gap-2" : "gap-2.5"}`}>
          <span
            className={`relative flex shrink-0 items-center justify-center ${sidebar ? "h-2 w-2" : "h-2.5 w-2.5"}`}
          >
            {statusCopy.pulse ? (
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${statusCopy.pingClass}`}
              />
            ) : null}
            <span
              className={`relative inline-flex rounded-full ${statusCopy.dotClass} ${sidebar ? "h-2 w-2" : "h-2.5 w-2.5"}`}
            />
          </span>
          <span className="shrink-0 font-medium text-dls-text">
            {statusCopy.label}
          </span>
          <span className="truncate text-dls-secondary">
            {statusCopy.detail}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {typeof props.onOpenAppLogs === "function" ? (
            <button
              ref={appLogsButtonRef}
              type="button"
              className={`flex shrink-0 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text ${
                sidebar ? "h-7 w-7" : "h-8 w-8"
              }`}
              onClick={props.onOpenAppLogs}
              title={t("status.app_logs")}
              aria-label={t("status.app_logs")}
            >
              <ScrollText className={sidebar ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </button>
          ) : null}
          {props.showSettingsButton !== false ? (
            <button
              ref={settingsButtonRef}
              type="button"
              className={`flex shrink-0 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text ${
                sidebar ? "h-7 w-7" : "h-8 w-8"
              }`}
              onClick={props.onOpenSettings}
              title={
                props.settingsOpen ? t("status.back") : t("status.settings")
              }
              aria-label={
                props.settingsOpen ? t("status.back") : t("status.settings")
              }
            >
              <Settings className={sidebar ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
