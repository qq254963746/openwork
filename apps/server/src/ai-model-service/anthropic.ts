import { ApiError } from "../errors.js";
import type { ListModelsInput, ListModelsResult } from "./types.js";
import { assertPublicHttpUrlForModelProxy, fetchWithModelsTimeout } from "./shared.js";

/** Anthropic `GET /v1/models` — uses `x-api-key` + `anthropic-version`. */
export async function listModels(input: ListModelsInput): Promise<ListModelsResult> {
  const root = input.baseURL.trim().replace(/\/+$/, "");
  const base = /\/v1$/i.test(root) ? root : `${root}/v1`;
  const listHref = `${base}/models`;

  try {
    assertPublicHttpUrlForModelProxy(listHref);
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }

  try {
    const upstream = await fetchWithModelsTimeout(listHref, {
      method: "GET",
      headers: {
        "x-api-key": input.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      const hint = text.trim().slice(0, 400);
      return {
        ok: false,
        message: hint ? `HTTP ${upstream.status}: ${hint}` : `HTTP ${upstream.status}`,
        httpStatus: upstream.status,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: "Upstream returned invalid JSON" };
    }

    const record = parsed as { data?: Array<{ id?: unknown }> };
    const ids = (record.data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

    return { ok: true, ids };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `upstream fetch failed: ${message}` };
  }
}
