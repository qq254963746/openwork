import { ApiError } from "../errors.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerPluginRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, requireClientScope, requireApproval,
    readJsonBody, jsonResponse, fetchEngineJson, resolveEngineDirectory,
    emitReloadEvent, buildConfigTrigger,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_PLUGINS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pluginDir = resolveEngineDirectory(workspace);
    if (!pluginDir) {
      return jsonResponse({ items: [] });
    }
    try {
      const data = await fetchEngineJson(config, workspace, "/plugin", { method: "GET" });
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return jsonResponse({ items: [] });
      }
      throw error;
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_PLUGINS_ADD, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
    if (!id) {
      throw new ApiError(400, "invalid_payload", "id is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin.enable",
      summary: `Enable plugin ${id}`,
      paths: [resolveEngineDirectory(workspace) ?? workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/plugin/enable", {
        method: "POST",
        body: { id },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "plugins", buildConfigTrigger(`${resolveEngineDirectory(workspace) ?? workspace.path}/plugins`));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "plugin_not_found", `Plugin "${id}" not found`);
      }
      throw error;
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_PLUGINS_REMOVE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
    if (!id) {
      throw new ApiError(400, "invalid_payload", "id is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin.disable",
      summary: `Disable plugin ${id}`,
      paths: [resolveEngineDirectory(workspace) ?? workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/plugin/disable", {
        method: "POST",
        body: { id },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "plugins", buildConfigTrigger(`${resolveEngineDirectory(workspace) ?? workspace.path}/plugins`));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "plugin_not_found", `Plugin "${id}" not found`);
      }
      throw error;
    }
  });
}