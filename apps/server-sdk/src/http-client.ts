import type { IAiWorkServerClient } from "./interface.js";
import {
  ApiRoutes,
  buildRoute,
} from "./routes.js";
import type {
  AiWorkArtifactList,
  AiWorkCommandItem,
  AiWorkHubRepo,
  AiWorkHubSkillItem,
  AiWorkInboxList,
  AiWorkInboxUploadResult,
  AiWorkMcpItem,
  AiWorkModelProviderModelsResult,
  AiWorkPluginItem,
  AiWorkReloadEvent,
  AiWorkServerCapabilities,
  AiWorkServerDiagnostics,
  AiWorkSessionMessage,
  AiWorkSessionSnapshot,
  AiWorkSkillContent,
  AiWorkSkillItem,
  AiWorkWorkspaceConfig,
  AiWorkWorkspaceDirectoryList,
  AiWorkWorkspaceFileContent,
  AiWorkWorkspaceFileWriteResult,
  AiWorkWorkspaceGitStatus,
  AiWorkWorkspaceInfo,
  AiWorkWorkspaceList,
  EngineConfigFile,
} from "./types.js";

// ---------------------------------------------------------------------------
// Re-exported for convenience so consumers can import from a single entry point
// ---------------------------------------------------------------------------
export { ApiRoutes, buildRoute };
export type { IAiWorkServerClient };
export type * from "./types.js";

// ---------------------------------------------------------------------------
// Log callback
// ---------------------------------------------------------------------------

