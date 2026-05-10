import { RouteError } from "../../http.js";
import type { ServerRecord, WorkspaceRecord } from "../../database/types.js";
import { createOpenCodeSessionBackend } from "./opencode-backend.js";
import { buildRemoteAiWorkHeaders } from "../remote-aiwork.js";

export function createRemoteAiWorkSessionAdapter(input: {
  server: ServerRecord;
  workspace: WorkspaceRecord;
}) {
  if (!input.server.baseUrl) {
    throw new RouteError(502, "bad_gateway", "Remote workspace server is missing a base URL.");
  }

  const remoteType = input.workspace.notes?.remoteType === "opencode" ? "opencode" : "aiwork";
  const remoteWorkspaceId = input.workspace.remoteWorkspaceId?.trim() ?? "";

  if (remoteType === "aiwork") {
    if (!remoteWorkspaceId) {
      throw new RouteError(502, "bad_gateway", "Remote AiWork workspace is missing its remote workspace identifier.");
    }

    return createOpenCodeSessionBackend({
      baseUrl: `${input.server.baseUrl.replace(/\/+$/, "")}/w/${encodeURIComponent(remoteWorkspaceId)}/opencode`,
      headers: buildRemoteAiWorkHeaders(input.server),
    });
  }

  return createOpenCodeSessionBackend({
    baseUrl: input.server.baseUrl,
    directory: typeof input.workspace.notes?.directory === "string" ? input.workspace.notes.directory : undefined,
    headers: buildRemoteAiWorkHeaders(input.server),
  });
}
