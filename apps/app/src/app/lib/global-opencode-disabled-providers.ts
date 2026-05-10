import { applyEdits, modify, parse } from "jsonc-parser";

import type { AiWorkServerClient } from "./aiwork-server";
import type { OpencodeConfigFile } from "./desktop-tauri";
import { readOpencodeConfig, writeOpencodeConfig } from "./desktop";
import { isDesktopRuntime } from "../utils";
import { ConsoleLog } from "./console-log";

const DEFAULT_GLOBAL_CONFIG_HEADER =
  '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

const PROJECT_OPENCODE_JSONC_FORMAT = { insertSpaces: true, tabSize: 2 };

export type ReadGlobalOpencodeConfigInput = {
  workspaceRoot: string;
  selectedWorkspaceId: string;
  runtimeWorkspaceId: string | null;
  aiworkServerStatus: "connected" | "disconnected" | "limited";
  aiworkServerClient: AiWorkServerClient | null;
  aiworkServerCapabilities: { config?: { read?: boolean; write?: boolean } } | null;
};

function resolveAiWorkWorkspaceId(input: ReadGlobalOpencodeConfigInput): string | null {
  const fromRuntime = input.runtimeWorkspaceId?.trim();
  if (fromRuntime) return fromRuntime;
  const fromSelected = input.selectedWorkspaceId.trim();
  return fromSelected.length > 0 ? fromSelected : null;
}

/** Resolve global OpenCode config file (~/.config/opencode/… or AiWork server workspace global scope). */
export async function readGlobalOpencodeConfigFile(
  input: ReadGlobalOpencodeConfigInput,
): Promise<OpencodeConfigFile | null> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.read &&
    typeof input.aiworkServerClient.readOpencodeConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    return await input.aiworkServerClient.readOpencodeConfigFile(aiworkWorkspaceId, "global");
  }

  if (isDesktopRuntime()) {
    return await readOpencodeConfig("global", input.workspaceRoot);
  }

  return null;
}

export async function writeGlobalOpencodeConfigContent(
  input: ReadGlobalOpencodeConfigInput,
  content: string,
): Promise<boolean> {
  const aiworkWorkspaceId = resolveAiWorkWorkspaceId(input);
  const canUseAiWorkServer =
    input.aiworkServerStatus === "connected" &&
    input.aiworkServerClient &&
    aiworkWorkspaceId &&
    input.aiworkServerCapabilities?.config?.write &&
    typeof input.aiworkServerClient.writeOpencodeConfigFile === "function";

  if (canUseAiWorkServer && input.aiworkServerClient && aiworkWorkspaceId) {
    const result = await input.aiworkServerClient.writeOpencodeConfigFile(
      aiworkWorkspaceId,
      "global",
      content,
    );
    ConsoleLog.log("global-opencode-disabled-providers", "writeGlobalOpencodeConfigContent:done via aiwork-server", {
      ok: result.ok,
      content: content,
    });
    return result.ok;
  }

  if (isDesktopRuntime()) {
    const result = await writeOpencodeConfig("global", input.workspaceRoot, content);
    ConsoleLog.log("global-opencode-disabled-providers", "writeGlobalOpencodeConfigContent:done via desktop", {
      ok: result.ok,
      content: content,
    });
    return result.ok;
  }

  ConsoleLog.log("global-opencode-disabled-providers", "writeGlobalOpencodeConfigContent:done via fallback", {
    ok: false,
    content: content,
  });
  return false;
}

export function parseDisabledProvidersFromOpenCodeJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const parsed = parse(raw, undefined, { allowTrailingComma: true }) as
    | Record<string, unknown>
    | undefined;
  const dp = parsed?.disabled_providers;
  if (!Array.isArray(dp)) return [];
  return dp.filter((item): item is string => typeof item === "string");
}

export async function readGlobalDisabledProviderIds(
  input: ReadGlobalOpencodeConfigInput,
): Promise<string[]> {
  const file = await readGlobalOpencodeConfigFile(input);
  return parseDisabledProvidersFromOpenCodeJson(file?.content ?? null);
}

export async function writeGlobalDisabledProviderIds(
  input: ReadGlobalOpencodeConfigInput,
  ids: string[],
): Promise<boolean> {
  const existing = await readGlobalOpencodeConfigFile(input);
  const raw = existing?.content?.trim() ? existing.content : DEFAULT_GLOBAL_CONFIG_HEADER;
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const edits = modify(raw, ["disabled_providers"], uniqueIds, {
    formattingOptions: PROJECT_OPENCODE_JSONC_FORMAT,
  });
  const nextContent = applyEdits(raw, edits);
  return await writeGlobalOpencodeConfigContent(input, nextContent);
}

export async function removeGlobalDisabledProviderIds(
  input: ReadGlobalOpencodeConfigInput,
  removeIds: string[],
): Promise<boolean> {
  const remove = new Set(removeIds.map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return false;
  const current = await readGlobalDisabledProviderIds(input);
  const next = current.filter((id) => !remove.has(id));
  if (next.length === current.length) return false;
  return await writeGlobalDisabledProviderIds(input, next);
}
