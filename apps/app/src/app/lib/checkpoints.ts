/**
 * Frontend client for AiWork session checkpoints (shadow-git based file/version
 * time travel). Endpoints are mounted under
 *   /workspace/:workspaceId/sessions/:sessionId/checkpoints
 *
 * The base URL and auth token mirror what `createAiWorkServerClient` uses.
 */

export type CheckpointEntry = {
  id: string;
  sha: string;
  messageID: string | null;
  label: string;
  parentMessageID: string | null;
  createdAt: number;
  stats: { files: number; additions: number; deletions: number };
};

export type CheckpointDiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed" | "type-changed" | "unknown";
  additions: number;
  deletions: number;
  binary: boolean;
  truncated?: boolean;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    header: string;
    lines: Array<{ kind: "context" | "add" | "del"; text: string }>;
  }>;
};

export type RestoreResult = {
  ok: true;
  restored: number;
  removed: number;
  safetySha: string | null;
  sha?: string;
};

type ClientOptions = {
  baseUrl: string;
  token: string;
};

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function asJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through
    }
  }
  if (!response.ok) {
    const obj = parsed as { code?: string; message?: string } | null;
    const message = obj?.message ?? response.statusText ?? "checkpoint request failed";
    const code = obj?.code ?? "checkpoint_request_failed";
    const error = new Error(`${code}: ${message}`);
    (error as Error & { code?: string; status?: number }).code = code;
    (error as Error & { code?: string; status?: number }).status = response.status;
    throw error;
  }
  return parsed as T;
}

function pathPrefix(workspaceId: string, sessionId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/checkpoints`;
}

export function createCheckpointClient({ baseUrl, token }: ClientOptions) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async create(input: {
      workspaceId: string;
      sessionId: string;
      messageID: string | null;
      label?: string;
      parentMessageID?: string | null;
    }): Promise<{ ok: true; entry: CheckpointEntry }> {
      const response = await fetch(`${root}${pathPrefix(input.workspaceId, input.sessionId)}`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          messageID: input.messageID,
          label: input.label,
          parentMessageID: input.parentMessageID,
        }),
      });
      return asJson(response);
    },

    async list(input: { workspaceId: string; sessionId: string }): Promise<{ items: CheckpointEntry[] }> {
      const response = await fetch(`${root}${pathPrefix(input.workspaceId, input.sessionId)}`, {
        method: "GET",
        headers: authHeaders(token),
      });
      return asJson(response);
    },

    async bindMessage(input: {
      workspaceId: string;
      sessionId: string;
      fromMessageID: string;
      toMessageID: string;
    }): Promise<{ ok: boolean }> {
      const response = await fetch(
        `${root}${pathPrefix(input.workspaceId, input.sessionId)}/bind-message`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({
            fromMessageID: input.fromMessageID,
            toMessageID: input.toMessageID,
          }),
        },
      );
      return asJson(response);
    },

    async diff(input: {
      workspaceId: string;
      sessionId: string;
      fromSha: string;
      toSha?: string | null;
      contextLines?: number;
    }): Promise<{ files: CheckpointDiffFile[] }> {
      const params = new URLSearchParams({ from: input.fromSha });
      if (input.toSha) params.set("to", input.toSha);
      if (typeof input.contextLines === "number") params.set("context", String(input.contextLines));
      const response = await fetch(
        `${root}${pathPrefix(input.workspaceId, input.sessionId)}/diff?${params.toString()}`,
        { method: "GET", headers: authHeaders(token) },
      );
      return asJson(response);
    },

    async restoreBySha(input: {
      workspaceId: string;
      sessionId: string;
      sha: string;
      safetyCheckpoint?: boolean;
    }): Promise<RestoreResult> {
      const response = await fetch(
        `${root}${pathPrefix(input.workspaceId, input.sessionId)}/${encodeURIComponent(input.sha)}/restore`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ safetyCheckpoint: input.safetyCheckpoint !== false }),
        },
      );
      return asJson(response);
    },

    async restoreByMessage(input: {
      workspaceId: string;
      sessionId: string;
      messageID: string;
      safetyCheckpoint?: boolean;
    }): Promise<RestoreResult> {
      const response = await fetch(
        `${root}${pathPrefix(input.workspaceId, input.sessionId)}/by-message/${encodeURIComponent(input.messageID)}/restore`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ safetyCheckpoint: input.safetyCheckpoint !== false }),
        },
      );
      return asJson(response);
    },

    async destroy(input: { workspaceId: string; sessionId: string }): Promise<{ ok: boolean }> {
      const response = await fetch(`${root}${pathPrefix(input.workspaceId, input.sessionId)}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      return asJson(response);
    },
  };
}

export type CheckpointClient = ReturnType<typeof createCheckpointClient>;
