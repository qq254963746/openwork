import { ApiError } from "../errors.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerMcpRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, requireClientScope, requireApproval,
    readJsonBody, jsonResponse, fetchEngineJson,
    emitReloadEvent, buildConfigTrigger,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_MCP, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    try {
      const data = await fetchEngineJson(config, workspace, "/mcp", { method: "GET" });
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return jsonResponse({ items: [], servers: [] });
      }
      throw error;
    }
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_MCP_ADD, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    try {
      const data = await fetchEngineJson(config, workspace, "/mcp/servers", { method: "GET" });
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return jsonResponse({ items: [] });
      }
      throw error;
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_MCP_ENABLED, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const serverId = typeof body.serverId === "string" && body.serverId.trim() ? body.serverId.trim() : "";
    if (!serverId) {
      throw new ApiError(400, "invalid_payload", "serverId is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.connect",
      summary: `Connect MCP server ${serverId}`,
      paths: [workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/mcp/connect", {
        method: "POST",
        body: { serverId },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "mcp", buildConfigTrigger(workspace.path));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "mcp_server_not_found", `MCP server "${serverId}" not found`);
      }
      throw error;
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_MCP_AUTH, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const serverId = typeof body.serverId === "string" && body.serverId.trim() ? body.serverId.trim() : "";
    if (!serverId) {
      throw new ApiError(400, "invalid_payload", "serverId is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.disconnect",
      summary: `Disconnect MCP server ${serverId}`,
      paths: [workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/mcp/disconnect", {
        method: "POST",
        body: { serverId },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "mcp", buildConfigTrigger(workspace.path));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "mcp_server_not_found", `MCP server "${serverId}" not found`);
      }
      throw error;
    }
  });

  addRoute(routes, "DELETE", ApiRoutes.WORKSPACE_MCP_REMOVE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const mcpSessionId = (ctx.params.mcpSessionId ?? "").trim();
    if (!mcpSessionId) {
      throw new ApiError(400, "invalid_payload", "mcpSessionId is required");
    }

    const result = await fetchEngineJson(config, workspace, `/mcp/sessions/${encodeURIComponent(mcpSessionId)}`, {
      method: "DELETE",
    });
    return jsonResponse(result);
  });
}