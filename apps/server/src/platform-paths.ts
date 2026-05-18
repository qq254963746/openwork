/**
 * Resolve the root data directory for all AiWork components.
 *
 * AIWORK_APP_LOCAL_DATA_DIR must be set by the Tauri desktop app.
 * If running standalone, set this env var manually.
 */
export function resolveAppLocalDataDir(): string {
  const dir = (process.env.AIWORK_APP_LOCAL_DATA_DIR ?? "").trim();
  if (!dir) {
    throw new Error(
      "AIWORK_APP_LOCAL_DATA_DIR is required. AiWork Server must be started via AiWork Desktop or with this env var set.",
    );
  }
  return dir;
}