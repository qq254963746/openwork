import { parse } from "jsonc-parser";

import {
  readGlobalAiWorkEngineConfigFile,
  writeGlobalAiWorkEngineConfigContent,
  type ReadGlobalAiWorkEngineConfigInput,
} from "./global-opencode-disabled-providers";
import {
  AIWORK_CUSTOM_PROVIDER_ENTRY_KEY,
  type ModelProviderType,
  npmSdkPackageForProviderType,
} from "../utils/model-providers-catalog";
import { ConsoleLog } from "./console-log";

const SCHEMA_URL = "https://www.aiwork.love/config.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge `provider.<id>` into global `~/.config/opencode/opencode.json` (or AiWork server global scope).
 * Includes `options.baseURL`, `options.apiKey`, and `models` from the `/v1/models` step when available.
 */
export async function upsertGlobalProviderAiWorkEngineEntry(
  input: ReadGlobalAiWorkEngineConfigInput & {
    providerId: string;
    displayName: string;
    baseURL: string;
    apiKey: string;
    presetCode: string;
    providerType: ModelProviderType;
    modelsMap: Record<string, { name: string }>;
  },
): Promise<{ ok: boolean; reason?: "parse_failed" | "write_failed" }> {
  const providerId = input.providerId.trim();
  const baseURL = input.baseURL.trim();
  const apiKey = input.apiKey.trim();
  const displayName = input.displayName.trim() || providerId;
  const isCustom = input.presetCode.trim() === AIWORK_CUSTOM_PROVIDER_ENTRY_KEY;

  if (!providerId || !baseURL || !apiKey) {
    return { ok: false, reason: "write_failed" };
  }

  const existing = await readGlobalAiWorkEngineConfigFile(input);
  const raw = existing?.content?.trim() ? existing.content : `{\n  "$schema": "${SCHEMA_URL}"\n}\n`;

  const parseErrors: Array<{ error: number; offset: number; length: number }> = [];
  parse(raw, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    return { ok: false, reason: "parse_failed" };
  }

  const tree = parse(raw, undefined, { allowTrailingComma: true }) as Record<string, unknown>;

  const prevProviders = isPlainObject(tree.provider) ? { ...(tree.provider as Record<string, unknown>) } : {};
  const prevEntryRaw = prevProviders[providerId];
  const prevEntry = isPlainObject(prevEntryRaw) ? { ...(prevEntryRaw as Record<string, unknown>) } : {};
  const prevOptsRaw = prevEntry.options;
  const prevOpts = isPlainObject(prevOptsRaw) ? { ...(prevOptsRaw as Record<string, unknown>) } : {};

  const nextEntry: Record<string, unknown> = {
    ...prevEntry,
    name: displayName,
    options: {
      ...prevOpts,
      baseURL,
      apiKey,
    },
    models: input.modelsMap,
  };

  if (isCustom) {
    nextEntry.npm = npmSdkPackageForProviderType(input.providerType);
  }

  prevProviders[providerId] = nextEntry;
  tree.provider = prevProviders;
  tree.$schema = SCHEMA_URL;

  const ep = tree.enabled_providers;
  if (Array.isArray(ep)) {
    const strings = ep.filter((item): item is string => typeof item === "string");
    if (!strings.includes(providerId)) {
      tree.enabled_providers = [...strings, providerId];
    }
  }

  const nextContent = `${JSON.stringify(tree, null, 2)}\n`;
  ConsoleLog.log("global-opencode-provider-upsert", "upsertGlobalProviderAiWorkEngineEntry:done", {
    ok: true,
    content: nextContent,
  });
  const wrote = await writeGlobalAiWorkEngineConfigContent(input, nextContent);
  return wrote ? { ok: true } : { ok: false, reason: "write_failed" };
}
