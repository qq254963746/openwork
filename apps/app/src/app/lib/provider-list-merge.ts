import { parse } from "jsonc-parser";
import type { ProviderListResponse } from "@engine/sdk/v2/client";

import type { Client, ProviderListItem } from "../types";
import type { ModelProviderType } from "../utils/model-providers-catalog";
import { isModelProviderType } from "../utils/model-providers-catalog";
import { resolveProviderInitialApiBaseUrl } from "../utils/providers";
import { ConsoleLog } from "./console-log";
import {
  readGlobalEngineConfigFile,
  type ReadGlobalEngineConfigInput,
} from "./global-engine-disabled-providers";

const PROVIDER_LIST_MERGE_LOG_SCOPE = "provider-list-merge";

type EngineSdkFieldsResult<T> =
  | { data: T; error?: undefined; request: Request; response: Response }
  | { data?: undefined; error: unknown; request: Request; response: Response };

function apiAuthMetadataBaseUrlFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const meta = (payload as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== "object") return "";
  const raw =
    (meta as Record<string, unknown>).baseURL ?? (meta as Record<string, unknown>).baseUrl;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * For each provider entry in global engine.json that defines a `models` object,
 * collect allowed model ids (keys). Missing `models` means "do not restrict list models".
 */
function collectGlobalModelAllowlistsFromJsonRoot(root: Record<string, unknown>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const providerRoot = root.provider;
  if (!isPlainObject(providerRoot)) return map;
  for (const [pid, entry] of Object.entries(providerRoot)) {
    if (!isPlainObject(entry)) continue;
    if (!Object.prototype.hasOwnProperty.call(entry, "models")) continue;
    const models = entry.models;
    if (!isPlainObject(models)) continue;
    map.set(
      pid.trim().toLowerCase(),
      new Set(Object.keys(models).map((k) => k.trim()).filter(Boolean)),
    );
  }
  return map;
}

async function loadGlobalModelAllowlists(
  input: ReadGlobalEngineConfigInput,
): Promise<Map<string, Set<string>> | null> {
  const file = await readGlobalEngineConfigFile(input);
  const raw = file?.content?.trim();
  if (!raw) return null;
  const tree = parse(raw, undefined, { allowTrailingComma: true }) as Record<string, unknown>;
  const map = collectGlobalModelAllowlistsFromJsonRoot(tree);
  return map.size > 0 ? map : null;
}

async function fetchAuthMetadataBaseUrl(client: Client, providerId: string): Promise<string> {
  const id = providerId.trim();
  if (!id) return "";
  const inner = client as unknown as {
    client: {
      get: (opts: Record<string, unknown>) => Promise<EngineSdkFieldsResult<unknown>>;
    };
  };
  try {
    const result = await inner.client.get({
      url: "/auth/{providerID}",
      path: { providerID: id },
      throwOnError: false,
    });
    if (result.data === undefined) return "";
    return apiAuthMetadataBaseUrlFromPayload(result.data);
  } catch {
    return "";
  }
}

/**
 * For each connected provider, read `GET /auth/{id}` and merge `metadata.baseURL` into
 * `Provider.options.baseURL` so the UI and routing use the same URL the user stored in auth metadata.
 *
 * When `globalInput` is set, reads global engine config (same resolution as
 * `readGlobalEngineConfigFile`) and, for **connected** providers whose global entry defines
 * `provider.<id>.models`, drops list models whose ids are not keys of that object.
 */
