import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { createRepositories, type ServerRepositories } from "./repositories.js";
import type { StartupDiagnostics, HostingKind, ImportSourceReport, JsonObject } from "./types.js";
import { runMigrations } from "./migrations/index.js";
import { ensureServerWorkingDirectoryLayout, resolveServerWorkingDirectory, type ServerWorkingDirectory } from "./working-directory.js";
import { createRegistryService, type RegistryService } from "../services/registry-service.js";

const legacyWorkspaceSchema = z.object({
  baseUrl: z.string().optional().nullable(),
  directory: z.string().optional().nullable(),
  displayName: z.string().optional().nullable(),
  id: z.string(),
  name: z.string().optional().default(""),
  aiworkClientToken: z.string().optional().nullable(),
  aiworkHostToken: z.string().optional().nullable(),
  aiworkHostUrl: z.string().optional().nullable(),
  aiworkToken: z.string().optional().nullable(),
  aiworkWorkspaceId: z.string().optional().nullable(),
  aiworkWorkspaceName: z.string().optional().nullable(),
  path: z.string().default(""),
  preset: z.string().optional().nullable(),
});


const legacyWorkspaceStateSchema = z.object({
  activeId: z.string().optional().nullable(),
  selectedWorkspaceId: z.string().optional().nullable(),
  version: z.number().optional(),
  watchedWorkspaceId: z.string().optional().nullable(),
  workspaces: z.array(legacyWorkspaceSchema),
});

const orchestratorStateSchema = z.object({
  activeId: z.string().optional().nullable(),
  binaries: z.object({
    opencode: z.object({
      actualVersion: z.string().optional().nullable(),
      expectedVersion: z.string().optional().nullable(),
      path: z.string().optional().nullable(),
      source: z.string().optional().nullable(),
    }).optional().nullable(),
  }).optional().nullable(),
  cliVersion: z.string().optional().nullable(),
  daemon: z.object({
    baseUrl: z.string(),
    pid: z.number(),
    port: z.number(),
    startedAt: z.number(),
  }).optional().nullable(),
  opencode: z.object({
    baseUrl: z.string(),
    pid: z.number(),
    port: z.number(),
    startedAt: z.number(),
  }).optional().nullable(),
  workspaces: z.array(z.object({
    baseUrl: z.string().optional().nullable(),
    createdAt: z.number().optional().nullable(),
    directory: z.string().optional().nullable(),
    id: z.string(),
    lastUsedAt: z.number().optional().nullable(),
    name: z.string().optional().default(""),
    path: z.string(),
  })).default([]),
});

const orchestratorAuthSchema = z.object({
  opencodePassword: z.string().optional().nullable(),
  opencodeUsername: z.string().optional().nullable(),
  projectDir: z.string().optional().nullable(),
  updatedAt: z.number().optional().nullable(),
});

const cloudSigninSchema = z.object({
  activeOrgId: z.string().optional().nullable(),
  activeOrgName: z.string().optional().nullable(),
  activeOrgSlug: z.string().optional().nullable(),
  authToken: z.string().optional().nullable(),
  baseUrl: z.string().optional().nullable(),
  cloudBaseUrl: z.string().optional().nullable(),
  lastValidatedAt: z.string().optional().nullable(),
  orgId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
});

type CreateServerPersistenceOptions = {
  environment: string;
  inMemory?: boolean;
  legacy?: {
    cloudSigninJson?: string;
    cloudSigninPath?: string;
    desktopDataDir?: string;
    orchestratorDataDir?: string;
  };
  localServer: {
    baseUrl?: string | null;
    hostingKind: HostingKind;
    label: string;
  };
  version: string;
  workingDirectory?: string;
};

export type ServerPersistence = {
  close(): void;
  database: Database;
  diagnostics: StartupDiagnostics;
  registry: RegistryService;
  repositories: ServerRepositories;
  workingDirectory: ServerWorkingDirectory;
};

function isTruthy(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeWorkspacePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const expanded = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;

  try {
    return fs.realpathSync.native(expanded);
  } catch {
    return path.resolve(expanded);
  }
}

