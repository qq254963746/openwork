import { existsSync } from "node:fs";
import { join } from "node:path";

export function opencodeConfigPath(workspaceRoot: string): string {
  const jsoncPath = join(workspaceRoot, "opencode.jsonc");
  const jsonPath = join(workspaceRoot, "opencode.json");
  const hiddenJsoncPath = join(workspaceRoot, ".aiwork-opencode", "opencode.jsonc");
  const hiddenJsonPath = join(workspaceRoot, ".aiwork-opencode", "opencode.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  if (existsSync(jsonPath)) return jsonPath;
  if (existsSync(hiddenJsoncPath)) return hiddenJsoncPath;
  if (existsSync(hiddenJsonPath)) return hiddenJsonPath;
  return jsoncPath;
}

export function aiworkConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".aiwork-opencode", "aiwork.json");
}

export function projectSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".aiwork-opencode", "skills");
}

export function projectCommandsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".aiwork-opencode", "commands");
}

export function projectPluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".aiwork-opencode", "plugins");
}
