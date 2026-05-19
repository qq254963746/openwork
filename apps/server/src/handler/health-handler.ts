import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerHealthRoutes(routes: Route[], deps: HandlerDeps): void {
  const { jsonResponse, buildCapabilities, serializeWorkspace, resolveWorkspace, config, serverVersion, engineVersion } = deps;

  addRoute(routes, "GET", ApiRoutes.HEALTH, "none", async () => {
    return jsonResponse({
      ok: true,
      version: serverVersion,
      engineVersion,
      uptimeMs: Date.now() - config.startedAt,
    });
  });

  addRoute(routes, "GET", ApiRoutes.MOUNT_HEALTH, "none", async () => {
    return jsonResponse({
      ok: true,
      version: serverVersion,
      engineVersion,
      uptimeMs: Date.now() - config.startedAt,
    });
  });

  addRoute(routes, "GET", ApiRoutes.MOUNT_STATUS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({
      ok: true,
      version: serverVersion,
      engineVersion,
      uptimeMs: Date.now() - config.startedAt,
      readOnly: config.readOnly,
      approval: config.approval,
      corsOrigins: config.corsOrigins,
      workspaceCount: 1,
      activeWorkspaceId: workspace.id,
      workspace: serializeWorkspace(workspace as unknown as Record<string, unknown>),
      authorizedRoots: config.authorizedRoots,
      server: {
        host: config.host,
        port: config.port,
        configPath: config.configPath ?? null,
      },
      tokenSource: {
        client: config.tokenSource,
        host: config.hostTokenSource,
      },
    });
  });

  addRoute(routes, "GET", ApiRoutes.MOUNT_CAPABILITIES, "client", async () => {
    return jsonResponse(buildCapabilities(config));
  });

  addRoute(routes, "GET", ApiRoutes.MOUNT_WORKSPACES, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ items: [serializeWorkspace(workspace as unknown as Record<string, unknown>)], activeId: workspace.id });
  });

  addRoute(routes, "GET", ApiRoutes.STATUS, "client", async () => {
    const active = config.workspaces[0];
    return jsonResponse({
      ok: true,
      version: serverVersion,
      engineVersion,
      uptimeMs: Date.now() - config.startedAt,
      readOnly: config.readOnly,
      approval: config.approval,
      corsOrigins: config.corsOrigins,
      workspaceCount: config.workspaces.length,
      activeWorkspaceId: active?.id ?? null,
      workspace: active ? serializeWorkspace(active as unknown as Record<string, unknown>) : null,
      authorizedRoots: config.authorizedRoots,
      server: {
        host: config.host,
        port: config.port,
        configPath: config.configPath ?? null,
      },
      tokenSource: {
        client: config.tokenSource,
        host: config.hostTokenSource,
      },
    });
  });

  addRoute(routes, "GET", ApiRoutes.WHOAMI, "client", async (ctx) => {
    return jsonResponse({ ok: true, actor: ctx.actor ?? null });
  });

  addRoute(routes, "GET", ApiRoutes.CAPABILITIES, "client", async () => {
    return jsonResponse(buildCapabilities(config));
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACES, "client", async () => {
    const active = config.workspaces[0] ?? null;
    const items = config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>));
    return jsonResponse({ items, workspaces: items, activeId: active?.id ?? null });
  });
}