/**
 * Route URL patterns extracted from `addRoute` calls in `apps/server/src/server.ts`.
 * Each value is the path pattern with `:param` placeholders for segments that must
 * be provided when building a concrete URL.
 */
export enum ApiRoutes {
  /** GET /health */
  HEALTH = "/health",

  /** GET /w/:id/health */
  MOUNT_HEALTH = "/w/:id/health",

  /** GET /w/:id/status */
  MOUNT_STATUS = "/w/:id/status",

  /** GET /w/:id/capabilities */
  MOUNT_CAPABILITIES = "/w/:id/capabilities",

  /** GET /w/:id/workspaces */
  MOUNT_WORKSPACES = "/w/:id/workspaces",

  /** GET /status */
  STATUS = "/status",

  /** GET /whoami */
  WHOAMI = "/whoami",

  /** GET /capabilities */
  CAPABILITIES = "/capabilities",

  /** GET /workspaces */
  WORKSPACES = "/workspaces",

  /** GET /tokens */
  TOKENS = "/tokens",

  /** POST /tokens */
  TOKENS_CREATE = "/tokens",

  /** DELETE /tokens/:id */
  TOKENS_DELETE = "/tokens/:id",

  // ---- User env vars ----

  /** GET /env */
  ENV = "/env",

  /** GET /env/keys */
  ENV_KEYS = "/env/keys",

  /** PUT /env */
  ENV_UPSERT = "/env",

  /** DELETE /env/:key */
  ENV_DELETE = "/env/:key",

  // ---- Workspace management ----

  /** POST /workspaces/local */
  WORKSPACES_LOCAL = "/workspaces/local",

  /** PATCH /workspaces/:id/display-name */
  WORKSPACES_DISPLAY_NAME = "/workspaces/:id/display-name",

  /** POST /workspaces/:id/activate */
  WORKSPACES_ACTIVATE = "/workspaces/:id/activate",

  /** POST /workspaces/reorder */
  WORKSPACES_REORDER = "/workspaces/reorder",

  /** DELETE /workspaces/:id */
  WORKSPACES_DELETE = "/workspaces/:id",

  // ---- Workspace-scoped routes (singular "workspace") ----

  /** GET /workspace/:id/config */
  WORKSPACE_CONFIG = "/workspace/:id/config",

  /** PATCH /workspace/:id/config */
  WORKSPACE_CONFIG_PATCH = "/workspace/:id/config",

  /** GET /workspace/:id/engine-config */
  WORKSPACE_ENGINE_CONFIG = "/workspace/:id/engine-config",

  /** POST /workspace/:id/engine-config */
  WORKSPACE_ENGINE_CONFIG_WRITE = "/workspace/:id/engine-config",

  /** POST /workspace/:id/model-provider/models */
  WORKSPACE_MODEL_PROVIDER_MODELS = "/workspace/:id/model-provider/models",

  /** GET /workspace/:id/sessions */
  WORKSPACE_SESSIONS = "/workspace/:id/sessions",

  /** GET /workspace/:id/sessions/:sessionId */
  WORKSPACE_SESSION = "/workspace/:id/sessions/:sessionId",

  /** GET /workspace/:id/sessions/:sessionId/messages */
  WORKSPACE_SESSION_MESSAGES = "/workspace/:id/sessions/:sessionId/messages",

  /** GET /workspace/:id/sessions/:sessionId/snapshot */
  WORKSPACE_SESSION_SNAPSHOT = "/workspace/:id/sessions/:sessionId/snapshot",

  /** DELETE /workspace/:id/sessions/:sessionId */
  WORKSPACE_SESSION_DELETE = "/workspace/:id/sessions/:sessionId",

  /** GET /workspace/:id/events */
  WORKSPACE_EVENTS = "/workspace/:id/events",

  /** POST /workspace/:id/engine/reload */
  WORKSPACE_ENGINE_RELOAD = "/workspace/:id/engine/reload",

  // ---- Files ----

  /** GET /workspace/:id/files/list */
  WORKSPACE_FILES_LIST = "/workspace/:id/files/list",

  /** GET /workspace/:id/files/content */
  WORKSPACE_FILES_CONTENT = "/workspace/:id/files/content",

  /** POST /workspace/:id/files/content */
  WORKSPACE_FILES_CONTENT_WRITE = "/workspace/:id/files/content",

  /** GET /workspace/:id/git/status */
  WORKSPACE_GIT_STATUS = "/workspace/:id/git/status",

  /** POST /workspace/:id/files/sessions */
  WORKSPACE_FILES_SESSIONS = "/workspace/:id/files/sessions",

  /** POST /files/sessions/:sessionId/renew */
  FILES_SESSIONS_RENEW = "/files/sessions/:sessionId/renew",

  /** DELETE /files/sessions/:sessionId */
  FILES_SESSIONS_DELETE = "/files/sessions/:sessionId",

  /** GET /files/sessions/:sessionId/catalog/snapshot */
  FILES_SESSIONS_CATALOG_SNAPSHOT = "/files/sessions/:sessionId/catalog/snapshot",

  /** GET /files/sessions/:sessionId/catalog/events */
  FILES_SESSIONS_CATALOG_EVENTS = "/files/sessions/:sessionId/catalog/events",

  /** POST /files/sessions/:sessionId/read-batch */
  FILES_SESSIONS_READ_BATCH = "/files/sessions/:sessionId/read-batch",

  /** POST /files/sessions/:sessionId/write-batch */
  FILES_SESSIONS_WRITE_BATCH = "/files/sessions/:sessionId/write-batch",

