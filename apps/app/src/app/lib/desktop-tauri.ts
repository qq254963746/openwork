import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { validateMcpServerName } from "../mcp";
import { applyWebviewZoom } from "./font-zoom";

export const desktopFetch = tauriFetch as unknown as typeof globalThis.fetch;

export async function openDesktopUrl(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function openDesktopPath(target: string): Promise<void> {
  await invoke<void>("host_open_path_native", { path: target });
}

export async function revealDesktopItemInDir(target: string): Promise<void> {
  await invoke<void>("host_reveal_path_native", { path: target });
}

/** Opens the log viewer in a dedicated Webview window (Release-safe; avoids `window.open`). */
export async function openAppLogWebviewWindow(): Promise<void> {
  await invoke<void>("open_app_log_window");
}

/** Fetches `window.__aiwork.events` from the main shell webview (detached log window has no `window.opener`). */
export async function pullShellEventsFromMain(limit: number): Promise<string> {
  return invoke<string>("pull_shell_events_from_main", { limit });
}

export async function requestClearMainShellEvents(): Promise<void> {
  await invoke<void>("request_clear_main_shell_events");
}

export async function relaunchDesktopApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

export async function getDesktopHomeDir(): Promise<string> {
  const { homeDir } = await import("@tauri-apps/api/path");
  return homeDir();
}

export async function joinDesktopPath(...parts: string[]): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  return join(...parts);
}

export async function setDesktopZoomFactor(value: number): Promise<boolean> {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const webview = getCurrentWebview();
    await applyWebviewZoom(webview, value);
    return true;
  } catch {
    return false;
  }
}

export type EngineInfo = {
  running: boolean;
  runtime: "direct";
  baseUrl: string | null;
  projectDir: string | null;
  hostname: string | null;
  port: number | null;
  opencodeUsername: string | null;
  opencodePassword: string | null;
  opencodeBinPath: string | null;
  opencodeBinSource: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type OpencodeEngineDiskLogsSnapshot = {
  dir: string;
  resolvedVariant: string;
  fileLabel?: string | null;
  content: string;
  error?: string | null;
};

export type AiWorkServerInfo = {
  running: boolean;
  host: string | null;
  port: number | null;
  baseUrl: string | null;
  connectUrl: string | null;
  mdnsUrl: string | null;
  lanUrl: string | null;
  clientToken: string | null;
  ownerToken: string | null;
  hostToken: string | null;
  managedOpencodeBinPath: string | null;
  managedOpencodeBinSource: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type EngineDoctorResult = {
  found: boolean;
  inPath: boolean;
  resolvedPath: string | null;
  resolvedSource: string | null;
  version: string | null;
  supportsServe: boolean;
  notes: string[];
  serveHelpStatus: number | null;
  serveHelpStdout: string | null;
  serveHelpStderr: string | null;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  preset: string;
  displayName?: string | null;
};

export type WorkspaceList = {
  // UI-selected workspace persisted by the desktop shell.
  selectedId?: string;
  // Runtime/watch target currently followed by the desktop host.
  watchedId?: string | null;
  // Legacy desktop payloads used activeId for the UI-selected workspace.
  activeId?: string | null;
  workspaces: WorkspaceInfo[];
};

export function resolveWorkspaceListSelectedId(
  list: Pick<WorkspaceList, "selectedId" | "activeId"> | null | undefined,
): string {
  return list?.selectedId?.trim() || list?.activeId?.trim() || "";
}

export type WorkspaceExportSummary = {
  outputPath: string;
  included: number;
  excluded: string[];
};

export async function engineStart(
  projectDir: string,
  options?: {
    preferSidecar?: boolean;
    runtime?: "direct";
    workspacePaths?: string[];
    opencodeBinPath?: string | null;
    opencodeEnableExa?: boolean;
  },
): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_start", {
    projectDir,
    preferSidecar: options?.preferSidecar ?? true,
    opencodeBinPath: options?.opencodeBinPath ?? null,
    opencodeEnableExa: options?.opencodeEnableExa ?? null,
    runtime: options?.runtime ?? null,
    workspacePaths: options?.workspacePaths ?? null,
  });
}

export async function workspaceBootstrap(): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_bootstrap");
}

export async function workspaceSetSelected(workspaceId: string): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_set_selected", { workspaceId });
}

export async function workspaceReorder(workspaceIds: string[]): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_reorder", { workspaceIds });
}

export async function workspaceSetRuntimeActive(workspaceId: string | null): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_set_runtime_active", { workspaceId: workspaceId ?? "" });
}

