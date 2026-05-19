import type { ModelProviderType } from "../utils/model-providers-catalog";
import { desktopFetch } from "./desktop";
import { ConsoleLog } from "./console-log";
import {
  HttpAiWorkServerClient,
  AiWorkServerError as SdkAiWorkServerError,
  type AiWorkServerCapabilities,
  type AiWorkServerStatus,
  type AiWorkServerDiagnostics,
  type AiWorkRuntimeServiceName,
  type AiWorkRuntimeServiceSnapshot,
  type AiWorkRuntimeSnapshot,
  type AiWorkServerSettings,
  type AiWorkWorkspaceInfo,
  type AiWorkWorkspaceList,
  type AiWorkPluginItem,
  type AiWorkSkillItem,
  type AiWorkSkillContent,
  type AiWorkHubSkillItem,
  type AiWorkHubRepo,
  type AiWorkWorkspaceFileContent,
  type AiWorkWorkspaceFileWriteResult,
  type AiWorkWorkspaceDirEntry,
  type AiWorkWorkspaceDirectoryList,
  type AiWorkWorkspaceGitStatus,
  type AiWorkCommandItem,
  type AiWorkMcpItem,
  type AiWorkArtifactItem,
  type AiWorkArtifactList,
  type AiWorkInboxItem,
  type AiWorkInboxList,
  type AiWorkInboxUploadResult,
  type AiWorkActor,
  type AiWorkReloadTrigger,
  type AiWorkReloadEvent,
  type AiWorkSessionMessage,
  type AiWorkSessionSnapshot
} from "@aiwork/server-sdk";

export type {
  AiWorkServerCapabilities,
  AiWorkServerStatus,
  AiWorkServerDiagnostics,
  AiWorkRuntimeServiceName,
  AiWorkRuntimeServiceSnapshot,
  AiWorkRuntimeSnapshot,
  AiWorkServerSettings,
  AiWorkWorkspaceInfo,
  AiWorkWorkspaceList,
  AiWorkPluginItem,
  AiWorkSkillItem,
  AiWorkSkillContent,
  AiWorkHubSkillItem,
  AiWorkHubRepo,
  AiWorkWorkspaceFileContent,
  AiWorkWorkspaceFileWriteResult,
  AiWorkWorkspaceDirEntry,
  AiWorkWorkspaceDirectoryList,
  AiWorkWorkspaceGitStatus,
  AiWorkCommandItem,
  AiWorkMcpItem,
  AiWorkArtifactItem,
  AiWorkArtifactList,
  AiWorkInboxItem,
  AiWorkInboxList,
  AiWorkInboxUploadResult,
  AiWorkActor,
  AiWorkReloadTrigger,
  AiWorkReloadEvent,
  AiWorkSessionMessage,
  AiWorkSessionSnapshot
};
const LOG_SCOPE = "aiwork-server-client";


const STORAGE_URL_OVERRIDE = "aiwork.server.urlOverride";
const STORAGE_PORT_OVERRIDE = "aiwork.server.port";
const STORAGE_TOKEN = "aiwork.server.token";
const STORAGE_HOST_TOKEN = "aiwork.server.hostToken";

/**
 * Prefix root-relative AiWork HTTP paths (`/workspace/...`) with the real server base URL.
 * Session snapshots may store API URLs without a host; in Vite dev they would otherwise resolve
 * against the web shell origin (wrong port) instead of the AiWork server.
 */
export function resolveWorkspaceApiUrl(rawUrl: string, serverBaseUrl: string): string {
  const raw = rawUrl.trim();
  const base = serverBaseUrl.trim().replace(/\/+$/, "");
  if (!raw || !base) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return raw;
  if (raw.startsWith("/workspace/")) {
    return `${base}${raw}`;
  }
  return raw;
}

export function normalizeAiWorkServerUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  const normalized = withProtocol.replace(/\/+$/, "");
  // Desktop runtime may hand us a workspace-scoped AiWork mount URL
  // (`.../w/<id>/engine`). AiWork server APIs live at `.../w/<id>`.
  try {
    const url = new URL(normalized);
    const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    if (last === "engine") {
      url.pathname = `/${segments.slice(0, -1).join("/")}`;
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // ignore — fall through to regex strip
  }
  return normalized.replace(/\/engine$/, "");
}

