#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";

import { parseCliArgs, printHelp, resolveServerConfig } from "./config.js";
import { createManagedAiWorkEngineServer, type ManagedAiWorkEngineServer } from "./managed-opencode.js";
import { createServerLogger, startServer } from "./server.js";
import pkg from "../package.json" with { type: "json" };

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}

const config = await resolveServerConfig(args);
const logger = createServerLogger(config);
let managedAiWorkEngine: ManagedAiWorkEngineServer | null = null;

if (!config.opencodeBaseUrl && process.env.AIWORK_MANAGE_AIWORK_ENGINE === "1") {
  const workspace = config.workspaces[0];
  if (workspace?.path) {
    const managedAiWorkEngineCwd = process.env.AIWORK_MANAGED_AIWORK_ENGINE_CWD?.trim() || workspace.path;
    await mkdir(managedAiWorkEngineCwd, { recursive: true });
    managedAiWorkEngine = await createManagedAiWorkEngineServer({
      bin: process.env.AIWORK_AIWORK_ENGINE_BIN,
      cwd: managedAiWorkEngineCwd,
      env: {
        ...(process.env.AIWORK_DEV_MODE ? { AIWORK_DEV_MODE: process.env.AIWORK_DEV_MODE } : {}),
      },
    });
    config.opencodeBaseUrl = managedAiWorkEngine.url;
    config.opencodeUsername = managedAiWorkEngine.username;
    config.opencodePassword = managedAiWorkEngine.password;
    for (const entry of config.workspaces) {
      entry.opencode = {
        ...entry.opencode,
        baseUrl: entry.opencode?.baseUrl ?? managedAiWorkEngine.url,
        directory: entry.opencode?.directory ?? entry.path,
      };
      entry.opencodeUsername ??= managedAiWorkEngine.username;
      entry.opencodePassword ??= managedAiWorkEngine.password;
    }
    logger.log("info", `Managed AiWorkEngine listening on ${managedAiWorkEngine.url}`);
  }
}

const server = startServer(config);

const url = `http://${config.host}:${server.port}`;
logger.log("info", `AiWork server listening on ${url}`);

if (config.tokenSource === "generated") {
  logger.log("info", `Client token: ${config.token}`);
}

if (config.hostTokenSource === "generated") {
  logger.log("info", `Host token: ${config.hostToken}`);
}

if (config.workspaces.length === 0) {
  logger.log("info", "No workspaces configured. Add --workspace or update server.json.");
} else {
  logger.log("info", `Workspaces: ${config.workspaces.length}`);
}

if (args.verbose) {
  logger.log("info", `Config path: ${config.configPath ?? "unknown"}`);
  logger.log("info", `Read-only: ${config.readOnly ? "true" : "false"}`);
  logger.log("info", `Approval: ${config.approval.mode} (${config.approval.timeoutMs}ms)`);
  logger.log("info", `CORS origins: ${config.corsOrigins.join(", ")}`);
  logger.log("info", `Authorized roots: ${config.authorizedRoots.join(", ")}`);
  logger.log("info", `Token source: ${config.tokenSource}`);
  logger.log("info", `Host token source: ${config.hostTokenSource}`);
}

const shutdown = () => {
  managedAiWorkEngine?.close();
  (server as { stop?: (closeActiveConnections?: boolean) => void }).stop?.(true);
};

process.once("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