export async function workspaceCreate(input: {
  folderPath: string;
  name: string;
  preset: string;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_create", {
    folderPath: input.folderPath,
    name: input.name,
    preset: input.preset,
  });
}

export async function workspaceUpdateDisplayName(input: {
  workspaceId: string;
  displayName?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_update_display_name", {
    workspaceId: input.workspaceId,
    displayName: input.displayName ?? null,
  });
}

export async function workspaceForget(workspaceId: string): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_forget", { workspaceId });
}

export async function workspaceAddAuthorizedRoot(input: {
  workspacePath: string;
  folderPath: string;
}): Promise<ExecResult> {
  return invoke<ExecResult>("workspace_add_authorized_root", {
    workspacePath: input.workspacePath,
    folderPath: input.folderPath,
  });
}

export async function workspaceExportConfig(input: {
  workspaceId: string;
  outputPath: string;
}): Promise<WorkspaceExportSummary> {
  return invoke<WorkspaceExportSummary>("workspace_export_config", {
    workspaceId: input.workspaceId,
    outputPath: input.outputPath,
  });
}

export async function workspaceImportConfig(input: {
  archivePath: string;
  targetDir: string;
  name?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_import_config", {
    archivePath: input.archivePath,
    targetDir: input.targetDir,
    name: input.name ?? null,
  });
}

export type OpencodeCommandDraft = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};

export type WorkspaceAiWorkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

export async function workspaceAiWorkRead(input: {
  workspacePath: string;
}): Promise<WorkspaceAiWorkConfig> {
  return invoke<WorkspaceAiWorkConfig>("workspace_aiwork_read", {
    workspacePath: input.workspacePath,
  });
}

export async function workspaceAiWorkWrite(input: {
  workspacePath: string;
  config: WorkspaceAiWorkConfig;
}): Promise<ExecResult> {
  return invoke<ExecResult>("workspace_aiwork_write", {
    workspacePath: input.workspacePath,
    config: input.config,
  });
}

export async function opencodeCommandList(input: {
  scope: "workspace" | "global";
  projectDir: string;
}): Promise<string[]> {
  return invoke<string[]>("opencode_command_list", {
    scope: input.scope,
    projectDir: input.projectDir,
  });
}

export async function opencodeCommandWrite(input: {
  scope: "workspace" | "global";
  projectDir: string;
  command: OpencodeCommandDraft;
}): Promise<ExecResult> {
  return invoke<ExecResult>("opencode_command_write", {
    scope: input.scope,
    projectDir: input.projectDir,
    command: input.command,
  });
}

export async function opencodeCommandDelete(input: {
  scope: "workspace" | "global";
  projectDir: string;
  name: string;
}): Promise<ExecResult> {
  return invoke<ExecResult>("opencode_command_delete", {
    scope: input.scope,
    projectDir: input.projectDir,
    name: input.name,
  });
}

export async function engineStop(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_stop");
}

export async function engineRestart(options?: {
  opencodeEnableExa?: boolean;
}): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_restart", {
    opencodeEnableExa: options?.opencodeEnableExa ?? null,
  });
}

export type AppBuildInfo = {
  version: string;
  gitSha?: string | null;
  buildEpoch?: string | null;
  aiworkDevMode?: boolean;
  os?: string | null;
  arch?: string | null;
};

export async function appBuildInfo(): Promise<AppBuildInfo> {
  return invoke<AppBuildInfo>("app_build_info");
}

export async function nukeAiWorkAndOpencodeConfigAndExit(): Promise<void> {
  return invoke<void>("nuke_aiwork_and_opencode_config_and_exit");
}

export async function aiworkServerInfo(): Promise<AiWorkServerInfo> {
  return invoke<AiWorkServerInfo>("aiwork_server_info");
}

export async function aiworkServerRestart(): Promise<AiWorkServerInfo> {
  return invoke<AiWorkServerInfo>("aiwork_server_restart", {});
}

export async function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}

export async function readOpencodeEngineDiskLogs(): Promise<OpencodeEngineDiskLogsSnapshot> {
  return invoke<OpencodeEngineDiskLogsSnapshot>("read_opencode_engine_disk_logs");
}

export async function runtimeBootstrap(): Promise<unknown> {
  return {
    ok: true,
    skipped: true,
    reason: "unsupported-runtime",
  };
}

export async function engineDoctor(options?: {
  preferSidecar?: boolean;
  opencodeBinPath?: string | null;
}): Promise<EngineDoctorResult> {
  return invoke<EngineDoctorResult>("engine_doctor", {
    preferSidecar: options?.preferSidecar ?? true,
    opencodeBinPath: options?.opencodeBinPath ?? null,
  });
}

