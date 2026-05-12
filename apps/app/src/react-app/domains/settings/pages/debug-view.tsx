/** @jsxImportSource react */
import {
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  RefreshCcw,
  Smartphone,
} from "lucide-react";

import type {
  AiWorkAuditEntry,
  AiWorkServerCapabilities,
  AiWorkServerDiagnostics,
} from "../../../../app/lib/aiwork-server";
import type { OpencodeConnectStatus, StartupPreference } from "../../../../app/types";
import { formatRelativeTime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { Button } from "../../../design-system/button";

const sectionHeaderClass = "flex flex-col gap-1 pb-2";
const sectionTitleClass = "text-[15px] font-semibold tracking-[-0.2px] text-dls-text";
const sectionDescClass = "text-[12px] text-dls-secondary";
const cardClass =
  "rounded-2xl border border-dls-border bg-dls-surface/95 p-5 space-y-4";
const subCardClass = "rounded-xl border border-dls-border bg-dls-sidebar/40 p-4 space-y-3";
const monoPreClass =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-dls-sidebar/40 p-3 text-[11px] font-mono text-dls-text";
const miniPreClass =
  "max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-dls-sidebar/30 p-2 text-[11px] font-mono text-dls-text";
const compactDangerActionClass =
  "inline-flex h-9 items-center gap-2 rounded-xl border border-red-7/40 bg-red-9 px-4 text-xs font-medium text-white transition-colors hover:bg-red-10 disabled:cursor-not-allowed disabled:opacity-60";

type RuntimeSummary = {
  appVersionLabel: string;
  appCommitLabel: string;
  opencodeVersionLabel: string;
  aiworkServerVersionLabel: string;
};

type StatusPill = {
  label: string;
  className: string;
};

type RuntimeServiceCard = StatusPill & {
  lines: string[];
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
};

type OpenCodeConnectDebugCard = StatusPill & {
  lines: string[];
  metricsLines: string[];
  error?: string | null;
};

type ServiceStatus = { tone: "success" | "error"; message: string } | null;

export type DebugViewProps = {
  developerMode: boolean;
  busy: boolean;
  anyActiveRuns: boolean;
  startupPreference: StartupPreference | null;
  startupLabel: string;
  startupStatus: string | null;
  runtimeSummary: RuntimeSummary;
  runtimeDebugReportJson: string;
  runtimeDebugStatus: string | null;
  onCopyRuntimeDebugReport: () => void | Promise<void>;
  onExportRuntimeDebugReport: () => void | Promise<void>;
  developerLogRecordCount: number;
  developerLogText: string;
  developerLogStatus: string | null;
  onClearDeveloperLog: () => void | Promise<void>;
  onCopyDeveloperLog: () => void | Promise<void>;
  onExportDeveloperLog: () => void | Promise<void>;
  onStopHost: () => void | Promise<void>;
  onResetStartupPreference: () => void | Promise<void>;
  engineSource: "path" | "sidecar" | "custom";
  onSetEngineSource: (value: "path" | "sidecar" | "custom") => void;
  engineCustomBinPath: string;
  engineCustomBinPathLabel: string;
  onPickEngineBinary: () => void | Promise<void>;
  onClearEngineCustomBinPath: () => void;
  onOpenResetModal: (mode: "onboarding" | "all") => void;
  resetModalBusy: boolean;
  resetStatus: string | null;
  opencodeRestarting: boolean;
  aiworkServerRestarting: boolean;
  opencodeServiceStatus: ServiceStatus;
  aiworkServiceStatus: ServiceStatus;
  opencodeLogStatus: string | null;
  aiworkLogStatus: string | null;
  onCopyOpencodeLogs: () => void | Promise<void>;
  onExportOpencodeLogs: () => void | Promise<void>;
  onCopyAiWorkLogs: () => void | Promise<void>;
  onExportAiWorkLogs: () => void | Promise<void>;
  serviceRestartError: string | null;
  onRestartOpencode: () => void | Promise<void>;
  onRestartAiWorkServer: () => void | Promise<void>;
  engineCard: RuntimeServiceCard;
  opencodeConnectCard: OpenCodeConnectDebugCard;
  aiworkCard: RuntimeServiceCard;
  aiworkServerDiagnostics: AiWorkServerDiagnostics | null;
  runtimeWorkspaceId: string | null;
  aiworkServerCapabilities: AiWorkServerCapabilities | null;
  pendingPermissions: unknown;
  events: unknown;
  workspaceDebugEvents: unknown;
  workspaceDebugEventsStatus: string | null;
  safeStringify: (value: unknown) => string;
  onClearWorkspaceDebugEvents: () => void | Promise<void>;
  aiworkAuditEntries: AiWorkAuditEntry[];
  aiworkAuditStatus: StatusPill;
  aiworkAuditError: string | null;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  opencodeDevModeEnabled: boolean;
  nukeConfigBusy: boolean;
  nukeConfigStatus: string | null;
  onNukeAiWorkAndOpencodeConfig: () => void | Promise<void>;
};

function formatActor(entry: AiWorkAuditEntry) {
  if (entry.actor.type === "host") return t("settings.audit_actor_host");
  if (entry.actor.clientId) return entry.actor.clientId;
  if (entry.actor.tokenHash) return entry.actor.tokenHash;
  return t("settings.audit_actor_remote");
}

function formatCapability(value: { read: boolean; write: boolean }) {
  if (value.read && value.write) return t("settings.cap_read_write");
  if (value.read) return t("settings.cap_read_only");
  if (value.write) return t("settings.cap_write_only");
  return t("settings.disabled");
}

function formatUptime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderLines(lines: string[]) {
  return lines.map((line, index) => (
    <div key={`${line}-${index}`} className="truncate text-[11px] font-mono text-dls-secondary">
      {line}
    </div>
  ));
}

function StatusBanner(props: { tone: "success" | "error" | "info"; message: string }) {
  const cls =
    props.tone === "success"
      ? "border-green-6 bg-green-3/40 text-green-11"
      : props.tone === "error"
        ? "border-red-6 bg-red-3/40 text-red-11"
        : "border-dls-border bg-dls-sidebar/40 text-dls-secondary";
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${cls}`}>{props.message}</div>
  );
}

type ServiceCardProps = {
  title: string;
  description: string;
  pill: StatusPill;
  lines: string[];
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
  restarting: boolean;
  restartLabel: string;
  onRestart: () => void | Promise<void>;
  serviceStatus: ServiceStatus;
  logStatus: string | null;
  onCopyLogs: () => void | Promise<void>;
  onExportLogs: () => void | Promise<void>;
  isDesktop: boolean;
};

function ServiceCard(props: ServiceCardProps) {
  const restartDisabled = props.restarting || !props.isDesktop;
  return (
    <div className={subCardClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">{props.title}</div>
          <div className="text-[12px] text-dls-secondary">{props.description}</div>
        </div>
        <div className={`rounded-full border px-2 py-1 text-[11px] font-medium ${props.pill.className}`}>
          {props.pill.label}
        </div>
      </div>

      <div className="space-y-1">{renderLines(props.lines)}</div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void props.onRestart()}
          disabled={restartDisabled}
          className="h-9 px-3 py-0 text-xs"
          title={!props.isDesktop ? t("session.app_log_services_desktop_only") : ""}
        >
          <RefreshCcw className={`mr-1.5 h-3.5 w-3.5 ${props.restarting ? "animate-spin" : ""}`} />
          {props.restarting ? t("settings.restarting") : props.restartLabel}
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onCopyLogs()}
          className="h-9 px-3 py-0 text-xs"
        >
          <Copy size={13} className="mr-1.5" />
          {t("settings.copy_logs")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onExportLogs()}
          className="h-9 px-3 py-0 text-xs"
        >
          <Download size={13} className="mr-1.5" />
          {t("settings.export_log_button")}
        </Button>
      </div>

      {props.serviceStatus ? (
        <StatusBanner tone={props.serviceStatus.tone} message={props.serviceStatus.message} />
      ) : null}
      {props.logStatus ? <StatusBanner tone="info" message={props.logStatus} /> : null}

      <details className="group">
        <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-dls-secondary">
          {t("settings.last_stdout")} / {t("settings.last_stderr")}
        </summary>
        <div className="mt-2 grid gap-2">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
              {t("settings.last_stdout")}
            </div>
            <pre className={miniPreClass}>{props.stdout || t("settings.no_logs_captured")}</pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
              {t("settings.last_stderr")}
            </div>
            <pre className={miniPreClass}>{props.stderr || t("settings.no_logs_captured")}</pre>
          </div>
          {props.error ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
                {t("settings.last_error")}
              </div>
              <pre className={miniPreClass}>{props.error}</pre>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

export function DebugView(props: DebugViewProps) {
  if (!props.developerMode) return null;

  const isDesktop = true;
  const isLocalPreference = props.startupPreference !== "server";

  return (
    <section className="space-y-6">
      {/* Section: Runtime overview */}
      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={sectionTitleClass}>{t("settings.runtime_debug_title")}</div>
            <div className={sectionDescClass}>{t("settings.runtime_debug_desc")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              className="h-8 px-3 py-0 text-xs"
              onClick={() => void props.onCopyRuntimeDebugReport()}
            >
              <Copy size={13} className="mr-1.5" />
              {t("settings.copy_json")}
            </Button>
            <Button
              variant="secondary"
              className="h-8 px-3 py-0 text-xs"
              onClick={() => void props.onExportRuntimeDebugReport()}
            >
              <Download size={13} className="mr-1.5" />
              {t("settings.export")}
            </Button>
          </div>
        </div>
        <div className="grid gap-2 text-[12px] text-dls-secondary md:grid-cols-2">
          <div>{t("settings.debug_desktop_app", { version: props.runtimeSummary.appVersionLabel })}</div>
          <div>{t("settings.debug_commit", { commit: props.runtimeSummary.appCommitLabel })}</div>
          <div>
            {t("settings.debug_opencode_version", { version: props.runtimeSummary.opencodeVersionLabel })}
          </div>
          <div>
            {t("settings.debug_aiwork_server_version", {
              version: props.runtimeSummary.aiworkServerVersionLabel,
            })}
          </div>
        </div>
        {props.runtimeDebugStatus ? <StatusBanner tone="info" message={props.runtimeDebugStatus} /> : null}
        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-dls-secondary">
            JSON
          </summary>
          <pre className={`${monoPreClass} mt-2`}>{props.runtimeDebugReportJson}</pre>
        </details>
      </div>

      {/* Section: Services */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.services_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.services_section_desc")}</div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ServiceCard
            title={t("settings.aiwork_server_label")}
            description={t("settings.aiwork_config_sidecar_desc")}
            pill={props.aiworkCard}
            lines={props.aiworkCard.lines}
            stdout={props.aiworkCard.stdout ?? null}
            stderr={props.aiworkCard.stderr ?? null}
            error={props.aiworkCard.error ?? null}
            restarting={props.aiworkServerRestarting}
            restartLabel={t("settings.restart_aiwork_server")}
            onRestart={props.onRestartAiWorkServer}
            serviceStatus={props.aiworkServiceStatus}
            logStatus={props.aiworkLogStatus}
            onCopyLogs={props.onCopyAiWorkLogs}
            onExportLogs={props.onExportAiWorkLogs}
            isDesktop={isDesktop}
          />

          <ServiceCard
            title={t("settings.opencode_engine_sidecar")}
            description={t("settings.opencode_engine_sidecar_desc")}
            pill={props.engineCard}
            lines={props.engineCard.lines}
            stdout={props.engineCard.stdout ?? null}
            stderr={props.engineCard.stderr ?? null}
            error={props.engineCard.error ?? null}
            restarting={props.opencodeRestarting}
            restartLabel={t("settings.restart_opencode")}
            onRestart={props.onRestartOpencode}
            serviceStatus={props.opencodeServiceStatus}
            logStatus={props.opencodeLogStatus}
            onCopyLogs={props.onCopyOpencodeLogs}
            onExportLogs={props.onExportOpencodeLogs}
            isDesktop={isDesktop}
          />
        </div>

        <div className={subCardClass}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">
                {t("settings.opencode_sdk_title")}
              </div>
              <div className="text-[12px] text-dls-secondary">{t("settings.opencode_sdk_desc")}</div>
            </div>
            <div className={`rounded-full border px-2 py-1 text-[11px] font-medium ${props.opencodeConnectCard.className}`}>
              {props.opencodeConnectCard.label}
            </div>
          </div>
          <div className="space-y-1">{renderLines(props.opencodeConnectCard.lines)}</div>
          {props.opencodeConnectCard.metricsLines.length > 0 ? (
            <div className="space-y-1 border-t border-dls-border/60 pt-1">
              {renderLines(props.opencodeConnectCard.metricsLines)}
            </div>
          ) : null}
          {props.opencodeConnectCard.error ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
                {t("settings.last_error")}
              </div>
              <pre className={miniPreClass}>{props.opencodeConnectCard.error}</pre>
            </div>
          ) : null}
        </div>

        {props.serviceRestartError ? (
          <StatusBanner tone="error" message={props.serviceRestartError} />
        ) : null}
      </div>

      {/* Section: Diagnostics */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.aiwork_diagnostics_title")}</div>
          <div className={sectionDescClass}>
            <span className="font-mono text-[11px] text-dls-secondary">
              {props.aiworkServerDiagnostics?.version ?? "—"}
            </span>
          </div>
        </div>

        {props.aiworkServerDiagnostics ? (
          <div className="grid gap-2 text-[12px] text-dls-secondary md:grid-cols-2">
            <div>{t("settings.diag_started", { time: formatUptime(props.aiworkServerDiagnostics.uptimeMs) })}</div>
            <div>
              {t("settings.diag_read_only", {
                value: props.aiworkServerDiagnostics.readOnly ? "true" : "false",
              })}
            </div>
            <div>
              {t("settings.diag_approval", {
                mode: props.aiworkServerDiagnostics.approval.mode,
                ms: String(props.aiworkServerDiagnostics.approval.timeoutMs),
              })}
            </div>
            <div>{t("settings.diag_workspaces", { count: String(props.aiworkServerDiagnostics.workspaceCount) })}</div>
            <div>
              {t("settings.diag_selected_workspace", {
                id: props.aiworkServerDiagnostics.selectedWorkspaceId ?? "—",
              })}
            </div>
            <div>
              {t("settings.diag_runtime_workspace", {
                id: props.aiworkServerDiagnostics.activeWorkspaceId ?? "—",
              })}
            </div>
            <div>
              {t("settings.diag_config_path", {
                path: props.aiworkServerDiagnostics.server.configPath ?? t("settings.diag_default"),
              })}
            </div>
            <div>
              {t("settings.diag_token_source", {
                source: props.aiworkServerDiagnostics.tokenSource.client,
              })}
            </div>
            <div>
              {t("settings.diag_host_token_source", {
                source: props.aiworkServerDiagnostics.tokenSource.host,
              })}
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-dls-secondary">{t("settings.diagnostics_unavailable")}</div>
        )}

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">
              {t("settings.capabilities_title")}
            </div>
            <div className="truncate font-mono text-[11px] text-dls-secondary">
              {props.runtimeWorkspaceId
                ? t("settings.worker_id_label", { id: props.runtimeWorkspaceId })
                : t("settings.worker_unresolved")}
            </div>
          </div>
          {props.aiworkServerCapabilities ? (
            <div className="grid gap-2 text-[12px] text-dls-secondary md:grid-cols-2">
              <div>{t("settings.cap_skills", { value: formatCapability(props.aiworkServerCapabilities.skills) })}</div>
              <div>{t("settings.cap_plugins", { value: formatCapability(props.aiworkServerCapabilities.plugins) })}</div>
              <div>{t("settings.cap_mcp", { value: formatCapability(props.aiworkServerCapabilities.mcp) })}</div>
              <div>{t("settings.cap_commands", { value: formatCapability(props.aiworkServerCapabilities.commands) })}</div>
              <div>{t("settings.cap_config", { value: formatCapability(props.aiworkServerCapabilities.config) })}</div>
              <div>
                {t("settings.cap_browser_tools", {
                  value: (() => {
                    const browser = props.aiworkServerCapabilities.toolProviders?.browser;
                    if (!browser?.enabled) return t("settings.disabled");
                    return `${browser.mode} · ${browser.placement}`;
                  })(),
                })}
              </div>
              <div>
                {t("settings.cap_file_tools", {
                  value: (() => {
                    const files = props.aiworkServerCapabilities.toolProviders?.files;
                    if (!files) return t("config.unavailable");
                    return [
                      files.injection ? t("settings.cap_inbox_on") : t("settings.cap_inbox_off"),
                      files.outbox ? t("settings.cap_outbox_on") : t("settings.cap_outbox_off"),
                    ].join(" · ");
                  })(),
                })}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-dls-secondary">{t("settings.capabilities_unavailable")}</div>
          )}
        </div>
      </div>

      {/* Section: Activity */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.activity_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.activity_section_desc")}</div>
        </div>

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">
              {t("settings.audit_log_title")}
            </div>
            <div className={`rounded-full border px-2 py-1 text-[11px] font-medium ${props.aiworkAuditStatus.className}`}>
              {props.aiworkAuditStatus.label}
            </div>
          </div>
          {props.aiworkAuditError ? <StatusBanner tone="error" message={props.aiworkAuditError} /> : null}
          {props.aiworkAuditEntries.length > 0 ? (
            <div className="divide-y divide-dls-border/60">
              {props.aiworkAuditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-dls-text">{entry.summary}</div>
                    <div className="truncate text-[11px] text-dls-secondary">
                      {entry.action} · {entry.target} · {formatActor(entry)}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-[11px] text-dls-secondary">
                    {entry.timestamp ? formatRelativeTime(entry.timestamp) : "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-dls-secondary">{t("settings.no_audit_entries")}</div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className={subCardClass}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-dls-secondary">
              {t("settings.pending_permissions")}
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-dls-text">
              {props.safeStringify(props.pendingPermissions)}
            </pre>
          </div>
          <div className={subCardClass}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-dls-secondary">
              {t("settings.recent_events")}
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-dls-text">
              {props.safeStringify(props.events)}
            </pre>
          </div>
        </div>

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-dls-secondary">
              {t("settings.workspace_debug_events_label")}
            </div>
            <Button
              variant="outline"
              className="h-7 shrink-0 px-2 py-0 text-xs"
              onClick={() => void props.onClearWorkspaceDebugEvents()}
              disabled={props.busy}
            >
              {t("settings.clear_button")}
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-dls-text">
            {props.safeStringify(props.workspaceDebugEvents)}
          </pre>
          {props.workspaceDebugEventsStatus ? (
            <StatusBanner tone="info" message={props.workspaceDebugEventsStatus} />
          ) : null}
        </div>
      </div>

      {/* Section: Developer log stream */}
      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={sectionTitleClass}>{t("settings.developer_log_title")}</div>
            <div className={sectionDescClass}>{t("settings.developer_log_desc")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" className="h-8 px-3 py-0 text-xs" onClick={() => void props.onClearDeveloperLog()}>
              {t("settings.clear_button")}
            </Button>
            <Button variant="outline" className="h-8 px-3 py-0 text-xs" onClick={() => void props.onCopyDeveloperLog()}>
              <Copy size={13} className="mr-1.5" />
              {t("settings.copy_log_button")}
            </Button>
            <Button variant="secondary" className="h-8 px-3 py-0 text-xs" onClick={() => void props.onExportDeveloperLog()}>
              <Download size={13} className="mr-1.5" />
              {t("settings.export_log_button")}
            </Button>
          </div>
        </div>
        <div className="text-[11px] text-dls-secondary">
          {t("settings.developer_log_count", { count: String(props.developerLogRecordCount) })}
        </div>
        <pre className={monoPreClass}>{props.developerLogText || t("settings.developer_log_empty")}</pre>
        {props.developerLogStatus ? <StatusBanner tone="info" message={props.developerLogStatus} /> : null}
      </div>

      {/* Section: Tools */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.tools_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.tools_section_desc")}</div>
        </div>

        {isDesktop && (isLocalPreference || props.developerMode) ? (
          <div className={subCardClass}>
            <div>
              <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">{t("settings.engine_title")}</div>
              <div className="text-[12px] text-dls-secondary">{t("settings.engine_desc")}</div>
            </div>

            {!isLocalPreference ? (
              <StatusBanner tone="info" message={t("settings.startup_remote_warning")} />
            ) : null}

            <div className="space-y-3">
              <div className="text-[12px] text-dls-secondary">{t("settings.engine_source_debug")}</div>
              <div className={props.developerMode ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
                <Button
                  variant={props.engineSource === "sidecar" ? "secondary" : "outline"}
                  onClick={() => props.onSetEngineSource("sidecar")}
                  disabled={props.busy}
                >
                  {t("settings.engine_bundled")}
                </Button>
                <Button
                  variant={props.engineSource === "path" ? "secondary" : "outline"}
                  onClick={() => props.onSetEngineSource("path")}
                  disabled={props.busy}
                >
                  {t("settings.engine_system_path")}
                </Button>
                {props.developerMode ? (
                  <Button
                    variant={props.engineSource === "custom" ? "secondary" : "outline"}
                    onClick={() => props.onSetEngineSource("custom")}
                    disabled={props.busy}
                  >
                    {t("settings.engine_custom_binary")}
                  </Button>
                ) : null}
              </div>
              <div className="text-[11px] text-dls-secondary">{t("settings.engine_bundled_hint")}</div>
            </div>

            {props.developerMode && props.engineSource === "custom" ? (
              <div className="space-y-2">
                <div className="text-[12px] text-dls-secondary">{t("settings.custom_binary_label")}</div>
                <div className="flex items-center gap-2">
                  <div
                    className="min-w-0 flex-1 truncate rounded-xl border border-dls-border bg-dls-surface p-3 font-mono text-[11px] text-dls-secondary"
                    title={props.engineCustomBinPathLabel}
                  >
                    {props.engineCustomBinPathLabel}
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 shrink-0 px-3 text-xs"
                    onClick={() => void props.onPickEngineBinary()}
                    disabled={props.busy}
                  >
                    {t("settings.choose")}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 shrink-0 px-3 text-xs"
                    onClick={props.onClearEngineCustomBinPath}
                    disabled={props.busy || !props.engineCustomBinPath.trim()}
                    title={!props.engineCustomBinPath.trim() ? t("settings.no_custom_path_set") : t("settings.clear")}
                  >
                    {t("settings.clear")}
                  </Button>
                </div>
                <div className="text-[11px] text-dls-secondary">{t("settings.custom_binary_hint")}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={subCardClass}>
          <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">
            {t("settings.startup_title")}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-dls-border bg-dls-surface p-3">
            <div className="flex items-center gap-3">
              <div
                className={`rounded-lg p-2 ${
                  isLocalPreference ? "bg-indigo-7/10 text-indigo-11" : "bg-green-7/10 text-green-11"
                }`}
              >
                {isLocalPreference ? <HardDrive size={18} /> : <Smartphone size={18} />}
              </div>
              <span className="text-sm font-medium text-dls-text">{props.startupLabel}</span>
            </div>
            <Button
              variant="outline"
              className="h-8 px-3 py-0 text-xs"
              onClick={() => void props.onStopHost()}
              disabled={props.busy}
            >
              {t("settings.switch")}
            </Button>
          </div>

          <Button
            variant="secondary"
            className="group w-full justify-between"
            onClick={() => void props.onResetStartupPreference()}
          >
            <span>{t("settings.reset_startup_pref")}</span>
            <RefreshCcw size={14} className="opacity-80 transition-transform group-hover:rotate-180" />
          </Button>

          <p className="text-[11px] text-dls-secondary">{t("settings.startup_reset_hint")}</p>
          {props.startupStatus ? <StatusBanner tone="info" message={props.startupStatus} /> : null}
        </div>
      </div>

      {/* Section: Reset & recovery */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.recovery_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.recovery_section_desc")}</div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface p-3">
          <div className="min-w-0">
            <div className="text-sm text-dls-text">{t("settings.reset_onboarding_title")}</div>
            <div className="text-[12px] text-dls-secondary">{t("settings.reset_onboarding_description")}</div>
          </div>
          <Button
            variant="outline"
            className="h-8 shrink-0 px-3 py-0 text-xs"
            onClick={() => props.onOpenResetModal("onboarding")}
            disabled={props.busy || props.resetModalBusy || props.anyActiveRuns}
            title={props.anyActiveRuns ? t("settings.stop_runs_to_reset") : ""}
          >
            {t("settings.reset_button")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface p-3">
          <div className="min-w-0">
            <div className="text-sm text-dls-text">{t("settings.reset_app_data_title")}</div>
            <div className="text-[12px] text-dls-secondary">{t("settings.reset_app_data_description")}</div>
          </div>
          <Button
            variant="danger"
            className="h-8 shrink-0 px-3 py-0 text-xs"
            onClick={() => props.onOpenResetModal("all")}
            disabled={props.busy || props.resetModalBusy || props.anyActiveRuns}
            title={props.anyActiveRuns ? t("settings.stop_runs_to_reset") : ""}
          >
            {t("settings.reset_button")}
          </Button>
        </div>

        <div className="text-[11px] text-dls-secondary">{t("settings.reset_requires_confirm")}</div>
        {props.resetStatus ? <StatusBanner tone="info" message={props.resetStatus} /> : null}
      </div>

      {/* Section: Danger zone */}
      {isDesktop ? (
        <div className="space-y-3 rounded-2xl border border-red-7/30 bg-red-3/10 p-5">
          <div className={sectionHeaderClass}>
            <div className="text-[15px] font-semibold tracking-[-0.2px] text-red-11">
              {t("settings.danger_section_title")}
            </div>
            <div className={sectionDescClass}>{t("settings.danger_section_desc")}</div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold tracking-[-0.1px] text-dls-text">
                {t("settings.reset_aiwork_title")}
              </div>
              <div className="text-[12px] text-dls-secondary">
                {props.opencodeDevModeEnabled
                  ? t("settings.reset_aiwork_desc_dev")
                  : t("settings.reset_aiwork_desc_prod")}
              </div>
            </div>
            <div
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                props.opencodeDevModeEnabled
                  ? "border-blue-7/35 bg-blue-3/25 text-blue-11"
                  : "border-dls-border bg-dls-sidebar/50 text-dls-secondary"
              }`}
            >
              {props.opencodeDevModeEnabled
                ? t("settings.dev_mode_badge")
                : t("settings.production_mode_badge")}
            </div>
          </div>

          <div className="text-[11px] text-dls-secondary">{t("settings.quit_hint")}</div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={compactDangerActionClass}
              onClick={() => void props.onNukeAiWorkAndOpencodeConfig()}
              disabled={props.busy || props.nukeConfigBusy}
            >
              <CircleAlert size={14} />
              {props.nukeConfigBusy
                ? t("settings.removing_local_state")
                : t("settings.delete_local_config")}
            </button>
            <div className="text-[12px] text-dls-secondary">{t("settings.nuke_hint")}</div>
          </div>

          {props.nukeConfigStatus ? <StatusBanner tone="error" message={props.nukeConfigStatus} /> : null}
        </div>
      ) : null}
    </section>
  );
}
