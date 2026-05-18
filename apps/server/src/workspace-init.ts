import { readFile } from "node:fs/promises";

import { ensureDir, exists } from "./utils.js";
import { ApiError } from "./errors.js";

export async function ensureWorkspaceFiles(workspaceRoot: string, _presetInput: string): Promise<void> {
  if (!workspaceRoot.trim()) {
    throw new ApiError(400, "invalid_workspace_path", "workspace path is required");
  }
  // Only ensure the workspace directory exists. All project-level config files
  // (engine.jsonc, aiwork.json, agents, skills, commands) are managed by the
  // desktop app under project_config_dir and should NOT be written to the
  // user's workspace folder.
  await ensureDir(workspaceRoot);
}

export async function readRawEngineConfig(path: string): Promise<{ exists: boolean; content: string | null }> {
  const hasFile = await exists(path);
  if (!hasFile) {
    return { exists: false, content: null };
  }
  const content = await readFile(path, "utf8");
  return { exists: true, content };
}