import { ApiError } from "../errors.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerApprovalRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    approvals, readJsonBody, jsonResponse,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.APPROVALS, "host", async (ctx) => {
    return jsonResponse({ items: ctx.approvals.list() });
  });

  addRoute(routes, "POST", ApiRoutes.APPROVALS_RESPOND, "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const reply = body.reply === "allow" ? "allow" : "deny";
    const result = ctx.approvals.respond(ctx.params.id, reply);
    if (!result) {
      throw new ApiError(404, "approval_not_found", "Approval request not found");
    }
    return jsonResponse({ ok: true, allowed: result.allowed });
  });
}