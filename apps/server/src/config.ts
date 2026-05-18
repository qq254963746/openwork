import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ApprovalMode, ApprovalConfig, ServerConfig, WorkspaceConfig, LogFormat } from "./types.js";
import { buildWorkspaceInfos } from "./workspaces.js";
import { parseList, readJsonFile, shortId } from "./utils.js";

interface CliArgs {
  configPath?: string;
  host?: string;
  port?: number;
  token?: string;
  hostToken?: string;
  approvalMode?: ApprovalMode;
  approvalTimeoutMs?: number;
  engineBaseUrl?: string;
  engineDirectory?: string;
  engineUsername?: string;
  enginePassword?: string;
  workspaces: string[];
  corsOrigins?: string[];
  readOnly?: boolean;
  verbose?: boolean;
  logFormat?: LogFormat;
  logRequests?: boolean;
  version?: boolean;
  help?: boolean;
}

interface FileConfig {
  host?: string;
  port?: number;
  token?: string;
  hostToken?: string;
  approval?: Partial<ApprovalConfig>;
  workspaces?: WorkspaceConfig[];
  corsOrigins?: string[];
  authorizedRoots?: string[];
  readOnly?: boolean;
  engineBaseUrl?: string;
  engineDirectory?: string;
  engineUsername?: string;
  enginePassword?: string;
  logFormat?: LogFormat;
  logRequests?: boolean;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_LOG_FORMAT: LogFormat = "pretty";
const DEFAULT_LOG_REQUESTS = true;

function normalizeLogFormat(value: string | undefined): LogFormat | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "json") return "json";
  if (normalized === "pretty" || normalized === "text" || normalized === "human") return "pretty";
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { workspaces: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) continue;
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--version") {
      args.version = true;
      continue;
    }
    if (value === "--verbose") {
      args.verbose = true;
      continue;
    }
    if (value === "--log-format") {
      args.logFormat = argv[index + 1] as LogFormat | undefined;
      index += 1;
      continue;
    }
    if (value === "--log-requests") {
      args.logRequests = true;
      continue;
    }
    if (value === "--no-log-requests") {
      args.logRequests = false;
      continue;
    }
    if (value === "--config") {
      args.configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--host") {
      args.host = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--port") {
      const port = Number(argv[index + 1]);
      if (!Number.isNaN(port)) args.port = port;
      index += 1;
      continue;
    }
    if (value === "--token") {
      args.token = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--host-token") {
      args.hostToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--approval") {
      const mode = argv[index + 1] as ApprovalMode | undefined;
      if (mode === "manual" || mode === "auto") args.approvalMode = mode;
      index += 1;
      continue;
    }
    if (value === "--approval-timeout") {
      const timeout = Number(argv[index + 1]);
      if (!Number.isNaN(timeout)) args.approvalTimeoutMs = timeout;
      index += 1;
      continue;
    }
    if (value === "--engine-base-url") {
      args.engineBaseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--engine-directory") {
      args.engineDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--engine-username") {
      args.engineUsername = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--engine-password") {
      args.enginePassword = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--workspace") {
      const path = argv[index + 1];
      if (path) args.workspaces.push(path);
      index += 1;
      continue;
    }
    if (value === "--cors") {
      args.corsOrigins = parseList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--read-only") {
      args.readOnly = true;
      continue;
    }
  }
  return args;
}

export function printHelp(): void {
  const message = [
    "aiwork-server",
    "",
    "Options:",
    "  --config <path>          Path to server.json",
    "  --host <host>            Hostname (default 127.0.0.1)",
    "  --port <port>            Port (default 8787)",
    "  --token <token>          Client bearer token",
    "  --host-token <token>     Host approval token",
    "  --approval <mode>        manual | auto",
    "  --approval-timeout <ms>  Approval timeout",
    "  --engine-base-url <url> Engine base URL to share",
    "  --engine-directory <path> Engine workspace directory to share",
    "  --engine-username <user> Engine server username",
    "  --engine-password <pass> Engine server password",
    "  --workspace <path>       Workspace root (repeatable)",
    "  --cors <origins>          Comma-separated origins or *",
    "  --read-only              Disable writes",
    "  --log-format <format>     Log output format: pretty | json",
    "  --log-requests           Log incoming requests (default: true)",
    "  --no-log-requests        Disable request logging",
    "  --verbose                Print resolved config",
    "  --version                Show version",
  ].join("\n");
  console.log(message);
}

async function loadFileConfig(configPath: string): Promise<FileConfig> {
  const parsed = await readJsonFile<FileConfig>(configPath);
  return parsed ?? {};
}

