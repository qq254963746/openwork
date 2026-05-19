import type { WorkspaceInfo } from "../types.js";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";
import { buildSession, buildSessionList, buildSessionMessages, buildSessionSnapshot } from "../session-read-model.js";
import { destroySessionCheckpoints } from "../checkpoint-store.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function remapSessionReadError(error: unknown): never {
  if (error instanceof ApiError && error.code === "aiwork_request_failed") {
    const details = error.details;
    const upstreamStatus =
      details && typeof details === "object" && "status" in details
        ? Number((details as { status?: unknown }).status)
        : NaN;
    if (upstreamStatus === 400) {
      throw new ApiError(400, "invalid_query", "Engine rejected the session read request", details);
    }
    if (upstreamStatus === 404) {
      throw new ApiError(404, "session_not_found", "Session not found", details);
    }
  }
  throw error;
}

async function listWorkspaceSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number },
  fetchEngineJson: HandlerDeps["fetchEngineJson"],
) {
  try {
    return buildSessionList(
      await fetchEngineJson(config, workspace, "/session", {
        method: "GET",
        query: {
          roots: input.roots,
          start: input.start,
          search: input.search,
          limit: input.limit,
        },
      }),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  fetchEngineJson: HandlerDeps["fetchEngineJson"],
) {
  try {
    return buildSession(
      await fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}`, {
        method: "GET",
      }),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionMessages(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number },
  fetchEngineJson: HandlerDeps["fetchEngineJson"],
) {
  try {
    return buildSessionMessages(
      await fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}/message`, {
        method: "GET",
        query: { limit: input.limit },
      }),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

async function readWorkspaceSessionSnapshot(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number },
  fetchEngineJson: HandlerDeps["fetchEngineJson"],
) {
  try {
    const [session, messages, todos, statuses] = await Promise.all([
      fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}`, { method: "GET" }),
      fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}/message`, { method: "GET", query: { limit: input.limit } }),
      fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}/todo`, { method: "GET" }),
      fetchEngineJson(config, workspace, "/session/status", { method: "GET" }),
    ]);
    return buildSessionSnapshot({ session, messages, todos, statuses });
  } catch (error) {
    remapSessionReadError(error);
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSessionRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, requireClientScope,
    jsonResponse, fetchEngineJson, parseOptionalBoolean,
    parseOptionalNonNegativeInteger, parseOptionalPositiveInteger,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SESSIONS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listWorkspaceSessions(config, workspace, {
      roots: parseOptionalBoolean(ctx.url.searchParams.get("roots"), "roots"),
      start: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("start"), "start"),
      search: ctx.url.searchParams.get("search")?.trim() || undefined,
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    }, fetchEngineJson);
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SESSION, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSession(config, workspace, sessionId, fetchEngineJson);
    return jsonResponse({ item });
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SESSION_MESSAGES, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const items = await readWorkspaceSessionMessages(config, workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    }, fetchEngineJson);
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SESSION_SNAPSHOT, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSessionSnapshot(config, workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    }, fetchEngineJson);
    return jsonResponse({ item });
  });

  addRoute(routes, "DELETE", ApiRoutes.WORKSPACE_SESSION_DELETE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");

    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }

    await fetchEngineJson(config, workspace, `/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });

    void destroySessionCheckpoints(workspace.id, sessionId).catch(() => undefined);

    return jsonResponse({ ok: true });
  });
}