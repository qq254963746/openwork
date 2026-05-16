/**
 * Filesystem layout for AiWork session checkpoints.
 *
 * All checkpoint data lives entirely outside the user's workspace directory.
 * We never create `.git`, `.aiwork`, or any other file inside the user's project.
 *
 * Resolution priority (first wins):
 *   1. AIWORK_CHECKPOINTS_ROOT  — absolute override (used in tests / advanced setups).
 *   2. AIWORK_APP_LOCAL_DATA_DIR + "/checkpoints" — preferred when launched by the
 *      Tauri desktop app (`app.path().app_local_data_dir()`); guarantees we share
 *      the same root the rest of the app uses.
 *   3. Platform default + bundle-id-style suffix + "/checkpoints":
 *      macOS:  ~/Library/Application Support/com.aiworkgroup3.aiwork/checkpoints/
 *      Linux:  $XDG_DATA_HOME/com.aiworkgroup3.aiwork/checkpoints/
 *               (defaults to ~/.local/share/com.aiworkgroup3.aiwork/checkpoints/)
 *      Win:    %APPDATA%/com.aiworkgroup3.aiwork/checkpoints/
 *
 * Per-session layout:
 *   <root>/<workspaceId>/sessions/<sessionId>/
 *     shadow.git/        bare-but-with-worktree git repo
 *     index              shadow git index file (kept outside shadow.git so multiple sessions
 *                        can coexist without conflicting locks if they ever share a workdir)
 *     checkpoints.json   messageID -> commitSha mapping + light metadata
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";

const CHECKPOINTS_DIRNAME = "checkpoints";
/** Matches Tauri identifier in tauri.conf.json. Used only as a fallback when the
 *  desktop app didn't pass AIWORK_APP_LOCAL_DATA_DIR (e.g. running the server
 *  standalone for testing). */
const FALLBACK_BUNDLE_ID = "com.aiworkgroup3.aiwork";

export function checkpointsRoot(): string {
  // 1. Hard override (tests, advanced users).
  const override = (process.env.AIWORK_CHECKPOINTS_ROOT ?? "").trim();
  if (override) return override;

  // 2. Tauri-provided app_local_data_dir (preferred).
  const tauriLocalData = (process.env.AIWORK_APP_LOCAL_DATA_DIR ?? "").trim();
  if (tauriLocalData) {
    return join(tauriLocalData, CHECKPOINTS_DIRNAME);
  }

  // 3. Platform fallback that mimics what Tauri's `app_local_data_dir()`
  //    would compute for our bundle identifier.
  const home = homedir();
  const plat = platform();

  if (plat === "darwin") {
    return join(home, "Library", "Application Support", FALLBACK_BUNDLE_ID, CHECKPOINTS_DIRNAME);
  }

  if (plat === "win32") {
    const appData = (process.env.APPDATA ?? "").trim();
    const base = appData || join(home, "AppData", "Roaming");
    return join(base, FALLBACK_BUNDLE_ID, CHECKPOINTS_DIRNAME);
  }

  const xdg = (process.env.XDG_DATA_HOME ?? "").trim();
  const base = xdg || join(home, ".local", "share");
  return join(base, FALLBACK_BUNDLE_ID, CHECKPOINTS_DIRNAME);
}

export function workspaceCheckpointDir(workspaceId: string): string {
  if (!workspaceId) throw new Error("workspaceId is required");
  return join(checkpointsRoot(), sanitizeId(workspaceId));
}

export function sessionCheckpointDir(workspaceId: string, sessionId: string): string {
  if (!sessionId) throw new Error("sessionId is required");
  return join(workspaceCheckpointDir(workspaceId), "sessions", sanitizeId(sessionId));
}

export function shadowGitDir(workspaceId: string, sessionId: string): string {
  return join(sessionCheckpointDir(workspaceId, sessionId), "shadow.git");
}

export function shadowIndexFile(workspaceId: string, sessionId: string): string {
  return join(sessionCheckpointDir(workspaceId, sessionId), "index");
}

export function checkpointsManifestFile(workspaceId: string, sessionId: string): string {
  return join(sessionCheckpointDir(workspaceId, sessionId), "checkpoints.json");
}

/**
 * Defensive: workspace and session IDs come from trusted sources (workspace.id is a hash,
 * sessionId from OpenCode), but we still strip path separators / parent-traversal sequences.
 */
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[\\/\u0000]/g, "_").replace(/^\.+/, "_");
  if (!cleaned) throw new Error("invalid id");
  return cleaned;
}
