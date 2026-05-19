import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerEventRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, jsonResponse, reloadEvents,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_EVENTS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sinceRaw = ctx.url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const items = ctx.reloadEvents.list(workspace.id, since);
    return jsonResponse({
      items,
      cursor: ctx.reloadEvents.cursor(),
      workspaceId: workspace.id,
      disabled: false,
    });
  });
}