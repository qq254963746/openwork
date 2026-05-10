import { isTauriRuntime } from "../../app/utils";
import { ensureInspectorInstalled } from "./app-inspector";

const EVENT_SHELL_EVENTS_REQUEST = "aiwork-shell-events-request";
const EVENT_SHELL_CLEAR_REQUEST = "aiwork-shell-clear-request";

/**
 * Listeners on the **main** webview only: answers IPC pull/clear for the detached `app-log` window.
 */
export async function installDesktopShellEventsBridgeListeners(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  if (getCurrentWebviewWindow().label !== "main") return;

  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);

  await listen<{ limit?: number }>(EVENT_SHELL_EVENTS_REQUEST, async (event) => {
    ensureInspectorInstalled();
    const rawLimit = event.payload.limit;
    const limit = typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : 500;
    try {
      const entries = window.__aiwork?.events(limit) ?? [];
      await invoke("shell_events_bridge_reply", { eventsJson: JSON.stringify(entries) });
    } catch {
      await invoke("shell_events_bridge_reply", { eventsJson: "[]" });
    }
  });

  await listen(EVENT_SHELL_CLEAR_REQUEST, async () => {
    try {
      window.__aiwork?.clearEvents();
    } finally {
      await invoke("shell_events_clear_bridge_ack");
    }
  });
}
