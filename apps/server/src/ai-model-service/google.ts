import { ApiError } from "../errors.js";
import type { ListModelsInput, ListModelsResult } from "./types.js";
import { assertPublicHttpUrlForModelProxy, fetchWithModelsTimeout } from "./shared.js";

/**
 * Google Generative Language API `GET /v1beta/models` with `?key=` query param.
 * Expects `baseURL` like `https://generativelanguage.googleapis.com/v1beta`.
 */
export async function listModels(input: ListModelsInput): Promise<ListModelsResult> {
  const root = input.baseURL.trim().replace(/\/+$/, "");
  const base = /\/v1beta$/i.test(root) ? root : `${root}/v1beta`;
  const key = encodeURIComponent(input.apiKey.trim());
  const listHref = `${base}/models?key=${key}`;

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

    const record = parsed as { models?: Array<{ name?: unknown }> };
    const ids = (record.models ?? [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.replace(/^models\//, ""));

    return { ok: true, ids };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `upstream fetch failed: ${message}` };
  }
}
