/** @jsxImportSource react */
import { useEffect } from "react";

import {
  engineInfo,
  engineStart,
  aiworkServerInfo,
  resolveWorkspaceListSelectedId,
  runtimeBootstrap,
  workspaceBootstrap,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
} from "../../app/lib/desktop";
import {
  hydrateAiWorkServerSettingsFromEnv,
  writeAiWorkServerSettings,
} from "../../app/lib/aiwork-server";
import { safeStringify } from "../../app/utils";
import { useServer } from "../kernel/server-provider";
import { useBootState } from "./boot-state";

// Module-scoped latch so React Strict-Mode's "mount-unmount-remount" cycle in
// dev only triggers the boot sequence once per app launch, and the async work
// keeps running across the transient unmount.
let BOOT_STARTED = false;

/**
 * Returns true when Tauri's IPC layer appears ready to accept invoke calls.
 *
 * The Tauri 2 webview initializes its IPC bridge asynchronously after the page
 * load event.  During that brief window the first invoke() call can fail with
 * "IPC custom protocol failed" followed by "TypeError: Load failed".
 *
 * We probe window.__TAURI_INTERNALS__ (populated synchronously once the bridge
 * is wired) as a lightweight readiness signal.
 */
function isTauriIpcReady(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Tauri 2 populates __TAURI_INTERNALS__ on the window object once the
    // IPC bridge has been wired.  The exact shape varies across versions
    // but its mere presence is a reliable signal that invoke() is usable.
    const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    return !!(w.__TAURI_INTERNALS__ || w.__TAURI__);
  } catch {
    return false;
  }
}

/**
 * Wait for Tauri's IPC bridge to become ready, polling every 50ms.
 * Returns once readiness is confirmed or the timeout is reached.
 *
 * @param timeoutMs  Maximum time to wait (default 3000ms)
 * @returns true if IPC is ready, false if timeout was reached
 */
function waitForTauriReady(timeoutMs = 3000): Promise<boolean> {
  if (isTauriIpcReady()) return Promise.resolve(true);

  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (isTauriIpcReady()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Execute a function with retry on failure.  Uses exponential backoff starting
 * at 100ms, capped at 1s between attempts.
 *
 * Designed for Tauri invoke calls that may fail transiently during IPC
 * bridge initialization.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  startDelayMs = 100,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.min(startDelayMs * Math.pow(2, attempt), 1000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * On desktop (Tauri) startup:
 *   1) bootstrap the workspace list
 *   2) if a local workspace is selected, restart the embedded AiWork server
 *   3) start the AiWork engine pointed at the workspace
 *   4) activate the workspace on the running AiWork server
 *   5) notify React routes that fresh desktop runtime info is available.
 *
 * Safe to call multiple times — gated by a `didBoot` ref so it runs once per mount.
 */
