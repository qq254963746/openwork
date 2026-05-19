import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerModelProviderRoutes(routes: Route[], deps: HandlerDeps): void {
  const { config, resolveWorkspace, jsonResponse, fetchEngineJson } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_MODEL_PROVIDER_MODELS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    try {
      const data = await fetchEngineJson(config, workspace, "/model-provider", { method: "GET" });
      return jsonResponse(data);
    } catch {
      return jsonResponse({ items: [] });
    }
  });
}