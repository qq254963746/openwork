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
  AiWorkTokenItem,
  AiWorkWorkspaceConfig,
  AiWorkWorkspaceDirectoryList,
  AiWorkWorkspaceFileContent,
  AiWorkWorkspaceFileWriteResult,
  AiWorkWorkspaceGitStatus,
  AiWorkWorkspaceInfo,
  AiWorkWorkspaceList,
  EngineConfigFile,
} from "./types.js";

/**
 * Client interface for the AiWork Server HTTP API.
 *
 * Every method corresponds to an endpoint defined in `apps/server/src/server.ts`
 * and matches the shape returned by `createAiWorkServerClient` in the app layer.
 */
export interface IAiWorkServerClient {
  /** Server health check. GET /health */
  health(): Promise<{ ok: boolean; version: string; uptimeMs: number }>;

  /** Server diagnostics. GET /status */
  status(): Promise<AiWorkServerDiagnostics>;

  /** Server capabilities. GET /capabilities */
  capabilities(): Promise<AiWorkServerCapabilities>;

  /** List workspaces. GET /workspaces */
  listWorkspaces(): Promise<AiWorkWorkspaceList>;

  /** Create a local workspace. POST /workspaces/local */
  createLocalWorkspace(payload: {
    folderPath: string;
    name: string;
    preset: string;
  }): Promise<{ activeId: string; workspaces: AiWorkWorkspaceInfo[]; persisted: boolean }>;

  /** Update workspace display name. PATCH /workspaces/:id/display-name */
  updateWorkspaceDisplayName(
    workspaceId: string,
    displayName: string | null,
  ): Promise<{
    activeId: string | null;
    workspaces: AiWorkWorkspaceInfo[];
    persisted: boolean;
  }>;

  /** Activate a workspace. POST /workspaces/:id/activate */
  activateWorkspace(
    workspaceId: string,
  ): Promise<{ activeId: string; workspace: AiWorkWorkspaceInfo }>;

  /** Reorder workspaces. POST /workspaces/reorder */
  reorderWorkspaces(
    workspaceIds: string[],
  ): Promise<{
    ok: boolean;
    persisted: boolean;
    activeId: string | null;
    items: AiWorkWorkspaceInfo[];
    workspaces?: AiWorkWorkspaceInfo[];
  }>;

  /** Delete a workspace. DELETE /workspaces/:id */
  deleteWorkspace(
    workspaceId: string,
  ): Promise<{
    ok: boolean;
    deleted: boolean;
    persisted: boolean;
    activeId: string | null;
    items: AiWorkWorkspaceInfo[];
    workspaces?: AiWorkWorkspaceInfo[];
  }>;

  /** Delete a session (via engine proxy). DELETE /workspace/:id/sessions/:sessionId */
  deleteSession(workspaceId: string, sessionId: string): Promise<{ ok: boolean }>;

  /** List sessions. GET /workspace/:id/sessions */
  listSessions(
    workspaceId: string,
    options?: { roots?: boolean; start?: number; search?: string; limit?: number },
  ): Promise<{ items: Array<{ id: string; title?: string; createdAt?: number; updatedAt?: number; model?: string }> }>;

