import { basename, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "./utils.js";
import { ApiError } from "./errors.js";
import { aiworkConfigPath, opencodeConfigPath } from "./workspace-files.js";
import { readJsoncFile, writeJsoncFile } from "./jsonc.js";
import { DEFAULT_AGENT } from "./engine-db.js";

const AIWORK_AGENT = `---
description: AiWork default agent
mode: primary
temperature: 0.2
---

You are AiWork.

Help the user work on files safely from this workspace. Prefer clear, practical steps. If required setup or credentials are missing, ask one targeted question and continue once provided.
`;

const ASK_AGENT = `---
description: Ask mode — answer questions without modifying files or running commands
mode: primary
temperature: 0.3
---

You are in Ask mode.

Your role:
- Answer questions, explain concepts, review code, and provide guidance.
- Read files when needed to understand context.
- NEVER modify, create, or delete files.
- NEVER run shell commands that change the filesystem or have side effects.
- NEVER use tools that write, edit, or execute code.

If the user asks you to make changes, politely suggest they switch back to the default agent (AiWork) for that task.
`;

type WorkspaceAiWorkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

function normalizePreset(preset: string | null | undefined): string {
  const trimmed = preset?.trim() ?? "";
  if (!trimmed) return "starter";
  return trimmed;
}

async function ensureWorkspaceAiWorkConfig(workspaceRoot: string, preset: string): Promise<void> {
  const path = aiworkConfigPath(workspaceRoot);
  if (await exists(path)) return;
  const now = Date.now();
  const config: WorkspaceAiWorkConfig = {
    version: 1,
    workspace: {
      name: basename(workspaceRoot) || "Workspace",
      createdAt: now,
      preset,
    },
    authorizedRoots: [workspaceRoot],
    reload: null,
  };
  await ensureDir(join(workspaceRoot, ".opencode"));
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function ensureAiWorkEngineConfig(workspaceRoot: string): Promise<void> {
  const path = opencodeConfigPath(workspaceRoot);
  const { data } = await readJsoncFile<Record<string, unknown>>(path, {
    $schema: "https://www.aiwork.love/config.json",
  });
  const next: Record<string, unknown> = data && typeof data === "object" && !Array.isArray(data)
    ? { ...data }
    : { $schema: "https://www.aiwork.love/config.json" };

  if (typeof next.default_agent !== "string" || !next.default_agent.trim()) {
    next.default_agent = DEFAULT_AGENT;
  }

  await writeJsoncFile(path, next);
}

async function ensureAiWorkAgent(workspaceRoot: string): Promise<void> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  const agentPath = join(agentsDir, "aiwork.md");
  if (await exists(agentPath)) return;
  await ensureDir(agentsDir);
  await writeFile(agentPath, AIWORK_AGENT.endsWith("\n") ? AIWORK_AGENT : `${AIWORK_AGENT}\n`, "utf8");
}

async function ensureAskAgent(workspaceRoot: string): Promise<void> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  const agentPath = join(agentsDir, "ask.md");
  if (await exists(agentPath)) return;
  await ensureDir(agentsDir);
  await writeFile(agentPath, ASK_AGENT.endsWith("\n") ? ASK_AGENT : `${ASK_AGENT}\n`, "utf8");
}

export async function ensureWorkspaceFiles(workspaceRoot: string, presetInput: string): Promise<void> {
  const preset = normalizePreset(presetInput);
  if (!workspaceRoot.trim()) {
    throw new ApiError(400, "invalid_workspace_path", "workspace path is required");
  }
  await ensureDir(workspaceRoot);
  await ensureAiWorkEngineConfig(workspaceRoot);

  await ensureAiWorkAgent(workspaceRoot);

  await ensureAskAgent(workspaceRoot);
  await ensureWorkspaceAiWorkConfig(workspaceRoot, preset);
}

export async function readRawAiWorkEngineConfig(path: string): Promise<{ exists: boolean; content: string | null }> {
  const hasFile = await exists(path);
  if (!hasFile) {
    return { exists: false, content: null };
  }
  const content = await readFile(path, "utf8");
  return { exists: true, content };
}
