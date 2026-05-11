import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { ServerRepositories } from "../database/repositories.js";
import type { JsonObject, ManagedConfigRecord, WorkspaceRecord } from "../database/types.js";
import type { ServerWorkingDirectory } from "../database/working-directory.js";
import type { ConfigMaterializationService } from "./config-materialization-service.js";
import type { WorkspaceFileService } from "./workspace-file-service.js";
import { RouteError } from "../http.js";

const DEFAULT_HUB_REPO = {
  owner: "different-ai",
  repo: "openwork-hub",
  ref: "main",
} as const;

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COMMAND_NAME_REGEX = /^[A-Za-z0-9_-]+$/;
const MCP_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

type ManagedKind = "mcps" | "plugins" | "providerConfigs" | "skills";
type ManagedSummary = ManagedConfigRecord & { workspaceIds: string[] };
type HubRepo = { owner: string; repo: string; ref: string };


function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as JsonObject) } : {};
}



function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: content, data: {} as Record<string, unknown> };
  }
  const raw = match[1] ?? "";
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    if (value === "true") {
      data[key] = true;
      continue;
    }
    if (value === "false") {
      data[key] = false;
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      data[key] = Number(value);
      continue;
    }
    data[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return {
    body: content.slice(match[0].length),
    data,
  };
}

