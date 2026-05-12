import { openAppLogWebviewWindow } from "../../app/lib/desktop-tauri";

const APP_LOG_WINDOW_NAME = "aiworkAppLog";

/** Lets the popup detect a deliberate launch even when `window.opener` is missing (some embedded WebViews). */
export const LOG_VIEWER_POPUP_QUERY = "aiworkLogViewer";

const LOG_VIEWER_LAUNCH_STORAGE_KEY = "aiwork.logViewerLaunch";

type LaunchPayload = { route: string; at: number };

const LAUNCH_TTL_MS = 60_000;

export function primeLogViewerPopupNavigation(): void {
  try {
    const payload: LaunchPayload = { route: "/devtools/app-log", at: Date.now() };
    localStorage.setItem(LOG_VIEWER_LAUNCH_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function shouldTrustPopupNavigationHandshake(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get(LOG_VIEWER_POPUP_QUERY) === "1") return true;
  } catch {
    // ignore
  }
  try {
    return window.opener != null;
  } catch {
    return false;
  }
}

/**
 * Some hosts drop the `#/…` fragment on `window.open`. Run synchronously before React Router mounts:
 * read one-shot localStorage + query/`opener` handshake, then `replaceState` onto `/devtools/app-log`.
 */
export function applyLogViewerPopupNavigationFromStorage(): void {
  if (typeof window === "undefined") return;
  if (!shouldTrustPopupNavigationHandshake()) return;

  let payload: LaunchPayload | null = null;
  try {
    const raw = localStorage.getItem(LOG_VIEWER_LAUNCH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<LaunchPayload>;
    if (typeof parsed.route !== "string" || typeof parsed.at !== "number") {
      localStorage.removeItem(LOG_VIEWER_LAUNCH_STORAGE_KEY);
      return;
    }
    if (Date.now() - parsed.at > LAUNCH_TTL_MS) {
      localStorage.removeItem(LOG_VIEWER_LAUNCH_STORAGE_KEY);
      return;
    }
    payload = parsed as LaunchPayload;
  } catch {
    try {
      localStorage.removeItem(LOG_VIEWER_LAUNCH_STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  try {
    localStorage.removeItem(LOG_VIEWER_LAUNCH_STORAGE_KEY);
  } catch {
    // ignore
  }

  const route = payload.route.startsWith("/") ? payload.route : `/${payload.route}`;

  try {
    const u = new URL(window.location.href);
    u.searchParams.delete(LOG_VIEWER_POPUP_QUERY);

    u.hash = `#${route}`;

    window.history.replaceState(null, "", u.toString());
  } catch {
    try {
      window.location.hash = `#${route}`;
    } catch {
      // ignore
    }
  }
}

export function buildAppLogWindowUrl(): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.searchParams.set(LOG_VIEWER_POPUP_QUERY, "1");
  u.hash = "#/devtools/app-log";
  return u.href;
}

/** Opens (or focuses) a detached log viewer window; requires `opener` so logs read from the main shell. */
export function openAppLogWindow(): Window | null {
  if (typeof window === "undefined") return null;

  void openAppLogWebviewWindow().catch(() => {
    try {
      window.location.hash = "#/devtools/app-log";
    } catch {
      // ignore
    }
  });
  return null;
}