export function useDesktopRuntimeBoot() {
  const { setPhase, setError, markReady } = useBootState();
  const { setActive } = useServer();

  useEffect(() => {
    if (BOOT_STARTED) return;
    BOOT_STARTED = true;

    void (async () => {
      try {
        hydrateAiWorkServerSettingsFromEnv();

        // Wait for Tauri's IPC bridge to be ready before making the first
        // invoke() call.  During the first ~100-300ms after page load the
        // Tauri webview wires its IPC handlers asynchronously; calling
        // invoke() before that window yields "IPC custom protocol failed"
        // and "TypeError: Load failed".
        const tauriReady = await waitForTauriReady(3000);
        if (!tauriReady) {
          console.warn(
            "[desktop-boot] Tauri IPC bridge not ready after 3s; " +
            "proceeding with best-effort retries.",
          );
        }

        setPhase("bootstrapping-workspaces");
        const list = await retryWithBackoff(
          () => workspaceBootstrap(),
          3,
          150,
        ).catch(() => null);
        if (!list) {
          markReady();
          return;
        }

        const selectedId = resolveWorkspaceListSelectedId(list);
        const workspace = selectedId
          ? list.workspaces.find((w) => w.id === selectedId)
          : undefined;
        if (!workspace) {
          markReady();
          return;
        }

        const workspaceRoot = workspace.path?.trim();
        if (!workspaceRoot) {
          markReady();
          return;
        }

        // FAST PATH ─────────────────────────────────────────────────────
        // Cheap status probe: if engine is already running just publish the
        // current aiwork-server base URL + token and finish in <1s.
        // This mirrors Solid's bootstrap at context/workspace.ts:3883-3907
        // ("localAttachExisting"), which never restarts a running stack.
        try {
          const engine = await retryWithBackoff(() => engineInfo(), 2, 100);
          if (engine?.running && engine.baseUrl) {
            setActive(engine.baseUrl);
            const fresh = await aiworkServerInfo().catch(() => null);
            if (fresh?.baseUrl) {
              writeAiWorkServerSettings({
                urlOverride: fresh.baseUrl,
                token:
                  fresh.ownerToken?.trim() ||
                  fresh.clientToken?.trim() ||
                  undefined,
                hostToken: fresh.hostToken?.trim() || undefined,
                portOverride: fresh.port ?? undefined,
              });
              try {
                window.dispatchEvent(
                  new CustomEvent("aiwork-server-settings-changed"),
                );
              } catch {
                /* ignore */
              }
            }
            markReady();
            return;
          }
        } catch {
          // engineInfo is best-effort; fall through to the slow path.
        }

        // SLOW PATH ─────────────────────────────────────────────────────
        // No running engine. engine_start boots aiwork-server and lets that
        // server manage AiWork.
        const localPaths = list.workspaces
          .map((entry) => entry.path?.trim() ?? "")
          .filter((path): path is string => path.length > 0);
        const workspacePathsFor = (root: string) => {
          const paths = [root];
          for (const path of localPaths) {
            if (!paths.includes(path)) paths.push(path);
          }
          return paths;
        };

        setPhase("starting-engine", "Starting your workspace");
        let engineStartResult = await engineStart(workspaceRoot, {
          runtime: "direct",
          workspacePaths: workspacePathsFor(workspaceRoot),
        }).catch((error) => {
          console.warn("[desktop-boot] engineStart failed:", error);
          return null;
        });

        if (!engineStartResult) {
          const fallback = list.workspaces.find((entry) => {
            const path = entry.path?.trim() ?? "";
            return path && path !== workspaceRoot;
          });
          const fallbackRoot = fallback?.path?.trim() ?? "";
          if (fallback && fallbackRoot) {
            console.warn("[desktop-boot] selected workspace failed; trying fallback workspace", {
              selectedWorkspaceId: workspace.id,
              fallbackWorkspaceId: fallback.id,
            });
            setPhase("starting-engine", "Starting another workspace");
            engineStartResult = await engineStart(fallbackRoot, {
              runtime: "direct",
              workspacePaths: workspacePathsFor(fallbackRoot).filter((path) => path !== workspaceRoot),
            }).catch((error) => {
              console.warn("[desktop-boot] fallback engineStart failed:", error);
              setError(error instanceof Error ? error.message : safeStringify(error));
              return null;
            });
            if (engineStartResult) {
              void workspaceSetSelected(fallback.id).catch(() => undefined);
              void workspaceSetRuntimeActive(fallback.id).catch(() => undefined);
            }
          } else {
            setError("Failed to start the selected workspace.");
          }
        }

        if (engineStartResult) {
          if (engineStartResult.baseUrl) {
            setActive(engineStartResult.baseUrl);
          }
          try {
            const freshInfo = await aiworkServerInfo();
            if (freshInfo?.baseUrl) {
              writeAiWorkServerSettings({
                urlOverride: freshInfo.baseUrl,
                token:
                  freshInfo.ownerToken?.trim() ||
                  freshInfo.clientToken?.trim() ||
                  undefined,
                hostToken: freshInfo.hostToken?.trim() || undefined,
                portOverride: freshInfo.port ?? undefined,
              });
              try {
                window.dispatchEvent(new CustomEvent("aiwork-server-settings-changed"));
              } catch {
                /* ignore */
              }
            }
          } catch (error) {
            console.warn("[desktop-boot] post-engineStart aiworkServerInfo failed:", error);
          }
        }

        markReady();
      } catch (error) {
        console.warn("[desktop-boot] fatal:", error);
        setError(error instanceof Error ? error.message : safeStringify(error));
      }
    })();
  }, [markReady, setActive, setError, setPhase]);
}

/**
 * Component wrapper that must be rendered inside <BootStateProvider>. It runs
 * the boot hook exactly once per app mount so callers don't have to think
 * about React Strict-Mode double-invocation.
 */
export function DesktopRuntimeBoot(): null {
  useDesktopRuntimeBoot();
  return null;
}
