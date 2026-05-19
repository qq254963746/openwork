import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";
import {
  handleCheckpointCreate,
  handleCheckpointList,
  handleCheckpointBindMessage,
  handleCheckpointDiff,
  handleCheckpointRestoreBySha,
  handleCheckpointRestoreByMessage,
  handleCheckpointDestroy,
  handleCheckpointFileContent,
} from "../checkpoint-routes.js";

export function registerCheckpointRoutes(routes: Route[], deps: HandlerDeps): void {
  const { config } = deps;

  const buildCtx = (req: Request, url: URL, params: Record<string, string>) => ({
    request: req,
    url,
    params,
    config,
  });

  addRoute(routes, "POST", ApiRoutes.CHECKPOINTS_CREATE, "client", async (ctx) => {
    return handleCheckpointCreate(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "GET", ApiRoutes.CHECKPOINTS, "client", async (ctx) => {
    return handleCheckpointList(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "POST", ApiRoutes.CHECKPOINTS_BIND_MESSAGE, "client", async (ctx) => {
    return handleCheckpointBindMessage(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "GET", ApiRoutes.CHECKPOINTS_DIFF, "client", async (ctx) => {
    return handleCheckpointDiff(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "POST", ApiRoutes.CHECKPOINTS_RESTORE_BY_SHA, "client", async (ctx) => {
    return handleCheckpointRestoreBySha(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "POST", ApiRoutes.CHECKPOINTS_RESTORE_BY_MESSAGE, "client", async (ctx) => {
    return handleCheckpointRestoreByMessage(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "DELETE", ApiRoutes.CHECKPOINTS_DESTROY, "client", async (ctx) => {
    return handleCheckpointDestroy(buildCtx(ctx.request, ctx.url, ctx.params));
  });

  addRoute(routes, "GET", ApiRoutes.CHECKPOINTS_FILE_CONTENT, "client", async (ctx) => {
    return handleCheckpointFileContent(buildCtx(ctx.request, ctx.url, ctx.params));
  });
}