function buildFrontmatter(data: Record<string, unknown>) {
  const yaml = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "string" ? String(value).replace(/\n/g, " ") : String(value)}`)
    .join("\n");
  return `---\n${yaml}\n---\n`;
}

function validateSkillName(name: string) {
  if (!name || name.length < 1 || name.length > 64 || !SKILL_NAME_REGEX.test(name)) {
    throw new RouteError(400, "invalid_request", "Skill name must be kebab-case (1-64 chars).");
  }
}

function validateCommandName(name: string) {
  if (!name || !COMMAND_NAME_REGEX.test(name)) {
    throw new RouteError(400, "invalid_request", "Command name must be alphanumeric with _ or -.");
  }
}

function validateMcpName(name: string) {
  if (!name || name.startsWith("-") || !MCP_NAME_REGEX.test(name)) {
    throw new RouteError(400, "invalid_request", "MCP name must be alphanumeric and not start with -.");
  }
}

function validateMcpConfig(config: Record<string, unknown>) {
  const type = config.type;
  if (type !== "local" && type !== "remote") {
    throw new RouteError(400, "invalid_request", "MCP config type must be local or remote.");
  }
  if (type === "local") {
    const command = config.command;
    if (!Array.isArray(command) || command.length === 0) {
      throw new RouteError(400, "invalid_request", "Local MCP requires command array.");
    }
  }
  if (type === "remote") {
    const url = config.url;
    if (!url || typeof url !== "string") {
      throw new RouteError(400, "invalid_request", "Remote MCP requires url.");
    }
  }
}

function normalizeManagedKey(value: string, fallback: string) {
  const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return trimmed || fallback;
}

function managedSkillMatchesWorkspaceQuery(item: ManagedSummary, workspaceId: string, normalizedName: string) {
  if (!item.workspaceIds.includes(workspaceId)) return false;
  const byKey = normalizeManagedKey(item.key ?? "", "skill");
  if (byKey === normalizedName) return true;
  const byDisplay = normalizeManagedKey(item.displayName ?? "", "skill");
  return byDisplay === normalizedName;
}

function extractTriggerFromBody(body: string) {
  const lines = body.split(/\r?\n/);
  let inWhenSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, "").trim();
      inWhenSection = /^when to use$/i.test(heading);
      continue;
    }
    if (!inWhenSection) {
      continue;
    }
    const cleaned = trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

export type ManagedResourceService = ReturnType<typeof createManagedResourceService>;

export function createManagedResourceService(input: {
  config: ConfigMaterializationService;
  files: WorkspaceFileService;
  repositories: ServerRepositories;
  serverId: string;
  workingDirectory: ServerWorkingDirectory;
}) {
  const kindConfig = {
    mcps: {
      assignmentRepo: input.repositories.workspaceMcps,
      itemRepo: input.repositories.mcps,
      reloadReason: "mcp" as const,
      triggerType: "mcp" as const,
    },
    plugins: {
      assignmentRepo: input.repositories.workspacePlugins,
      itemRepo: input.repositories.plugins,
      reloadReason: "plugins" as const,
      triggerType: "plugin" as const,
    },
    providerConfigs: {
      assignmentRepo: input.repositories.workspaceProviderConfigs,
      itemRepo: input.repositories.providerConfigs,
      reloadReason: "config" as const,
      triggerType: "config" as const,
    },
    skills: {
      assignmentRepo: input.repositories.workspaceSkills,
      itemRepo: input.repositories.skills,
      reloadReason: "skills" as const,
      triggerType: "skill" as const,
    },
  };

  function getWorkspaceOrThrow(workspaceId: string) {
    const workspace = input.repositories.workspaces.getById(workspaceId);
    if (!workspace) {
      throw new HTTPException(404, { message: `Workspace not found: ${workspaceId}` });
    }
    return workspace;
  }

  function ensureWorkspaceMutable(workspace: WorkspaceRecord) {
    if (!workspace.dataDir?.trim()) {
      throw new RouteError(400, "invalid_request", `Workspace ${workspace.id} does not have a local data directory.`);
    }
    return workspace;
  }

  function workspaceSkillPath(workspace: WorkspaceRecord, key: string) {
    const baseDir = workspace.configDir?.trim() || workspace.dataDir?.trim() || "";
    return path.join(baseDir, ".opencode", "skills", "aiwork-managed", key, "SKILL.md");
  }

  function summaryForKind(kind: ManagedKind, item: ManagedConfigRecord): ManagedSummary {
    return {
      ...item,
      workspaceIds: kindConfig[kind].assignmentRepo.listForItem(item.id).map((assignment) => assignment.workspaceId),
    };
  }

  async function materializeAssignments(kind: ManagedKind, workspaceIds: string[], action: "added" | "removed" | "updated", name: string) {
    for (const workspaceId of Array.from(new Set(workspaceIds.filter(Boolean)))) {
      const workspace = input.repositories.workspaces.getById(workspaceId);
      if (!workspace) {
        continue;
      }
      input.config.ensureWorkspaceConfig(workspaceId);
      input.files.emitReloadEvent(workspaceId, kindConfig[kind].reloadReason, {
        action,
        name,
        path: kind === "skills" ? workspaceSkillPath(workspace, normalizeManagedKey(name, workspaceId)) : undefined,
        type: kindConfig[kind].triggerType,
      });
      await input.files.recordWorkspaceAudit(
        workspaceId,
        `${kind}.${action}`,
        workspace.dataDir ?? workspaceId,
        `${action === "removed" ? "Removed" : action === "updated" ? "Updated" : "Added"} ${kind} item ${name} through Server V2.`,
      );
    }
  }

  function upsertManaged(kind: ManagedKind, payload: {
    auth?: JsonObject | null;
    cloudItemId?: string | null;
    config?: JsonObject;
    displayName: string;
    id?: string;
    key?: string | null;
    metadata?: JsonObject | null;
    source?: ManagedConfigRecord["source"];
    workspaceIds?: string[];
  }) {
    const displayName = payload.displayName.trim();
    if (!displayName) {
      throw new RouteError(400, "invalid_request", "displayName is required.");
    }
    const key = normalizeManagedKey(payload.key?.trim() || displayName, kind.slice(0, -1));
    const id = payload.id?.trim() || `${kind.slice(0, -1)}_${randomUUID()}`;
    const workspaceIds = Array.from(new Set((payload.workspaceIds ?? []).map((value) => value.trim()).filter(Boolean)));
    for (const workspaceId of workspaceIds) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
    }
    const item = kindConfig[kind].itemRepo.upsert({
      auth: payload.auth ?? null,
      cloudItemId: payload.cloudItemId ?? null,
      config: payload.config ?? {},
      displayName,
      id,
      key,
      metadata: payload.metadata ?? null,
      source: payload.source ?? "aiwork_managed",
    });
    if (payload.workspaceIds) {
      const currentAssignments = kindConfig[kind].assignmentRepo.listForItem(item.id).map((assignment) => assignment.workspaceId);
      for (const workspace of input.repositories.workspaces.list({ includeHidden: true })) {
        const nextAssigned = workspaceIds.includes(workspace.id);
        const currentlyAssigned = currentAssignments.includes(workspace.id);
        if (nextAssigned === currentlyAssigned) {
          continue;
        }
        const currentForWorkspace = kindConfig[kind].assignmentRepo.listForWorkspace(workspace.id).map((assignment) => assignment.itemId);
        const nextForWorkspace = nextAssigned
          ? Array.from(new Set([...currentForWorkspace, item.id]))
          : currentForWorkspace.filter((candidate) => candidate !== item.id);
        kindConfig[kind].assignmentRepo.replaceAssignments(workspace.id, nextForWorkspace);
      }
    }
    return summaryForKind(kind, item);
  }

  async function updateAssignments(kind: ManagedKind, itemId: string, workspaceIds: string[]) {
    const item = kindConfig[kind].itemRepo.getById(itemId);
    if (!item) {
      throw new HTTPException(404, { message: `${kind} item not found: ${itemId}` });
    }
    const normalizedWorkspaceIds = Array.from(new Set(workspaceIds.map((value) => value.trim()).filter(Boolean)));
    for (const workspaceId of normalizedWorkspaceIds) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
    }
    const changedWorkspaceIds = new Set<string>();
    for (const workspace of input.repositories.workspaces.list({ includeHidden: true })) {
      const currentForWorkspace = kindConfig[kind].assignmentRepo.listForWorkspace(workspace.id).map((assignment) => assignment.itemId);
      const currentlyAssigned = currentForWorkspace.includes(itemId);
      const nextAssigned = normalizedWorkspaceIds.includes(workspace.id);
      if (currentlyAssigned === nextAssigned) {
        continue;
      }
      const nextItemIds = nextAssigned
        ? Array.from(new Set([...currentForWorkspace, itemId]))
        : currentForWorkspace.filter((candidate) => candidate !== itemId);
      kindConfig[kind].assignmentRepo.replaceAssignments(workspace.id, nextItemIds);
      changedWorkspaceIds.add(workspace.id);
    }
    await materializeAssignments(kind, Array.from(changedWorkspaceIds), "updated", item.displayName);
    return summaryForKind(kind, item);
  }

  return {
    listManaged(kind: ManagedKind) {
      return kindConfig[kind].itemRepo.list().map((item) => summaryForKind(kind, item));
    },

    createManaged(kind: ManagedKind, payload: Parameters<typeof upsertManaged>[1]) {
      return upsertManaged(kind, payload);
    },

    async deleteManaged(kind: ManagedKind, itemId: string) {
      const item = kindConfig[kind].itemRepo.getById(itemId);
      if (!item) {
        throw new HTTPException(404, { message: `${kind} item not found: ${itemId}` });
      }
      const workspaceIds = kindConfig[kind].assignmentRepo.listForItem(itemId).map((assignment) => assignment.workspaceId);
      kindConfig[kind].assignmentRepo.deleteForItem(itemId);
      kindConfig[kind].itemRepo.deleteById(itemId);
      await materializeAssignments(kind, workspaceIds, "removed", item.displayName);
      return { deleted: true, id: itemId };
    },

    updateManaged(kind: ManagedKind, itemId: string, payload: Omit<Parameters<typeof upsertManaged>[1], "id">) {
      const existing = kindConfig[kind].itemRepo.getById(itemId);
      if (!existing) {
        throw new HTTPException(404, { message: `${kind} item not found: ${itemId}` });
      }
      return upsertManaged(kind, {
        auth: payload.auth ?? existing.auth,
        cloudItemId: payload.cloudItemId ?? existing.cloudItemId,
        config: payload.config ?? existing.config,
        displayName: payload.displayName || existing.displayName,
        id: itemId,
        key: payload.key ?? existing.key,
        metadata: payload.metadata ?? existing.metadata,
        source: payload.source ?? existing.source,
        workspaceIds: payload.workspaceIds,
      });
    },

    updateAssignments,

    listWorkspaceMcp(workspaceId: string) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      return kindConfig.mcps.assignmentRepo.listForWorkspace(workspaceId)
        .map((assignment) => input.repositories.mcps.getById(assignment.itemId))
        .filter(Boolean)
        .map((item) => ({
          config: item!.config,
          name: item!.key ?? item!.displayName,
          source: "config.project" as const,
        }));
    },

    async addWorkspaceMcp(workspaceId: string, payload: { config: Record<string, unknown>; name: string }) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      validateMcpName(payload.name);
      validateMcpConfig(payload.config);
      const key = normalizeManagedKey(payload.name, "mcp");
      const existing = this.listManaged("mcps").find((item) => item.key === key && item.workspaceIds.includes(workspaceId)) ?? null;
      const item = upsertManaged("mcps", {
        config: payload.config,
        displayName: payload.name,
        id: existing?.id,
        key,
        metadata: { workspaceId },
        workspaceIds: [workspace.id],
      });
      await materializeAssignments("mcps", [workspaceId], existing ? "updated" : "added", item.displayName);
      return { items: this.listWorkspaceMcp(workspaceId) };
    },

    async removeWorkspaceMcp(workspaceId: string, name: string) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const key = normalizeManagedKey(name, "mcp");
      const assignment = this.listManaged("mcps").find((item) => item.key === key && item.workspaceIds.includes(workspaceId)) ?? null;
      if (!assignment) {
        return { items: this.listWorkspaceMcp(workspaceId) };
      }
      const nextWorkspaceIds = assignment.workspaceIds.filter((candidate) => candidate !== workspaceId);
      if (nextWorkspaceIds.length === 0) {
        await this.deleteManaged("mcps", assignment.id);
      } else {
        await updateAssignments("mcps", assignment.id, nextWorkspaceIds);
      }
      return { items: this.listWorkspaceMcp(workspaceId) };
    },

    listWorkspacePlugins(workspaceId: string) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const items = kindConfig.plugins.assignmentRepo.listForWorkspace(workspaceId)
        .map((assignment) => input.repositories.plugins.getById(assignment.itemId))
        .filter(Boolean)
        .map((item) => ({
          scope: "project" as const,
          source: "config" as const,
          spec: typeof asObject(item!.config).spec === "string" ? String(asObject(item!.config).spec) : item!.displayName,
        }));
      return { items, loadOrder: ["config.global", "config.project", "dir.global", "dir.project"] };
    },

    async addWorkspacePlugin(workspaceId: string, spec: string) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const normalizedSpec = spec.trim();
      if (!normalizedSpec) {
        throw new RouteError(400, "invalid_request", "Plugin spec is required.");
      }
      const key = normalizeManagedKey(normalizedSpec.replace(/^file:/, ""), "plugin");
      const existing = this.listManaged("plugins").find((item) => item.key === key && item.workspaceIds.includes(workspaceId)) ?? null;
      const item = upsertManaged("plugins", {
        config: { spec: normalizedSpec },
        displayName: normalizedSpec,
        id: existing?.id,
        key,
        metadata: { workspaceId },
        workspaceIds: [workspace.id],
      });
      await materializeAssignments("plugins", [workspaceId], existing ? "updated" : "added", item.displayName);
      return this.listWorkspacePlugins(workspaceId);
    },

    async removeWorkspacePlugin(workspaceId: string, spec: string) {
      ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const key = normalizeManagedKey(spec.replace(/^file:/, ""), "plugin");
      const assignment = this.listManaged("plugins").find((item) => item.key === key && item.workspaceIds.includes(workspaceId)) ?? null;
      if (!assignment) {
        return this.listWorkspacePlugins(workspaceId);
      }
      const nextWorkspaceIds = assignment.workspaceIds.filter((candidate) => candidate !== workspaceId);
      if (nextWorkspaceIds.length === 0) {
        await this.deleteManaged("plugins", assignment.id);
      } else {
        await updateAssignments("plugins", assignment.id, nextWorkspaceIds);
      }
      return this.listWorkspacePlugins(workspaceId);
    },

    listWorkspaceSkills(workspaceId: string) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      return kindConfig.skills.assignmentRepo.listForWorkspace(workspaceId)
        .map((assignment) => input.repositories.skills.getById(assignment.itemId))
        .filter(Boolean)
        .map((item) => ({
          description: typeof asObject(item!.metadata).description === "string" ? String(asObject(item!.metadata).description) : item!.displayName,
          name: item!.key ?? item!.displayName,
          path: workspaceSkillPath(workspace, item!.key ?? item!.id),
          scope: "project" as const,
          trigger: typeof asObject(item!.metadata).trigger === "string" ? String(asObject(item!.metadata).trigger) : undefined,
        }));
    },

    getWorkspaceSkill(workspaceId: string, name: string) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const normalized = normalizeManagedKey(name, "skill");
      const skill = this.listManaged("skills").find((item) => managedSkillMatchesWorkspaceQuery(item, workspaceId, normalized)) ?? null;
      if (!skill) {
        throw new HTTPException(404, { message: `Skill not found: ${name}` });
      }
      const content = typeof asObject(skill.config).content === "string" ? String(asObject(skill.config).content) : "";
      return {
        content,
        item: {
          description: typeof asObject(skill.metadata).description === "string" ? String(asObject(skill.metadata).description) : skill.displayName,
          name: skill.key ?? skill.displayName,
          path: workspaceSkillPath(workspace, skill.key ?? skill.id),
          scope: "project" as const,
          trigger: typeof asObject(skill.metadata).trigger === "string" ? String(asObject(skill.metadata).trigger) : undefined,
        },
      };
    },

    async upsertWorkspaceSkill(workspaceId: string, payload: {
      cloudItemId?: string | null;
      content: string;
      description?: string;
      metadata?: JsonObject | null;
      name: string;
      source?: ManagedConfigRecord["source"];
      trigger?: string;
    }) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      validateSkillName(payload.name);
      if (!payload.content.trim()) {
        throw new RouteError(400, "invalid_request", "Skill content is required.");
      }
      const parsed = parseFrontmatter(payload.content);
      const frontmatterName = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
      if (frontmatterName && frontmatterName !== payload.name) {
        throw new RouteError(400, "invalid_request", "Skill frontmatter name must match payload name.");
      }
      const nextDescription = normalizeString(parsed.data.description) || normalizeString(payload.description) || payload.name;
      const trigger = normalizeString(parsed.data.trigger) || normalizeString(parsed.data.when) || normalizeString(payload.trigger) || extractTriggerFromBody(parsed.body);
      const content = Object.keys(parsed.data).length > 0
        ? `${buildFrontmatter({ ...parsed.data, description: nextDescription, name: payload.name })}${parsed.body.replace(/^\n/, "")}`
        : `${buildFrontmatter({ description: nextDescription, name: payload.name, ...(trigger ? { trigger } : {}) })}${payload.content.replace(/^\n/, "")}`;
      const existing = this.listManaged("skills").find((item) => item.key === payload.name && item.workspaceIds.includes(workspaceId)) ?? null;
      const nextMetadata = {
        ...(existing?.metadata ?? {}),
        ...(payload.metadata ?? {}),
        description: nextDescription,
        trigger,
        workspaceId,
      } satisfies JsonObject;
      const item = upsertManaged("skills", {
        cloudItemId: payload.cloudItemId ?? existing?.cloudItemId ?? null,
        config: { content: content.endsWith("\n") ? content : `${content}\n` },
        displayName: payload.name,
        id: existing?.id,
        key: payload.name,
        metadata: nextMetadata,
        source: payload.source ?? existing?.source ?? "aiwork_managed",
        workspaceIds: [workspace.id],
      });
      await materializeAssignments("skills", [workspaceId], existing ? "updated" : "added", item.displayName);
      return this.getWorkspaceSkill(workspaceId, payload.name).item;
    },

    async deleteWorkspaceSkill(workspaceId: string, name: string) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      const normalized = normalizeManagedKey(name, "skill");
      const assignment = this.listManaged("skills").find((item) => managedSkillMatchesWorkspaceQuery(item, workspaceId, normalized)) ?? null;
      if (!assignment) {
        throw new HTTPException(404, { message: `Skill not found: ${name}` });
      }
      const nextWorkspaceIds = assignment.workspaceIds.filter((candidate) => candidate !== workspaceId);
      if (nextWorkspaceIds.length === 0) {
        await this.deleteManaged("skills", assignment.id);
      } else {
        await updateAssignments("skills", assignment.id, nextWorkspaceIds);
      }
      const pathKey = normalizeManagedKey(assignment.key ?? assignment.displayName ?? name, "skill");
      return { path: workspaceSkillPath(workspace, pathKey).replace(/[/\\]SKILL\.md$/, "") };
    },

    async listHubSkills(repo?: Partial<HubRepo>) {
      const resolvedRepo: HubRepo = {
        owner: normalizeString(repo?.owner) || DEFAULT_HUB_REPO.owner,
        repo: normalizeString(repo?.repo) || DEFAULT_HUB_REPO.repo,
        ref: normalizeString(repo?.ref) || DEFAULT_HUB_REPO.ref,
      };
      const listing = await fetch(`https://api.github.com/repos/${encodeURIComponent(resolvedRepo.owner)}/${encodeURIComponent(resolvedRepo.repo)}/contents/skills?ref=${encodeURIComponent(resolvedRepo.ref)}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "aiwork-server-v2" },
      });
      if (!listing.ok) {
        throw new RouteError(502, "bad_gateway", `Failed to fetch hub catalog (${listing.status}).`);
      }
      const items = await listing.json() as Array<Record<string, unknown>>;
      const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(resolvedRepo.owner)}/${encodeURIComponent(resolvedRepo.repo)}/${encodeURIComponent(resolvedRepo.ref)}`;
      const result: Array<{ description: string; name: string; source: { owner: string; path: string; ref: string; repo: string }; trigger?: string }> = [];
      for (const entry of Array.isArray(items) ? items : []) {
        const name = typeof entry?.name === "string" ? entry.name.trim() : "";
        const type = typeof entry?.type === "string" ? entry.type : "";
        if (!name || type !== "dir") {
          continue;
        }
        try {
          const content = await fetch(`${rawBase}/skills/${encodeURIComponent(name)}/SKILL.md`, {
            headers: { Accept: "text/plain", "User-Agent": "aiwork-server-v2" },
          }).then((response) => response.ok ? response.text() : "");
          if (!content) {
            continue;
          }
          const parsed = parseFrontmatter(content);
          const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
          const trigger = typeof parsed.data.trigger === "string" ? parsed.data.trigger : extractTriggerFromBody(parsed.body);
          result.push({
            description,
            name,
            source: { owner: resolvedRepo.owner, path: `skills/${name}`, ref: resolvedRepo.ref, repo: resolvedRepo.repo },
            ...(trigger ? { trigger } : {}),
          });
        } catch {
          // ignore individual skill failures
        }
      }
      result.sort((left, right) => left.name.localeCompare(right.name));
      return { items: result };
    },

    async installHubSkill(workspaceId: string, inputValue: { name: string; overwrite?: boolean; repo?: Partial<HubRepo> }) {
      const workspace = ensureWorkspaceMutable(getWorkspaceOrThrow(workspaceId));
      validateSkillName(inputValue.name);
      const repo: HubRepo = {
        owner: normalizeString(inputValue.repo?.owner) || DEFAULT_HUB_REPO.owner,
        repo: normalizeString(inputValue.repo?.repo) || DEFAULT_HUB_REPO.repo,
        ref: normalizeString(inputValue.repo?.ref) || DEFAULT_HUB_REPO.ref,
      };
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodeURIComponent(repo.ref)}/skills/${encodeURIComponent(inputValue.name)}/SKILL.md`;
      const response = await fetch(rawUrl, {
        headers: { Accept: "text/plain", "User-Agent": "aiwork-server-v2" },
      });
      if (!response.ok) {
        throw new RouteError(404, "not_found", `Hub skill not found: ${inputValue.name}`);
      }
      const content = await response.text();
      const existing = this.listManaged("skills").find((item) => item.key === inputValue.name && item.workspaceIds.includes(workspaceId)) ?? null;
      if (existing && inputValue.overwrite !== true) {
        return { action: "updated" as const, name: inputValue.name, path: workspaceSkillPath(workspace, inputValue.name).replace(/[/\\]SKILL\.md$/, ""), skipped: 1, written: 0 };
      }
      const parsed = parseFrontmatter(content);
      const description = typeof parsed.data.description === "string" ? parsed.data.description : inputValue.name;
      const trigger = typeof parsed.data.trigger === "string" ? parsed.data.trigger : extractTriggerFromBody(parsed.body);
      await this.upsertWorkspaceSkill(workspaceId, {
        content,
        description,
        metadata: {
          description,
          install: {
            kind: "hub",
            owner: repo.owner,
            path: `skills/${inputValue.name}`,
            ref: repo.ref,
            repo: repo.repo,
            url: rawUrl,
          },
          trigger,
          workspaceId,
        },
        name: inputValue.name,
        source: "imported",
        trigger,
      });
      return { action: existing ? "updated" as const : "added" as const, name: inputValue.name, path: workspaceSkillPath(workspace, inputValue.name).replace(/[/\\]SKILL\.md$/, ""), skipped: 0, written: 1 };
    },

  };
}