export async function pickDirectory(options?: {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
}): Promise<string | string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    title: options?.title,
    defaultPath: options?.defaultPath,
    directory: true,
    canCreateDirectories: true,
    multiple: options?.multiple,
  });
}

export async function pickFile(options?: {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    title: options?.title,
    defaultPath: options?.defaultPath,
    directory: false,
    multiple: options?.multiple,
    filters: options?.filters,
  });
}

export async function saveFile(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    title: options?.title,
    defaultPath: options?.defaultPath,
    filters: options?.filters,
  });
}

export type ExecResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

export async function engineInstall(): Promise<ExecResult> {
  return invoke<ExecResult>("engine_install");
}

export async function importSkill(
  projectDir: string,
  sourceDir: string,
  options?: { overwrite?: boolean },
): Promise<ExecResult> {
  return invoke<ExecResult>("import_skill", {
    projectDir,
    sourceDir,
    overwrite: options?.overwrite ?? false,
  });
}

export async function installSkillTemplate(
  projectDir: string,
  name: string,
  content: string,
  options?: { overwrite?: boolean },
): Promise<ExecResult> {
  return invoke<ExecResult>("install_skill_template", {
    projectDir,
    name,
    content,
    overwrite: options?.overwrite ?? false,
  });
}

export type LocalSkillCard = {
  name: string;
  path: string;
  description?: string;
  trigger?: string;
};

export type LocalSkillContent = {
  path: string;
  content: string;
};

export async function listLocalSkills(projectDir: string): Promise<LocalSkillCard[]> {
  return invoke<LocalSkillCard[]>("list_local_skills", { projectDir });
}

export async function readLocalSkill(projectDir: string, name: string): Promise<LocalSkillContent> {
  return invoke<LocalSkillContent>("read_local_skill", { projectDir, name });
}

export async function writeLocalSkill(projectDir: string, name: string, content: string): Promise<ExecResult> {
  return invoke<ExecResult>("write_local_skill", { projectDir, name, content });
}

export async function uninstallSkill(projectDir: string, name: string): Promise<ExecResult> {
  return invoke<ExecResult>("uninstall_skill", { projectDir, name });
}

export type OpencodeConfigFile = {
  path: string;
  exists: boolean;
  content: string | null;
};

export type OpencodeAuthJsonFile = {
  path: string | null;
  content: string | null;
};

export type DesktopAppPaths = {
  executablePath: string | null;
  appBundlePath: string | null;
};

export async function desktopAppPaths(): Promise<DesktopAppPaths> {
  return invoke<DesktopAppPaths>("desktop_app_paths");
}

export async function readOpencodeConfig(
  scope: "project" | "global",
  projectDir: string,
): Promise<OpencodeConfigFile> {
  return invoke<OpencodeConfigFile>("read_opencode_config", { scope, projectDir });
}

export async function writeOpencodeConfig(
  scope: "project" | "global",
  projectDir: string,
  content: string,
): Promise<ExecResult> {
  return invoke<ExecResult>("write_opencode_config", { scope, projectDir, content });
}

export async function readOpencodeAuthJson(): Promise<OpencodeAuthJsonFile> {
  return invoke<OpencodeAuthJsonFile>("read_opencode_auth_json");
}

export async function resetAiWorkState(mode: "onboarding" | "all"): Promise<void> {
  return invoke<void>("reset_aiwork_state", { mode });
}

export type CacheResetResult = {
  removed: string[];
  missing: string[];
  errors: string[];
};

export async function resetOpencodeCache(): Promise<CacheResetResult> {
  return invoke<CacheResetResult>("reset_opencode_cache");
}

export async function opencodeMcpAuth(
  projectDir: string,
  serverName: string,
): Promise<ExecResult> {
  const safeProjectDir = projectDir.trim();
  if (!safeProjectDir) {
    throw new Error("project_dir is required");
  }

  const safeServerName = validateMcpServerName(serverName);

  return invoke<ExecResult>("opencode_mcp_auth", {
    projectDir: safeProjectDir,
    serverName: safeServerName,
  });
}

/**
 * Set window decorations (titlebar) visibility.
 * When `decorations` is false, the native titlebar is hidden.
 * Useful for tiling window managers on Linux (e.g., Hyprland, i3, sway).
 */
export async function setWindowDecorations(decorations: boolean): Promise<void> {
  return invoke<void>("set_window_decorations", { decorations });
}
