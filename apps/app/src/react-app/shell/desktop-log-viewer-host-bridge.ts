import type {
  EngineInfo,
  OpencodeEngineDiskLogsSnapshot,
  AiWorkServerInfo,
} from "../../app/lib/desktop-tauri";
import { engineInfo, aiworkServerInfo, readOpencodeEngineDiskLogs } from "../../app/lib/desktop";

export type DesktopLogViewerHostBridge = {
  engineInfo: () => Promise<EngineInfo>;
  /** Added after disk-backed OpenCode logs; older host shells may omit this. */
  readOpencodeEngineDiskLogs?: () => Promise<OpencodeEngineDiskLogsSnapshot>;
  aiworkServerInfo: () => Promise<AiWorkServerInfo>;
};

declare global {
  interface Window {
    /** Pop-out log viewer (no Tauri/Electron prelude) calls these on `window.opener`. */
    __aiworkDesktopLogBridge?: DesktopLogViewerHostBridge;
  }
}

/** Install on the main shell window so `window.open` log viewers can reach desktop IPC. */
export function installDesktopLogViewerHostBridge(): void {
  if (typeof window === "undefined") return;
  if (window.__aiworkDesktopLogBridge) return;
  window.__aiworkDesktopLogBridge = {
    engineInfo: () => engineInfo(),
    readOpencodeEngineDiskLogs: () => readOpencodeEngineDiskLogs(),
    aiworkServerInfo: () => aiworkServerInfo(),
  };
}

export function resolveDesktopLogViewerBridge(): DesktopLogViewerHostBridge | null {
  if (typeof window === "undefined") return null;
  try {
    if (window.__aiworkDesktopLogBridge) return window.__aiworkDesktopLogBridge;
    const openerWindow = window.opener as Window | null;
    if (!openerWindow || openerWindow.closed) return null;
    return openerWindow.__aiworkDesktopLogBridge ?? null;
  } catch {
    return null;
  }
}

/** True when this frame has desktop IPC, or the opener exposed {@link installDesktopLogViewerHostBridge}. */
export function isDesktopServiceLogsAvailableInLogViewer(): boolean {
  return resolveDesktopLogViewerBridge() != null;
}

export async function fetchEngineInfoForLogViewer(): Promise<EngineInfo> {
  try {
    return await engineInfo();
  } catch {
    const bridge = resolveDesktopLogViewerBridge();
    if (!bridge) throw new Error("desktop_log_bridge_missing");
    return bridge.engineInfo();
  }
}

export async function fetchOpencodeEngineDiskLogsForLogViewer(): Promise<OpencodeEngineDiskLogsSnapshot> {
  try {
    return await readOpencodeEngineDiskLogs();
  } catch {
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
}

export async function fetchAiWorkServerInfoForLogViewer(): Promise<AiWorkServerInfo> {
  try {
    return await aiworkServerInfo();
  } catch {
    const bridge = resolveDesktopLogViewerBridge();
    if (!bridge) throw new Error("desktop_log_bridge_missing");
    return bridge.aiworkServerInfo();
  }
}
