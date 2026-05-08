import type {
  EngineInfo,
  OpencodeEngineDiskLogsSnapshot,
  OpenworkServerInfo,
} from "../../app/lib/desktop-tauri";
import { engineInfo, openworkServerInfo, readOpencodeEngineDiskLogs } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";

export type DesktopLogViewerHostBridge = {
  engineInfo: () => Promise<EngineInfo>;
  /** Added after disk-backed OpenCode logs; older host shells may omit this. */
  readOpencodeEngineDiskLogs?: () => Promise<OpencodeEngineDiskLogsSnapshot>;
  openworkServerInfo: () => Promise<OpenworkServerInfo>;
};

declare global {
  interface Window {
    /** Pop-out log viewer (no Tauri/Electron prelude) calls these on `window.opener`. */
    __openworkDesktopLogBridge?: DesktopLogViewerHostBridge;
  }
}

/** Install on the main shell window so `window.open` log viewers can reach desktop IPC. */
export function installDesktopLogViewerHostBridge(): void {
  if (typeof window === "undefined") return;
  if (!isDesktopRuntime()) return;
  if (window.__openworkDesktopLogBridge) return;
  window.__openworkDesktopLogBridge = {
    engineInfo: () => engineInfo(),
    readOpencodeEngineDiskLogs: () => readOpencodeEngineDiskLogs(),
    openworkServerInfo: () => openworkServerInfo(),
  };
}

export function resolveDesktopLogViewerBridge(): DesktopLogViewerHostBridge | null {
  if (typeof window === "undefined") return null;
  try {
    if (isDesktopRuntime()) {
      return window.__openworkDesktopLogBridge ?? null;
    }
    const openerWindow = window.opener as Window | null;
    if (!openerWindow || openerWindow.closed) return null;
    return openerWindow.__openworkDesktopLogBridge ?? null;
  } catch {
    return null;
  }
}

/** True when this frame has desktop IPC, or the opener exposed {@link installDesktopLogViewerHostBridge}. */
export function isDesktopServiceLogsAvailableInLogViewer(): boolean {
  if (isDesktopRuntime()) return true;
  return resolveDesktopLogViewerBridge() != null;
}

export async function fetchEngineInfoForLogViewer(): Promise<EngineInfo> {
  if (isDesktopRuntime()) return engineInfo();
  const bridge = resolveDesktopLogViewerBridge();
  if (!bridge) throw new Error("desktop_log_bridge_missing");
  return bridge.engineInfo();
}

export async function fetchOpencodeEngineDiskLogsForLogViewer(): Promise<OpencodeEngineDiskLogsSnapshot> {
  if (isDesktopRuntime()) return readOpencodeEngineDiskLogs();
  const bridge = resolveDesktopLogViewerBridge();
  if (!bridge) throw new Error("desktop_log_bridge_missing");
  const reader = bridge.readOpencodeEngineDiskLogs;
  if (!reader) {
    return {
      dir: "",
      resolvedVariant: "none",
      fileLabel: null,
      content: "",
      error: "desktop_log_bridge_outdated",
    };
  }
  return reader();
}

export async function fetchOpenworkServerInfoForLogViewer(): Promise<OpenworkServerInfo> {
  if (isDesktopRuntime()) return openworkServerInfo();
  const bridge = resolveDesktopLogViewerBridge();
  if (!bridge) throw new Error("desktop_log_bridge_missing");
  return bridge.openworkServerInfo();
}
