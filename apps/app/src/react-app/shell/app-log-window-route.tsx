/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ScrollText, Trash2 } from "lucide-react";

import { t } from "../../i18n";
import { Button } from "../design-system/button";
import { useBootState } from "./boot-state";
import {
  fetchEngineInfoForLogViewer,
  fetchOpencodeEngineDiskLogsForLogViewer,
  fetchOpenworkServerInfoForLogViewer,
  isDesktopServiceLogsAvailableInLogViewer,
} from "./desktop-log-viewer-host-bridge";
import {
  pullShellEventsFromMain,
  requestClearMainShellEvents,
} from "../../app/lib/desktop-tauri";
import { isTauriRuntime } from "../../app/utils";
import { LOG_VIEWER_POPUP_QUERY } from "./open-app-log-window";

const POLL_SHELL_MS = 600;
const POLL_SERVICE_MS = 1000;

/** Cap displayed/stored log volume so the log viewer cannot retain unbounded text in memory. */
const LOG_VIEWER_MAX_LINES = 10000;

function truncateLogLines(text: string, maxLines: number): string {
  if (maxLines <= 0 || !text) return text;
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

/** Keeps the newest log lines across shell events (each event may be multi-line JSON). */
function truncateFormattedShellEntries(formattedEntries: string[], maxLines: number): string[] {
  if (maxLines <= 0) return [];
  if (formattedEntries.length === 0) return [];
  const out: string[] = [];
  let budget = maxLines;
  for (let i = formattedEntries.length - 1; i >= 0; i--) {
    const entry = formattedEntries[i];
    const lines = entry.split(/\r?\n/);
    if (lines.length > budget) {
      out.push(lines.slice(-budget).join("\n"));
      break;
    }
    out.push(entry);
    budget -= lines.length;
    if (budget <= 0) break;
  }
  return out.reverse();
}

type LogTabId = "shell" | "openwork_server" | "opencode";

function formatServiceLogs(stdout: string | null | undefined, stderr: string | null | undefined): string {
  const out = (stdout ?? "").toString().trim();
  const err = (stderr ?? "").toString().trim();
  const sections: string[] = [];
  if (out) sections.push(`# stdout\n${out}`);
  if (err) sections.push(`# stderr\n${err}`);
  return sections.join("\n\n");
}

function formatOpencodeDiskLogsSection(
  snapshot: {
    dir: string;
    resolvedVariant: string;
    fileLabel?: string | null;
    content: string;
    error?: string | null;
  },
  emptyDiskLabel: string,
): string {
  const pathLine =
    snapshot.fileLabel && snapshot.dir ? `${snapshot.dir}/${snapshot.fileLabel}` : snapshot.dir || "(unknown)";
  const body =
    snapshot.error && !String(snapshot.content ?? "").trim()
      ? `(error: ${snapshot.error})`
      : String(snapshot.content ?? "").trim() || emptyDiskLabel;
  return `# disk (${snapshot.resolvedVariant})\n${pathLine}\n\n${body}`;
}

function formatEntry(
  entry: { at: number; name: string; data: unknown },
  stringify: (value: unknown) => string,
): string {
  const time = new Date(entry.at).toISOString().slice(11, 23);
  const payload =
    entry.data === null || entry.data === undefined ? "" : `\n${stringify(entry.data)}`;
  return `[${time}] ${entry.name}${payload}`;
}

function resolveOpenerLogApi(): NonNullable<typeof window.__openwork> | null {
  try {
    const openerWindow = window.opener as (Window & { __openwork?: typeof window.__openwork }) | null;
    if (!openerWindow || openerWindow.closed) return null;
    return openerWindow.__openwork ?? null;
  } catch {
    return null;
  }
}

/** Tauri detached log webview uses `open_app_log_window` + `?openworkLogViewer=1` (no `window.opener`). */
function shouldPullShellEventsFromMainShell(): boolean {
  if (!isTauriRuntime()) return false;
  try {
    return new URL(window.location.href).searchParams.get(LOG_VIEWER_POPUP_QUERY) === "1";
  } catch {
    return false;
  }
}

type ShellInspectorEvent = { at: number; name: string; data: unknown };

const tabButtonBase =
  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)]";