export async function resolveServerConfig(cli: CliArgs): Promise<ServerConfig> {
  const envConfigPath = process.env.AIWORK_SERVER_CONFIG;
  const configPath = cli.configPath ?? envConfigPath ?? resolve(homedir(), ".config", "aiwork", "server.json");
  const fileConfig = await loadFileConfig(configPath);
  const configDir = dirname(configPath);

  const envWorkspaces = parseList(process.env.AIWORK_WORKSPACES);
  let workspaceConfigs: WorkspaceConfig[] =
    cli.workspaces.length > 0
      ? cli.workspaces.map((path) => ({ path }))
      : envWorkspaces.length > 0
        ? envWorkspaces.map((path) => ({ path }))
        : fileConfig.workspaces ?? [];

  const envEngineBaseUrl = process.env.engine_BASE_URL;
  const envEngineDirectory = process.env.engine_DIRECTORY;
  const envEngineUsername = process.env.engine_USERNAME;
  const envEnginePassword = process.env.engine_PASSWORD;
  const engineBaseUrl = cli.engineBaseUrl ?? envEngineBaseUrl ?? fileConfig.engineBaseUrl;
  const engineDirectory = cli.engineDirectory ?? envEngineDirectory ?? fileConfig.engineDirectory;
  const engineUsername = cli.engineUsername ?? envEngineUsername ?? fileConfig.engineUsername;
  const enginePassword = cli.enginePassword ?? envEnginePassword ?? fileConfig.enginePassword;

  if (workspaceConfigs.length > 0 && (engineBaseUrl || engineDirectory || engineUsername || enginePassword)) {
    const allowDirectoryOverride = workspaceConfigs.length === 1 && engineDirectory;
    workspaceConfigs = workspaceConfigs.map((workspace, index) => {
      const nextDirectory =
        workspace.engine?.directory ?? (allowDirectoryOverride && index === 0 ? engineDirectory : undefined);
      return {
        ...workspace,
        engine: {
          ...workspace.engine,
          baseUrl: workspace.engine?.baseUrl ?? engineBaseUrl,
          ...(nextDirectory ? { directory: nextDirectory } : {}),
        },
        engineUsername: workspace.engineUsername ?? engineUsername,
        enginePassword: workspace.enginePassword ?? enginePassword,
      };
    });
  }

  const workspaces = buildWorkspaceInfos(workspaceConfigs, configDir);

  const tokenFromEnv = process.env.AIWORK_TOKEN;
  const hostTokenFromEnv = process.env.AIWORK_HOST_TOKEN;

  const token = cli.token ?? tokenFromEnv ?? fileConfig.token ?? shortId();
  const hostToken = cli.hostToken ?? hostTokenFromEnv ?? fileConfig.hostToken ?? shortId();

  const tokenSource: ServerConfig["tokenSource"] = cli.token
    ? "cli"
    : tokenFromEnv
      ? "env"
      : fileConfig.token
        ? "file"
        : "generated";

  const hostTokenSource: ServerConfig["hostTokenSource"] = cli.hostToken
    ? "cli"
    : hostTokenFromEnv
      ? "env"
      : fileConfig.hostToken
        ? "file"
        : "generated";

  const approvalMode =
    cli.approvalMode ??
    (process.env.AIWORK_APPROVAL_MODE as ApprovalMode | undefined) ??
    fileConfig.approval?.mode ??
    "manual";

  const approvalTimeoutMs =
    cli.approvalTimeoutMs ??
    (process.env.AIWORK_APPROVAL_TIMEOUT_MS ? Number(process.env.AIWORK_APPROVAL_TIMEOUT_MS) : undefined) ??
    fileConfig.approval?.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const approval: ApprovalConfig = {
    mode: approvalMode === "auto" ? "auto" : "manual",
    timeoutMs: Number.isNaN(approvalTimeoutMs) ? DEFAULT_TIMEOUT_MS : approvalTimeoutMs,
  };

  const envCorsOrigins = process.env.AIWORK_CORS_ORIGINS;
  const parsedEnvCors = envCorsOrigins ? parseList(envCorsOrigins) : null;
  const corsOrigins = cli.corsOrigins ?? parsedEnvCors ?? fileConfig.corsOrigins ?? ["*"];

  const envReadOnly = process.env.AIWORK_READONLY;
  const parsedReadOnly = envReadOnly
    ? ["true", "1", "yes"].includes(envReadOnly.toLowerCase())
    : undefined;
  const readOnly = cli.readOnly ?? parsedReadOnly ?? fileConfig.readOnly ?? false;

  const envLogFormat = process.env.AIWORK_LOG_FORMAT;
  const logFormat =
    cli.logFormat ??
    normalizeLogFormat(envLogFormat) ??
    normalizeLogFormat(fileConfig.logFormat) ??
    DEFAULT_LOG_FORMAT;

  const envLogRequests = parseBoolean(process.env.AIWORK_LOG_REQUESTS);
  const logRequests = cli.logRequests ?? envLogRequests ?? fileConfig.logRequests ?? DEFAULT_LOG_REQUESTS;

  const authorizedRoots =
    fileConfig.authorizedRoots?.length
      ? fileConfig.authorizedRoots.map((root) => resolve(configDir, root))
      : workspaces.map((workspace) => workspace.path);

  const host = cli.host ?? process.env.AIWORK_HOST ?? fileConfig.host ?? DEFAULT_HOST;
  const port = cli.port ?? (process.env.AIWORK_PORT ? Number(process.env.AIWORK_PORT) : undefined) ?? fileConfig.port ?? DEFAULT_PORT;

  return {
    host,
    port: Number.isNaN(port) ? DEFAULT_PORT : port,
    token,
    hostToken,
    configPath,
    engineBaseUrl,
    engineDirectory,
    engineUsername,
    enginePassword,
    approval,
    corsOrigins,
    workspaces,
    authorizedRoots,
    readOnly,
    startedAt: Date.now(),
    tokenSource,
    hostTokenSource,
    logFormat,
    logRequests,
  };
}