function normalizeUrl(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function stripWorkspaceMount(value: string | null | undefined) {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const prev = segments[segments.length - 2] ?? "";
  if (prev === "w" && last) {
    url.pathname = `/${segments.slice(0, -2).join("/")}`;
  }
  return url.toString().replace(/\/+$/, "");
}

function legacyDesktopDataDirCandidates(explicitDir?: string) {
  if (explicitDir?.trim()) {
    return [path.resolve(explicitDir)];
  }

  const candidates: string[] = [];
  const home = os.homedir();
  const names = ["com.fengai.aiwork.dev", "com.fengai.aiwork", "AiWork Dev", "AiWork"];
  if (process.platform === "darwin") {
    for (const name of names) {
      candidates.push(path.join(home, "Library", "Application Support", name));
    }
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() || path.join(home, "AppData", "Roaming");
    for (const name of names) {
      candidates.push(path.join(appData, name));
    }
  } else {
    const xdgDataHome = process.env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
    for (const name of names) {
      candidates.push(path.join(xdgDataHome, name));
    }
  }

  return Array.from(new Set(candidates));
}

function legacyOrchestratorDirCandidates(explicitDir?: string) {
  if (explicitDir?.trim()) {
    return [path.resolve(explicitDir)];
  }

  const candidates: string[] = [];
  const fromEnv = process.env.AIWORK_DATA_DIR?.trim();
  if (fromEnv) {
    candidates.push(path.resolve(fromEnv));
  }

  const home = os.homedir();
  for (const name of ["aiwork-orchestrator-dev-react", "aiwork-orchestrator-dev", "aiwork-orchestrator"]) {
    candidates.push(path.join(home, ".aiwork", name));
  }

  return Array.from(new Set(candidates));
}

function readTextIfExists(filePath: string | null) {
  if (!filePath) {
    return null;
  }

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveExistingFile(candidates: string[], fileName: string) {
  for (const directory of candidates) {
    const filePath = path.join(directory, fileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function fromUnixTimestamp(value: number | null | undefined) {
  if (!value) {
    return null;
  }

  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
}

function createEmptyReport(status: ImportSourceReport["status"], sourcePath: string | null, details: JsonObject = {}): ImportSourceReport {
  return {
    details,
    sourcePath,
    status,
    warnings: [],
  };
}

function mergeReportWarnings(report: ImportSourceReport, warnings: string[]) {
  report.warnings.push(...warnings);
  return report;
}

function asJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function readLegacyWorkspaceImportCompletedAt(value: JsonObject | null | undefined) {
  const startup = asJsonObject(value?.startup);
  const legacyWorkspaceImport = asJsonObject(startup?.legacyWorkspaceImport);
  const completedAt = legacyWorkspaceImport?.completedAt;
  return typeof completedAt === "string" && completedAt.trim() ? completedAt.trim() : null;
}

function summarizeMode(inMemory: boolean, databasePath: string) {
  if (inMemory) {
    return "fresh" as const;
  }

  return fs.existsSync(databasePath) ? "existing" as const : "fresh" as const;
}

export function createServerPersistence(options: CreateServerPersistenceOptions): ServerPersistence {
  const inMemory = options.inMemory ?? (isTruthy(process.env.AIWORK_SERVER_V2_IN_MEMORY) || options.environment === "test");
  const workingDirectory = resolveServerWorkingDirectory({
    environment: options.environment,
    explicitRootDir: options.workingDirectory,
  });
  if (!inMemory) {
    ensureServerWorkingDirectoryLayout(workingDirectory);
  }

  const mode = summarizeMode(inMemory, workingDirectory.databasePath);
  const database = new Database(inMemory ? ":memory:" : workingDirectory.databasePath, { create: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");

  const migrations = runMigrations(database);
  const repositories = createRepositories(database);
  const registry = createRegistryService({
    localServerCapabilities: {
      configRoutes: true,
      capabilitiesRoutes: true,
      contractLoop: true,
      fileRoutes: true,
      managedConfigTables: true,
      phase: 9,
      remoteServerConnections: false,
      remoteWorkspaceDiscovery: false,
      reloadOwnership: true,
      rootMounted: true,
      runtimeRoutes: true,
      runtimeSupervision: true,
      runtimeStateTables: true,
      version: options.version,
      workspaceReadRoutes: true,
      workspaceRegistry: true,
    },
    repositories,
    workingDirectory,
  });

  const localServer = registry.ensureLocalServer({
    baseUrl: options.localServer.baseUrl ?? null,
    hostingKind: options.localServer.hostingKind,
    label: options.localServer.label,
    notes: {
      workingDirectory: workingDirectory.rootDir,
    },
  });

  const controlWorkspace = registry.ensureHiddenWorkspace("control");
  const helpWorkspace = registry.ensureHiddenWorkspace("help");

  const existingRuntimeState = repositories.serverRuntimeState.getByServerId(registry.localServerId);
  const priorLegacyWorkspaceImportCompletedAt = readLegacyWorkspaceImportCompletedAt(existingRuntimeState?.health);
  const shouldImportLegacyWorkspaceState = !priorLegacyWorkspaceImportCompletedAt;

  const desktopWorkspaceFile = resolveExistingFile(
    legacyDesktopDataDirCandidates(options.legacy?.desktopDataDir),
    "aiwork-workspaces.json",
  );
  const desktopWorkspaceReport = !shouldImportLegacyWorkspaceState
    ? createEmptyReport("skipped", desktopWorkspaceFile, {
        completedAt: priorLegacyWorkspaceImportCompletedAt,
        reason: "Legacy workspace import already completed on an earlier Server V2 startup.",
      })
    : desktopWorkspaceFile
      ? createEmptyReport("imported", desktopWorkspaceFile)
      : createEmptyReport("unavailable", null, { reason: "No legacy desktop workspace registry file was found." });

  if (shouldImportLegacyWorkspaceState && desktopWorkspaceFile) {
    try {
      const parsed = legacyWorkspaceStateSchema.parse(JSON.parse(readTextIfExists(desktopWorkspaceFile) ?? "{}"));
      let localImported = 0;
      let skippedRemoteStyle = 0;
      const importedWorkspaceIds: string[] = [];
      for (const workspace of parsed.workspaces) {

        skippedRemoteStyle += 1;
        desktopWorkspaceReport.warnings.push(
          `Skipped legacy remote-style workspace ${workspace.id} (remote import removed).`,
        );
      }

      desktopWorkspaceReport.details = {
        importedWorkspaceIds,
        localImported,
        skippedRemoteStyle,
        selectedWorkspaceId: parsed.selectedWorkspaceId?.trim() || parsed.activeId?.trim() || null,
        watchedWorkspaceId: parsed.watchedWorkspaceId?.trim() || null,
      };
    } catch (error) {
      desktopWorkspaceReport.status = "error";
      desktopWorkspaceReport.details = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const orchestratorStateFile = resolveExistingFile(
    legacyOrchestratorDirCandidates(options.legacy?.orchestratorDataDir),
    "aiwork-orchestrator-state.json",
  );
  const orchestratorStateReport = !shouldImportLegacyWorkspaceState
    ? createEmptyReport("skipped", orchestratorStateFile, {
        completedAt: priorLegacyWorkspaceImportCompletedAt,
        reason: "Legacy workspace import already completed on an earlier Server V2 startup.",
      })
    : orchestratorStateFile
      ? createEmptyReport("imported", orchestratorStateFile)
      : createEmptyReport("unavailable", null, { reason: "No legacy orchestrator state snapshot was found." });

  if (shouldImportLegacyWorkspaceState && orchestratorStateFile) {
    try {
      const parsed = orchestratorStateSchema.parse(JSON.parse(readTextIfExists(orchestratorStateFile) ?? "{}"));
      let importedWorkspaceCount = 0;
      const importedWorkspaceIds: string[] = [];
      for (const workspace of parsed.workspaces) {
        const normalizedPath = normalizeWorkspacePath(workspace.path);
        if (!normalizedPath) {
          continue;
        }

        const record = registry.importLocalWorkspace({
          dataDir: normalizedPath,
          displayName: workspace.name?.trim() || path.basename(normalizedPath),
          legacyNotes: {
            legacyOrchestrator: {
              baseUrl: workspace.baseUrl ?? null,
              createdAt: fromUnixTimestamp(workspace.createdAt ?? null),
              directory: workspace.directory ?? null,
              lastUsedAt: fromUnixTimestamp(workspace.lastUsedAt ?? null),
              legacyId: workspace.id,
            },
          },
          status: "imported",
        });
        importedWorkspaceCount += 1;
        importedWorkspaceIds.push(record.id);
      }

      const existingRuntimeState = repositories.serverRuntimeState.getByServerId(registry.localServerId);
      repositories.serverRuntimeState.upsert({
        health: {
          ...(existingRuntimeState?.health ?? {}),
          orchestrator: {
            activeLegacyWorkspaceId: parsed.activeId?.trim() || null,
            daemonBaseUrl: parsed.daemon?.baseUrl ?? null,
            workspaceCount: parsed.workspaces.length,
          },
        },
        lastExit: existingRuntimeState?.lastExit ?? null,
        lastStartedAt: fromUnixTimestamp(parsed.daemon?.startedAt ?? parsed.opencode?.startedAt ?? null),
        opencodeBaseUrl: parsed.opencode?.baseUrl ?? existingRuntimeState?.opencodeBaseUrl ?? null,
        opencodeStatus: parsed.opencode ? "detected" : existingRuntimeState?.opencodeStatus ?? "unknown",
        opencodeVersion:
          parsed.binaries?.opencode?.actualVersion ?? parsed.cliVersion ?? existingRuntimeState?.opencodeVersion ?? null,
        restartPolicy: existingRuntimeState?.restartPolicy ?? null,
        routerStatus: existingRuntimeState?.routerStatus ?? "disabled",
        routerVersion: existingRuntimeState?.routerVersion ?? null,
        runtimeVersion: parsed.cliVersion ?? existingRuntimeState?.runtimeVersion ?? options.version,
        serverId: registry.localServerId,
      });

      orchestratorStateReport.details = {
        activeLegacyWorkspaceId: parsed.activeId?.trim() || null,
        importedWorkspaceCount,
        importedWorkspaceIds,
        opencodeBaseUrl: parsed.opencode?.baseUrl ?? null,
      };
    } catch (error) {
      orchestratorStateReport.status = "error";
      orchestratorStateReport.details = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const orchestratorAuthFile = resolveExistingFile(
    legacyOrchestratorDirCandidates(options.legacy?.orchestratorDataDir),
    "aiwork-orchestrator-auth.json",
  );
  const orchestratorAuthReport = orchestratorAuthFile
    ? createEmptyReport("skipped", orchestratorAuthFile)
    : createEmptyReport("unavailable", null, { reason: "No legacy orchestrator auth snapshot was found." });

  if (orchestratorAuthFile) {
    try {
      const parsed = orchestratorAuthSchema.parse(JSON.parse(readTextIfExists(orchestratorAuthFile) ?? "{}"));
      const normalizedProjectDir = parsed.projectDir ? normalizeWorkspacePath(parsed.projectDir) : null;
      const matchedWorkspace = normalizedProjectDir
        ? repositories.workspaces
            .list({ includeHidden: true })
            .find((workspace) => workspace.dataDir === normalizedProjectDir)
        : null;
      orchestratorAuthReport.details = {
        credentialsDetected: Boolean(parsed.opencodeUsername?.trim() || parsed.opencodePassword?.trim()),
        matchedWorkspaceId: matchedWorkspace?.id ?? null,
        projectDir: normalizedProjectDir,
        updatedAt: fromUnixTimestamp(parsed.updatedAt ?? null),
      };
      orchestratorAuthReport.warnings.push(
        "Legacy orchestrator OpenCode credentials were detected but were not imported because they are transitional host secrets, not durable Phase 2 registry state.",
      );
    } catch (error) {
      orchestratorAuthReport.status = "error";
      orchestratorAuthReport.details = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const cloudSigninFile =
    options.legacy?.cloudSigninPath?.trim() ||
    resolveExistingFile(legacyDesktopDataDirCandidates(options.legacy?.desktopDataDir), "aiwork-cloud-signin.json");
  const cloudSigninReport = options.legacy?.cloudSigninJson?.trim() || cloudSigninFile
    ? createEmptyReport("imported", cloudSigninFile ?? "env:AIWORK_SERVER_V2_CLOUD_SIGNIN_JSON")
    : createEmptyReport(
        "unavailable",
        null,
        {
          reason:
            "No server-readable cloud signin snapshot was found. The current desktop app still persists cloud auth in browser localStorage, so later phases need an explicit handoff path.",
        },
      );

  const cloudSigninRaw = options.legacy?.cloudSigninJson?.trim() || readTextIfExists(cloudSigninFile ?? null);
  if (cloudSigninRaw) {
    try {
      const parsed = cloudSigninSchema.parse(JSON.parse(cloudSigninRaw));
      const cloudBaseUrl = normalizeUrl(parsed.cloudBaseUrl ?? parsed.baseUrl ?? "");
      if (!cloudBaseUrl) {
        throw new Error("Cloud signin snapshot did not include a valid base URL.");
      }

      repositories.cloudSignin.upsert({
        auth: parsed.authToken?.trim() ? { authToken: parsed.authToken.trim() } : null,
        cloudBaseUrl,
        id: "cloud_primary",
        lastValidatedAt: parsed.lastValidatedAt?.trim() || null,
        metadata: {
          activeOrgName: parsed.activeOrgName?.trim() || null,
          activeOrgSlug: parsed.activeOrgSlug?.trim() || null,
        },
        orgId: parsed.orgId?.trim() || parsed.activeOrgId?.trim() || null,
        serverId: registry.localServerId,
        userId: parsed.userId?.trim() || null,
      });

      cloudSigninReport.details = {
        cloudBaseUrl,
        imported: true,
        orgId: parsed.orgId?.trim() || parsed.activeOrgId?.trim() || null,
        userId: parsed.userId?.trim() || null,
      };
    } catch (error) {
      cloudSigninReport.status = "error";
      cloudSigninReport.details = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const legacyWorkspaceImportCompletedAt = priorLegacyWorkspaceImportCompletedAt
    ?? (desktopWorkspaceReport.status !== "error" && orchestratorStateReport.status !== "error"
      ? new Date().toISOString()
      : null);
  const diagnostics: StartupDiagnostics = {
    completedAt: new Date().toISOString(),
    importReports: {
      cloudSignin: cloudSigninReport,
      desktopWorkspaceState: desktopWorkspaceReport,
      orchestratorAuth: orchestratorAuthReport,
      orchestratorState: orchestratorStateReport,
    },
    legacyWorkspaceImport: {
      completedAt: legacyWorkspaceImportCompletedAt,
      skipped: !shouldImportLegacyWorkspaceState,
    },
    mode,
    migrations,
    registry: {
      hiddenWorkspaceIds: [controlWorkspace.id, helpWorkspace.id],
      localServerCreated: localServer.created,
      localServerId: localServer.server.id,
      totalServers: repositories.servers.count(),
      totalVisibleWorkspaces: repositories.workspaces.countVisible(),
    },
    warnings: [
      ...desktopWorkspaceReport.warnings,
      ...orchestratorStateReport.warnings,
      ...orchestratorAuthReport.warnings,
      ...cloudSigninReport.warnings,
    ],
    workingDirectory: {
      databasePath: inMemory ? ":memory:" : workingDirectory.databasePath,
      rootDir: workingDirectory.rootDir,
      workspacesDir: workingDirectory.workspacesDir,
    },
  };

  repositories.serverRuntimeState.upsert({
    health: {
      startup: diagnostics,
    },
    lastExit: existingRuntimeState?.lastExit ?? null,
    lastStartedAt: existingRuntimeState?.lastStartedAt ?? null,
    opencodeBaseUrl: existingRuntimeState?.opencodeBaseUrl ?? null,
    opencodeStatus: existingRuntimeState?.opencodeStatus ?? "unknown",
    opencodeVersion: existingRuntimeState?.opencodeVersion ?? options.version,
    restartPolicy: existingRuntimeState?.restartPolicy ?? null,
    routerStatus: existingRuntimeState?.routerStatus ?? "disabled",
    routerVersion: existingRuntimeState?.routerVersion ?? null,
    runtimeVersion: existingRuntimeState?.runtimeVersion ?? options.version,
    serverId: registry.localServerId,
  });

  return {
    close() {
      database.close(false);
    },
    database,
    diagnostics,
    registry,
    repositories,
    workingDirectory,
  };
}