const tabButtonIdle = "text-dls-secondary hover:bg-dls-hover hover:text-dls-text";
const tabButtonActive = "bg-dls-hover text-dls-text";

export function AppLogWindowRoute() {
  const { markRouteReady } = useBootState();
  /** Log window never mounts Session/Settings; without this the boot overlay stays up and steals all clicks. */
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  const [tab, setTab] = useState<LogTabId>("shell");
  const [live, setLive] = useState(true);

  const [shellLines, setShellLines] = useState<string[]>([]);
  const [openworkText, setOpenworkText] = useState("");
  const [openworkError, setOpenworkError] = useState<string | null>(null);
  const [opencodeText, setOpencodeText] = useState("");
  const [opencodeError, setOpencodeError] = useState<string | null>(null);

  const preRef = useRef<HTMLPreElement>(null);
  const stickBottomRef = useRef(true);

  const stringify = useCallback((value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  const refreshShell = useCallback(async () => {
    const openerApi = resolveOpenerLogApi();
    if (openerApi) {
      const events = openerApi.events(500);
      setShellLines(
        truncateFormattedShellEntries(
          events.map((e) => formatEntry(e, stringify)),
          LOG_VIEWER_MAX_LINES,
        ),
      );
      return;
    }

    if (shouldPullShellEventsFromMainShell()) {
      try {
        const raw = await pullShellEventsFromMain(500);
        const parsed = JSON.parse(raw) as ShellInspectorEvent[];
        const events = Array.isArray(parsed) ? parsed : [];
        setShellLines(
          truncateFormattedShellEntries(
            events.map((e) => formatEntry(e, stringify)),
            LOG_VIEWER_MAX_LINES,
          ),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setShellLines([`${t("session.app_log_fetch_error")}\n${detail}`]);
      }
      return;
    }

    try {
      if (window.__openwork) {
        const events = window.__openwork.events(500);
        setShellLines(
          truncateFormattedShellEntries(
            events.map((e) => formatEntry(e, stringify)),
            LOG_VIEWER_MAX_LINES,
          ),
        );
        return;
      }
    } catch {
      // ignore
    }

    setShellLines([t("session.app_log_window_no_opener")]);
  }, [stringify, t]);

  const refreshOpenwork = useCallback(async () => {
    if (!isDesktopServiceLogsAvailableInLogViewer()) return;
    setOpenworkError(null);
    try {
      const info = await fetchOpenworkServerInfoForLogViewer();
      const raw = formatServiceLogs(info.lastStdout, info.lastStderr);
      setOpenworkText(truncateLogLines(raw || t("settings.no_logs_captured"), LOG_VIEWER_MAX_LINES));
    } catch (error) {
      setOpenworkError(error instanceof Error ? error.message : String(error));
      setOpenworkText("");
    }
  }, []);

  const refreshOpencode = useCallback(async () => {
    if (!isDesktopServiceLogsAvailableInLogViewer()) return;
    setOpencodeError(null);
    try {
      const [disk, info] = await Promise.all([
        fetchOpencodeEngineDiskLogsForLogViewer(),
        fetchEngineInfoForLogViewer(),
      ]);
      const sections: string[] = [
        formatOpencodeDiskLogsSection(disk, t("settings.no_logs_captured")),
      ];
      const capture = formatServiceLogs(info.lastStdout, info.lastStderr);
      if (capture.trim()) {
        sections.push(`# process capture\n${capture}`);
      }
      setOpencodeText(truncateLogLines(sections.join("\n\n"), LOG_VIEWER_MAX_LINES));
    } catch (error) {
      setOpencodeError(error instanceof Error ? error.message : String(error));
      setOpencodeText("");
    }
  }, []);

  const refreshActive = useCallback(async () => {
    if (tab === "shell") await refreshShell();
    else if (tab === "openwork_server") await refreshOpenwork();
    else await refreshOpencode();
  }, [refreshOpencode, refreshOpenwork, refreshShell, tab]);

  useEffect(() => {
    stickBottomRef.current = true;
    void refreshActive();
  }, [refreshActive, tab]);

  useEffect(() => {
    if (!live) return;
    const ms = tab === "shell" ? POLL_SHELL_MS : POLL_SERVICE_MS;
    const id = window.setInterval(() => {
      void refreshActive();
    }, ms);
    return () => window.clearInterval(id);
  }, [live, refreshActive, tab]);

  const displayBody = useMemo(() => {
    if (tab === "openwork_server" || tab === "opencode") {
      if (!isDesktopServiceLogsAvailableInLogViewer()) return t("session.app_log_services_desktop_only");
      if (tab === "openwork_server") {
        if (openworkError) return `${t("session.app_log_fetch_error")}\n${openworkError}`;
        return openworkText || t("settings.no_logs_captured");
      }
      if (opencodeError) return `${t("session.app_log_fetch_error")}\n${opencodeError}`;
      return opencodeText || t("settings.no_logs_captured");
    }
    return shellLines.length === 0 ? t("session.app_log_empty") : shellLines.join("\n\n");
  }, [openworkError, openworkText, opencodeError, opencodeText, shellLines, tab]);

  useEffect(() => {
    const el = preRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [displayBody]);

  const handleScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const threshold = 48;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  const handleClear = () => {
    const openerApi = resolveOpenerLogApi();
    if (openerApi) {
      openerApi.clearEvents();
      void refreshShell();
      return;
    }
    if (shouldPullShellEventsFromMainShell()) {
      void requestClearMainShellEvents()
        .then(() => refreshShell())
        .catch(() => void refreshShell());
      return;
    }
    window.__openwork?.clearEvents();
    void refreshShell();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayBody);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text">
      <header className="flex shrink-0 flex-col gap-3 border-b border-dls-border bg-dls-surface px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ScrollText className="h-5 w-5 shrink-0 text-dls-secondary" aria-hidden />
            <h1 className="truncate text-base font-semibold text-dls-text">{t("session.app_log_title")}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-dls-secondary">
              <input
                type="checkbox"
                className="rounded border-dls-border"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
              {live ? t("session.app_log_live_on") : t("session.app_log_live_off")}
            </label>
            <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void refreshActive()}>
              {t("session.app_log_refresh")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-3 py-1.5 text-xs disabled:opacity-40"
              onClick={handleClear}
              disabled={tab !== "shell"}
              aria-label={t("session.app_log_clear")}
              title={tab !== "shell" ? t("session.app_log_clear_shell_only") : undefined}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("session.app_log_clear")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-3 py-1.5 text-xs"
              onClick={() => void handleCopy()}
              aria-label={t("session.app_log_copy")}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t("session.app_log_copy")}
            </Button>
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.close()}>
              {t("session.app_log_close_window")}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("session.app_log_sources_label")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shell"}
            className={`${tabButtonBase} ${tab === "shell" ? tabButtonActive : tabButtonIdle}`}
            onClick={() => setTab("shell")}
          >
            {t("session.app_log_tab_shell")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "openwork_server"}
            className={`${tabButtonBase} ${tab === "openwork_server" ? tabButtonActive : tabButtonIdle}`}
            onClick={() => setTab("openwork_server")}
          >
            {t("settings.openwork_server_label")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "opencode"}
            className={`${tabButtonBase} ${tab === "opencode" ? tabButtonActive : tabButtonIdle}`}
            onClick={() => setTab("opencode")}
          >
            {t("settings.opencode_engine_sidecar")}
          </button>
        </div>
      </header>

      <pre
        ref={preRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-dls-sidebar/30 px-4 py-3 font-mono text-[11px] leading-relaxed text-dls-text md:px-5"
      >
        {displayBody}
      </pre>
    </div>
  );
}
