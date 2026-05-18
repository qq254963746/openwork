import { existsSync } from "node:fs";
import { join } from "node:path";

export function engineConfigPath(workspaceRoot: string): string {
  const jsoncPath = join(workspaceRoot, "engine.jsonc");
  const jsonPath = join(workspaceRoot, "engine.json");
  const hiddenJsoncPath = join(workspaceRoot, ".engine", "engine.jsonc");
  const hiddenJsonPath = join(workspaceRoot, ".engine", "engine.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  if (existsSync(jsonPath)) return jsonPath;
  if (existsSync(hiddenJsoncPath)) return hiddenJsoncPath;
  if (existsSync(hiddenJsonPath)) return hiddenJsonPath;
  return jsoncPath;
}

export function aiworkConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".engine", "aiwork.json");
}

export function projectSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".engine", "skills");
}

export function projectCommandsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".engine", "commands");
}

export function projectPluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".engine", "plugins");
}
