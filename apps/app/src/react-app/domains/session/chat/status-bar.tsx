/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollText, Settings } from "lucide-react";

import { t } from "../../../../i18n";
import { useControlAction, type AiWorkControlAction } from "../../../shell/control/control-provider";
import type { AiWorkServerStatus } from "../../../../app/lib/aiwork-server";

const STATUS_BAR_BOOT_STARTED_AT = Date.now();
const STATUS_BAR_INITIALIZING_MS = 15_000;

export type StatusBarProps = {
  clientConnected: boolean;
  aiworkServerStatus: AiWorkServerStatus;
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
  labelClass: string;
};

function deriveStatusCopy(props: StatusBarProps): StatusCopy {
  if (props.statusLabel) {
    return {
      label: props.statusLabel,
      detail: props.statusDetail ?? "",
      dotClass: props.statusDotClass ?? "bg-green-9",
      pingClass: props.statusPingClass ?? "bg-green-9/45 animate-ping",
      pulse: props.statusPulse ?? true,
      labelClass: "font-medium text-dls-text",
    };
  }

  const mcp = props.mcpConnectedCount;

  if (!props.clientConnected && props.aiworkServerStatus === "disconnected" && props.initializing) {
    return {
      label: "Preparing",
      detail: t("session.loading_detail"),
      dotClass: "bg-amber-9",
      pingClass: "bg-amber-9/35 animate-ping",
      pulse: true,
      labelClass: "font-medium text-dls-text",
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
      label: t("status.aiwork_ready"),
      detail: detailBits.join(" · "),
      dotClass: "bg-green-9",
      pingClass: "bg-green-9/45 animate-ping",
      pulse: true,
      labelClass: "font-medium text-dls-secondary",
    };
  }

  if (props.aiworkServerStatus === "limited") {
    return {
      label: t("status.limited_mode"),
      detail:
        mcp > 0
          ? t("status.limited_mcp_hint", undefined, { count: mcp })
          : t("status.limited_hint"),
      dotClass: "bg-amber-9",
      pingClass: "bg-amber-9/35",
      pulse: false,
      labelClass: "font-medium text-dls-text",
    };
  }

  return {
    label: t("status.disconnected_label"),
    detail: t("status.disconnected_hint"),
    dotClass: "bg-red-9",
    pingClass: "bg-red-9/35",
    pulse: false,
    labelClass: "font-medium text-dls-text",
  };
}

function SidebarSettingsIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={props.className}
      aria-hidden
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M928 800H508c-14.2-55.2-64.3-96-124-96-59.6 0-109.8 40.8-124 96H96c-17.7 0-32 14.3-32 32s14.3 32 32 32h164c14.2 55.2 64.3 96 124 96 59.6 0 109.8-40.8 124-96h420c17.7 0 32-14.3 32-32s-14.3-32-32-32zm-544 97c-35.9 0-65-29.1-65-65s29.1-65 65-65 65 29.1 65 65-29.1 65-65 65zM928 480H764c-14.2-55.2-64.3-96-124-96s-109.8 40.8-124 96H96c-17.7 0-32 14.3-32 32s14.3 32 32 32h420c14.2 55.2 64.3 96 124 96s109.8-40.8 124-96h164c17.7 0 32-14.3 32-32s-14.3-32-32-32zm-288 97c-35.9 0-65-29.1-65-65s29.1-65 65-65 65 29.1 65 65-29.1 65-65 65zM96 224h164c14.2 55.2 64.3 96 124 96 59.6 0 109.8-40.8 124-96h420c17.7 0 32-14.3 32-32s-14.3-32-32-32H508c-14.2-55.2-64.3-96-124-96-59.6 0-109.8 40.8-124 96H96c-17.7 0-32 14.3-32 32s14.3 32 32 32zm288-97c35.9 0 65 29.1 65 65s-29.1 65-65 65-65-29.1-65-65 29.1-65 65-65z" />
    </svg>
  );
}

function SidebarAppLogsIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={props.className}
      aria-hidden
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M725.333333 426.666667c-166.4 0-298.666667 132.266667-298.666666 298.666666s132.266667 298.666667 298.666666 298.666667 298.666667-132.266667 298.666667-298.666667-132.266667-298.666667-298.666667-298.666666zm0 512c-119.466667 0-213.333333-93.866667-213.333333-213.333334s93.866667-213.333333 213.333333-213.333333 213.333333 93.866667 213.333334 213.333333-93.866667 213.333333-213.333334 213.333334z" />
      <path d="M128 85.333333h597.333333v341.333334c29.866667 0 59.733333 4.266667 85.333334 12.8V85.333333c0-46.933333-38.4-85.333333-85.333334-85.333333H128C81.066667 0 42.666667 38.4 42.666667 85.333333v810.666667c0 46.933333 38.4 85.333333 85.333333 85.333333h443.733333c-34.133333-21.333333-68.266667-51.2-89.6-85.333333H128V85.333333z" />
      <path d="M725.333333 533.333333c25.6 0 42.666667 17.066667 42.666667 42.666667V682.666667h64c25.6 0 42.666667 17.066667 42.666667 42.666666s-17.066667 42.666667-42.666667 42.666667h-85.333333c-34.133333 0-64-29.866667-64-64v-128c0-25.6 17.066667-42.666667 42.666666-42.666667zM192 256c0-25.6 17.066667-42.666667 42.666667-42.666667h384c25.6 0 42.666667 17.066667 42.666666 42.666667s-17.066667 42.666667-42.666666 42.666667h-384c-25.6 0-42.666667-17.066667-42.666667-42.666667zM192 503.466667c0-25.6 17.066667-42.666667 42.666667-42.666667h128c25.6 0 42.666667 17.066667 42.666666 42.666667s-17.066667 42.666667-42.666666 42.666666h-128c-25.6 0-42.666667-17.066667-42.666667-42.666666zM192 738.133333c0-25.6 17.066667-42.666667 42.666667-42.666666h128c25.6 0 42.666667 17.066667 42.666666 42.666666s-17.066667 42.666667-42.666666 42.666667h-128c-25.6 0-42.666667-17.066667-42.666667-42.666667z" />
    </svg>
  );
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

  const settingsControlAction = useMemo<AiWorkControlAction>(() => ({
    id: "status.settings.open",
    label: props.settingsOpen ? "Go back from settings" : "Open settings from the status bar",
    description: "Use the visible settings button in the status bar.",
    sideEffect: "navigation",
    disabled: props.showSettingsButton === false,
    targetRef: settingsButtonRef,
    execute: props.onOpenSettings,
  }), [props.onOpenSettings, props.settingsOpen, props.showSettingsButton]);
  useControlAction(settingsControlAction);

  const appLogsControlAction = useMemo<AiWorkControlAction>(() => ({
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
          ? "border-t border-dls-divider bg-dls-sidebar"
          : "border-t border-dls-border bg-dls-surface"
      }
    >
      <div
        className={`flex items-center justify-between text-[12px] text-dls-secondary ${
          sidebar
            ? "min-h-11 gap-2 px-2 py-2"
            : "h-12 gap-3 px-4 md:px-6"
        } ${
          sidebar &&
          typeof props.onOpenAppLogs === "function" &&
          props.showSettingsButton !== false
            ? "group/sidebar-actions"
            : ""
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
          <span className={`shrink-0 ${statusCopy.labelClass}`}>
            {statusCopy.label}
          </span>
          <span className="truncate text-dls-secondary">
            {statusCopy.detail}
          </span>
        </div>

        <div
          className={
            sidebar &&
            typeof props.onOpenAppLogs === "function" &&
            props.showSettingsButton !== false
              ? "flex shrink-0 items-center gap-0 group-hover/sidebar-actions:gap-1.5"
              : "flex items-center gap-1.5"
          }
        >
          {typeof props.onOpenAppLogs === "function" ? (
            <button
              ref={appLogsButtonRef}
              type="button"
              className={`flex shrink-0 items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12 ${
                sidebar ? "h-7 w-7 translate-x-[5px]" : "h-8 w-8"
              } ${
                sidebar && props.showSettingsButton !== false
                  ? "max-w-0 min-w-0 translate-x-[5px] overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-out pointer-events-none group-hover/sidebar-actions:pointer-events-auto group-hover/sidebar-actions:max-w-7 group-hover/sidebar-actions:opacity-100 group-hover/sidebar-actions:translate-x-[5px] focus-visible:pointer-events-auto focus-visible:max-w-7 focus-visible:opacity-100"
                  : ""
              }`}
              onClick={() => {
                props.onOpenAppLogs?.();
                // Clear click focus so closing the detached log window does not restore focus here and leave the icon expanded.
                if (sidebar && props.showSettingsButton !== false) {
                  queueMicrotask(() => {
                    const ae = document.activeElement;
                    if (ae instanceof HTMLElement) ae.blur();
                  });
                }
              }}
              title={t("status.app_logs")}
              aria-label={t("status.app_logs")}
            >
              {sidebar ? (
                <SidebarAppLogsIcon className="h-3.5 w-3.5" />
              ) : (
                <ScrollText className="h-4 w-4" />
              )}
            </button>
          ) : null}
          {props.showSettingsButton !== false ? (
            <button
              ref={settingsButtonRef}
              type="button"
              className={`flex shrink-0 items-center justify-center rounded-md text-[#000000] transition-colors hover:bg-dls-hover hover:text-[#000000] dark:text-gray-12 dark:hover:text-gray-12 ${
                sidebar ? "h-7 w-7 translate-x-1" : "h-8 w-8"
              }`}
              onClick={props.onOpenSettings}
              title={
                props.settingsOpen ? t("status.back") : t("status.settings")
              }
              aria-label={
                props.settingsOpen ? t("status.back") : t("status.settings")
              }
            >
              {sidebar ? (
                <SidebarSettingsIcon className="h-3.5 w-3.5" />
              ) : (
                <Settings className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
