import { ApiError } from "../errors.js";
import { EnvStoreReadError, InvalidEnvKeyError, isValidEnvKey } from "../env-file.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

function rethrowEnvStoreReadError(error: unknown): never {
  if (error instanceof EnvStoreReadError) {
    throw new ApiError(
      409,
      error.code,
      "Environment variable store is invalid. Fix or remove the local env file before editing.",
    );
  }
  throw error;
}

export function registerEnvRoutes(routes: Route[], deps: HandlerDeps): void {
  const { config, env, ensureWritable, readJsonBody, jsonResponse } = deps;

  addRoute(routes, "GET", ApiRoutes.ENV, "host-token", async () => {
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", ApiRoutes.ENV_KEYS, "host-token", async () => {
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return jsonResponse({ keys: items.map((item) => item.key) });
  });

  addRoute(routes, "PUT", ApiRoutes.ENV_UPSERT, "host-token", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const rawEntries = Array.isArray(body.entries)
      ? body.entries
      : [{ key: body.key, value: body.value }];
    const entries: Array<{ key: string; value: string }> = [];
    for (const raw of rawEntries) {
      if (!raw || typeof raw !== "object") {
        throw new ApiError(400, "invalid_entry", "Each entry must be an object");
      }
      const candidate = raw as { key?: unknown; value?: unknown };
      const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
      const value = typeof candidate.value === "string" ? candidate.value : "";
      if (!isValidEnvKey(key)) {
        throw new ApiError(400, "invalid_env_key", "Invalid environment variable name");
      }
      entries.push({ key, value });
    }
    if (entries.length === 0) {
      throw new ApiError(400, "no_entries", "No entries provided");
    }
    try {
      await env.upsertMany(entries);
    } catch (error) {
      if (error instanceof EnvStoreReadError) {
        rethrowEnvStoreReadError(error);
      }
      if (error instanceof InvalidEnvKeyError) {
        throw new ApiError(
          400,
          error.code,
          error.code === "reserved_env_key"
            ? "Environment variable name is reserved for AiWork internals"
            : "Invalid environment variable name",
        );
      }
      throw error;
    }
    return jsonResponse({ ok: true, count: entries.length });
  });

  addRoute(routes, "DELETE", ApiRoutes.ENV_DELETE, "host-token", async (ctx) => {
    ensureWritable(config);
    const key = ctx.params.key;
    if (!isValidEnvKey(key)) {
      throw new ApiError(400, "invalid_env_key", "Invalid environment variable name");
    }
    const removed = await env.delete(key).catch(rethrowEnvStoreReadError);
    if (!removed) {
      throw new ApiError(404, "env_not_found", "Environment variable not found");
    }
    return jsonResponse({ ok: true });
  });
}