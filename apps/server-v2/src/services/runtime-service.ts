import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { LocalOpencodeHandle, LocalProcessExit } from "../adapters/opencode/local.js";
import { LocalOpencodeStartupError, createLocalOpencode } from "../adapters/opencode/local.js";
import type { ServerRepositories } from "../database/repositories.js";
import type { ServerWorkingDirectory } from "../database/working-directory.js";
import { formatRuntimeOutput, type RuntimeOutputSnapshot } from "../runtime/output-buffer.js";
import type { ResolvedRuntimeBinary, RuntimeManifest } from "../runtime/manifest.js";
import { createRuntimeAssetService, type RuntimeAssetService } from "../runtime/assets.js";

type RuntimeBootstrapPolicy = "disabled" | "eager" | "manual";
type RuntimeChildStatus = "crashed" | "disabled" | "error" | "restart_scheduled" | "running" | "starting" | "stopped";

type RuntimeRestartPolicy = {
  backoffMs: number;
  maxAttempts: number;
  windowMs: number;
};

type RuntimeLastExit = LocalProcessExit & {
  output: RuntimeOutputSnapshot;
  reason: string;
};


type RuntimeChildState = {
  asset: ResolvedRuntimeBinary | null;
  baseUrl: string | null;
  healthUrl: string | null;
  lastError: string | null;
  lastExit: RuntimeLastExit | null;
  lastReadyAt: string | null;
  lastStartedAt: string | null;
  pid: number | null;
  recentOutput: RuntimeOutputSnapshot;
  running: boolean;
  status: RuntimeChildStatus;
  version: string | null;
};


type RuntimeUpgradeState = {
  error: string | null;
  finishedAt: string | null;
  startedAt: string | null;
  status: "completed" | "failed" | "idle" | "running";
};

export type RuntimeService = {
  bootstrap(): Promise<void>;
  dispose(): Promise<void>;
  getBootstrapPolicy(): RuntimeBootstrapPolicy;
  getOpencodeHealth(): {
    baseUrl: string | null;
    binaryPath: string | null;
    diagnostics: RuntimeOutputSnapshot;
    lastError: string | null;
    lastExit: RuntimeLastExit | null;
    lastReadyAt: string | null;
    lastStartedAt: string | null;
    manifest: RuntimeManifest | null;
    pid: number | null;
    running: boolean;
    source: "development" | "release";
    status: RuntimeChildStatus;
    version: string | null;
  };
  getRuntimeSummary(): {
    bootstrapPolicy: RuntimeBootstrapPolicy;
    manifest: RuntimeManifest | null;
    opencode: ReturnType<RuntimeService["getOpencodeHealth"]>;
    restartPolicy: RuntimeRestartPolicy;
    upgrade: RuntimeUpgradeState;
    source: "development" | "release";
    target: ReturnType<RuntimeAssetService["getTarget"]>;
  };
  getRuntimeVersions(): {
    active: {
      opencodeVersion: string | null;
      serverVersion: string;
    };
    manifest: RuntimeManifest | null;
    pinned: {
      opencodeVersion: string | null;
      serverVersion: string;
    };
    target: ReturnType<RuntimeAssetService["getTarget"]>;
  };
  getStateForPersistence(): ReturnType<RuntimeService["getRuntimeSummary"]>;
  upgradeRuntime(): Promise<{ state: RuntimeUpgradeState; summary: ReturnType<RuntimeService["getRuntimeSummary"]> }>;
};

type CreateRuntimeServiceOptions = {
  assetService?: RuntimeAssetService;
  bootstrapPolicy?: RuntimeBootstrapPolicy;
  environment: string;
  repositories: ServerRepositories;
  restartPolicy?: Partial<RuntimeRestartPolicy>;
  serverId: string;
  serverVersion: string;
  workingDirectory: ServerWorkingDirectory;
};

