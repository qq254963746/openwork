import * as React from "react";

import { applyEdits, modify } from "jsonc-parser";

import { t } from "../../../../i18n";
import type {
  Client,
  HubSkillCard,
  HubSkillRepo,
  PluginScope,
  ReloadReason,
  ReloadTrigger,
  SkillCard,
} from "../../../../app/types";
import { addAiWorkEngineCacheHint, normalizeDirectoryPath } from "../../../../app/utils";
import skillCreatorTemplate from "../../../../app/data/skill-creator.md?raw";
import {
  isPluginInstalled,
  loadPluginsFromConfig as loadPluginsFromConfigHelpers,
  parsePluginListFromContent,
  stripPluginVersion,
} from "../../../../app/utils/plugins";
import {
  ensureDirExist,
  importSkill,
  installSkillTemplate,
  joinDesktopPath,
  listLocalSkills,
  openDesktopPath,
  pickDirectory,
  readLocalSkill,
  readAiWorkEngineConfig,
  revealDesktopItemInDir,
  uninstallSkill as uninstallSkillCommand,
  workspaceAiWorkRead,
  writeLocalSkill,
  writeAiWorkEngineConfig,
  type AiWorkEngineConfigFile,
} from "../../../../app/lib/desktop";
import {
  AiWorkServerError,
  type AiWorkHubRepo,
  type AiWorkServerCapabilities,
  type AiWorkServerClient,
  type AiWorkServerStatus,
} from "../../../../app/lib/aiwork-server";
import {
  readWorkspaceCloudImports,
  type CloudImportedPlugin,
  type CloudImportedSkill,
  type CloudImportedSkillHub,
} from "../../../../app/cloud/import-state";
import type { AiWorkServerStore } from "../../connections/aiwork-server-store";

const DEFAULT_HUB_REPO: HubSkillRepo = {
  owner: "anthropic",
  repo: "skills",
  ref: "main",
};
const HUB_REPOS_STORAGE_KEY = "aiwork.skills.hubRepos.v1";

type SetStateAction<T> = T | ((current: T) => T);

type PluginListEntry = {
  name: string;
  source: "config" | "dir.project" | "dir.global";
  removable: boolean;
};

export type ExtensionsStoreSnapshot = {
  workspaceContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  importedCloudSkillHubs: Record<string, CloudImportedSkillHub>;
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
  pluginScope: PluginScope;
  pluginConfig: AiWorkEngineConfigFile | null;
  pluginConfigPath: string | null;
  pluginList: PluginListEntry[];
  pluginInput: string;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  sidebarPluginList: string[];
  sidebarPluginStatus: string | null;
  skillsStale: boolean;
  pluginsStale: boolean;
  hubSkillsStale: boolean;
};

type MutableState = {
  skillsContextKey: string;
  pluginsContextKey: string;
  hubSkillsContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  importedCloudSkillHubs: Record<string, CloudImportedSkillHub>;
  importedCloudPlugins: Record<string, CloudImportedPlugin>;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
  pluginScope: PluginScope;
  pluginConfig: AiWorkEngineConfigFile | null;
  pluginConfigPath: string | null;
  pluginList: PluginListEntry[];
  pluginInput: string;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  sidebarPluginList: string[];
  sidebarPluginStatus: string | null;
};

export type ExtensionsStore = ReturnType<typeof createExtensionsStore>;


function toConfigPluginListEntries(names: string[]): PluginListEntry[] {
  const next: PluginListEntry[] = [];
  const seen = new Set<string>();
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    next.push({ name, source: "config", removable: true });
  }
  return next;
}

function toProjectPluginListEntries(
  items: Array<{ spec: string; source: string }>,
): PluginListEntry[] {
  const byName = new Map<string, PluginListEntry>();
  for (const item of items) {
    const name = item.spec.trim();
    if (!name) continue;
    const source: PluginListEntry["source"] =
      item.source === "dir.project" || item.source === "dir.global"
        ? item.source
        : "config";
    const entry: PluginListEntry = {
      name,
      source,
      removable: source === "config",
    };
    const existing = byName.get(name);
    if (!existing || (entry.removable && !existing.removable)) {
      byName.set(name, entry);
    }
  }
  return [...byName.values()];
}

