import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getRequestContext, type AppBindings } from "../context/request-context.js";
import { buildSuccessResponse, RouteError } from "../http.js";
import { jsonResponse, withCommonErrorResponses } from "../openapi.js";
import {
  hubSkillInstallResponseSchema,
  hubSkillInstallWriteSchema,
  hubSkillListResponseSchema,
  managedAssignmentWriteSchema,
  managedDeleteResponseSchema,
  managedItemListResponseSchema,
  managedItemResponseSchema,
  managedItemWriteSchema,
  workspaceMcpListResponseSchema,
  workspaceMcpWriteSchema,
  workspacePluginListResponseSchema,
  workspacePluginWriteSchema,
  workspaceSkillListResponseSchema,
  workspaceSkillResponseSchema,
  workspaceSkillWriteSchema,
} from "../schemas/managed.js";
import { routePaths } from "./route-paths.js";

function parseJsonBody<T>(schema: { parse(input: unknown): T }, request: Request) {
  return request.json().then((body) => schema.parse(body));
}

function requireVisible(c: Context<AppBindings>) {
  const requestContext = getRequestContext(c);
  requestContext.services.auth.requireVisibleRead(requestContext.actor);
  return requestContext;
}

function requireWorkspace(c: Context<AppBindings>) {
  const requestContext = requireVisible(c);
  const workspaceId = c.req.param("workspaceId") ?? "";
  return { requestContext, workspaceId };
}

function addCompatibilityRoute(
  app: Hono<AppBindings>,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  path: string,
  handler: (c: Context<AppBindings>) => Promise<Response> | Response,
) {
  if (method === "GET") app.get(path, handler);
  if (method === "POST") app.post(path, handler);
  if (method === "PUT") app.put(path, handler);
  if (method === "PATCH") app.patch(path, handler);
  if (method === "DELETE") app.delete(path, handler);
}

