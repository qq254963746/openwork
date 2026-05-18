/**
 * HTTP routes for AiWork session checkpoints.
 *
 * All routes are under /workspace/:workspaceId/sessions/:sessionId/checkpoints
 *
 * POST   .../checkpoints                    create a new checkpoint
 * GET    .../checkpoints                    list all checkpoints for a session
 * POST   .../checkpoints/bind-message       rebind a pending placeholder messageID to a real one
 * GET    .../checkpoints/diff               line-level diff (by sha pair, or sha vs workdir)
 * POST   .../checkpoints/:sha/restore       restore workdir to a specific checkpoint sha
 * POST   .../checkpoints/by-message/:msgId/restore  restore by messageID
 * DELETE .../checkpoints                    destroy all checkpoints for this session
 */
import type { WorkspaceInfo } from "./types.js";
import type { ServerConfig } from "./types.js";
import { ApiError } from "./errors.js";
import { CheckpointStore, destroySessionCheckpoints } from "./checkpoint-store.js";

// -----------------------------------------------------------------------
// Types shared with caller (server.ts)
// -----------------------------------------------------------------------

export type CheckpointRequestContext = {
  request: Request;
  url: URL;
  params: Record<string, string>;
  config: ServerConfig;
};

type JsonResponse = Response;
function jsonResponse(data: unknown, status = 200): JsonResponse {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
}

// -----------------------------------------------------------------------
// Route handlers
// -----------------------------------------------------------------------

function makeStore(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): CheckpointStore {
  const workspace = config.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw new ApiError(404, "workspace_not_found", "Workspace not found");
  }
  const workspaceRoot = workspace.engine?.directory?.trim() || workspace.path?.trim() || "";
  if (!workspaceRoot) {
    throw new ApiError(400, "workspace_root_missing", "Workspace root path is not configured");
  }
  return new CheckpointStore({ workspaceId, sessionId, workspaceRoot });
}

export async function handleCheckpointCreate(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const body = await readJsonBody(ctx.request);
  const messageID = typeof body.messageID === "string" ? body.messageID.trim() || null : null;
  const label = typeof body.label === "string" ? body.label.trim() || "checkpoint" : "checkpoint";
  const parentMessageID = typeof body.parentMessageID === "string" ? body.parentMessageID.trim() || null : null;

  const store = makeStore(ctx.config, workspaceId, sessionId);
  const entry = await store.createCheckpoint({ messageID, label, parentMessageID });
  return jsonResponse({ ok: true, entry }, 201);
}

export async function handleCheckpointList(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const store = makeStore(ctx.config, workspaceId, sessionId);
  const entries = await store.list();
  return jsonResponse({ items: entries });
}

export async function handleCheckpointBindMessage(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const body = await readJsonBody(ctx.request);
  const from = typeof body.fromMessageID === "string" ? body.fromMessageID.trim() : "";
  const to = typeof body.toMessageID === "string" ? body.toMessageID.trim() : "";
  if (!from || !to) {
    throw new ApiError(400, "invalid_payload", "fromMessageID and toMessageID are required");
  }
  const store = makeStore(ctx.config, workspaceId, sessionId);
  const ok = await store.bindMessageId({ fromMessageID: from, toMessageID: to });
  return jsonResponse({ ok });
}

export async function handleCheckpointDiff(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const fromSha = (ctx.url.searchParams.get("from") ?? "").trim();
  const toSha = (ctx.url.searchParams.get("to") ?? "").trim() || null;
  const ctx2 = Number(ctx.url.searchParams.get("context") ?? "3");
  const contextLines = Number.isFinite(ctx2) ? ctx2 : 3;
  if (!fromSha) {
    throw new ApiError(400, "invalid_payload", "Query param 'from' (sha) is required");
  }
  const store = makeStore(ctx.config, workspaceId, sessionId);
  const files = await store.diffDetailed({ fromSha, toSha, contextLines });
  return jsonResponse({ files });
}

export async function handleCheckpointRestoreBySha(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const sha = (ctx.params.sha ?? "").trim();
  if (!sha) throw new ApiError(400, "invalid_payload", "sha is required");
  const body = await readJsonBody(ctx.request);
  const safetyCheckpoint = body.safetyCheckpoint !== false;

  const store = makeStore(ctx.config, workspaceId, sessionId);
  const result = await store.restoreTo({ sha, safetyCheckpoint });
  return jsonResponse({ ok: true, ...result });
}

export async function handleCheckpointRestoreByMessage(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const messageID = (ctx.params.messageId ?? "").trim();
  if (!messageID) throw new ApiError(400, "invalid_payload", "messageId is required");
  const body = await readJsonBody(ctx.request);
  const safetyCheckpoint = body.safetyCheckpoint !== false;

  const store = makeStore(ctx.config, workspaceId, sessionId);
  const result = await store.restoreToMessage({ messageID, safetyCheckpoint });
  return jsonResponse({ ok: true, ...result });
}

export async function handleCheckpointDestroy(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  await destroySessionCheckpoints(workspaceId, sessionId);
  return jsonResponse({ ok: true });
}

/**
 * Read a single file's content from a specific checkpoint commit.
 *
 * GET /workspace/:id/sessions/:sessionId/checkpoints/files/content?sha=<sha>&path=<path>
 */
export async function handleCheckpointFileContent(
  ctx: CheckpointRequestContext,
): Promise<JsonResponse> {
  const { workspaceId, sessionId } = resolveParams(ctx);
  const sha = (ctx.url.searchParams.get("sha") ?? "").trim();
  const filePath = (ctx.url.searchParams.get("path") ?? "").trim();

  if (!sha) {
    throw new ApiError(400, "sha_required", "sha query parameter is required");
  }
  if (!filePath) {
    throw new ApiError(400, "invalid_payload", "path query parameter is required");
  }

  const store = makeStore(ctx.config, workspaceId, sessionId);
  const result = await store.readFileAtCommit({ sha, filePath });

  if (!result) {
    throw new ApiError(404, "file_not_found_at_checkpoint", "File not found at this checkpoint");
  }

  return jsonResponse({ path: filePath, content: result.content, bytes: result.bytes, sha });
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function resolveParams(ctx: CheckpointRequestContext): { workspaceId: string; sessionId: string } {
  const workspaceId = (ctx.params.id ?? "").trim();
  const sessionId = (ctx.params.sessionId ?? "").trim();
  if (!workspaceId) throw new ApiError(400, "invalid_payload", "workspaceId is required");
  if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
  return { workspaceId, sessionId };
}