export function createExtensionsStore(options: {
  client: () => Client | null;
  projectDir: () => string;
  selectedWorkspaceId: () => string;
  selectedWorkspaceRoot: () => string;
  aiworkServer: AiWorkServerStore;
  aiworkServerConnection?: () => {
    aiworkServerClient: AiWorkServerClient | null;
    aiworkServerStatus: AiWorkServerStatus;
    aiworkServerCapabilities: AiWorkServerCapabilities | null;
  };
  runtimeWorkspaceId: () => string | null;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  setError: (value: string | null) => void;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
}) {
  const listeners = new Set<() => void>();

  let disposed = false;
  let started = false;
  let stopAiWorkSubscription: (() => void) | null = null;
  let lastWorkspaceContextKey = "";
  /** Dedupes sync when only AiWork/opencode transport becomes available (workspace key unchanged). */
  let lastSkillsTransportFingerprint = "";
  let snapshot: ExtensionsStoreSnapshot;

  let refreshSkillsInFlight = false;
  let refreshPluginsInFlight = false;
  let refreshHubSkillsInFlight = false;
  let refreshSkillsAborted = false;
  let refreshPluginsAborted = false;
  let refreshHubSkillsAborted = false;
  let skillsLoaded = false;
  let hubSkillsLoaded = false;
  let skillsRoot = "";
  let hubSkillsLoadKey = "";

  let state: MutableState = {
    skillsContextKey: "",
    pluginsContextKey: "",
    hubSkillsContextKey: "",
    skills: [],
    skillsStatus: null,
    hubSkills: [],
    hubSkillsStatus: null,
    importedCloudSkills: {},
    importedCloudSkillHubs: {},
    importedCloudPlugins: {},
    hubRepo: DEFAULT_HUB_REPO,
    hubRepos: [DEFAULT_HUB_REPO],
    pluginScope: "project",
    pluginConfig: null,
    pluginConfigPath: null,
    pluginList: [],
    pluginInput: "",
    pluginStatus: null,
    activePluginGuide: null,
    sidebarPluginList: [],
    sidebarPluginStatus: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getWorkspaceContextKey = () => {
    const workspaceId = options.selectedWorkspaceId().trim();
    const root = normalizeDirectoryPath(options.selectedWorkspaceRoot().trim());
    const runtimeWorkspaceId = (options.runtimeWorkspaceId() ?? "").trim();
    return `local:${workspaceId}:${root}:${runtimeWorkspaceId}`;
  };

  const getAiWorkServerSnapshot = () => {
    const snapshot = options.aiworkServer.getSnapshot();
    const connection = options.aiworkServerConnection?.();
    if (!connection?.aiworkServerClient) return snapshot;
    return {
      ...snapshot,
      aiworkServerClient: connection.aiworkServerClient,
      aiworkServerStatus: connection.aiworkServerStatus,
      aiworkServerCapabilities: connection.aiworkServerCapabilities,
    };
  };

  const refreshSnapshot = () => {
    const workspaceContextKey = getWorkspaceContextKey();
    snapshot = {
      workspaceContextKey,
      skills: state.skills,
      skillsStatus: state.skillsStatus,
      hubSkills: state.hubSkills,
      hubSkillsStatus: state.hubSkillsStatus,
      importedCloudSkills: state.importedCloudSkills,
      importedCloudSkillHubs: state.importedCloudSkillHubs,
      importedCloudPlugins: state.importedCloudPlugins,
      hubRepo: state.hubRepo,
      hubRepos: state.hubRepos,
      pluginScope: state.pluginScope,
      pluginConfig: state.pluginConfig,
      pluginConfigPath: state.pluginConfigPath,
      pluginList: state.pluginList,
      pluginInput: state.pluginInput,
      pluginStatus: state.pluginStatus,
      activePluginGuide: state.activePluginGuide,
      sidebarPluginList: state.sidebarPluginList,
      sidebarPluginStatus: state.sidebarPluginStatus,
      skillsStale: state.skillsContextKey !== workspaceContextKey,
      pluginsStale: state.pluginsContextKey !== workspaceContextKey,
      hubSkillsStale: state.hubSkillsContextKey !== workspaceContextKey,
    };
  };

  function isPluginInstalledByName(pluginName: string, aliases: string[] = []) {
    return isPluginInstalled(
      snapshot.pluginList.map((entry) => entry.name),
      pluginName,
      aliases,
    );
  }

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
    typeof next === "function" ? (next as (value: T) => T)(current) : next;

  const normalizeHubRepo = (input?: Partial<HubSkillRepo> | null): HubSkillRepo | null => {
    const owner = input?.owner?.trim() || "";
    const repo = input?.repo?.trim() || "";
    const ref = input?.ref?.trim() || DEFAULT_HUB_REPO.ref;
    if (!owner || !repo) return null;
    return { owner, repo, ref };
  };

  const hubRepoKey = (repo: HubSkillRepo) => `${repo.owner}/${repo.repo}@${repo.ref}`;

  const normalizeHubRepoList = (items: unknown[]): HubSkillRepo[] => {
    const seen = new Set<string>();
    const next: HubSkillRepo[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const normalized = normalizeHubRepo({
        owner: typeof record.owner === "string" ? record.owner : undefined,
        repo: typeof record.repo === "string" ? record.repo : undefined,
        ref: typeof record.ref === "string" ? record.ref : undefined,
      });
      if (!normalized) continue;
      const key = hubRepoKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(normalized);
    }
    return next;
  };

  const readWorkspaceAiWorkConfigRecord = async (): Promise<Record<string, unknown>> => {
    const root = options.selectedWorkspaceRoot().trim();
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.config?.read;

    if (canUseAiWorkServer) {
      const config = await aiworkClient.getConfig(aiworkWorkspaceId);
      return config.aiwork ?? {};
    }

    if (root) {
      return await workspaceAiWorkRead({ workspacePath: root }) as unknown as Record<string, unknown>;
    }

    return {};
  };

  const refreshImportedCloudSkillHubs = async () => {
    try {
      const config = await readWorkspaceAiWorkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudSkillHubs", cloudImports.skillHubs);
      return cloudImports.skillHubs;
    } catch {
      setStateField("importedCloudSkillHubs", {});
      return {};
    }
  };

  const refreshImportedCloudSkills = async () => {
    try {
      const config = await readWorkspaceAiWorkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudSkills", cloudImports.skills);
      return cloudImports.skills;
    } catch {
      setStateField("importedCloudSkills", {});
      return {};
    }
  };

  const refreshImportedCloudPlugins = async () => {
    try {
      const config = await readWorkspaceAiWorkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudPlugins", cloudImports.plugins);
      return cloudImports.plugins;
    } catch {
      setStateField("importedCloudPlugins", {});
      return {};
    }
  };

  const deleteWorkspaceSkill = async (name: string) => {
    const root = options.selectedWorkspaceRoot().trim();
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.skills?.write;

    if (canUseAiWorkServer) {
      try {
        await aiworkClient.deleteSkill(aiworkWorkspaceId, name);
        return;
      } catch (error) {
        const isNotFound =
          error instanceof AiWorkServerError && error.status === 404;
        if (isNotFound && root) {
          const result = await uninstallSkillCommand(root, name);
          if (!result.ok) {
            throw new Error(result.stderr || result.stdout || t("skills.uninstall_failed"));
          }
          return;
        }
        throw error;
      }
    }

    if (!root) {
      throw new Error(t("skills.pick_workspace_first"));
    }

    const result = await uninstallSkillCommand(root, name);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || t("skills.uninstall_failed"));
    }
  };



  const persistHubRepos = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        HUB_REPOS_STORAGE_KEY,
        JSON.stringify({ selected: state.hubRepo, repos: state.hubRepos }),
      );
    } catch {
      // ignore
    }
  };

  const invalidateWorkspaceCaches = () => {
    skillsLoaded = false;
    hubSkillsLoaded = false;
    skillsRoot = "";
    hubSkillsLoadKey = "";
  };

  const getSkillsTransportFingerprint = () => {
    const root = options.selectedWorkspaceRoot().trim();
    const ow = getAiWorkServerSnapshot();
    const runtimeId = (options.runtimeWorkspaceId() ?? "").trim();
    const canUseAiWorkSkills =
      ow.aiworkServerStatus === "connected" &&
      !!ow.aiworkServerClient &&
      !!runtimeId &&
      !!ow.aiworkServerCapabilities?.skills?.read;
    const hasAiWorkEngineClient = !!options.client();
    return `root:${root}|ow:${canUseAiWorkSkills ? 1 : 0}|dl:1|oc:${hasAiWorkEngineClient ? 1 : 0}`;
  };

  const touch = () => {
    refreshSnapshot();
    emitChange();
  };

  async function refreshHubSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const repo = snapshot.hubRepo;
    const loadKey = `${root}::${repo ? hubRepoKey(repo) : "none"}`;
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkSnapshot.aiworkServerCapabilities?.hub?.skills?.read;

    if (loadKey !== hubSkillsLoadKey) {
      hubSkillsLoaded = false;
    }

    if (!optionsOverride?.force && hubSkillsLoaded) return;
    if (refreshHubSkillsInFlight) return;

    refreshHubSkillsInFlight = true;
    refreshHubSkillsAborted = false;

    try {
      setStateField("hubSkillsStatus", null);

      if (!repo) {
        mutateState((current) => ({
          ...current,
          hubSkills: [],
          hubSkillsStatus: "No hub repo selected. Add a GitHub repo to browse skills.",
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      if (canUseAiWorkServer) {
        const response = await aiworkClient.listHubSkills({
          repo: {
            owner: repo.owner,
            repo: repo.repo,
            ref: repo.ref,
          },
        });
        if (refreshHubSkillsAborted) return;
        const next: HubSkillCard[] = Array.isArray(response?.items)
          ? response.items.map((entry) => ({
              name: String(entry.name ?? ""),
              description: typeof entry.description === "string" ? entry.description : undefined,
              trigger: typeof entry.trigger === "string" ? entry.trigger : undefined,
              source: entry.source,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          hubSkills: next,
          hubSkillsStatus: next.length ? null : "No hub skills found.",
          hubSkillsContextKey: getWorkspaceContextKey(),
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      const listingRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/skills?ref=${encodeURIComponent(repo.ref)}`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!listingRes.ok) {
        throw new Error(`Failed to fetch hub catalog (${listingRes.status})`);
      }
      const listing = (await listingRes.json()) as unknown;
      const dirs: string[] = Array.isArray(listing)
        ? listing
            .filter((entry) => entry && typeof entry === "object" && (entry as { type?: string }).type === "dir")
            .map((entry) => String((entry as { name?: string }).name ?? ""))
            .filter(Boolean)
        : [];

      const next: HubSkillCard[] = dirs.map((dirName) => ({
        name: dirName,
        source: { owner: repo.owner, repo: repo.repo, ref: repo.ref, path: `skills/${dirName}` },
      }));

      if (refreshHubSkillsAborted) return;
      const sorted = next.slice().sort((a, b) => a.name.localeCompare(b.name));
      mutateState((current) => ({
        ...current,
        hubSkills: sorted,
        hubSkillsStatus: sorted.length ? null : "No hub skills found.",
        hubSkillsContextKey: getWorkspaceContextKey(),
      }));
      hubSkillsLoaded = true;
      hubSkillsLoadKey = loadKey;
    } catch (error) {
      if (refreshHubSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        hubSkills: [],
        hubSkillsStatus: error instanceof Error ? error.message : "Failed to load hub skills.",
      }));
    } finally {
      refreshHubSkillsInFlight = false;
    }
  }



  async function installHubSkill(name: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Skill name is required." };
    const repo = snapshot.hubRepo;
    if (!repo) return { ok: false, message: "Select a hub repo before installing skills." };

    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.hub?.skills?.install;

    if (!canUseAiWorkServer) {
      return { ok: false, message: "Hub install requires AiWork server." };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const repoOverride: AiWorkHubRepo = { owner: repo.owner, repo: repo.repo, ref: repo.ref };
      const result = await aiworkClient.installHubSkill(aiworkWorkspaceId, trimmed, { repo: repoOverride });
      await refreshSkills({ force: true });
      await refreshHubSkills({ force: true });
      if (!result?.ok) return { ok: false, message: "Install failed." };
      return { ok: true, message: `Installed ${trimmed}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addAiWorkEngineCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function refreshSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.skills?.read;

    if (!root) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: t("skills.pick_workspace_first"),
      }));
      return;
    }

    if (canUseAiWorkServer) {
      if (root !== skillsRoot) skillsLoaded = false;
      if (!optionsOverride?.force && skillsLoaded) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const response = await aiworkClient.listSkills(aiworkWorkspaceId, { includeGlobal: true });
        if (refreshSkillsAborted) return;
        let next: SkillCard[] = Array.isArray(response.items)
          ? response.items.map((entry) => ({
              name: entry.name,
              description: entry.description,
              path: entry.path,
              trigger: entry.trigger,
            }))
          : [];

        // Server can briefly return an empty catalog while the engine/workspace warms up.
        // Desktop host can still see skills on disk — fall back so the UI isn't stuck until manual refresh.
        if (next.length === 0 && root) {
          try {
            const local = await listLocalSkills(root);
            if (refreshSkillsAborted) return;
            if (Array.isArray(local) && local.length > 0) {
              next = local.map((entry) => ({
                name: entry.name,
                description: entry.description,
                path: entry.path,
                trigger: entry.trigger,
              }));
            }
          } catch {
            // keep empty AiWork result
          }
        }

        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = root;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    if (root !== skillsRoot) skillsLoaded = false;
    if (!optionsOverride?.force && skillsLoaded) return;
    if (refreshSkillsInFlight) return;

    refreshSkillsInFlight = true;
    refreshSkillsAborted = false;
    try {
      setStateField("skillsStatus", null);
      const local = await listLocalSkills(root);
      if (refreshSkillsAborted) return;
      const next: SkillCard[] = Array.isArray(local)
        ? local.map((entry) => ({
            name: entry.name,
            description: entry.description,
            path: entry.path,
            trigger: entry.trigger,
          }))
        : [];
      mutateState((current) => ({
        ...current,
        skills: next,
        skillsStatus: next.length ? null : t("skills.no_skills_found"),
        skillsContextKey: getWorkspaceContextKey(),
      }));
      skillsLoaded = true;
      skillsRoot = root;
    } catch (error) {
      if (refreshSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
      }));
    } finally {
      refreshSkillsInFlight = false;
    }
  }

  async function refreshPlugins(scopeOverride?: PluginScope) {
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.plugins?.read;

    if (refreshPluginsInFlight) return;
    refreshPluginsInFlight = true;
    refreshPluginsAborted = false;

    const scope = scopeOverride ?? snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope === "project" && canUseAiWorkServer) {
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: "opencode.json (aiwork server)",
      }));

      try {
        mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
        if (refreshPluginsAborted) return;
        const result = await aiworkClient.listPlugins(aiworkWorkspaceId, { includeGlobal: false });
        if (refreshPluginsAborted) return;
        const projectItems = result.items.filter((item) => item.scope === "project");
        const list = toProjectPluginListEntries(projectItems);
        mutateState((current) => ({
          ...current,
          pluginList: list,
          sidebarPluginList: list.map((entry) => entry.name),
          pluginStatus: list.length ? null : "No plugins configured yet.",
          sidebarPluginStatus: null,
          pluginsContextKey: getWorkspaceContextKey(),
        }));
      } catch (error) {
        if (refreshPluginsAborted) return;
        mutateState((current) => ({
          ...current,
          pluginList: [],
          sidebarPluginList: [],
          sidebarPluginStatus: "Failed to load plugins.",
          pluginStatus: error instanceof Error ? error.message : "Failed to load plugins.",
        }));
      } finally {
        refreshPluginsInFlight = false;
      }
      return;
    }

    if (scope === "project" && !targetDir) {
      mutateState((current) => ({
        ...current,
        pluginStatus: t("skills.pick_project_for_plugins"),
        pluginList: [],
        sidebarPluginStatus: t("skills.pick_project_for_active"),
        sidebarPluginList: [],
      }));
      refreshPluginsInFlight = false;
      return;
    }

    try {
      mutateState((current) => ({ ...current, pluginStatus: null, sidebarPluginStatus: null }));
      if (refreshPluginsAborted) return;
      const config = await readAiWorkEngineConfig(scope, targetDir);
      if (refreshPluginsAborted) return;
      mutateState((current) => ({ ...current, pluginConfig: config, pluginConfigPath: config.path ?? null }));

      if (!config.exists) {
        mutateState((current) => ({
          ...current,
          pluginList: [],
          pluginStatus: t("skills.no_opencode_found"),
          sidebarPluginList: [],
          sidebarPluginStatus: t("skills.no_opencode_workspace"),
        }));
        return;
      }

      let nextSidebarPluginList: string[] = [];
      let nextSidebarPluginStatus: string | null = null;
      try {
        nextSidebarPluginList = parsePluginListFromContent(config.content ?? "");
      } catch {
        nextSidebarPluginList = [];
        nextSidebarPluginStatus = t("skills.failed_parse_opencode");
      }

      const nextPluginNames: string[] = [];
      let nextPluginStatus: string | null = null;
      loadPluginsFromConfigHelpers(
        config,
        (value) => {
          nextPluginNames.splice(0, nextPluginNames.length, ...applyStateAction(nextPluginNames, value));
        },
        (message) => {
          nextPluginStatus = message;
        },
      );

      mutateState((current) => ({
        ...current,
        pluginList: toConfigPluginListEntries(nextPluginNames),
        pluginStatus: nextPluginStatus,
        sidebarPluginList: nextSidebarPluginList,
        sidebarPluginStatus: nextSidebarPluginStatus,
        pluginsContextKey: getWorkspaceContextKey(),
      }));
    } catch (error) {
      if (refreshPluginsAborted) return;
      mutateState((current) => ({
        ...current,
        pluginConfig: null,
        pluginConfigPath: null,
        pluginList: [],
        pluginStatus: error instanceof Error ? error.message : t("skills.failed_load_opencode"),
        sidebarPluginStatus: t("skills.failed_load_active"),
        sidebarPluginList: [],
      }));
    } finally {
      refreshPluginsInFlight = false;
    }
  }

  async function addPlugin(pluginNameOverride?: string) {
    const pluginName = (pluginNameOverride ?? snapshot.pluginInput).trim();
    const isManualInput = pluginNameOverride == null;
    const triggerName = stripPluginVersion(pluginName);

    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.plugins?.write;

    if (!pluginName) {
      if (isManualInput) setStateField("pluginStatus", t("skills.enter_plugin_name"));
      return;
    }

    if (snapshot.pluginScope === "project" && canUseAiWorkServer) {
      try {
        setStateField("pluginStatus", null);
        await aiworkClient.addPlugin(aiworkWorkspaceId, pluginName);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", error instanceof Error ? error.message : "Failed to add plugin.");
      }
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();

    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = await readAiWorkEngineConfig(scope, targetDir);
      const raw = config.content ?? "";

      if (!raw.trim()) {
        const payload = { $schema: "https://www.aiwork.love/config.json", plugin: [pluginName] };
        await writeAiWorkEngineConfig(scope, targetDir, `${JSON.stringify(payload, null, 2)}\n`);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
        if (isManualInput) setStateField("pluginInput", "");
        await refreshPlugins(scope);
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(pluginName).toLowerCase();
      if (plugins.some((entry) => stripPluginVersion(entry).toLowerCase() === desired)) {
        setStateField("pluginStatus", t("skills.plugin_already_listed"));
        return;
      }

      const next = [...plugins, pluginName];
      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeAiWorkEngineConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "added" });
      if (isManualInput) setStateField("pluginInput", "");
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", error instanceof Error ? error.message : t("skills.failed_update_opencode"));
    }
  }

  async function removePlugin(pluginName: string) {
    const name = pluginName.trim();
    if (!name) return;
    const triggerName = stripPluginVersion(name);
    const existingPlugin = snapshot.pluginList.find((entry) => entry.name === name);
    if (existingPlugin && !existingPlugin.removable) {
      setStateField("pluginStatus", "Directory-discovered plugins are read-only.");
      return;
    }

    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.plugins?.write;

    if (snapshot.pluginScope === "project" && canUseAiWorkServer) {
      try {
        setStateField("pluginStatus", null);
        await aiworkClient.removePlugin(aiworkWorkspaceId, name);
        options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
        await refreshPlugins("project");
      } catch (error) {
        setStateField("pluginStatus", error instanceof Error ? error.message : "Failed to remove plugin.");
      }
      return;
    }

    const scope = snapshot.pluginScope;
    const targetDir = options.projectDir().trim();
    if (scope === "project" && !targetDir) {
      setStateField("pluginStatus", t("skills.pick_project_for_plugins"));
      return;
    }

    try {
      setStateField("pluginStatus", null);
      const config = await readAiWorkEngineConfig(scope, targetDir);
      const raw = config.content ?? "";
      if (!raw.trim()) {
        setStateField("pluginStatus", "No plugins configured yet.");
        return;
      }

      const plugins = parsePluginListFromContent(raw);
      const desired = stripPluginVersion(name).toLowerCase();
      const next = plugins.filter((entry) => stripPluginVersion(entry).toLowerCase() !== desired);
      if (next.length === plugins.length) {
        setStateField("pluginStatus", "Plugin not found.");
        return;
      }

      const edits = modify(raw, ["plugin"], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
      const updated = applyEdits(raw, edits);
      await writeAiWorkEngineConfig(scope, targetDir, updated);
      options.markReloadRequired?.("plugins", { type: "plugin", name: triggerName, action: "removed" });
      await refreshPlugins(scope);
    } catch (error) {
      setStateField("pluginStatus", error instanceof Error ? error.message : t("skills.failed_update_opencode"));
    }
  }

  async function importLocalSkill() {
    const targetDir = options.projectDir().trim();
    if (!targetDir) {
      options.setError(t("skills.pick_project_first"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const selection = await pickDirectory({ title: t("skills.select_skill_folder") });
      const sourceDir = typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!sourceDir) return;
      const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop();
      const result = await importSkill(targetDir, sourceDir, { overwrite: false });
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.import_failed").replace("{status}", String(result.status)));
      } else {
        setStateField("skillsStatus", result.stdout || t("skills.imported"));
        options.markReloadRequired?.("skills", { type: "skill", name: inferredName, action: "added" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addAiWorkEngineCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function installSkillCreator(): Promise<{ ok: boolean; message: string }> {
    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.skills?.write;

    if (canUseAiWorkServer) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", t("skills.installing_skill_creator"));
      try {
        await aiworkClient.upsertSkill(aiworkWorkspaceId, { name: "skill-creator", content: skillCreatorTemplate });
        const message = t("skills.skill_creator_installed");
        setStateField("skillsStatus", message);
        options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
        await refreshSkills({ force: true });
        return { ok: true, message };
      } catch (error) {
        const raw = error instanceof Error ? error.message : t("skills.unknown_error");
        const message = addAiWorkEngineCacheHint(raw);
        setStateField("skillsStatus", message);
        options.setError(message);
        return { ok: false, message };
      } finally {
        options.setBusy(false);
      }
    }

    const targetDir = options.selectedWorkspaceRoot().trim();
    if (!targetDir) {
      const message = t("skills.pick_workspace_first");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", t("skills.installing_skill_creator"));
    try {
      const result = await installSkillTemplate(targetDir, "skill-creator", skillCreatorTemplate, { overwrite: false });
      if (!result.ok && /already exists/i.test(result.stderr)) {
        const message = t("skills.skill_creator_already_installed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: true, message };
      }
      if (!result.ok) {
        const message = result.stderr || result.stdout || t("skills.install_failed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: false, message };
      }
      const message = result.stdout || t("skills.skill_creator_installed");
      setStateField("skillsStatus", message);
      options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
      await refreshSkills({ force: true });
      return { ok: true, message };
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("skills.unknown_error");
      const message = addAiWorkEngineCacheHint(raw);
      setStateField("skillsStatus", message);
      options.setError(message);
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    try {
      const opencodeSkills = await joinDesktopPath(root, ".opencode", "skills");
      const tryOpen = async (target: string) => {
        try {
          await openDesktopPath(target);
          return true;
        } catch {
          return false;
        }
      };
      
      // 确保目录存在，不存在则创建
      try {
        await ensureDirExist(opencodeSkills);
      } catch (error) {
        setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.create_dir_failed"));
        return;
      }

      if (await tryOpen(opencodeSkills)) return;
      await revealDesktopItemInDir(opencodeSkills);
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.reveal_failed"));
    }
  }

  async function uninstallSkill(name: string) {
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      await deleteWorkspaceSkill(trimmed);
      setStateField("skillsStatus", t("skills.uninstalled"));
      options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "removed" });
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      setStateField("skillsStatus", message);
      options.setError(addAiWorkEngineCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function readSkill(name: string): Promise<{ name: string; path: string; content: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return null;
    }

    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.skills?.read;

    if (canUseAiWorkServer) {
      try {
        setStateField("skillsStatus", null);
        const result = await aiworkClient.getSkill(aiworkWorkspaceId, trimmed, { includeGlobal: true });
        return { name: result.item.name, path: result.item.path, content: result.content };
      } catch (error) {
        setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
        return null;
      }
    }

    try {
      setStateField("skillsStatus", null);
      const result = await readLocalSkill(root, trimmed);
      return { name: trimmed, path: result.path, content: result.content };
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
      return null;
    }
  }

  async function saveSkill(input: { name: string; content: string; description?: string }) {
    const trimmed = input.name.trim();
    if (!trimmed) return;
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    const aiworkSnapshot = getAiWorkServerSnapshot();
    const aiworkClient = aiworkSnapshot.aiworkServerClient;
    const aiworkWorkspaceId = options.runtimeWorkspaceId();
    const canUseAiWorkServer =
      aiworkSnapshot.aiworkServerStatus === "connected" &&
      aiworkClient &&
      aiworkWorkspaceId &&
      aiworkSnapshot.aiworkServerCapabilities?.skills?.write;

    if (canUseAiWorkServer) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        await aiworkClient.upsertSkill(aiworkWorkspaceId, {
          name: trimmed,
          content: input.content,
          description: input.description,
        });
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        await refreshSkills({ force: true });
        setStateField("skillsStatus", "Saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : t("skills.unknown_error");
        options.setError(addAiWorkEngineCacheHint(message));
      } finally {
        options.setBusy(false);
      }
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const result = await writeLocalSkill(root, trimmed, input.content);
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.unknown_error"));
      } else {
        setStateField("skillsStatus", result.stdout || "Saved.");
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addAiWorkEngineCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  function abortRefreshes() {
    refreshSkillsAborted = true;
    refreshPluginsAborted = true;
    refreshHubSkillsAborted = true;
  }

  function ensureSkillsFresh() {
    if (!snapshot.skillsStale) return;
    void refreshSkills({ force: true });
  }

  function ensurePluginsFresh(scopeOverride?: PluginScope) {
    if (!snapshot.pluginsStale) return;
    void refreshPlugins(scopeOverride);
  }

  function ensureHubSkillsFresh() {
    if (!snapshot.hubSkillsStale) return;
    void refreshHubSkills({ force: true });
  }

  const setHubRepo = (repoInput: Partial<HubSkillRepo> | null, optionsOverride?: { remember?: boolean }) => {
    const next = normalizeHubRepo(repoInput);
    mutateState((current) => ({ ...current, hubRepo: next }));
    hubSkillsLoaded = false;
    if (optionsOverride?.remember === false || !next) {
      persistHubRepos();
      return;
    }
    mutateState((current) => {
      const seen = new Set<string>();
      const merged = [next, ...current.hubRepos];
      const deduped: HubSkillRepo[] = [];
      for (const item of merged) {
        const key = hubRepoKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      return { ...current, hubRepos: deduped };
    });
    persistHubRepos();
  };

  const addHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const next = normalizeHubRepo(repoInput);
    if (!next) return;
    setHubRepo(next);
  };

  const removeHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const target = normalizeHubRepo(repoInput);
    if (!target) return;
    const targetKey = hubRepoKey(target);
    const nextRepos = snapshot.hubRepos.filter((item) => hubRepoKey(item) !== targetKey);
    mutateState((current) => ({ ...current, hubRepos: nextRepos }));
    const activeRepo = snapshot.hubRepo;
    if (activeRepo && hubRepoKey(activeRepo) === targetKey) {
      mutateState((current) => ({
        ...current,
        hubRepo: nextRepos[0] ?? null,
        hubSkills: nextRepos.length ? current.hubSkills : [],
        hubSkillsStatus: nextRepos.length ? current.hubSkillsStatus : "No hub repo selected. Add a GitHub repo to browse skills.",
      }));
      hubSkillsLoaded = false;
      if (!nextRepos.length) {
        hubSkillsLoadKey = "";
      }
    }
    persistHubRepos();
  };

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;

    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(HUB_REPOS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { selected?: unknown; repos?: unknown[]; custom?: unknown[] };
          const storedRepos = Array.isArray(parsed?.repos)
            ? normalizeHubRepoList(parsed.repos)
            : Array.isArray(parsed?.custom)
              ? normalizeHubRepoList(parsed.custom)
              : [];
          const selected = parsed?.selected && typeof parsed.selected === "object"
            ? normalizeHubRepo(parsed.selected as Partial<HubSkillRepo>)
            : null;
          const selectedKey = selected ? hubRepoKey(selected) : null;
          const hasSelected = selectedKey ? storedRepos.some((item) => hubRepoKey(item) === selectedKey) : false;
          const nextRepos = selected && !hasSelected ? [selected, ...storedRepos] : storedRepos;
          mutateState((current) => ({
            ...current,
            hubRepos: nextRepos.length ? nextRepos : current.hubRepos,
            hubRepo: selected && nextRepos.length ? selected : nextRepos[0] ?? current.hubRepo,
          }));
        }
      } catch {
        // ignore
      }
    }

    stopAiWorkSubscription = options.aiworkServer.subscribe(() => {
      syncFromOptions();
    });

    syncFromOptions();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    lastWorkspaceContextKey = "";
    lastSkillsTransportFingerprint = "";
    abortRefreshes();
    stopAiWorkSubscription?.();
    stopAiWorkSubscription = null;
    listeners.clear();
  };

  const syncFromOptions = () => {
    if (disposed) return;
    const key = getWorkspaceContextKey();
    const transportFp = getSkillsTransportFingerprint();
    if (key === lastWorkspaceContextKey && transportFp === lastSkillsTransportFingerprint) {
      return;
    }
    lastWorkspaceContextKey = key;
    lastSkillsTransportFingerprint = transportFp;
    invalidateWorkspaceCaches();
    touch();
    if (!key || key === "::::") return;
    void refreshSkills({ force: true });
    void refreshPlugins();
    void refreshImportedCloudSkills();
    void refreshImportedCloudSkillHubs();
    void refreshImportedCloudPlugins();
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    skills: () => snapshot.skills,
    skillsStatus: () => snapshot.skillsStatus,
    hubSkills: () => snapshot.hubSkills,
    hubSkillsStatus: () => snapshot.hubSkillsStatus,
    importedCloudSkills: () => snapshot.importedCloudSkills,
    importedCloudSkillHubs: () => snapshot.importedCloudSkillHubs,
    importedCloudPlugins: () => snapshot.importedCloudPlugins,
    hubRepo: () => snapshot.hubRepo,
    hubRepos: () => snapshot.hubRepos,
    get pluginScope() {
      return snapshot.pluginScope;
    },
    setPluginScope(value: SetStateAction<PluginScope>) {
      const resolved = applyStateAction(state.pluginScope, value);
      setStateField("pluginScope", resolved);
    },
    pluginConfig: () => snapshot.pluginConfig,
    pluginConfigPath: () => snapshot.pluginConfigPath,
    pluginList: () => snapshot.pluginList,
    pluginInput: () => snapshot.pluginInput,
    setPluginInput(value: SetStateAction<string>) {
      const resolved = applyStateAction(state.pluginInput, value);
      setStateField("pluginInput", resolved);
    },
    pluginStatus: () => snapshot.pluginStatus,
    activePluginGuide: () => snapshot.activePluginGuide,
    setActivePluginGuide(value: SetStateAction<string | null>) {
      const resolved = applyStateAction(state.activePluginGuide, value);
      setStateField("activePluginGuide", resolved);
    },
    sidebarPluginList: () => snapshot.sidebarPluginList,
    sidebarPluginStatus: () => snapshot.sidebarPluginStatus,
    workspaceContextKey: () => snapshot.workspaceContextKey,
    skillsStale: () => snapshot.skillsStale,
    pluginsStale: () => snapshot.pluginsStale,
    hubSkillsStale: () => snapshot.hubSkillsStale,
    isPluginInstalledByName,
    refreshSkills,
    refreshHubSkills,
    refreshImportedCloudSkills,
    refreshImportedCloudSkillHubs,
    refreshImportedCloudPlugins,
    setHubRepo,
    addHubRepo,
    removeHubRepo,
    refreshPlugins,
    addPlugin,
    removePlugin,
    importLocalSkill,
    installSkillCreator,
    installHubSkill,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
    abortRefreshes,
    ensureSkillsFresh,
    ensurePluginsFresh,
    ensureHubSkillsFresh,
  };
}

export function useExtensionsStoreSnapshot(store: ExtensionsStore) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