export function isLoopbackAiWorkServerUrl(input: string) {
  const normalized = normalizeAiWorkServerUrl(input) ?? "";
  if (!normalized) return false;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function parseAiWorkWorkspaceIdFromUrl(input: string) {
  const normalized = normalizeAiWorkServerUrl(input) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    if (prev !== "w" || !last) return null;
    return decodeURIComponent(last);
  } catch {
    const match = normalized.match(/\/w\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

export function buildAiWorkWorkspaceBaseUrl(hostUrl: string, workspaceId?: string | null) {
  const normalized = normalizeAiWorkServerUrl(hostUrl) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    const alreadyMounted = prev === "w" && Boolean(last);
    if (alreadyMounted) {
      return url.toString().replace(/\/+$/, "");
    }

    const id = (workspaceId ?? "").trim();
    if (!id) return url.toString().replace(/\/+$/, "");

    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/w/${encodeURIComponent(id)}`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    const id = (workspaceId ?? "").trim();
    if (!id) return normalized;
    return `${normalized.replace(/\/+$/, "")}/w/${encodeURIComponent(id)}`;
  }
}

const AIWORK_INVITE_PARAM_URL = "ow_url";
const AIWORK_INVITE_PARAM_TOKEN = "ow_token";
const AIWORK_INVITE_PARAM_STARTUP = "ow_startup";
const AIWORK_INVITE_PARAM_AUTO_CONNECT = "ow_auto_connect";

export type AiWorkConnectInvite = {
  url: string;
  token?: string;
  startup?: "server";
  autoConnect?: boolean;
};

export function readAiWorkConnectInviteFromSearch(input: string | URLSearchParams) {
  const search =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;

  const rawUrl = search.get(AIWORK_INVITE_PARAM_URL)?.trim() ?? "";
  const url = normalizeAiWorkServerUrl(rawUrl);
  if (!url) return null;

  const token = search.get(AIWORK_INVITE_PARAM_TOKEN)?.trim() ?? "";
  const startupRaw = search.get(AIWORK_INVITE_PARAM_STARTUP)?.trim() ?? "";
  const startup = startupRaw === "server" ? "server" : undefined;
  const autoConnect = search.get(AIWORK_INVITE_PARAM_AUTO_CONNECT)?.trim() === "1";

  return {
    url,
    token: token || undefined,
    startup,
    autoConnect: autoConnect || undefined,
  } satisfies AiWorkConnectInvite;
}

export function stripAiWorkConnectInviteFromUrl(input: string) {
  try {
    const url = new URL(input);
    url.searchParams.delete(AIWORK_INVITE_PARAM_URL);
    url.searchParams.delete(AIWORK_INVITE_PARAM_TOKEN);
    url.searchParams.delete(AIWORK_INVITE_PARAM_STARTUP);
    url.searchParams.delete(AIWORK_INVITE_PARAM_AUTO_CONNECT);
    return url.toString();
  } catch {
    return input;
  }
}

export function readAiWorkServerSettings(): AiWorkServerSettings {
  if (typeof window === "undefined") return {};
  try {
    const urlOverride = normalizeAiWorkServerUrl(
      window.localStorage.getItem(STORAGE_URL_OVERRIDE) ?? "",
    );
    const portRaw = window.localStorage.getItem(STORAGE_PORT_OVERRIDE) ?? "";
    const portOverride = portRaw ? Number(portRaw) : undefined;
    const token = window.localStorage.getItem(STORAGE_TOKEN) ?? undefined;
    const hostToken = window.localStorage.getItem(STORAGE_HOST_TOKEN) ?? undefined;
    return {
      urlOverride: urlOverride ?? undefined,
      portOverride: Number.isNaN(portOverride) ? undefined : portOverride,
      token: token?.trim() || undefined,
      hostToken: hostToken?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function writeAiWorkServerSettings(next: AiWorkServerSettings): AiWorkServerSettings {
  if (typeof window === "undefined") return next;
  try {
    const urlOverride = normalizeAiWorkServerUrl(next.urlOverride ?? "");
    const portOverride = typeof next.portOverride === "number" ? next.portOverride : undefined;
    const token = next.token?.trim() || undefined;
    const hostToken = next.hostToken?.trim() || undefined;

    if (urlOverride) {
      window.localStorage.setItem(STORAGE_URL_OVERRIDE, urlOverride);
    } else {
      window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    }

    if (typeof portOverride === "number" && !Number.isNaN(portOverride)) {
      window.localStorage.setItem(STORAGE_PORT_OVERRIDE, String(portOverride));
    } else {
      window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    }

    if (token) {
      window.localStorage.setItem(STORAGE_TOKEN, token);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN);
    }

    if (hostToken) {
      window.localStorage.setItem(STORAGE_HOST_TOKEN, hostToken);
    } else {
      window.localStorage.removeItem(STORAGE_HOST_TOKEN);
    }

    return readAiWorkServerSettings();
  } catch {
    return next;
  }
}

export function hydrateAiWorkServerSettingsFromEnv() {
  if (typeof window === "undefined") return;

  const envUrl = typeof import.meta.env?.VITE_AIWORK_URL === "string"
    ? import.meta.env.VITE_AIWORK_URL.trim()
    : "";
  const envPort = typeof import.meta.env?.VITE_AIWORK_PORT === "string"
    ? import.meta.env.VITE_AIWORK_PORT.trim()
    : "";
  const envToken = typeof import.meta.env?.VITE_AIWORK_TOKEN === "string"
    ? import.meta.env.VITE_AIWORK_TOKEN.trim()
    : "";
  const envHostToken = typeof import.meta.env?.VITE_AIWORK_HOST_TOKEN === "string"
    ? import.meta.env.VITE_AIWORK_HOST_TOKEN.trim()
    : "";

  if (!envUrl && !envPort && !envToken && !envHostToken) return;

  try {
    const current = readAiWorkServerSettings();
    const next: AiWorkServerSettings = { ...current };
    let changed = false;

    if (!current.urlOverride && envUrl) {
      next.urlOverride = normalizeAiWorkServerUrl(envUrl) ?? undefined;
      changed = true;
    }

    if (!current.portOverride && envPort) {
      const parsed = Number(envPort);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.portOverride = parsed;
        changed = true;
      }
    }

    if (!current.token && envToken) {
      next.token = envToken;
      changed = true;
    }

    if (!current.hostToken && envHostToken) {
      next.hostToken = envHostToken;
      changed = true;
    }

    if (changed) {
      writeAiWorkServerSettings(next);
    }
  } catch {
    // ignore
  }
}

export function clearAiWorkServerSettings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    window.localStorage.removeItem(STORAGE_TOKEN);
    window.localStorage.removeItem(STORAGE_HOST_TOKEN);
    try {
      window.localStorage.removeItem("aiwork.server.remoteAccessEnabled");
    } catch {
      /* ignore */
    }
  } catch {
    // ignore
  }
}

export const AiWorkServerError = SdkAiWorkServerError;
export type AiWorkServerError = SdkAiWorkServerError;

export function createAiWorkServerClient(options: { baseUrl: string; token?: string; hostToken?: string }) {
  const client = new HttpAiWorkServerClient({
    baseUrl: options.baseUrl,
    token: options.token,
    hostToken: options.hostToken,
    fetchImpl: desktopFetch,
    logCallback: (method, phase, data) => {
      ConsoleLog.log(LOG_SCOPE, `${method}:${phase}`, data);
    },
  });

  return {
    baseUrl: client.baseUrl,
    health: () => client.health(),
    status: () => client.status(),
    capabilities: () => client.capabilities(),
    listWorkspaces: () => client.listWorkspaces(),
    createLocalWorkspace: (payload: { folderPath: string; name: string; preset: string }) =>
      client.createLocalWorkspace(payload),
    updateWorkspaceDisplayName: (workspaceId: string, displayName: string | null) =>
      client.updateWorkspaceDisplayName(workspaceId, displayName),
    activateWorkspace: (workspaceId: string) =>
      client.activateWorkspace(workspaceId),
    reorderWorkspaces: (workspaceIds: string[]) =>
      client.reorderWorkspaces(workspaceIds),
    deleteWorkspace: (workspaceId: string) =>
      client.deleteWorkspace(workspaceId),
    deleteSession: (workspaceId: string, sessionId: string) =>
      client.deleteSession(workspaceId, sessionId),
    listSessions: (
      workspaceId: string,
      options?: { roots?: boolean; start?: number; search?: string; limit?: number },
    ) =>
      client.listSessions(workspaceId, options),
    getSession: (workspaceId: string, sessionId: string) =>
      client.getSession(workspaceId, sessionId),
    getSessionMessages: (workspaceId: string, sessionId: string, options?: { limit?: number }) =>
      client.getSessionMessages(workspaceId, sessionId, options),
    getSessionSnapshot: (workspaceId: string, sessionId: string, options?: { limit?: number }) =>
      client.getSessionSnapshot(workspaceId, sessionId, options),
    getConfig: (workspaceId: string) =>
      client.getConfig(workspaceId),
    patchConfig: (workspaceId: string, payload: { engine?: Record<string, unknown>; aiwork?: Record<string, unknown> }) =>
      client.patchConfig(workspaceId, payload),
    readEngineConfigFile: (workspaceId: string, scope: "project" | "global" = "project") =>
      client.readEngineConfigFile(workspaceId, scope),
    writeEngineConfigFile: (workspaceId: string, scope: "project" | "global", content: string) =>
      client.writeEngineConfigFile(workspaceId, scope, content),
    proxyModelProviderModels: (
      workspaceId: string,
      body: { baseURL: string; apiKey: string; providerType: ModelProviderType },
    ) =>
      client.proxyModelProviderModels(workspaceId, body),
    listReloadEvents: (workspaceId: string, options?: { since?: number }) =>
      client.listReloadEvents(workspaceId, options),
    reloadEngine: (workspaceId: string) =>
      client.reloadEngine(workspaceId),
    listPlugins: (workspaceId: string, options?: { includeGlobal?: boolean }) =>
      client.listPlugins(workspaceId, options),
    addPlugin: (workspaceId: string, spec: string) =>
      client.addPlugin(workspaceId, spec),
    removePlugin: (workspaceId: string, name: string) =>
      client.removePlugin(workspaceId, name),
    listSkills: (workspaceId: string, options?: { includeGlobal?: boolean }) =>
      client.listSkills(workspaceId, options),
    listHubSkills: (options?: { repo?: { owner?: string; repo?: string; ref?: string } }) =>
      client.listHubSkills(options),
    installHubSkill: (
      workspaceId: string,
      name: string,
      options?: { overwrite?: boolean; repo?: { owner?: string; repo?: string; ref?: string } },
    ) =>
      client.installHubSkill(workspaceId, name, options),
    getSkill: (workspaceId: string, name: string, options?: { includeGlobal?: boolean }) =>
      client.getSkill(workspaceId, name, options),
    upsertSkill: (workspaceId: string, payload: { name: string; content: string; description?: string }) =>
      client.upsertSkill(workspaceId, payload),
    deleteSkill: (workspaceId: string, name: string) =>
      client.deleteSkill(workspaceId, name),
    listMcp: (workspaceId: string) =>
      client.listMcp(workspaceId),
    addMcp: (workspaceId: string, payload: { name: string; config: Record<string, unknown> }) =>
      client.addMcp(workspaceId, payload),
    removeMcp: (workspaceId: string, name: string) =>
      client.removeMcp(workspaceId, name),
    setMcpEnabled: (workspaceId: string, name: string, enabled: boolean) =>
      client.setMcpEnabled(workspaceId, name, enabled),
    logoutMcpAuth: (workspaceId: string, name: string) =>
      client.logoutMcpAuth(workspaceId, name),
    listCommands: (workspaceId: string, scope: "workspace" | "global" = "workspace") =>
      client.listCommands(workspaceId, scope),
    upsertCommand: (
      workspaceId: string,
      payload: { name: string; description?: string; template: string; agent?: string; model?: string | null; subtask?: boolean },
    ) =>
      client.upsertCommand(workspaceId, payload),
    deleteCommand: (workspaceId: string, name: string) =>
      client.deleteCommand(workspaceId, name),
    uploadInbox: (workspaceId: string, file: File, options?: { path?: string }) => {
      const sdkFile = {
        name: file.name,
        size: file.size,
        content: file as unknown as Blob,
      };
      return client.uploadInbox(workspaceId, sdkFile, options);
    },
    listInbox: (workspaceId: string) =>
      client.listInbox(workspaceId),
    downloadInboxItem: (workspaceId: string, inboxId: string) =>
      client.downloadInboxItem(workspaceId, inboxId),
    readWorkspaceFile: (workspaceId: string, path: string, options?: { optional?: boolean }) =>
      client.readWorkspaceFile(workspaceId, path, options),
    listWorkspaceDirectory: (workspaceId: string, path?: string) =>
      client.listWorkspaceDirectory(workspaceId, path),
    getWorkspaceGitStatus: (workspaceId: string) =>
      client.getWorkspaceGitStatus(workspaceId),
    writeWorkspaceFile: (
      workspaceId: string,
      payload: { path: string; content: string; baseUpdatedAt?: number | null; force?: boolean },
    ) =>
      client.writeWorkspaceFile(workspaceId, payload),
    listArtifacts: (workspaceId: string) =>
      client.listArtifacts(workspaceId),
    downloadArtifact: (workspaceId: string, artifactId: string) =>
      client.downloadArtifact(workspaceId, artifactId),
    listUserEnvKeys: () =>
      client.listUserEnvKeys(),
    listUserEnv: () =>
      client.listUserEnv(),
    upsertUserEnv: (entries: Array<{ key: string; value: string }>) =>
      client.upsertUserEnv(entries),
    deleteUserEnv: (key: string) =>
      client.deleteUserEnv(key),
  };
}

export type AiWorkServerClient = ReturnType<typeof createAiWorkServerClient>;
