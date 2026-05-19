import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ApiError } from "../errors.js";
import { readJsoncFile, updateJsoncPath, updateJsoncTopLevel } from "../jsonc.js";
import { engineConfigPath, aiworkConfigPath } from "../workspace-files.js";
import { ensureDir, exists } from "../utils.js";
import { logger as fileLogger } from "../log-util.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

// ---------------------------------------------------------------------------
// Local helpers (used only by config routes)
// ---------------------------------------------------------------------------

function normalizeEngineScope(value: string | null | undefined): "project" | "global" {
  return value?.trim().toLowerCase() === "global" ? "global" : "project";
}

function resolveGlobalEngineConfigBaseDir(): string {
  const explicitDir = process.env.ENGINE_CONFIG_DIR?.trim();
  if (explicitDir) return explicitDir;
  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgConfig) return join(xdgConfig, "engine");
  return join(homedir(), ".config", "engine");
}

function resolveEngineConfigFilePath(scope: "project" | "global", workspaceRoot: string): string {
  if (scope === "global") {
    const base = resolveGlobalEngineConfigBaseDir();
    const jsoncPath = join(base, "engine.jsonc");
    const jsonPath = join(base, "engine.json");
    if (existsSync(jsoncPath)) return jsoncPath;
    if (existsSync(jsonPath)) return jsonPath;
    return jsoncPath;
  }
  return engineConfigPath(workspaceRoot);
}

async function readEngineConfig(workspaceRoot: string): Promise<Record<string, unknown>> {
  const { data } = await readJsoncFile(engineConfigPath(workspaceRoot), {} as Record<string, unknown>);
  return data;
}

async function readAiWorkConfig(workspaceRoot: string): Promise<Record<string, unknown>> {
  const path = aiworkConfigPath(workspaceRoot);
  if (!(await exists(path))) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiError(422, "invalid_json", "Failed to parse aiwork.json");
  }
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerConfigRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, requireClientScope, requireApproval,
    readJsonBody, jsonResponse, emitReloadEvent, buildConfigTrigger,
    reloadEngineEngine,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_CONFIG, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const engine = await readEngineConfig(workspace.path);
    const aiwork = await readAiWorkConfig(workspace.path);
    return jsonResponse({ engine, aiwork, updatedAt: null });
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_ENGINE_CONFIG, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = normalizeEngineScope(ctx.url.searchParams.get("scope"));
    const cfgPath = resolveEngineConfigFilePath(scope, workspace.path);
    const hasFile = await exists(cfgPath);
    const result = hasFile
      ? { exists: true, content: await readFile(cfgPath, "utf8") }
      : { exists: false, content: null };
    return jsonResponse({ path: cfgPath, ...result });
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_ENGINE_CONFIG_WRITE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const scope = normalizeEngineScope(typeof body.scope === "string" ? body.scope : null);
    const content = typeof body.content === "string" ? body.content : null;
    if (content === null) {
      throw new ApiError(400, "invalid_payload", "content must be a string");
    }

    const cfgPath = resolveEngineConfigFilePath(scope, workspace.path);
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: scope === "global" ? "config.global.write" : "config.write",
      summary: `Write ${scope} Engine config`,
      paths: [cfgPath],
    });

    await ensureDir(dirname(cfgPath));
    await writeFile(cfgPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

    fileLogger.info("config.write", { workspaceId: workspace.id, summary: `Updated ${scope} Engine config` });
    if (scope === "project") {
      emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(cfgPath));
    }

    return jsonResponse({ ok: true, status: 0, stdout: `Wrote ${cfgPath}`, stderr: "" });
  });

  addRoute(routes, "PATCH", ApiRoutes.WORKSPACE_CONFIG_PATCH, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const engine = body.engine as Record<string, unknown> | undefined;
    const aiwork = body.aiwork as Record<string, unknown> | undefined;

    if (!engine && !aiwork) {
      throw new ApiError(400, "invalid_payload", "engine or aiwork updates required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.patch",
      summary: "Patch workspace config",
      paths: [engine ? engineConfigPath(workspace.path) : null, aiwork ? aiworkConfigPath(workspace.path) : null].filter(Boolean) as string[],
    });

    if (engine) {
      const configPath = engineConfigPath(workspace.path);
      const nextEngine = ensurePlainObject(engine);
      const { permission, ...topLevelUpdates } = nextEngine;

      if (Object.keys(topLevelUpdates).length) {
        await updateJsoncTopLevel(configPath, topLevelUpdates);
      }

      const permissionUpdate = ensurePlainObject(permission);
      if (Object.prototype.hasOwnProperty.call(permissionUpdate, "external_directory")) {
        const existingEngine = await readEngineConfig(workspace.path);
        const existingPermission = ensurePlainObject(existingEngine.permission);
        const nextExternalDirectory = permissionUpdate.external_directory;
        const existingPermissionKeys = Object.keys(existingPermission);
        const removePermissionParent =
          typeof nextExternalDirectory === "undefined" &&
          (existingPermissionKeys.length === 0 ||
            (existingPermissionKeys.length === 1 && Object.prototype.hasOwnProperty.call(existingPermission, "external_directory")));

        if (removePermissionParent) {
          await updateJsoncPath(configPath, ["permission"], undefined);
        } else {
          await updateJsoncPath(configPath, ["permission", "external_directory"], nextExternalDirectory);
        }
      }
    }
    if (aiwork) {
      await writeAiWorkConfig(workspace.path, aiwork, true);
    }

    fileLogger.info("config.patch", { workspaceId: workspace.id, summary: "Patched workspace config" });
    if (engine) {
      emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(engineConfigPath(workspace.path)));
    }

    return jsonResponse({ updatedAt: Date.now() });
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_ENGINE_RELOAD, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    requireClientScope(ctx, "collaborator");
    await reloadEngineEngine(config, workspace);
    fileLogger.info("engine.reload", { workspaceId: workspace.id, summary: "Reloaded workspace engine" });
    return jsonResponse({ ok: true, reloadedAt: Date.now() });
  });
}

async function writeAiWorkConfig(workspaceRoot: string, payload: Record<string, unknown>, merge: boolean): Promise<void> {
  const path = aiworkConfigPath(workspaceRoot);
  const next = merge ? { ...(await readAiWorkConfig(workspaceRoot)), ...payload } : payload;
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}