export async function mergeAuthMetadataBaseUrlIntoProviderList(
  client: Client,
  list: ProviderListResponse,
  globalInput?: ReadGlobalEngineConfigInput | null,
): Promise<ProviderListResponse> {
  const connected = new Set(
    (list.connected ?? []).map((id: string) => id.trim().toLowerCase()).filter(Boolean),
  );

  ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "mergeAuthMetadataBaseUrlIntoProviderList:start", {
    listAllCount: list.all?.length ?? 0,
    connectedCount: connected.size,
    connectedIds: [...connected],
    hasGlobalInput: Boolean(globalInput),
  });

  const probeIds = list.all
    .map((p: ProviderListItem) => p.id?.trim())
    .filter((cid: string | undefined): cid is string => !!cid && connected.has(cid.toLowerCase()));

  let modelAllowlists: Map<string, Set<string>> | null = null;
  if (globalInput) {
    try {
      modelAllowlists = await loadGlobalModelAllowlists(globalInput);
      ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "merge: global model allowlists", {
        modelAllowlists: modelAllowlists,
      });
    } catch (error) {
      modelAllowlists = null;
      ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "merge: loadGlobalModelAllowlists failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const overlay = new Map<string, string>();
  await Promise.all(
    probeIds.map(async (id: string) => {
      const fromHttp = await fetchAuthMetadataBaseUrl(client, id);
      if (fromHttp) overlay.set(id.toLowerCase(), fromHttp);
    }),
  );

  const mergeOne = (p: ProviderListItem): ProviderListItem => {
    const id = p.id?.trim();
    if (!id) return p;

    let next: ProviderListItem = p;

    if (modelAllowlists && connected.has(id.toLowerCase())) {
      const allowed = modelAllowlists.get(id.toLowerCase());
      if (allowed !== undefined) {
        const models = p.models;
        if (models && typeof models === "object") {
          const filtered = {} as ProviderListItem["models"];
          for (const mid of Object.keys(models)) {
            if (allowed.has(mid)) {
              filtered[mid] = models[mid];
            }
          }
          next = { ...next, models: filtered };
        }
      }
    }

    const fromAuth = overlay.get(id.toLowerCase()) ?? "";
    if (!fromAuth) return next;
    const existingOpts =
      next.options && typeof next.options === "object"
        ? ({ ...(next.options as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    return {
      ...next,
      options: { ...existingOpts, baseURL: fromAuth },
    };
  };

  const mergedAll = list.all.map(mergeOne);
  const allConnectedOnly = mergedAll.filter((p) => {
    const id = p.id?.trim();
    return Boolean(id && connected.has(id.toLowerCase()));
  });

  const byProviderId = new Map<string, ProviderListItem>();
  for (const p of allConnectedOnly) {
    const id = p.id?.trim();
    if (id) byProviderId.set(id.toLowerCase(), p);
  }

  const nextDefault: Record<string, string> = {};
  const rawDefault =
    list.default && typeof list.default === "object" ? (list.default as Record<string, string>) : {};

  for (const [providerKey, rawModelId] of Object.entries(rawDefault)) {
    const pidLower = providerKey.trim().toLowerCase();
    if (!connected.has(pidLower)) {
      continue;
    }

    const prov = byProviderId.get(pidLower);
    const models = prov?.models;
    const modelKeys =
      models && typeof models === "object" ? Object.keys(models as Record<string, unknown>) : [];

    if (modelKeys.length === 0) {
      ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "merge: default dropped (no models on merged all)", {
        providerKey,
      });
      continue;
    }

    const modelId = typeof rawModelId === "string" ? rawModelId.trim() : "";
    const hasModel =
      modelId.length > 0 &&
      models !== undefined &&
      typeof models === "object" &&
      Object.prototype.hasOwnProperty.call(models, modelId);

    if (hasModel) {
      nextDefault[providerKey] = modelId;
      continue;
    }

    const fallback = modelKeys[0];
    nextDefault[providerKey] = fallback;
    ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "merge: default model coerced to first in all.models", {
      providerKey,
      previous: rawModelId,
      chosen: fallback,
      availableModelIds: modelKeys,
    });
  }

  const result: ProviderListResponse = {
    ...list,
    all: allConnectedOnly,
    default: nextDefault,
  };

  ConsoleLog.log(PROVIDER_LIST_MERGE_LOG_SCOPE, "mergeAuthMetadataBaseUrlIntoProviderList:done", {
    result: result
  });

  return result;
}

function parseAuthPayloadForEdit(
  data: unknown,
  providerId: string,
): {
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  presetCode: string;
  providerType?: ModelProviderType;
} {
  const payload = data as {
    type?: string;
    key?: string;
    metadata?: Record<string, string | undefined>;
  };
  const meta = payload.metadata ?? {};
  const name = (meta.name && String(meta.name).trim()) || providerId;
  const baseUrl =
    (meta.baseURL && String(meta.baseURL).trim()) ||
    (meta.baseUrl && String(meta.baseUrl).trim()) ||
    "";
  const apiKeyHint =
    typeof payload.key === "string" && payload.key.trim() ? payload.key.trim() : "";
  const presetCode = (meta.code && String(meta.code).trim()) || "";
  const rawPt = meta.providerType;
  const providerType =
    typeof rawPt === "string" && isModelProviderType(rawPt) ? rawPt : undefined;
  return { name, baseUrl, apiKeyHint, presetCode, providerType };
}

/**
 * Build edit-form defaults from `provider.list()` when `GET /auth/{id}` is unavailable
 * (older Engine servers return HTML/404 for that route).
 */
export function providerAuthDetailsFromListItem(
  provider: ProviderListItem,
  providerId: string,
): {
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  presetCode: string;
  providerType?: ModelProviderType;
} {
  const id = providerId.trim();
  const opts =
    provider.options && typeof provider.options === "object"
      ? (provider.options as Record<string, unknown>)
      : {};
  const fromOpts =
    (typeof opts.baseURL === "string" && opts.baseURL.trim()) ||
    (typeof opts.baseUrl === "string" && opts.baseUrl.trim()) ||
    "";
  const baseUrl =
    fromOpts || resolveProviderInitialApiBaseUrl(provider.id ?? id, opts as Record<string, unknown>);
  const name = (provider.name && String(provider.name).trim()) || id;
  const keyRaw = (provider as { key?: unknown }).key;
  const apiKeyHint = typeof keyRaw === "string" && keyRaw.trim() ? keyRaw.trim() : "";
  const metaCode = opts.code ?? opts.presetCode;
  const presetCode =
    typeof metaCode === "string" && metaCode.trim() ? metaCode.trim() : "";
  return { name, baseUrl, apiKeyHint, presetCode };
}

export async function fetchProviderAuthForEdit(
  client: Client,
  providerId: string,
  options?: { fallbackFromList?: ProviderListItem | null },
): Promise<{
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  presetCode: string;
  providerType?: ModelProviderType;
}> {
  const id = providerId.trim();
  if (!id) {
    throw new Error("provider id required");
  }
  const inner = client as unknown as {
    client: {
      get: (opts: Record<string, unknown>) => Promise<EngineSdkFieldsResult<unknown>>;
    };
  };

  let result: EngineSdkFieldsResult<unknown>;
  try {
    result = await inner.client.get({
      url: "/auth/{providerID}",
      path: { providerID: id },
      throwOnError: false,
    });
  } catch {
    const fb = options?.fallbackFromList;
    if (fb) {
      return providerAuthDetailsFromListItem(fb, id);
    }
    throw new Error("Failed to read provider credentials");
  }

  if (result.data !== undefined) {
    return parseAuthPayloadForEdit(result.data, id);
  }

  const fb = options?.fallbackFromList;
  if (fb) {
    return providerAuthDetailsFromListItem(fb, id);
  }

  const err = (result as { error?: { message?: string } }).error;
  throw new Error(
    typeof err === "object" && err && "message" in err && typeof err.message === "string"
      ? err.message
      : "Failed to read provider credentials",
  );
}
