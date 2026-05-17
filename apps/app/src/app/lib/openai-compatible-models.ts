import { ConsoleLog } from "./console-log";

/** Fetch model IDs from an OpenAI-compatible `GET .../models` endpoint. */

const MAX_MODEL_IDS = 512;

const LOG_SCOPE = "openai-compatible-models";

export type FetchOpenAiCompatibleModelIdsOptions = {
  /**
   * AiWork server same-origin proxy (`POST …/model-provider/models`).
   * Avoids browser CORS when listing models from arbitrary provider hosts (e.g. web dev on localhost).
   */
  aiworkProxy?: () => Promise<{ ok: true; ids: string[] } | { ok: false; message: string }>;
};

export function resolveOpenAiCompatibleModelsUrl(baseURL: string): string {
  const t = baseURL.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(t)) return `${t}/models`;
  return `${t}/v1/models`;
}

export function modelsIdsToAiWorkEngineModelsMap(ids: string[]): Record<string, { name: string }> {
  const slice = ids.slice(0, MAX_MODEL_IDS);
  const out: Record<string, { name: string }> = {};
  for (const id of slice) {
    out[id] = { name: id };
  }
  return out;
}

async function fetchViaBrowserDirect(
  root: string,
  key: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const url = resolveOpenAiCompatibleModelsUrl(root);
  try {
    const res = await globalThis.fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const hint = body.trim().slice(0, 280);
      ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:done", {
        via: "browser-direct",
        ok: false,
        url,
        httpStatus: res.status,
        bodyPreview: hint.slice(0, 120),
      });
      return {
        ok: false,
        message: hint ? `HTTP ${res.status}: ${hint}` : `HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (json.data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

    ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:done", {
      via: "browser-direct",
      ok: true,
      url,
      modelCount: ids.length,
    });

    return { ok: true, ids };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:done", {
      via: "browser-direct",
      ok: false,
      url,
      error: message,
    });
    return { ok: false, message };
  }
}

export async function fetchOpenAiCompatibleModelIds(
  baseURL: string,
  apiKey: string,
  options?: FetchOpenAiCompatibleModelIdsOptions,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const root = baseURL.trim();
  const key = apiKey.trim();
  if (!root || !key) {
    ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:done", {
      ok: false,
      reason: "missing_base_or_key",
    });
    return { ok: false, message: "missing base URL or API key" };
  }

  if (options?.aiworkProxy) {
    try {
      const proxied = await options.aiworkProxy();
      ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:done", {
        via: "aiwork-server",
        ok: proxied.ok,
        ...(proxied.ok ? { modelCount: proxied.ids.length } : { message: proxied.message }),
      });
      return proxied;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ConsoleLog.log(LOG_SCOPE, "fetchOpenAiCompatibleModelIds:aiworkProxyFailed", {
        message,
        fallback: "browser-direct",
      });
      return fetchViaBrowserDirect(root, key);
    }
  }

  return fetchViaBrowserDirect(root, key);
}