export function registerManagedRoutes(app: Hono<AppBindings>) {
  for (const kind of ["mcps", "plugins", "providerConfigs", "skills"] as const) {
    app.get(
      routePaths.system.managed.list(kind),
      describeRoute({
        tags: ["Managed"],
        summary: `List managed ${kind}`,
        description: `Returns the server-owned ${kind} records and explicit workspace assignments.`,
        responses: withCommonErrorResponses({
          200: jsonResponse(`Managed ${kind} returned successfully.`, managedItemListResponseSchema),
        }, { includeUnauthorized: true }),
      }),
      (c) => {
        const requestContext = requireVisible(c);
        return c.json(buildSuccessResponse(requestContext.requestId, { items: requestContext.services.managed.listManaged(kind) }));
      },
    );

    app.post(
      routePaths.system.managed.list(kind),
      describeRoute({
        tags: ["Managed"],
        summary: `Create managed ${kind.slice(0, -1)}`,
        description: `Creates a server-owned ${kind.slice(0, -1)} record and optionally assigns it to workspaces.`,
        responses: withCommonErrorResponses({
          200: jsonResponse(`Managed ${kind.slice(0, -1)} created successfully.`, managedItemResponseSchema),
        }, { includeInvalidRequest: true, includeUnauthorized: true }),
      }),
      async (c) => {
        const requestContext = requireVisible(c);
        const body = await parseJsonBody(managedItemWriteSchema, c.req.raw);
        return c.json(buildSuccessResponse(requestContext.requestId, requestContext.services.managed.createManaged(kind, body)));
      },
    );

    app.put(
      routePaths.system.managed.item(kind),
      describeRoute({
        tags: ["Managed"],
        summary: `Update managed ${kind.slice(0, -1)}`,
        description: `Updates a server-owned ${kind.slice(0, -1)} record.`,
        responses: withCommonErrorResponses({
          200: jsonResponse(`Managed ${kind.slice(0, -1)} updated successfully.`, managedItemResponseSchema),
        }, { includeInvalidRequest: true, includeNotFound: true, includeUnauthorized: true }),
      }),
      async (c) => {
        const requestContext = requireVisible(c);
        const itemId = c.req.param("itemId") ?? "";
        const body = await parseJsonBody(managedItemWriteSchema, c.req.raw);
        return c.json(buildSuccessResponse(requestContext.requestId, requestContext.services.managed.updateManaged(kind, itemId, body)));
      },
    );

    app.put(
      routePaths.system.managed.assignments(kind),
      describeRoute({
        tags: ["Managed"],
        summary: `Assign managed ${kind.slice(0, -1)} to workspaces`,
        description: `Replaces the workspace assignments for a server-owned managed item.`,
        responses: withCommonErrorResponses({
          200: jsonResponse(`Managed ${kind.slice(0, -1)} assignments updated successfully.`, managedItemResponseSchema),
        }, { includeInvalidRequest: true, includeNotFound: true, includeUnauthorized: true }),
      }),
      async (c) => {
        const requestContext = requireVisible(c);
        const itemId = c.req.param("itemId") ?? "";
        const body = await parseJsonBody(managedAssignmentWriteSchema, c.req.raw);
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.updateAssignments(kind, itemId, body.workspaceIds)));
      },
    );

    app.delete(
      routePaths.system.managed.item(kind),
      describeRoute({
        tags: ["Managed"],
        summary: `Delete managed ${kind.slice(0, -1)}`,
        description: `Deletes a server-owned managed item and removes its workspace assignments.`,
        responses: withCommonErrorResponses({
          200: jsonResponse(`Managed ${kind.slice(0, -1)} deleted successfully.`, managedDeleteResponseSchema),
        }, { includeNotFound: true, includeUnauthorized: true }),
      }),
      async (c) => {
        const requestContext = requireVisible(c);
        const itemId = c.req.param("itemId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.deleteManaged(kind, itemId)));
      },
    );
  }

  app.get(
    routePaths.workspaces.mcp(),
    describeRoute({
      tags: ["Managed"],
      summary: "List workspace MCPs",
      description: "Returns the effective workspace MCP records backed by server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace MCPs returned successfully.", workspaceMcpListResponseSchema),
      }, { includeUnauthorized: true }),
    }),
    (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      return c.json(buildSuccessResponse(requestContext.requestId, { items: requestContext.services.managed.listWorkspaceMcp(workspaceId) }));
    },
  );

  app.post(
    routePaths.workspaces.mcp(),
    describeRoute({
      tags: ["Managed"],
      summary: "Add workspace MCP",
      description: "Creates or updates a workspace-scoped MCP through server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace MCP updated successfully.", workspaceMcpListResponseSchema),
      }, { includeInvalidRequest: true, includeUnauthorized: true }),
    }),
    async (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      const body = await parseJsonBody(workspaceMcpWriteSchema, c.req.raw);
      return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.addWorkspaceMcp(workspaceId, body)));
    },
  );

  app.get(
    routePaths.workspaces.plugins(),
    describeRoute({
      tags: ["Managed"],
      summary: "List workspace plugins",
      description: "Returns the effective workspace plugins backed by server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace plugins returned successfully.", workspacePluginListResponseSchema),
      }, { includeUnauthorized: true }),
    }),
    (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      return c.json(buildSuccessResponse(requestContext.requestId, requestContext.services.managed.listWorkspacePlugins(workspaceId)));
    },
  );

  app.post(
    routePaths.workspaces.plugins(),
    describeRoute({
      tags: ["Managed"],
      summary: "Add workspace plugin",
      description: "Creates or updates a workspace-scoped plugin through server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace plugins updated successfully.", workspacePluginListResponseSchema),
      }, { includeInvalidRequest: true, includeUnauthorized: true }),
    }),
      async (c) => {
        const { requestContext, workspaceId } = requireWorkspace(c);
        const body = await parseJsonBody(workspacePluginWriteSchema, c.req.raw);
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.addWorkspacePlugin(workspaceId, body.spec)));
      },
    );

  app.get(
    routePaths.workspaces.skills(),
    describeRoute({
      tags: ["Managed"],
      summary: "List workspace skills",
      description: "Returns the effective workspace skills backed by server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace skills returned successfully.", workspaceSkillListResponseSchema),
      }, { includeUnauthorized: true }),
    }),
    (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      return c.json(buildSuccessResponse(requestContext.requestId, { items: requestContext.services.managed.listWorkspaceSkills(workspaceId) }));
    },
  );

  app.post(
    routePaths.workspaces.skills(),
    describeRoute({
      tags: ["Managed"],
      summary: "Upsert workspace skill",
      description: "Creates or updates a workspace-scoped skill through server-owned managed state.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Workspace skill updated successfully.", workspaceSkillResponseSchema),
      }, { includeInvalidRequest: true, includeUnauthorized: true }),
    }),
    async (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      const body = await parseJsonBody(workspaceSkillWriteSchema, c.req.raw);
      const item = await requestContext.services.managed.upsertWorkspaceSkill(workspaceId, body);
      return c.json(buildSuccessResponse(requestContext.requestId, { content: requestContext.services.managed.getWorkspaceSkill(workspaceId, item.name).content, item }));
    },
  );

  app.get(
    routePaths.workspaces.hubSkills,
    describeRoute({
      tags: ["Managed"],
      summary: "List hub skills",
      description: "Returns the available Skill Hub catalog backed by trusted GitHub sources.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Hub skills returned successfully.", hubSkillListResponseSchema),
      }, { includeUnauthorized: true }),
    }),
    async (c) => {
      const requestContext = requireVisible(c);
      const url = new URL(c.req.url);
      return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.listHubSkills({ owner: url.searchParams.get("owner") ?? undefined, ref: url.searchParams.get("ref") ?? undefined, repo: url.searchParams.get("repo") ?? undefined })));
    },
  );

  app.post(
    `${routePaths.workspaces.skills()}/hub/:name`,
    describeRoute({
      tags: ["Managed"],
      summary: "Install hub skill",
      description: "Installs a trusted Skill Hub skill into server-owned managed state for a workspace.",
      responses: withCommonErrorResponses({
        200: jsonResponse("Hub skill installed successfully.", hubSkillInstallResponseSchema),
      }, { includeInvalidRequest: true, includeUnauthorized: true }),
    }),
    async (c) => {
      const { requestContext, workspaceId } = requireWorkspace(c);
      const body = await parseJsonBody(hubSkillInstallWriteSchema, c.req.raw).catch(() => ({} as any));
      return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.managed.installHubSkill(workspaceId, { name: c.req.param("name") ?? "", overwrite: body.overwrite, repo: body.repo })));
    },
  );

  addCompatibilityRoute(app, "GET", "/workspace/:workspaceId/mcp", (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json({ items: requestContext.services.managed.listWorkspaceMcp(workspaceId) });
  });
  addCompatibilityRoute(app, "POST", "/workspace/:workspaceId/mcp", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    const body = await parseJsonBody(workspaceMcpWriteSchema, c.req.raw);
    return c.json(await requestContext.services.managed.addWorkspaceMcp(workspaceId, body));
  });
  addCompatibilityRoute(app, "DELETE", "/workspace/:workspaceId/mcp/:name", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json(await requestContext.services.managed.removeWorkspaceMcp(workspaceId, c.req.param("name") ?? ""));
  });
  addCompatibilityRoute(app, "DELETE", "/workspace/:workspaceId/mcp/:name/auth", (c) => c.json({ ok: true }));

  addCompatibilityRoute(app, "GET", "/workspace/:workspaceId/plugins", (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json(requestContext.services.managed.listWorkspacePlugins(workspaceId));
  });
  addCompatibilityRoute(app, "POST", "/workspace/:workspaceId/plugins", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    const body = await parseJsonBody(workspacePluginWriteSchema, c.req.raw);
    return c.json(await requestContext.services.managed.addWorkspacePlugin(workspaceId, body.spec));
  });
  addCompatibilityRoute(app, "DELETE", "/workspace/:workspaceId/plugins/:name", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json(await requestContext.services.managed.removeWorkspacePlugin(workspaceId, c.req.param("name") ?? ""));
  });

  addCompatibilityRoute(app, "GET", "/workspace/:workspaceId/skills", (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json({ items: requestContext.services.managed.listWorkspaceSkills(workspaceId) });
  });
  addCompatibilityRoute(app, "GET", "/workspace/:workspaceId/skills/:name", (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json(requestContext.services.managed.getWorkspaceSkill(workspaceId, c.req.param("name") ?? ""));
  });
  addCompatibilityRoute(app, "POST", "/workspace/:workspaceId/skills", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    const body = await parseJsonBody(workspaceSkillWriteSchema, c.req.raw);
    return c.json(await requestContext.services.managed.upsertWorkspaceSkill(workspaceId, body));
  });
  addCompatibilityRoute(app, "DELETE", "/workspace/:workspaceId/skills/:name", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    return c.json(await requestContext.services.managed.deleteWorkspaceSkill(workspaceId, c.req.param("name") ?? ""));
  });
  addCompatibilityRoute(app, "GET", "/hub/skills", async (c) => {
    const requestContext = requireVisible(c);
    const url = new URL(c.req.url);
    return c.json(await requestContext.services.managed.listHubSkills({ owner: url.searchParams.get("owner") ?? undefined, ref: url.searchParams.get("ref") ?? undefined, repo: url.searchParams.get("repo") ?? undefined }));
  });
  addCompatibilityRoute(app, "POST", "/workspace/:workspaceId/skills/hub/:name", async (c) => {
    const { requestContext, workspaceId } = requireWorkspace(c);
    const body = await parseJsonBody(hubSkillInstallWriteSchema, c.req.raw).catch(() => ({} as any));
    return c.json({ ok: true, ...(await requestContext.services.managed.installHubSkill(workspaceId, { name: c.req.param("name") ?? "", overwrite: body.overwrite, repo: body.repo })) });
  });
}
