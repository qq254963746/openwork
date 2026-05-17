import { applyEdits, modify, parse } from "jsonc-parser";

import type { AiWorkServerClient } from "./aiwork-server";
import type { AiWorkEngineConfigFile } from "./desktop-tauri";
import { readAiWorkEngineConfig, writeAiWorkEngineConfig } from "./desktop";
import { ConsoleLog } from "./console-log";

const DEFAULT_GLOBAL_CONFIG_HEADER =
  '{\n  "$schema": "https://www.aiwork.love/config.json"\n}\n';

const PROJECT_AIWORK_ENGINE_JSONC_FORMAT = { insertSpaces: true, tabSize: 2 };

export type ReadGlobalAiWorkEngineConfigInput = {
  workspaceRoot: string;
  selectedWorkspaceId: string;
  runtimeWorkspaceId: string | null;
  aiworkServerStatus: "connected" | "disconnected" | "limited";
  aiworkServerClient: AiWorkServerClient | null;
  aiworkServerCapabilities: { config?: { read?: boolean; write?: boolean } } | null;
};

function resolveAiWorkWorkspaceId(input: ReadGlobalAiWorkEngineConfigInput): string | null {
  const fromRuntime = input.runtimeWorkspaceId?.trim();
  if (fromRuntime) return fromRuntime;
  const fromSelected = input.selectedWorkspaceId.trim();
  return fromSelected.length > 0 ? fromSelected : null;
}

/** Resolve global AiWorkEngine config file (~/.config/opencode/… or AiWork server workspace global scope). */
export async function readGlobalAiWorkEngineConfigFile(
  input: ReadGlobalAiWorkEngineConfigInput,
): Promise<AiWorkEngineConfigFile | null> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.read &&
    typeof input.aiworkServerClient.readAiWorkEngineConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    return await input.aiworkServerClient.readAiWorkEngineConfigFile(aiworkWorkspaceId, "global");
  }

  return await readAiWorkEngineConfig("global", input.workspaceRoot);
}

export async function writeGlobalAiWorkEngineConfigContent(
  input: ReadGlobalAiWorkEngineConfigInput,
  content: string,
): Promise<boolean> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.write &&
    typeof input.aiworkServerClient.writeAiWorkEngineConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    const result = await input.aiworkServerClient.writeAiWorkEngineConfigFile(
      aiworkWorkspaceId,
      "global",
      content,
    );
    ConsoleLog.log("global-opencode-disabled-providers", "writeGlobalAiWorkEngineConfigContent:done via aiwork-server", {
      ok: result.ok,
      content: content,
    });
    return result.ok;
  }

  const result = await writeAiWorkEngineConfig("global", input.workspaceRoot, content);
  ConsoleLog.log("global-opencode-disabled-providers", "writeGlobalAiWorkEngineConfigContent:done via desktop", {
    ok: result.ok,
    content: content,
  });
  return result.ok;
}

export function parseDisabledProvidersFromAiWorkEngineJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const parsed = parse(raw, undefined, { allowTrailingComma: true }) as
    | Record<string, unknown>
    | undefined;
  const dp = parsed?.disabled_providers;
  if (!Array.isArray(dp)) return [];
  return dp.filter((item): item is string => typeof item === "string");
}

export async function readGlobalDisabledProviderIds(
  input: ReadGlobalAiWorkEngineConfigInput,
): Promise<string[]> {
  const file = await readGlobalAiWorkEngineConfigFile(input);
  return parseDisabledProvidersFromAiWorkEngineJson(file?.content ?? null);
}

export async function writeGlobalDisabledProviderIds(
  input: ReadGlobalAiWorkEngineConfigInput,
  ids: string[],
): Promise<boolean> {
  const existing = await readGlobalAiWorkEngineConfigFile(input);
  const raw = existing?.content?.trim() ? existing.content : DEFAULT_GLOBAL_CONFIG_HEADER;
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const edits = modify(raw, ["disabled_providers"], uniqueIds, {
    formattingOptions: PROJECT_AIWORK_ENGINE_JSONC_FORMAT,
  });
  const nextContent = applyEdits(raw, edits);
  return await writeGlobalAiWorkEngineConfigContent(input, nextContent);
}

export async function removeGlobalDisabledProviderIds(
  input: ReadGlobalAiWorkEngineConfigInput,
  removeIds: string[],
): Promise<boolean> {
  const remove = new Set(removeIds.map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return false;
  const current = await readGlobalDisabledProviderIds(input);
  const next = current.filter((id) => !remove.has(id));
  if (next.length === current.length) return false;
  return await writeGlobalDisabledProviderIds(input, next);
}
