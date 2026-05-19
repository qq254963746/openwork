import { ApiError } from "../errors.js";
import type { Route, HandlerDeps } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

export function registerSkillRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, resolveWorkspace, ensureWritable, requireClientScope, requireApproval,
    readJsonBody, jsonResponse, fetchEngineJson, resolveEngineDirectory,
    emitReloadEvent, buildConfigTrigger,
  } = deps;

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SKILLS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    try {
      const data = await fetchEngineJson(config, workspace, "/skill", { method: "GET" });
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return jsonResponse({ items: [] });
      }
      throw error;
    }
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SKILL, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const skillId = (ctx.params.skillId ?? "").trim();
    if (!skillId) {
      throw new ApiError(400, "invalid_payload", "skillId is required");
    }

    try {
      const data = await fetchEngineJson(config, workspace, `/skill/${encodeURIComponent(skillId)}`, { method: "GET" });
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "skill_not_found", "Skill not found");
      }
      throw error;
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_SKILLS_UPSERT, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "";
    if (!source) {
      throw new ApiError(400, "invalid_payload", "source is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skill.install",
      summary: `Install skill from ${source}`,
      paths: [resolveEngineDirectory(workspace) ?? workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/skill/install", {
        method: "POST",
        body: { source },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "skills", buildConfigTrigger(`${resolveEngineDirectory(workspace) ?? workspace.path}/skills`));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "install_failed", `Failed to install skill: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  });

  addRoute(routes, "POST", ApiRoutes.WORKSPACE_SKILLS_DELETE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
    if (!id) {
      throw new ApiError(400, "invalid_payload", "id is required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skill.uninstall",
      summary: `Uninstall skill ${id}`,
      paths: [resolveEngineDirectory(workspace) ?? workspace.path],
    });

    try {
      const result = await fetchEngineJson(config, workspace, "/skill/uninstall", {
        method: "POST",
        body: { id },
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "skills", buildConfigTrigger(`${resolveEngineDirectory(workspace) ?? workspace.path}/skills`));
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "uninstall_failed", `Failed to uninstall skill: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  });

  addRoute(routes, "GET", ApiRoutes.HUB_SKILLS, "none", async () => {
    const upstream = process.env.AIWORK_SKILL_HUB_URL ?? "https://raw.githubusercontent.com/aiwork-community/skills-registry/main/index.json";
    try {
      const response = await fetch(upstream, {
        headers: { "User-Agent": "AiWork-Server" },
      });
      if (!response.ok) {
        throw new ApiError(502, "hub_unavailable", "Skill hub unavailable", { upstreamStatus: response.status });
      }
      const data = await response.json();
      return jsonResponse(data);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "hub_fetch_failed", "Failed to fetch skill hub");
    }
  });

  addRoute(routes, "GET", ApiRoutes.WORKSPACE_SKILLS_HUB_INSTALL, "none", async (ctx) => {
    const slug = (ctx.params.slug ?? "").trim();
    if (!slug) {
      throw new ApiError(400, "invalid_payload", "slug is required");
    }
    const upstream = process.env.AIWORK_SKILL_HUB_URL ?? "https://raw.githubusercontent.com/aiwork-community/skills-registry/main/index.json";
    try {
      const response = await fetch(upstream, {
        headers: { "User-Agent": "AiWork-Server" },
      });
      if (!response.ok) {
        throw new ApiError(502, "hub_unavailable", "Skill hub unavailable", { upstreamStatus: response.status });
      }
      const data = (await response.json()) as { items?: Array<{ slug: string }> };
      const items = Array.isArray(data?.items) ? data.items : [];
      const item = items.find((i) => i.slug === slug);
      if (!item) {
        throw new ApiError(404, "skill_not_found_in_hub", "Skill not found in hub");
      }
      return jsonResponse(item);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "hub_fetch_failed", "Failed to fetch skill hub");
    }
  });
}