import { basename, join, resolve } from "node:path";
import { ApiError } from "../errors.js";
import type { WorkspaceInfo } from "../types.js";
import { ensureDir } from "../utils.js";
import { workspaceIdForPath } from "../workspaces.js";
import { inheritWorkspaceEngineConnection, resolveWorkspaceEngineConnection } from "../engine-connection.js";
import { logger as fileLogger } from "../log-util.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerWorkspaceRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, readJsonBody, jsonResponse,
    onWorkspacesChanged, persistServerWorkspaceState, reloadEngineEngine,
    serializeWorkspace,
  } = deps;

  addRoute(routes, "POST", ApiRoutes.WORKSPACES_LOCAL, "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : basename(folderPath || "Workspace");
    const preset = typeof body.preset === "string" && body.preset.trim() ? body.preset.trim() : "starter";

    await fileLogger.info("POST /workspaces/local: received request", { folderPath, name, preset });

    if (!folderPath) {
      await fileLogger.warn("POST /workspaces/local: missing folderPath");
      throw new ApiError(400, "invalid_payload", "folderPath is required");
    }

    const workspacePath = resolve(folderPath);
    await fileLogger.info("POST /workspaces/local: resolved workspace path", { workspacePath });

    await ensureDir(workspacePath);

    const workspace: WorkspaceInfo = {
      id: workspaceIdForPath(workspacePath),
      name,
      path: workspacePath,
      preset,
      ...inheritWorkspaceEngineConnection(config),
    };

    config.workspaces = [workspace, ...config.workspaces.filter((entry) => entry.id !== workspace.id)];
    if (!config.authorizedRoots.some((root) => resolve(root) === workspacePath)) {
      config.authorizedRoots = [...config.authorizedRoots, workspacePath];
    }
    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    fileLogger.info("workspace.create", { workspaceId: workspace.id, summary: `Created workspace ${name}` });
    await fileLogger.info("POST /workspaces/local: workspace created", { workspaceId: workspace.id, workspacePath, name, preset, persisted });

    return jsonResponse({
      activeId: workspace.id,
      workspaces: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
      persisted,
    }, 201);
  });

  addRoute(routes, "PATCH", ApiRoutes.WORKSPACES_DISPLAY_NAME, "host", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const nextDisplayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : undefined;

    config.workspaces = config.workspaces.map((entry) =>
      entry.id === workspace.id
        ? {
          ...entry,
          displayName: nextDisplayName,
          name: nextDisplayName ?? entry.name,
        }
        : entry,
    );

    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    fileLogger.info("workspace.rename", { workspaceId: workspace.id, summary: `Updated workspace display name${nextDisplayName ? ` to ${nextDisplayName}` : ""}` });
    return jsonResponse({
      activeId: config.workspaces[0]?.id ?? null,
      workspaces: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
      persisted,
    });
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACES_ACTIVATE, "host", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    config.workspaces = [
      workspace,
      ...config.workspaces.filter((entry) => entry.id !== workspace.id),
    ];
    fileLogger.info("workspace.activate", { workspaceId: workspace.id, summary: "Switched active workspace" });
    const connection = resolveWorkspaceEngineConnection(config, workspace);
    if (connection.baseUrl?.trim()) {
      await reloadEngineEngine(config, workspace);
    }
    return jsonResponse({ activeId: workspace.id, workspace: serializeWorkspace(workspace as unknown as Record<string, unknown>), persisted: false });
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACES_REORDER, "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const rawIds = (body as { workspaceIds?: unknown }).workspaceIds;
    if (!Array.isArray(rawIds)) {
      throw new ApiError(400, "invalid_payload", "workspaceIds must be an array");
    }
    const requested = rawIds
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);
    const known = new Set(config.workspaces.map((entry) => entry.id));
    if (requested.length !== known.size) {
      throw new ApiError(
        400,
        "invalid_payload",
        "workspaceIds must list every workspace exactly once",
      );
    }
    const seen = new Set<string>();
    for (const id of requested) {
      if (!known.has(id) || seen.has(id)) {
        throw new ApiError(400, "invalid_payload", "Invalid or duplicate workspace id in reorder list");
      }
      seen.add(id);
    }
    const byId = new Map(config.workspaces.map((entry) => [entry.id, entry]));
    config.workspaces = requested.map((id) => byId.get(id)!);

    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    const active = config.workspaces[0] ?? null;
    return jsonResponse({
      ok: true,
      persisted,
      activeId: active?.id ?? null,
      items: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
      workspaces: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
    });
  });

  addRoute(routes, "DELETE", ApiRoutes.WORKSPACES_DELETE, "host", async (ctx) => {
    ensureWritable(config);

    const workspace = await resolveWorkspace(config, ctx.params.id);

    const before = config.workspaces.length;
    config.workspaces = config.workspaces.filter((entry) => entry.id !== workspace.id);
    const deleted = before !== config.workspaces.length;

    if (deleted) {
      config.authorizedRoots = config.authorizedRoots.filter((root) => resolve(root) !== resolve(workspace.path));
    }
    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    fileLogger.info("workspace.delete", { workspaceId: workspace.id, summary: "Deleted workspace from AiWork server" });
    const active = config.workspaces[0] ?? null;
    return jsonResponse({
      ok: true,
      deleted,
      persisted,
      activeId: active?.id ?? null,
      items: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
      workspaces: config.workspaces.map((w) => serializeWorkspace(w as unknown as Record<string, unknown>)),
    });
  });
}