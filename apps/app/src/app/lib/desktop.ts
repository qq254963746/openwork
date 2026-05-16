import * as tauriBridge from "./desktop-tauri";

export type * from "./desktop-tauri";

export type DesktopBridge = typeof tauriBridge;

export const desktopBridge: DesktopBridge = tauriBridge;

export const desktopFetch = tauriBridge.desktopFetch;

export const openDesktopUrl = tauriBridge.openDesktopUrl;

export async function openDesktopPath(target: string): Promise<void> {
  await tauriBridge.openDesktopPath(target);
}

export async function ensureDirExist(path: string): Promise<void> {
  await tauriBridge.ensureDirExist(path);
}

export async function revealDesktopItemInDir(target: string): Promise<void> {
  await tauriBridge.revealDesktopItemInDir(target);
}

export async function relaunchDesktopApp(): Promise<void> {
  await tauriBridge.relaunchDesktopApp();
}

export async function getDesktopHomeDir(): Promise<string> {
  return tauriBridge.getDesktopHomeDir();
}

export async function joinDesktopPath(...parts: string[]): Promise<string> {
  return tauriBridge.joinDesktopPath(...parts);
}

export async function setDesktopZoomFactor(value: number): Promise<boolean> {
  return tauriBridge.setDesktopZoomFactor(value);
}

const {
  resolveWorkspaceListSelectedId,
  engineStart,
  workspaceBootstrap,
  workspaceReorder,
  workspaceSetSelected,
  workspaceSetRuntimeActive,
  workspaceCreate,
  workspaceUpdateDisplayName,
  workspaceForget,
  workspaceAddAuthorizedRoot,
  workspaceAiWorkRead,
  workspaceAiWorkWrite,
  opencodeCommandList,
  opencodeCommandWrite,
  opencodeCommandDelete,
  engineStop,
  engineRestart,
  appBuildInfo,
  nukeAiWorkAndOpencodeConfigAndExit,
  aiworkServerInfo,
  aiworkServerRestart,
  runtimeBootstrap,
  engineInfo,
  readOpencodeEngineDiskLogs,
  pickDirectory,
  pickFile,
  saveFile,
  importSkill,
  installSkillTemplate,
  listLocalSkills,
  readLocalSkill,
  writeLocalSkill,
  uninstallSkill,
  desktopAppPaths,
  readOpencodeConfig,
  readOpencodeAuthJson,
  writeOpencodeConfig,
  resetAiWorkState,
  resetOpencodeCache,
  opencodeMcpAuth,
  setWindowDecorations,
} = desktopBridge;

export {
  resolveWorkspaceListSelectedId,
  engineStart,
  workspaceBootstrap,
  workspaceReorder,
  workspaceSetSelected,
  workspaceSetRuntimeActive,
  workspaceCreate,
  workspaceUpdateDisplayName,
  workspaceForget,
  workspaceAddAuthorizedRoot,
  workspaceAiWorkRead,
  workspaceAiWorkWrite,
  opencodeCommandList,
  opencodeCommandWrite,
  opencodeCommandDelete,
  engineStop,
  engineRestart,
  appBuildInfo,
  nukeAiWorkAndOpencodeConfigAndExit,
  aiworkServerInfo,
  aiworkServerRestart,
  runtimeBootstrap,
  engineInfo,
  readOpencodeEngineDiskLogs,
  pickDirectory,
  pickFile,
  saveFile,
  importSkill,
  installSkillTemplate,
  listLocalSkills,
  readLocalSkill,
  writeLocalSkill,
  uninstallSkill,
  desktopAppPaths,
  readOpencodeConfig,
  readOpencodeAuthJson,
  writeOpencodeConfig,
  resetAiWorkState,
  resetOpencodeCache,
  opencodeMcpAuth,
  setWindowDecorations,
};