  /** POST /files/sessions/:sessionId/ops */
  FILES_SESSIONS_OPS = "/files/sessions/:sessionId/ops",

  // ---- Plugins ----

  /** GET /workspace/:id/plugins */
  WORKSPACE_PLUGINS = "/workspace/:id/plugins",

  /** POST /workspace/:id/plugins */
  WORKSPACE_PLUGINS_ADD = "/workspace/:id/plugins",

  /** DELETE /workspace/:id/plugins/:name */
  WORKSPACE_PLUGINS_REMOVE = "/workspace/:id/plugins/:name",

  // ---- Hub skills ----

  /** GET /hub/skills */
  HUB_SKILLS = "/hub/skills",

  // ---- Skills ----

  /** GET /workspace/:id/skills */
  WORKSPACE_SKILLS = "/workspace/:id/skills",

  /** POST /workspace/:id/skills/hub/:name */
  WORKSPACE_SKILLS_HUB_INSTALL = "/workspace/:id/skills/hub/:name",

  /** GET /workspace/:id/skills/:name */
  WORKSPACE_SKILL = "/workspace/:id/skills/:name",

  /** POST /workspace/:id/skills */
  WORKSPACE_SKILLS_UPSERT = "/workspace/:id/skills",

  /** DELETE /workspace/:id/skills/:name */
  WORKSPACE_SKILLS_DELETE = "/workspace/:id/skills/:name",

  // ---- MCP ----

  /** GET /workspace/:id/mcp */
  WORKSPACE_MCP = "/workspace/:id/mcp",

  /** POST /workspace/:id/mcp */
  WORKSPACE_MCP_ADD = "/workspace/:id/mcp",

  /** DELETE /workspace/:id/mcp/:name */
  WORKSPACE_MCP_REMOVE = "/workspace/:id/mcp/:name",

  /** POST /workspace/:id/mcp/:name/enabled */
  WORKSPACE_MCP_ENABLED = "/workspace/:id/mcp/:name/enabled",

  /** DELETE /workspace/:id/mcp/:name/auth */
  WORKSPACE_MCP_AUTH = "/workspace/:id/mcp/:name/auth",

  // ---- Commands ----

  /** GET /workspace/:id/commands */
  WORKSPACE_COMMANDS = "/workspace/:id/commands",

  /** POST /workspace/:id/commands */
  WORKSPACE_COMMANDS_UPSERT = "/workspace/:id/commands",

  /** DELETE /workspace/:id/commands/:name */
  WORKSPACE_COMMANDS_DELETE = "/workspace/:id/commands/:name",

  // ---- Inbox ----

  /** GET /workspace/:id/inbox */
  WORKSPACE_INBOX = "/workspace/:id/inbox",

  /** GET /workspace/:id/inbox/:inboxId */
  WORKSPACE_INBOX_ITEM = "/workspace/:id/inbox/:inboxId",

  /** POST /workspace/:id/inbox */
  WORKSPACE_INBOX_UPLOAD = "/workspace/:id/inbox",

  // ---- Artifacts ----

  /** GET /workspace/:id/artifacts */
  WORKSPACE_ARTIFACTS = "/workspace/:id/artifacts",

  /** GET /workspace/:id/artifacts/:artifactId */
  WORKSPACE_ARTIFACT = "/workspace/:id/artifacts/:artifactId",

  // ---- Approvals ----

  /** GET /approvals */
  APPROVALS = "/approvals",

  /** POST /approvals/:id */
  APPROVALS_RESPOND = "/approvals/:id",

  // ---- Checkpoints ----

  /** POST /workspace/:id/sessions/:sessionId/checkpoints */
  CHECKPOINTS_CREATE = "/workspace/:id/sessions/:sessionId/checkpoints",

  /** GET /workspace/:id/sessions/:sessionId/checkpoints */
  CHECKPOINTS = "/workspace/:id/sessions/:sessionId/checkpoints",

  /** POST /workspace/:id/sessions/:sessionId/checkpoints/bind-message */
  CHECKPOINTS_BIND_MESSAGE = "/workspace/:id/sessions/:sessionId/checkpoints/bind-message",

  /** GET /workspace/:id/sessions/:sessionId/checkpoints/diff */
  CHECKPOINTS_DIFF = "/workspace/:id/sessions/:sessionId/checkpoints/diff",

  /** POST /workspace/:id/sessions/:sessionId/checkpoints/:sha/restore */
  CHECKPOINTS_RESTORE_BY_SHA = "/workspace/:id/sessions/:sessionId/checkpoints/:sha/restore",

  /** POST /workspace/:id/sessions/:sessionId/checkpoints/by-message/:messageId/restore */
  CHECKPOINTS_RESTORE_BY_MESSAGE = "/workspace/:id/sessions/:sessionId/checkpoints/by-message/:messageId/restore",

  /** DELETE /workspace/:id/sessions/:sessionId/checkpoints */
  CHECKPOINTS_DESTROY = "/workspace/:id/sessions/:sessionId/checkpoints",

  /** GET /workspace/:id/sessions/:sessionId/checkpoints/files/content */
  CHECKPOINTS_FILE_CONTENT = "/workspace/:id/sessions/:sessionId/checkpoints/files/content",
}

/**
 * Replace `:param` placeholders in a route pattern with provided values.
 * All values are automatically URI-encoded.
 *
 * @example
 *   buildRoute(ApiRoutes.WORKSPACE_SESSION, { id: "ws1", sessionId: "s1" })
 *   // "/workspace/ws1/sessions/s1"
 */
export function buildRoute(
  pattern: string,
  params: Record<string, string>,
): string {
  let result = pattern;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(value));
  }
  return result;
}