function isTruthy(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function emptyOutput(): RuntimeOutputSnapshot {
  return {
    combined: [],
    stderr: [],
    stdout: [],
    totalLines: 0,
    truncated: false,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function resolveBootstrapPolicy(environment: string, explicit?: RuntimeBootstrapPolicy): RuntimeBootstrapPolicy {
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.AIWORK_SERVER_V2_RUNTIME_BOOTSTRAP?.trim().toLowerCase();
  if (fromEnv === "disabled" || fromEnv === "manual" || fromEnv === "eager") {
    return fromEnv;
  }

  if (environment === "test") {
    return "disabled";
  }

  return "eager";
}

function resolveRestartPolicy(overrides?: Partial<RuntimeRestartPolicy>): RuntimeRestartPolicy {
  const maxAttempts = Number.parseInt(process.env.AIWORK_SERVER_V2_RUNTIME_RESTART_MAX_ATTEMPTS ?? "2", 10);
  const backoffMs = Number.parseInt(process.env.AIWORK_SERVER_V2_RUNTIME_RESTART_BACKOFF_MS ?? "750", 10);
  const windowMs = Number.parseInt(process.env.AIWORK_SERVER_V2_RUNTIME_RESTART_WINDOW_MS ?? "30000", 10);

  return {
    backoffMs: overrides?.backoffMs ?? (Number.isFinite(backoffMs) ? backoffMs : 750),
    maxAttempts: overrides?.maxAttempts ?? (Number.isFinite(maxAttempts) ? maxAttempts : 2),
    windowMs: overrides?.windowMs ?? (Number.isFinite(windowMs) ? windowMs : 30_000),
  };
}

function pickLatestExit(opencode: RuntimeChildState) {
  const exits = [
    opencode.lastExit ? { component: "opencode" as const, ...opencode.lastExit } : null
  ].filter(Boolean) as Array<RuntimeLastExit & { component: "opencode" }>;
  exits.sort((left, right) => right.at.localeCompare(left.at));
  return exits[0] ?? null;
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a free loopback port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function waitForOpencodeHealthy(handle: LocalOpencodeHandle, timeoutMs = 5_000, pollMs = 200) {
  const startedAt = Date.now();
  let lastError = "OpenCode did not report healthy status yet.";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await handle.client.global.health();
      const data = (health as { healthy?: boolean }).healthy;
      if (data) {
        return;
      }
      lastError = "OpenCode reported unhealthy state.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await Bun.sleep(pollMs);
  }

  throw new Error(lastError);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function createInitialChildState(status: RuntimeChildStatus, version: string | null): RuntimeChildState {
  return {
    asset: null,
    baseUrl: null,
    healthUrl: null,
    lastError: null,
    lastExit: null,
    lastReadyAt: null,
    lastStartedAt: null,
    pid: null,
    recentOutput: emptyOutput(),
    running: false,
    status,
    version,
  };
}

export function createRuntimeService(options: CreateRuntimeServiceOptions): RuntimeService {
  const bootstrapPolicy = resolveBootstrapPolicy(options.environment, options.bootstrapPolicy);
  const restartPolicy = resolveRestartPolicy(options.restartPolicy);
  const assetService = options.assetService ?? createRuntimeAssetService({
    environment: options.environment,
    serverVersion: options.serverVersion,
    workingDirectory: options.workingDirectory,
  });
  const persisted = options.repositories.serverRuntimeState.getByServerId(options.serverId);
  const startupDiagnostics = asRecord(asRecord(persisted?.health).startup);
  const opencodeState = createInitialChildState(bootstrapPolicy === "disabled" ? "disabled" : "stopped", persisted?.opencodeVersion ?? null);

  let runtimeManifest: RuntimeManifest | null = null;
  let bootstrapPromise: Promise<void> | null = null;
  let shuttingDown = false;
  let opencodeHandle: LocalOpencodeHandle | null = null;
  let opencodeStopping = false;
  let upgradeState: RuntimeUpgradeState = {
    error: null,
    finishedAt: null,
    startedAt: null,
    status: "idle",
  };

  const restartHistory = {
    opencode: [] as number[],
  };
  const restartTimers = {
    opencode: null as ReturnType<typeof setTimeout> | null,
  };

  const persistState = () => {
    const health = {
      startup: startupDiagnostics,
      runtime: {
        bootstrapPolicy,
        manifest: runtimeManifest,
        opencode: {
          ...opencodeState,
          binaryPath: opencodeState.asset?.absolutePath ?? null,
        },
        restartPolicy,
        target: assetService.getTarget(),
        upgrade: upgradeState,
      },
    };
    const latestExit = pickLatestExit(opencodeState);

    options.repositories.serverRuntimeState.upsert({
      health,
      lastExit: latestExit,
      lastStartedAt: [opencodeState.lastStartedAt].filter(Boolean).sort().reverse()[0] ?? null,
      opencodeBaseUrl: opencodeState.baseUrl,
      opencodeStatus: opencodeState.status,
      opencodeVersion: opencodeState.version ?? runtimeManifest?.opencodeVersion ?? null,
      restartPolicy: {
        bootstrapPolicy,
        ...restartPolicy,
      },
      runtimeVersion: options.serverVersion,
      serverId: options.serverId,
    });
  };

  const withRestartRecord = (component: "opencode") => {
    const now = Date.now();
    const withinWindow = restartHistory[component].filter((value) => now - value <= restartPolicy.windowMs);
    restartHistory[component] = withinWindow;
    if (withinWindow.length >= restartPolicy.maxAttempts) {
      return false;
    }
    restartHistory[component].push(now);
    return true;
  };

  const clearRestartTimer = (component: "opencode") => {
    const timer = restartTimers[component];
    if (timer) {
      clearTimeout(timer);
      restartTimers[component] = null;
    }
  };

  const updateRecentOutput = () => {
    opencodeState.recentOutput = opencodeHandle?.server.getOutput() ?? opencodeState.recentOutput;
  };

  const stopOpencode = async () => {
    clearRestartTimer("opencode");
    if (!opencodeHandle) {
      opencodeState.running = false;
      opencodeState.pid = null;
      opencodeState.status = bootstrapPolicy === "disabled" ? "disabled" : "stopped";
      persistState();
      return;
    }

    opencodeStopping = true;
    const handle = opencodeHandle;
    opencodeHandle = null;
    handle.server.close();
    await handle.server.waitForExit().catch(() => null);
    opencodeState.running = false;
    opencodeState.pid = null;
    opencodeState.recentOutput = handle.server.getOutput();
    opencodeState.status = bootstrapPolicy === "disabled" ? "disabled" : "stopped";
    persistState();
    opencodeStopping = false;
  };

  const startOpencode = async () => {
    const bundle = await assetService.resolveRuntimeBundle();
    runtimeManifest = bundle.manifest;
    opencodeState.asset = bundle.opencode;
    opencodeState.version = bundle.opencode.version;
    opencodeState.status = bootstrapPolicy === "disabled" ? "disabled" : "starting";
    opencodeState.lastError = null;
    opencodeState.lastStartedAt = nowIso();
    persistState();

    const configuredPort = Number.parseInt(process.env.AIWORK_SERVER_V2_OPENCODE_PORT ?? "0", 10);
    const handle = await createLocalOpencode({
      binary: bundle.opencode.absolutePath,
      client: {
        directory: options.workingDirectory.rootDir,
        responseStyle: "data",
        throwOnError: true,
      },
      config: {},
      cwd: options.workingDirectory.rootDir,
      hostname: process.env.AIWORK_SERVER_V2_OPENCODE_HOST?.trim() || "127.0.0.1",
      port: configuredPort > 0 ? configuredPort : await getFreePort(),
      timeout: Number.parseInt(process.env.AIWORK_SERVER_V2_OPENCODE_START_TIMEOUT_MS ?? "10000", 10) || 10_000,
    });

    try {
      await waitForOpencodeHealthy(handle, 5_000, 200);
    } catch (error) {
      handle.server.close();
      const snapshot = handle.server.getOutput();
      throw new Error(
        `OpenCode became reachable at ${handle.server.url}, but did not pass the SDK health probe: ${error instanceof Error ? error.message : String(error)}.\nCollected output:\n${formatRuntimeOutput(snapshot)}`,
      );
    }

    opencodeHandle = handle;
    opencodeState.baseUrl = handle.server.url;
    opencodeState.lastReadyAt = nowIso();
    opencodeState.pid = handle.server.proc.pid ?? null;
    opencodeState.recentOutput = handle.server.getOutput();
    opencodeState.running = true;
    opencodeState.status = "running";
    persistState();

    void handle.server.waitForExit().then(async (exit) => {
      if (opencodeHandle === handle) {
        opencodeHandle = null;
      }
      opencodeState.running = false;
      opencodeState.pid = null;
      opencodeState.recentOutput = handle.server.getOutput();
      opencodeState.lastExit = {
        ...exit,
        output: handle.server.getOutput(),
        reason: opencodeStopping || shuttingDown ? "stopped" : "unexpected_exit",
      };

      if (opencodeStopping || shuttingDown) {
        opencodeState.status = bootstrapPolicy === "disabled" ? "disabled" : "stopped";
        persistState();
        return;
      }

      opencodeState.status = "crashed";
      persistState();

      if (!withRestartRecord("opencode")) {
        opencodeState.lastError = "OpenCode restart policy exhausted.";
        persistState();
        return;
      }

      opencodeState.status = "restart_scheduled";
      persistState();
      clearRestartTimer("opencode");
      restartTimers.opencode = setTimeout(() => {
        if (shuttingDown) {
          return;
        }

        void bootstrap().catch((error) => {
          opencodeState.status = "error";
          opencodeState.lastError = error instanceof Error ? error.message : String(error);
          persistState();
        });
      }, restartPolicy.backoffMs);
    });
  };

  const bootstrap = async () => {
    if (bootstrapPolicy === "disabled") {
      opencodeState.status = "disabled";
      persistState();
      return;
    }

    if (bootstrapPromise) {
      return bootstrapPromise;
    }

    bootstrapPromise = (async () => {
      persistState();
      try {
        updateRecentOutput();
        if (!opencodeState.running) {
          await startOpencode();
        }
      } catch (error) {
        opencodeState.running = false;
        opencodeState.status = "error";
        opencodeState.lastError = error instanceof Error ? error.message : String(error);
        if (error instanceof LocalOpencodeStartupError) {
          opencodeState.recentOutput = error.output;
          opencodeState.lastExit = {
            at: nowIso(),
            code: null,
            output: error.output,
            reason: error.code,
            signal: null,
          };
        }
        persistState();
        throw error;
      }

    })().finally(() => {
      bootstrapPromise = null;
    });

    return bootstrapPromise;
  };

  persistState();

  const service: RuntimeService = {

    async bootstrap() {
      await bootstrap();
    },

    async dispose() {
      shuttingDown = true;
      clearRestartTimer("opencode");
      await stopOpencode();
      persistState();
    },

    getBootstrapPolicy() {
      return bootstrapPolicy;
    },

    getOpencodeHealth() {
      updateRecentOutput();
      return {
        baseUrl: opencodeState.baseUrl,
        binaryPath: opencodeState.asset?.absolutePath ?? null,
        diagnostics: opencodeState.recentOutput,
        lastError: opencodeState.lastError,
        lastExit: opencodeState.lastExit,
        lastReadyAt: opencodeState.lastReadyAt,
        lastStartedAt: opencodeState.lastStartedAt,
        manifest: runtimeManifest,
        pid: opencodeState.pid,
        running: opencodeState.running,
        source: opencodeState.asset?.source ?? assetService.getSource(),
        status: opencodeState.status,
        version: opencodeState.version,
      };
    },

    getRuntimeSummary() {
      return {
        bootstrapPolicy,
        manifest: runtimeManifest,
        opencode: this.getOpencodeHealth(),
        restartPolicy,
        upgrade: upgradeState,
        source: assetService.getSource(),
        target: assetService.getTarget(),
      };
    },

    getRuntimeVersions() {
      const summary = this.getRuntimeSummary();
      return {
        active: {
          opencodeVersion: summary.opencode.version,
          serverVersion: options.serverVersion,
        },
        manifest: summary.manifest,
        pinned: {
          opencodeVersion: summary.manifest?.opencodeVersion ?? null,
          serverVersion: options.serverVersion,
        },
        target: summary.target,
      };
    },

    getStateForPersistence(): ReturnType<RuntimeService["getRuntimeSummary"]> {
      return this.getRuntimeSummary();
    },

    async upgradeRuntime() {
      upgradeState = {
        error: null,
        finishedAt: null,
        startedAt: nowIso(),
        status: "running",
      };
      persistState();

      try {
        await stopOpencode();
        runtimeManifest = null;
        opencodeState.asset = null;
        await bootstrap();
        upgradeState = {
          error: null,
          finishedAt: nowIso(),
          startedAt: upgradeState.startedAt,
          status: "completed",
        };
        persistState();
        return {
          state: upgradeState,
          summary: this.getRuntimeSummary(),
        };
      } catch (error) {
        upgradeState = {
          error: error instanceof Error ? error.message : String(error),
          finishedAt: nowIso(),
          startedAt: upgradeState.startedAt,
          status: "failed",
        };
        persistState();
        throw error;
      }
    },
  };

  return service;
}