export type AiWorkLogCallback = (
  method: string,
  phase: "call" | "ok" | "error",
  data: unknown,
) => void;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class AiWorkServerError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AiWorkServerError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AiWorkServerHttpClientOptions {
  baseUrl: string;
  token?: string;
  hostToken?: string;
  /** Custom fetch implementation (e.g. Tauri HTTP plugin fetch). */
  fetchImpl?: typeof fetch;
  /** Default request timeout in milliseconds (default: 10_000). */
  defaultTimeoutMs?: number;
  /** Optional callback for logging method calls, results, and errors. */
  logCallback?: AiWorkLogCallback;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function buildHeaders(
  token?: string,
  hostToken?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-AiWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

function buildAuthHeaders(
  token?: string,
  hostToken?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-AiWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller?.signal;
  const initWithSignal =
    signal && !init.signal ? { ...init, signal } : init;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, initWithSignal), timeoutPromise]);
  } catch (error) {
    const name =
      error &&
      typeof error === "object" &&
      "name" in error
        ? (error as { name?: string }).name
        : "";
    if (name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// HTTP Client Implementation
// ---------------------------------------------------------------------------

export class HttpAiWorkServerClient implements IAiWorkServerClient {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly hostToken: string | undefined;
  private readonly _fetch: typeof fetch;
  private readonly _defaultTimeoutMs: number;
  private readonly _logCallback: AiWorkLogCallback | undefined;

  private readonly _timeouts: Record<string, number>;

  constructor(options: AiWorkServerHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.hostToken = options.hostToken;
    this._fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this._defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._logCallback = options.logCallback;

    this._timeouts = {
      health: 3_000,
      capabilities: 6_000,
      listWorkspaces: 8_000,
      activateWorkspace: 10_000,
      deleteWorkspace: 10_000,
      deleteSession: 12_000,
      sessionRead: 12_000,
      status: 6_000,
      config: 10_000,
      workspaceExport: 30_000,
      workspaceImport: 30_000,
      binary: 60_000,
      openAiCompatibleModels: 65_000,
    };
  }

  private _logCall<T>(method: string, promise: Promise<T>, input?: unknown): Promise<T> {
    if (!this._logCallback) return promise;
    this._logCallback(method, "call", input);
    return promise.then(
      (result) => { this._logCallback!(method, "ok", result); return result; },
      (error) => { this._logCallback!(method, "error", error); return Promise.reject(error); },
    );
  }

  // ---- Core request helpers ----

  private async _requestJson<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;

    const response = await fetchWithTimeout(
      this._fetch,
      url,
      {
        method: options.method ?? "GET",
        headers: buildHeaders(this.token, this.hostToken, options.headers),
        body: options.body != null ? JSON.stringify(options.body) : undefined,
      },
      timeoutMs,
    );

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const code =
        typeof json?.code === "string" ? json.code : "request_failed";
      const message =
        typeof json?.message === "string"
          ? json.message
          : response.statusText;
      const details = isPlainObject(json?.details)
        ? { ...json.details, url }
        : json?.details !== undefined
          ? { details: json.details, url }
          : { url };
      throw new AiWorkServerError(response.status, code, message, details);
    }

    return json as T;
  }

  private async _requestBinary(
    path: string,
    options: { method?: string; timeoutMs?: number } = {},
  ): Promise<{
    data: ArrayBuffer;
    contentType: string | null;
    filename: string | null;
  }> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;

    const response = await fetchWithTimeout(
      this._fetch,
      url,
      {
        method: options.method ?? "GET",
        headers: buildAuthHeaders(this.token, this.hostToken),
      },
      timeoutMs,
    );

    if (!response.ok) {
      const text = await response.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const code =
        typeof json?.code === "string" ? json.code : "request_failed";
      const message =
        typeof json?.message === "string"
          ? json.message
          : response.statusText;
      throw new AiWorkServerError(
        response.status,
        code,
        message,
        json?.details,
      );
    }

    const contentType = response.headers.get("content-type");
    const disposition =
      response.headers.get("content-disposition") ?? "";
    const filenameMatch = disposition.match(
      /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
    );
    const filenameRaw =
      filenameMatch?.[1] ?? filenameMatch?.[2] ?? null;
    const filename = filenameRaw ? decodeURIComponent(filenameRaw) : null;
    const data = await response.arrayBuffer();
    return { data, contentType, filename };
  }

  private async _requestMultipart(
    path: string,
    options: { method?: string; body?: FormData; timeoutMs?: number } = {},
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;

    const response = await fetchWithTimeout(
      this._fetch,
      url,
      {
        method: options.method ?? "POST",
        headers: buildAuthHeaders(this.token, this.hostToken),
        body: options.body,
      },
      timeoutMs,
    );
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  }

  // ---- API methods ----

  health(): Promise<{ ok: boolean; version: string; uptimeMs: number }> {
    return this._logCall("health",
      this._requestJson(ApiRoutes.HEALTH, { timeoutMs: this._timeouts.health }));
  }

  status(): Promise<AiWorkServerDiagnostics> {
    return this._logCall("status",
      this._requestJson(ApiRoutes.STATUS, { timeoutMs: this._timeouts.status }));
  }

  capabilities(): Promise<AiWorkServerCapabilities> {
    return this._logCall("capabilities",
      this._requestJson(ApiRoutes.CAPABILITIES, { timeoutMs: this._timeouts.capabilities }));
  }

  listWorkspaces(): Promise<AiWorkWorkspaceList> {
    return this._logCall("listWorkspaces",
      this._requestJson(ApiRoutes.WORKSPACES, { timeoutMs: this._timeouts.listWorkspaces }));
  }

  createLocalWorkspace(payload: {
    folderPath: string;
    name: string;
    preset: string;
  }): Promise<{
    activeId: string;
    workspaces: AiWorkWorkspaceInfo[];
    persisted: boolean;
  }> {
    return this._logCall("createLocalWorkspace",
      this._requestJson(ApiRoutes.WORKSPACES_LOCAL, {
        method: "POST",
        body: payload,
        timeoutMs: this._timeouts.activateWorkspace,
      }),
      payload);
  }

  updateWorkspaceDisplayName(
    workspaceId: string,
    displayName: string | null,
  ): Promise<{
    activeId: string | null;
    workspaces: AiWorkWorkspaceInfo[];
    persisted: boolean;
  }> {
    return this._logCall("updateWorkspaceDisplayName",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACES_DISPLAY_NAME, { id: workspaceId }),
        { method: "PATCH", body: { displayName }, timeoutMs: this._timeouts.activateWorkspace },
      ),
      { workspaceId, displayName });
  }

  activateWorkspace(
    workspaceId: string,
  ): Promise<{ activeId: string; workspace: AiWorkWorkspaceInfo }> {
    return this._logCall("activateWorkspace",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACES_ACTIVATE, { id: workspaceId }),
        { method: "POST", timeoutMs: this._timeouts.activateWorkspace },
      ),
      { workspaceId });
  }

  reorderWorkspaces(
    workspaceIds: string[],
  ): Promise<{
    ok: boolean;
    persisted: boolean;
    activeId: string | null;
    items: AiWorkWorkspaceInfo[];
    workspaces?: AiWorkWorkspaceInfo[];
  }> {
    return this._logCall("reorderWorkspaces",
      this._requestJson(ApiRoutes.WORKSPACES_REORDER, {
        method: "POST",
        body: { workspaceIds },
        timeoutMs: this._timeouts.activateWorkspace,
      }),
      { workspaceIds });
  }

  deleteWorkspace(
    workspaceId: string,
  ): Promise<{
    ok: boolean;
    deleted: boolean;
    persisted: boolean;
    activeId: string | null;
    items: AiWorkWorkspaceInfo[];
    workspaces?: AiWorkWorkspaceInfo[];
  }> {
    return this._logCall("deleteWorkspace",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACES_DELETE, { id: workspaceId }),
        { method: "DELETE", timeoutMs: this._timeouts.deleteWorkspace },
      ),
      { workspaceId });
  }

  deleteSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ ok: boolean }> {
    return this._logCall("deleteSession",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_SESSION_DELETE, { id: workspaceId, sessionId }),
        { method: "DELETE", timeoutMs: this._timeouts.deleteSession },
      ),
      { workspaceId, sessionId });
  }

  listSessions(
    workspaceId: string,
    options?: {
      roots?: boolean;
      start?: number;
      search?: string;
      limit?: number;
    },
  ): Promise<{
    items: Array<{
      id: string;
      title?: string;
      createdAt?: number;
      updatedAt?: number;
      model?: string;
    }>;
  }> {
    const query = new URLSearchParams();
    if (typeof options?.roots === "boolean")
      query.set("roots", String(options.roots));
    if (typeof options?.start === "number")
      query.set("start", String(options.start));
    if (options?.search?.trim())
      query.set("search", options.search.trim());
    if (typeof options?.limit === "number")
      query.set("limit", String(options.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this._logCall("listSessions",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_SESSIONS, { id: workspaceId })}${suffix}`,
        { timeoutMs: this._timeouts.sessionRead },
      ),
      { workspaceId, options });
  }

  getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{
    item: {
      id: string;
      title?: string;
      createdAt?: number;
      updatedAt?: number;
      model?: string;
    };
  }> {
    return this._logCall("getSession",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_SESSION, { id: workspaceId, sessionId }),
        { timeoutMs: this._timeouts.sessionRead },
      ),
      { workspaceId, sessionId });
  }

  getSessionMessages(
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<{ items: AiWorkSessionMessage[] }> {
    const query = new URLSearchParams();
    if (typeof options?.limit === "number")
      query.set("limit", String(options.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this._logCall("getSessionMessages",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_SESSION_MESSAGES, {
          id: workspaceId,
          sessionId,
        })}${suffix}`,
        { timeoutMs: this._timeouts.sessionRead },
      ),
      { workspaceId, sessionId, options });
  }

  getSessionSnapshot(
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<{ item: AiWorkSessionSnapshot }> {
    const query = new URLSearchParams();
    if (typeof options?.limit === "number")
      query.set("limit", String(options.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this._logCall("getSessionSnapshot",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_SESSION_SNAPSHOT, {
          id: workspaceId,
          sessionId,
        })}${suffix}`,
        { timeoutMs: this._timeouts.sessionRead },
      ),
      { workspaceId, sessionId, options });
  }

  getConfig(workspaceId: string): Promise<AiWorkWorkspaceConfig> {
    return this._logCall("getConfig",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_CONFIG, { id: workspaceId }),
        { timeoutMs: this._timeouts.config },
      ),
      { workspaceId });
  }

  patchConfig(
    workspaceId: string,
    payload: {
      engine?: Record<string, unknown>;
      aiwork?: Record<string, unknown>;
    },
  ): Promise<{ updatedAt?: number | null }> {
    return this._logCall("patchConfig",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_CONFIG_PATCH, { id: workspaceId }),
        { method: "PATCH", body: payload },
      ),
      { workspaceId, payload });
  }

  readEngineConfigFile(
    workspaceId: string,
    scope: "project" | "global" = "project",
  ): Promise<EngineConfigFile> {
    const params = new URLSearchParams({ scope });
    params.set("_", String(Date.now()));
    const query = `?${params.toString()}`;
    return this._logCall("readEngineConfigFile",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_ENGINE_CONFIG, {
          id: workspaceId,
        })}${query}`,
      ),
      { workspaceId, scope });
  }

  writeEngineConfigFile(
    workspaceId: string,
    scope: "project" | "global",
    content: string,
  ): Promise<{ ok: boolean; status: number; stdout: string; stderr: string }> {
    return this._logCall("writeEngineConfigFile",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_ENGINE_CONFIG_WRITE, { id: workspaceId }),
        { method: "POST", body: { scope, content } },
      ),
      { workspaceId, scope });
  }

  proxyModelProviderModels(
    workspaceId: string,
    body: { baseURL: string; apiKey: string; providerType: string },
  ): Promise<AiWorkModelProviderModelsResult> {
    return this._logCall("proxyModelProviderModels",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MODEL_PROVIDER_MODELS, { id: workspaceId }),
        { method: "POST", body, timeoutMs: this._timeouts.openAiCompatibleModels },
      ),
      { workspaceId, providerType: body.providerType });
  }

  listReloadEvents(
    workspaceId: string,
    options?: { since?: number },
  ): Promise<{ items: AiWorkReloadEvent[]; cursor?: number }> {
    const query =
      typeof options?.since === "number" ? `?since=${options.since}` : "";
    return this._logCall("listReloadEvents",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_EVENTS, { id: workspaceId })}${query}`,
      ),
      { workspaceId, options });
  }

  reloadEngine(
    workspaceId: string,
  ): Promise<{ ok: boolean; reloadedAt?: number }> {
    return this._logCall("reloadEngine",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_ENGINE_RELOAD, { id: workspaceId }),
        { method: "POST" },
      ),
      { workspaceId });
  }

  listPlugins(
    workspaceId: string,
    options?: { includeGlobal?: boolean },
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }> {
    const query = options?.includeGlobal ? "?includeGlobal=true" : "";
    return this._logCall("listPlugins",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_PLUGINS, { id: workspaceId })}${query}`,
      ),
      { workspaceId, options });
  }

  addPlugin(
    workspaceId: string,
    spec: string,
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }> {
    return this._logCall("addPlugin",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_PLUGINS_ADD, { id: workspaceId }),
        { method: "POST", body: { spec } },
      ),
      { workspaceId, spec });
  }

  removePlugin(
    workspaceId: string,
    name: string,
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }> {
    return this._logCall("removePlugin",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_PLUGINS_REMOVE, { id: workspaceId, name }),
        { method: "DELETE" },
      ),
      { workspaceId, name });
  }

  listSkills(
    workspaceId: string,
    options?: { includeGlobal?: boolean },
  ): Promise<{ items: AiWorkSkillItem[] }> {
    const query = options?.includeGlobal ? "?includeGlobal=true" : "";
    return this._logCall("listSkills",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_SKILLS, { id: workspaceId })}${query}`,
      ),
      { workspaceId, options });
  }

  listHubSkills(
    options?: { repo?: AiWorkHubRepo },
  ): Promise<{ items: AiWorkHubSkillItem[] }> {
    const params = new URLSearchParams();
    const owner = options?.repo?.owner?.trim();
    const repo = options?.repo?.repo?.trim();
    const ref = options?.repo?.ref?.trim();
    if (owner) params.set("owner", owner);
    if (repo) params.set("repo", repo);
    if (ref) params.set("ref", ref);
    const query = params.size ? `?${params.toString()}` : "";
    return this._logCall("listHubSkills",
      this._requestJson(`${ApiRoutes.HUB_SKILLS}${query}`),
      options);
  }

  installHubSkill(
    workspaceId: string,
    name: string,
    options?: {
      overwrite?: boolean;
      repo?: { owner?: string; repo?: string; ref?: string };
    },
  ): Promise<{
    ok: boolean;
    name: string;
    path: string;
    action: "added" | "updated";
    written: number;
    skipped: number;
  }> {
    return this._logCall("installHubSkill",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_SKILLS_HUB_INSTALL, { id: workspaceId, name }),
        {
          method: "POST",
          body: {
            ...(options?.overwrite ? { overwrite: true } : {}),
            ...(options?.repo ? { repo: options.repo } : {}),
          },
        },
      ),
      { workspaceId, name, options });
  }

  getSkill(
    workspaceId: string,
    name: string,
    options?: { includeGlobal?: boolean },
  ): Promise<AiWorkSkillContent> {
    const query = options?.includeGlobal ? "?includeGlobal=true" : "";
    return this._logCall("getSkill",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_SKILL, { id: workspaceId, name })}${query}`,
      ),
      { workspaceId, name, options });
  }

  upsertSkill(
    workspaceId: string,
    payload: { name: string; content: string; description?: string },
  ): Promise<AiWorkSkillItem> {
    return this._logCall("upsertSkill",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_SKILLS_UPSERT, { id: workspaceId }),
        { method: "POST", body: payload },
      ),
      { workspaceId, name: payload.name });
  }

  deleteSkill(
    workspaceId: string,
    name: string,
  ): Promise<{ path: string }> {
    return this._logCall("deleteSkill",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_SKILLS_DELETE, { id: workspaceId, name }),
        { method: "DELETE" },
      ),
      { workspaceId, name });
  }

  listMcp(workspaceId: string): Promise<{ items: AiWorkMcpItem[] }> {
    return this._logCall("listMcp",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MCP, { id: workspaceId }),
      ),
      { workspaceId });
  }

  addMcp(
    workspaceId: string,
    payload: { name: string; config: Record<string, unknown> },
  ): Promise<{ items: AiWorkMcpItem[] }> {
    return this._logCall("addMcp",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MCP_ADD, { id: workspaceId }),
        { method: "POST", body: payload },
      ),
      { workspaceId, name: payload.name });
  }

  removeMcp(
    workspaceId: string,
    name: string,
  ): Promise<{ items: AiWorkMcpItem[] }> {
    return this._logCall("removeMcp",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MCP_REMOVE, { id: workspaceId, name }),
        { method: "DELETE" },
      ),
      { workspaceId, name });
  }

  setMcpEnabled(
    workspaceId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ items: AiWorkMcpItem[] }> {
    return this._logCall("setMcpEnabled",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MCP_ENABLED, { id: workspaceId, name }),
        { method: "POST", body: { enabled } },
      ),
      { workspaceId, name, enabled });
  }

  logoutMcpAuth(
    workspaceId: string,
    name: string,
  ): Promise<{ ok: true }> {
    return this._logCall("logoutMcpAuth",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_MCP_AUTH, { id: workspaceId, name }),
        { method: "DELETE" },
      ),
      { workspaceId, name });
  }

  listCommands(
    workspaceId: string,
    scope: "workspace" | "global" = "workspace",
  ): Promise<{ items: AiWorkCommandItem[] }> {
    return this._logCall("listCommands",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_COMMANDS, { id: workspaceId })}?scope=${scope}`,
      ),
      { workspaceId, scope });
  }

  upsertCommand(
    workspaceId: string,
    payload: {
      name: string;
      description?: string;
      template: string;
      agent?: string;
      model?: string | null;
      subtask?: boolean;
    },
  ): Promise<{ items: AiWorkCommandItem[] }> {
    return this._logCall("upsertCommand",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_COMMANDS_UPSERT, { id: workspaceId }),
        { method: "POST", body: payload },
      ),
      { workspaceId, name: payload.name });
  }

  deleteCommand(
    workspaceId: string,
    name: string,
  ): Promise<{ ok: boolean }> {
    return this._logCall("deleteCommand",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_COMMANDS_DELETE, { id: workspaceId, name }),
        { method: "DELETE" },
      ),
      { workspaceId, name });
  }

  async uploadInbox(
    workspaceId: string,
    file: { name: string; size: number; content: Blob | ArrayBuffer },
    options?: { path?: string },
  ): Promise<AiWorkInboxUploadResult> {
    const id = workspaceId.trim();
    if (!id) throw new Error("workspaceId is required");
    if (!file) throw new Error("file is required");

    const form = new FormData();
    const blob =
      file.content instanceof Blob
        ? file.content
        : new Blob([file.content]);

    const fileObj = new File([blob], file.name, { type: "application/octet-stream" });
    form.append("file", fileObj);
    if (options?.path?.trim()) {
      form.append("path", options.path.trim());
    }

    const uploadPromise = (async () => {
      const result = await this._requestMultipart(
        buildRoute(ApiRoutes.WORKSPACE_INBOX_UPLOAD, { id: workspaceId }),
        { method: "POST", body: form, timeoutMs: this._timeouts.binary },
      );

      if (!result.ok) {
        let message = result.text.trim();
        try {
          const json = message ? JSON.parse(message) : null;
          if (json && typeof json.message === "string") {
            message = json.message;
          }
        } catch {
          // ignore
        }
        throw new AiWorkServerError(
          result.status,
          "request_failed",
          message || "Shared folder upload failed",
        );
      }

      const body = result.text.trim();
      if (body) {
        try {
          const parsed = JSON.parse(body) as Partial<AiWorkInboxUploadResult>;
          if (typeof parsed.path === "string" && parsed.path.trim()) {
            return {
              ok: parsed.ok ?? true,
              path: parsed.path.trim(),
              bytes: typeof parsed.bytes === "number" ? parsed.bytes : file.size,
            };
          }
        } catch {
          // ignore invalid JSON
        }
      }

      return {
        ok: true,
        path: options?.path?.trim() || file.name,
        bytes: file.size,
      };
    })();

    return this._logCall("uploadInbox", uploadPromise, { workspaceId, fileName: file.name, path: options?.path });
  }

  listInbox(workspaceId: string): Promise<AiWorkInboxList> {
    return this._logCall("listInbox",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_INBOX, { id: workspaceId }),
      ),
      { workspaceId });
  }

  downloadInboxItem(
    workspaceId: string,
    inboxId: string,
  ): Promise<{
    data: ArrayBuffer;
    contentType: string | null;
    filename: string | null;
  }> {
    return this._logCall("downloadInboxItem",
      this._requestBinary(
        buildRoute(ApiRoutes.WORKSPACE_INBOX_ITEM, { id: workspaceId, inboxId }),
        { timeoutMs: this._timeouts.binary },
      ),
      { workspaceId, inboxId });
  }

  readWorkspaceFile(
    workspaceId: string,
    path: string,
    options?: { optional?: boolean },
  ): Promise<AiWorkWorkspaceFileContent> {
    const query = `?path=${encodeURIComponent(path)}${options?.optional ? "&optional=1" : ""}`;
    return this._logCall("readWorkspaceFile",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_FILES_CONTENT, { id: workspaceId })}${query}`,
      ),
      { workspaceId, path, options });
  }

  listWorkspaceDirectory(
    workspaceId: string,
    path?: string,
  ): Promise<AiWorkWorkspaceDirectoryList> {
    const query = path?.trim()
      ? `?path=${encodeURIComponent(path.trim())}`
      : "";
    return this._logCall("listWorkspaceDirectory",
      this._requestJson(
        `${buildRoute(ApiRoutes.WORKSPACE_FILES_LIST, { id: workspaceId })}${query}`,
      ),
      { workspaceId, path });
  }

  getWorkspaceGitStatus(
    workspaceId: string,
  ): Promise<AiWorkWorkspaceGitStatus> {
    return this._logCall("getWorkspaceGitStatus",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_GIT_STATUS, { id: workspaceId }),
      ),
      { workspaceId });
  }

  writeWorkspaceFile(
    workspaceId: string,
    payload: {
      path: string;
      content: string;
      baseUpdatedAt?: number | null;
      force?: boolean;
    },
  ): Promise<AiWorkWorkspaceFileWriteResult> {
    return this._logCall("writeWorkspaceFile",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_FILES_CONTENT_WRITE, { id: workspaceId }),
        { method: "POST", body: payload },
      ),
      { workspaceId, path: payload.path });
  }

  listArtifacts(workspaceId: string): Promise<AiWorkArtifactList> {
    return this._logCall("listArtifacts",
      this._requestJson(
        buildRoute(ApiRoutes.WORKSPACE_ARTIFACTS, { id: workspaceId }),
      ),
      { workspaceId });
  }

  downloadArtifact(
    workspaceId: string,
    artifactId: string,
  ): Promise<{
    data: ArrayBuffer;
    contentType: string | null;
    filename: string | null;
  }> {
    return this._logCall("downloadArtifact",
      this._requestBinary(
        buildRoute(ApiRoutes.WORKSPACE_ARTIFACT, { id: workspaceId, artifactId }),
        { timeoutMs: this._timeouts.binary },
      ),
      { workspaceId, artifactId });
  }

  listUserEnvKeys(): Promise<{ keys: string[] }> {
    return this._logCall("listUserEnvKeys",
      this._requestJson(ApiRoutes.ENV_KEYS, { timeoutMs: this._timeouts.config }));
  }

  listUserEnv(): Promise<{
    items: Array<{ key: string; value: string; updatedAt: number }>;
  }> {
    return this._logCall("listUserEnv",
      this._requestJson(ApiRoutes.ENV, { timeoutMs: this._timeouts.config }));
  }

  upsertUserEnv(
    entries: Array<{ key: string; value: string }>,
  ): Promise<{ ok: true; count: number }> {
    return this._logCall("upsertUserEnv",
      this._requestJson(ApiRoutes.ENV_UPSERT, {
        method: "PUT",
        body: { entries },
        timeoutMs: this._timeouts.config,
      }),
      { count: entries.length });
  }

  deleteUserEnv(key: string): Promise<{ ok: true }> {
    return this._logCall("deleteUserEnv",
      this._requestJson(buildRoute(ApiRoutes.ENV_DELETE, { key }), {
        method: "DELETE",
        timeoutMs: this._timeouts.config,
      }),
      { key });
  }
}