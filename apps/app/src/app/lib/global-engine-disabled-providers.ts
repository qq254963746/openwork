import { applyEdits, modify, parse } from "jsonc-parser";

import type { AiWorkServerClient } from "./aiwork-server";
import type { EngineConfigFile } from "./desktop-tauri";
import { readEngineConfig, writeEngineConfig } from "./desktop";
import { ConsoleLog } from "./console-log";

const DEFAULT_GLOBAL_CONFIG_HEADER =
  '{\n  "$schema": "https://www.aiwork.love/config.json"\n}\n';

const PROJECT_ENGINE_JSONC_FORMAT = { insertSpaces: true, tabSize: 2 };

export type ReadGlobalEngineConfigInput = {
  workspaceRoot: string;
  selectedWorkspaceId: string;
  runtimeWorkspaceId: string | null;
  aiworkServerStatus: "connected" | "disconnected" | "limited";
  aiworkServerClient: AiWorkServerClient | null;
  aiworkServerCapabilities: { config?: { read?: boolean; write?: boolean } } | null;
};

function resolveAiWorkWorkspaceId(input: ReadGlobalEngineConfigInput): string | null {
  const fromRuntime = input.runtimeWorkspaceId?.trim();
  if (fromRuntime) return fromRuntime;
  const fromSelected = input.selectedWorkspaceId.trim();
  return fromSelected.length > 0 ? fromSelected : null;
}

/** Resolve global Engine config file (~/.config/engine/… or AiWork server workspace global scope). */
export async function readGlobalEngineConfigFile(
  input: ReadGlobalEngineConfigInput,
): Promise<EngineConfigFile | null> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.read &&
    typeof input.aiworkServerClient.readEngineConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    return await input.aiworkServerClient.readEngineConfigFile(aiworkWorkspaceId, "global");
  }

  return await readEngineConfig("global", input.workspaceRoot);
}

export async function writeGlobalEngineConfigContent(
  input: ReadGlobalEngineConfigInput,
  content: string,
): Promise<boolean> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.write &&
    typeof input.aiworkServerClient.writeEngineConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    const result = await input.aiworkServerClient.writeEngineConfigFile(
      aiworkWorkspaceId,
      "global",
      content,
    );
    return result.ok;
  }

  const result = await writeEngineConfig("global", input.workspaceRoot, content);
  return result.ok;
}

export function parseDisabledProvidersFromEngineJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const parsed = parse(raw, undefined, { allowTrailingComma: true }) as
    | Record<string, unknown>
    | undefined;
  const dp = parsed?.disabled_providers;
  if (!Array.isArray(dp)) return [];
  return dp.filter((item): item is string => typeof item === "string");
}

export async function readGlobalDisabledProviderIds(
  input: ReadGlobalEngineConfigInput,
): Promise<string[]> {
  const file = await readGlobalEngineConfigFile(input);
  return parseDisabledProvidersFromEngineJson(file?.content ?? null);
}

export async function writeGlobalDisabledProviderIds(
  input: ReadGlobalEngineConfigInput,
  ids: string[],
): Promise<boolean> {
  const existing = await readGlobalEngineConfigFile(input);
  const raw = existing?.content?.trim() ? existing.content : DEFAULT_GLOBAL_CONFIG_HEADER;
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const edits = modify(raw, ["disabled_providers"], uniqueIds, {
    formattingOptions: PROJECT_ENGINE_JSONC_FORMAT,
  });
  const nextContent = applyEdits(raw, edits);
  return await writeGlobalEngineConfigContent(input, nextContent);
}

export async function removeGlobalDisabledProviderIds(
  input: ReadGlobalEngineConfigInput,
  removeIds: string[],
): Promise<boolean> {
  const remove = new Set(removeIds.map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return false;
  const current = await readGlobalDisabledProviderIds(input);
  const next = current.filter((id) => !remove.has(id));
  if (next.length === current.length) return false;
  return await writeGlobalDisabledProviderIds(input, next);
}
