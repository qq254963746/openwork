/**
 * Filesystem layout for AiWork session checkpoints.
 *
 * All checkpoint data lives entirely outside the user's workspace directory,
 * under the unified AiWork data root at {appLocalDataDir}/server/checkpoints/.
 *
 * Resolution priority (first wins):
 *   1. AIWORK_CHECKPOINTS_ROOT  — absolute override (used in tests / advanced setups).
 *   2. AIWORK_APP_LOCAL_DATA_DIR + "/server/checkpoints" — preferred when launched by the
 *      Tauri desktop app.
 *   3. Platform default via resolveAppLocalDataDir() + "/server/checkpoints".
 *
 * Per-session layout:
 *   <root>/<workspaceId>/sessions/<sessionId>/
 *     shadow.git/        bare-but-with-worktree git repo
 *     index              shadow git index file
 *     checkpoints.json   messageID -> commitSha mapping + light metadata
 */
import { join } from "node:path";
import { resolveAppLocalDataDir } from "./platform-paths.js";

const CHECKPOINTS_DIRNAME = "checkpoints";

export function checkpointsRoot(): string {
  // 1. Hard override (tests, advanced users).
  const override = (process.env.AIWORK_CHECKPOINTS_ROOT ?? "").trim();
  if (override) return override;

  // 2. Unified path under app data dir + server/checkpoints.
  return join(resolveAppLocalDataDir(), "server", CHECKPOINTS_DIRNAME);
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
 * sessionId from Engine), but we still strip path separators / parent-traversal sequences.
 */
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[\\/\u0000]/g, "_").replace(/^\.+/, "_");
  if (!cleaned) throw new Error("invalid id");
  return cleaned;
}