  /** Get a session. GET /workspace/:id/sessions/:sessionId */
  getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ item: { id: string; title?: string; createdAt?: number; updatedAt?: number; model?: string } }>;

  /** Get session messages. GET /workspace/:id/sessions/:sessionId/messages */
  getSessionMessages(
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<{ items: AiWorkSessionMessage[] }>;

  /** Get session snapshot. GET /workspace/:id/sessions/:sessionId/snapshot */
  getSessionSnapshot(
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<{ item: AiWorkSessionSnapshot }>;

  /** Get workspace config. GET /workspace/:id/config */
  getConfig(workspaceId: string): Promise<AiWorkWorkspaceConfig>;

  /** Patch workspace config. PATCH /workspace/:id/config */
  patchConfig(
    workspaceId: string,
    payload: { engine?: Record<string, unknown>; aiwork?: Record<string, unknown> },
  ): Promise<{ updatedAt?: number | null }>;

  /** Read engine config file. GET /workspace/:id/engine-config */
  readEngineConfigFile(
    workspaceId: string,
    scope?: "project" | "global",
  ): Promise<EngineConfigFile>;

  /** Write engine config file. POST /workspace/:id/engine-config */
  writeEngineConfigFile(
    workspaceId: string,
    scope: "project" | "global",
    content: string,
  ): Promise<{ ok: boolean; status: number; stdout: string; stderr: string }>;

  /** Proxy model provider model listing. POST /workspace/:id/model-provider/models */
  proxyModelProviderModels(
    workspaceId: string,
    body: { baseURL: string; apiKey: string; providerType: string },
  ): Promise<AiWorkModelProviderModelsResult>;

  /** List reload events. GET /workspace/:id/events */
  listReloadEvents(
    workspaceId: string,
    options?: { since?: number },
  ): Promise<{ items: AiWorkReloadEvent[]; cursor?: number }>;

  /** Reload workspace engine. POST /workspace/:id/engine/reload */
  reloadEngine(workspaceId: string): Promise<{ ok: boolean; reloadedAt?: number }>;

  /** List plugins. GET /workspace/:id/plugins */
  listPlugins(
    workspaceId: string,
    options?: { includeGlobal?: boolean },
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }>;

  /** Add a plugin. POST /workspace/:id/plugins */
  addPlugin(
    workspaceId: string,
    spec: string,
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }>;

  /** Remove a plugin. DELETE /workspace/:id/plugins/:name */
  removePlugin(
    workspaceId: string,
    name: string,
  ): Promise<{ items: AiWorkPluginItem[]; loadOrder: string[] }>;

  /** List skills. GET /workspace/:id/skills */
  listSkills(
    workspaceId: string,
    options?: { includeGlobal?: boolean },
  ): Promise<{ items: AiWorkSkillItem[] }>;

  /** List hub skills. GET /hub/skills */
  listHubSkills(
    options?: { repo?: AiWorkHubRepo },
  ): Promise<{ items: AiWorkHubSkillItem[] }>;

  /** Install a hub skill. POST /workspace/:id/skills/hub/:name */
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
  }>;

  /** Get a skill. GET /workspace/:id/skills/:name */
  getSkill(
    workspaceId: string,
    name: string,
    options?: { includeGlobal?: boolean },
  ): Promise<AiWorkSkillContent>;

  /** Upsert a skill. POST /workspace/:id/skills */
  upsertSkill(
    workspaceId: string,
    payload: { name: string; content: string; description?: string },
  ): Promise<AiWorkSkillItem>;

  /** Delete a skill. DELETE /workspace/:id/skills/:name */
  deleteSkill(workspaceId: string, name: string): Promise<{ path: string }>;

  /** List MCP servers. GET /workspace/:id/mcp */
  listMcp(workspaceId: string): Promise<{ items: AiWorkMcpItem[] }>;

  /** Add an MCP server. POST /workspace/:id/mcp */
  addMcp(
    workspaceId: string,
    payload: { name: string; config: Record<string, unknown> },
  ): Promise<{ items: AiWorkMcpItem[] }>;

  /** Remove an MCP server. DELETE /workspace/:id/mcp/:name */
  removeMcp(workspaceId: string, name: string): Promise<{ items: AiWorkMcpItem[] }>;

  /** Set MCP enabled state. POST /workspace/:id/mcp/:name/enabled */
  setMcpEnabled(
    workspaceId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ items: AiWorkMcpItem[] }>;

  /** Logout MCP auth. DELETE /workspace/:id/mcp/:name/auth */
  logoutMcpAuth(workspaceId: string, name: string): Promise<{ ok: true }>;

  /** List commands. GET /workspace/:id/commands */
  listCommands(
    workspaceId: string,
    scope?: "workspace" | "global",
  ): Promise<{ items: AiWorkCommandItem[] }>;

  /** Upsert a command. POST /workspace/:id/commands */
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
  ): Promise<{ items: AiWorkCommandItem[] }>;

  /** Delete a command. DELETE /workspace/:id/commands/:name */
  deleteCommand(workspaceId: string, name: string): Promise<{ ok: boolean }>;

  /** Upload an inbox item. POST /workspace/:id/inbox (multipart) */
  uploadInbox(
    workspaceId: string,
    file: { name: string; size: number; content: Blob | ArrayBuffer },
    options?: { path?: string },
  ): Promise<AiWorkInboxUploadResult>;

  /** List inbox items. GET /workspace/:id/inbox */
  listInbox(workspaceId: string): Promise<AiWorkInboxList>;

  /** Download an inbox item. GET /workspace/:id/inbox/:inboxId */
  downloadInboxItem(
    workspaceId: string,
    inboxId: string,
  ): Promise<{ data: ArrayBuffer; contentType: string | null; filename: string | null }>;

  /** Read a workspace file. GET /workspace/:id/files/content */
  readWorkspaceFile(
    workspaceId: string,
    path: string,
    options?: { optional?: boolean },
  ): Promise<AiWorkWorkspaceFileContent>;

  /** List workspace directory. GET /workspace/:id/files/list */
  listWorkspaceDirectory(
    workspaceId: string,
    path?: string,
  ): Promise<AiWorkWorkspaceDirectoryList>;

  /** Get workspace git status. GET /workspace/:id/git/status */
  getWorkspaceGitStatus(
    workspaceId: string,
  ): Promise<AiWorkWorkspaceGitStatus>;

  /** Write a workspace file. POST /workspace/:id/files/content */
  writeWorkspaceFile(
    workspaceId: string,
    payload: {
      path: string;
      content: string;
      baseUpdatedAt?: number | null;
      force?: boolean;
    },
  ): Promise<AiWorkWorkspaceFileWriteResult>;

  /** List artifacts. GET /workspace/:id/artifacts */
  listArtifacts(workspaceId: string): Promise<AiWorkArtifactList>;

  /** Download an artifact. GET /workspace/:id/artifacts/:artifactId */
  downloadArtifact(
    workspaceId: string,
    artifactId: string,
  ): Promise<{ data: ArrayBuffer; contentType: string | null; filename: string | null }>;

  /** List user env keys. GET /env/keys */
  listUserEnvKeys(): Promise<{ keys: string[] }>;

  /** List user env entries. GET /env */
  listUserEnv(): Promise<{
    items: Array<{ key: string; value: string; updatedAt: number }>;
  }>;

  /** Upsert user env entries. PUT /env */
  upsertUserEnv(
    entries: Array<{ key: string; value: string }>,
  ): Promise<{ ok: true; count: number }>;

  /** Delete a user env entry. DELETE /env/:key */
  deleteUserEnv(key: string): Promise<{ ok: true }>;
}