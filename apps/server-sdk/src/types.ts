import type { Message, Part, Session, Todo } from "@engine/sdk/v2/client";
/**
 * Shared type definitions for the AiWork Server SDK.
 * These types mirror the response shapes defined in `apps/app/src/app/lib/aiwork-server.ts`
 * and are used by both the client interface and the HTTP implementation.
 */

// ---- Server-level types ----

export type AiWorkServerCapabilities = {
  skills: { read: boolean; write: boolean; source: "aiwork" | "engine" };
  hub?: {
    skills?: {
      read: boolean;
      install: boolean;
      repo?: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };
  proxy?: { engine: boolean };
  toolProviders?: {
    browser?: {
      enabled: boolean;
      placement: "in-sandbox" | "host-machine" | "client-machine" | "external";
      mode: "none" | "headless" | "interactive";
    };
    files?: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
};

export type AiWorkServerStatus = "connected" | "disconnected" | "limited";

export type AiWorkServerDiagnostics = {
  ok: boolean;
  version: string;
  uptimeMs: number;
  readOnly: boolean;
  approval: { mode: "manual" | "auto"; timeoutMs: number };
  corsOrigins: string[];
  workspaceCount: number;
  activeWorkspaceId?: string | null;
  selectedWorkspaceId?: string | null;
  workspace: AiWorkWorkspaceInfo | null;
  authorizedRoots: string[];
  server: { host: string; port: number; configPath?: string | null };
  tokenSource: { client: string; host: string };
};

export type AiWorkRuntimeServiceName = "aiwork-server" | "engine";

export type AiWorkRuntimeServiceSnapshot = {
  name: AiWorkRuntimeServiceName;
  enabled: boolean;
  running: boolean;
  targetVersion: string | null;
  actualVersion: string | null;
};

export type AiWorkRuntimeSnapshot = {
  ok: boolean;
  worker?: {
    workspace: string;
  };
  services: AiWorkRuntimeServiceSnapshot[];
};

export type AiWorkServerSettings = {
  urlOverride?: string;
  portOverride?: number;
  token?: string;
  hostToken?: string;
};

// ---- Workspace types ----

export type AiWorkWorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  preset: string;
  displayName?: string | null;
  engine?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
};

export type AiWorkWorkspaceList = {
  items: AiWorkWorkspaceInfo[];
  workspaces?: AiWorkWorkspaceInfo[];
  activeId?: string | null;
};

// ---- Session types ----
export type AiWorkSessionMessage = {
  info: Message;
  parts: Part[];
};

export type AiWorkSessionSnapshot = {
  session: Session;
  messages: AiWorkSessionMessage[];
  todos: Todo[];
  status:
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number };
};

// ---- Plugin types ----

export type AiWorkPluginItem = {
  spec: string;
  source: "config" | "dir.project" | "dir.global";
  scope: "project" | "global";
  path?: string;
};

// ---- Skill types ----

export type AiWorkSkillItem = {
  name: string;
  path: string;
  description: string;
  scope: "project" | "global";
  trigger?: string;
};

export type AiWorkSkillContent = {
  item: AiWorkSkillItem;
  content: string;
};

export type AiWorkHubSkillItem = {
  name: string;
  description: string;
  trigger?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  };
};

export type AiWorkHubRepo = {
  owner?: string;
  repo?: string;
  ref?: string;
};

// ---- File types ----

export type AiWorkWorkspaceFileContent = {
  path: string;
  content: string;
  bytes: number;
  updatedAt?: number;
  missing?: boolean;
};

export type AiWorkWorkspaceFileWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
  revision?: string;
};

export type AiWorkWorkspaceDirEntry = {
  name: string;
  kind: "file" | "directory";
  updatedAt?: number;
};

export type AiWorkWorkspaceDirectoryList = {
  path: string;
  entries: AiWorkWorkspaceDirEntry[];
  truncated?: boolean;
};

export type AiWorkWorkspaceGitStatus = {
  entries: Record<string, string>;
};

// ---- Command types ----

export type AiWorkCommandItem = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
  scope: "workspace" | "global";
};

// ---- MCP types ----

export type AiWorkMcpItem = {
  name: string;
  config: Record<string, unknown>;
  source: "config.project" | "config.global" | "config.remote";
  disabledByTools?: boolean;
};

// ---- Artifact types ----

export type AiWorkArtifactItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  createdAt?: number;
  updatedAt?: number;
  mime?: string;
};

export type AiWorkArtifactList = {
  items: AiWorkArtifactItem[];
};

// ---- Inbox types ----

export type AiWorkInboxItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
};

export type AiWorkInboxList = {
  items: AiWorkInboxItem[];
};

export type AiWorkInboxUploadResult = {
  ok: boolean;
  path: string;
  bytes: number;
};

// ---- Auth types ----

export type AiWorkActor = {
  type: "remote" | "host";
  clientId?: string;
  tokenHash?: string;
};

// ---- Reload events ----

export type AiWorkReloadTrigger = {
  type: "skill" | "plugin" | "config" | "mcp" | "agent" | "command";
  name?: string;
  action?: "added" | "removed" | "updated";
  path?: string;
};

export type AiWorkReloadEvent = {
  id: string;
  seq: number;
  workspaceId: string;
  reason: "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";
  trigger?: AiWorkReloadTrigger;
  timestamp: number;
};

// ---- Token types ----

export type AiWorkTokenItem = {
  id: string;
  tokenHash: string;
  scope: "owner" | "collaborator" | "viewer";
  label?: string;
  createdAt: number;
};

// ---- Approval types ----

export type AiWorkApprovalItem = {
  id: string;
  workspaceId: string;
  action: string;
  summary: string;
  paths: string[];
  createdAt: number;
  timeoutMs: number;
};

// ---- Config types ----

export type AiWorkWorkspaceConfig = {
  engine: Record<string, unknown>;
  aiwork: Record<string, unknown>;
  updatedAt?: number | null;
};

export type EngineConfigFile = {
  path: string;
  exists: boolean;
  content: string | null;
};

// ---- Model provider types ----

export type AiWorkModelProviderModelsResult = {
  ok: boolean;
  ids?: string[];
  message?: string;
  httpStatus?: number;
};
