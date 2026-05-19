import type {
  ServerConfig,
  WorkspaceInfo,
  Actor,
  TokenScope,
  ReloadReason,
  ReloadTrigger,
  ApprovalRequest,
  Capabilities,
} from "../types.js";
import type { ApprovalService } from "../approvals.js";
import type { TokenService } from "../tokens.js";
import type { EnvService } from "../env-file.js";
import type { ReloadEventStore } from "../events.js";
import type { FileSessionStore } from "../file-sessions.js";

// ---------------------------------------------------------------------------
// Route system types (extracted from server.ts to avoid circular imports)
// ---------------------------------------------------------------------------

export type AuthMode = "none" | "client" | "host" | "host-token";

export interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  auth: AuthMode;
  handler: (ctx: RequestContext) => Promise<Response>;
}

export interface RequestContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  config: ServerConfig;
  approvals: ApprovalService;
  reloadEvents: ReloadEventStore;
  tokens: TokenService;
  actor?: Actor;
}

// ---------------------------------------------------------------------------
// Handler registration helpers
// ---------------------------------------------------------------------------

export function addRoute(
  routes: Route[],
  method: string,
  path: string,
  auth: AuthMode,
  handler: Route["handler"],
): void {
  const keys: string[] = [];
  const regex = pathToRegex(path, keys);
  routes.push({ method, regex, keys, auth, handler });
}

export function pathToRegex(path: string, keys: string[]): RegExp {
  const pattern = path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  return new RegExp(`^${pattern}$`);
}

// ---------------------------------------------------------------------------
// Shared dependencies injected into every handler module
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  // ---- direct service dependencies ----
  config: ServerConfig;
  approvals: ApprovalService;
  tokens: TokenService;
  env: EnvService;
  reloadEvents: ReloadEventStore;
  onWorkspacesChanged: () => void;
  fileSessions: FileSessionStore;

  // ---- version constants ----
  serverVersion: string;
  engineVersion: string;

  // ---- shared helper functions ----
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (data: unknown, status?: number) => Response;
  emitReloadEvent: (
    reloadEvents: ReloadEventStore,
    workspace: WorkspaceInfo,
    reason: ReloadReason,
    trigger?: ReloadTrigger,
  ) => void;
  buildConfigTrigger: (path: string) => ReloadTrigger;
  buildCapabilities: (config: ServerConfig) => Capabilities;
  serializeWorkspace: (workspace: Record<string, unknown>) => Record<string, unknown>;

  // ---- engine helpers ----
  resolveEngineDirectory: (workspace: WorkspaceInfo) => string | null;
  fetchEngineJson: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    path: string,
    init: { method: string; body?: unknown; query?: URLSearchParams | Record<string, string | number | boolean | null | undefined> },
  ) => Promise<unknown>;
  reloadEngineEngine: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<void>;

  // ---- file/path helpers ----
  resolveSafeChildPath: (root: string, child: string) => string;
  normalizeWorkspaceRelativePath: (input: string, options: { allowSubdirs: boolean }) => string;

  // ---- session helpers ----
  requireHost: (request: Request, config: ServerConfig, tokens: TokenService) => Promise<Actor>;
  parseOptionalPositiveInteger: (value: string | null, name: string) => number | undefined;
  parseOptionalNonNegativeInteger: (value: string | null, name: string) => number | undefined;
  parseOptionalBoolean: (value: string | null, name: string) => boolean | undefined;

  // ---- workspace persist ----
  persistServerWorkspaceState: (config: ServerConfig) => Promise<boolean>;
}