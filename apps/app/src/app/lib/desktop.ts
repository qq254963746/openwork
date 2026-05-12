import * as tauriBridge from "./desktop-tauri";

export type * from "./desktop-tauri";

export type DesktopBridge = typeof tauriBridge;

declare global {
  interface Window {
    __AIWORK_ELECTRON__?: {
      bridge?: Partial<DesktopBridge>;
      invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown>;
      shell?: {
        openExternal?: (url: string) => Promise<void>;
        relaunch?: () => Promise<void>;
      };
      meta?: {
        initialDeepLinks?: string[];
        platform?: "darwin" | "linux" | "windows";
        version?: string;
      };
    };
  }
}

function missingElectronMethod(method: string): never {
  throw new Error(`Electron desktop bridge method is not implemented yet: ${method}`);
}

function isElectronDesktopRuntime() {
  return typeof window !== "undefined" && window.__AIWORK_ELECTRON__ != null;
}

function isTauriDesktopRuntime() {
  return typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ != null;
}

async function invokeElectronHelper<T>(command: string, ...args: unknown[]): Promise<T> {
  const invokeDesktop = window.__AIWORK_ELECTRON__?.invokeDesktop;
  if (!invokeDesktop) {
    throw new Error(`Electron desktop helper is unavailable: ${command}`);
  }
  return (await invokeDesktop(command, ...args)) as T;
}

function resolveElectronBridge(): DesktopBridge {
  const exposed = window.__AIWORK_ELECTRON__?.bridge ?? {};
  const invokeDesktop = window.__AIWORK_ELECTRON__?.invokeDesktop;
  return new Proxy(exposed as DesktopBridge, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value != null) {
        return value;
      }

      if (prop === "resolveWorkspaceListSelectedId") {
        return tauriBridge.resolveWorkspaceListSelectedId;
      }

      if (typeof prop === "string" && invokeDesktop) {
        return (...args: unknown[]) => invokeDesktop(prop, ...args);
      }

      if (typeof prop === "string") {
        return (..._args: unknown[]) => missingElectronMethod(prop);
      }

      return value;
    },
  });
}

function resolveDesktopBridge(): DesktopBridge {
  if (
    typeof window !== "undefined" &&
    (window.__AIWORK_ELECTRON__?.bridge || window.__AIWORK_ELECTRON__?.invokeDesktop)
  ) {
    return resolveElectronBridge();
  }
  return tauriBridge;
}

export const desktopBridge: DesktopBridge = new Proxy({} as DesktopBridge, {
  get(_target, prop, receiver) {
    return Reflect.get(resolveDesktopBridge(), prop, receiver);
  },
});

function isLoopbackUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const url = new URL(raw);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export const desktopFetch: typeof globalThis.fetch = (input, init) => {
  if (isElectronDesktopRuntime()) {
    if (isLoopbackUrl(input)) {
      return globalThis.fetch(input, init);
    }

    return invokeElectronHelper<{
      status: number;
      statusText: string;
      headers: [string, string][];
      body: string;
    }>("__fetch", typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, {
      method: init?.method,
      headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    }).then(
      (result) =>
        new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        }),
    );
  }
  return tauriBridge.desktopFetch(input, init);
};

export async function openDesktopUrl(url: string): Promise<void> {
  if (isElectronDesktopRuntime()) {
    const openExternal = window.__AIWORK_ELECTRON__?.shell?.openExternal;
    if (openExternal) {
      await openExternal(url);
      return;
    }
  }
  if (isTauriDesktopRuntime()) {
    await tauriBridge.openDesktopUrl(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function openDesktopPath(target: string): Promise<void> {
  if (isElectronDesktopRuntime()) {
    const result = await invokeElectronHelper<string | null>("__openPath", target);
    if (typeof result === "string" && result.trim()) {
      throw new Error(result);
    }
    return;
  }
  await tauriBridge.openDesktopPath(target);
}

export async function ensureDirExist(path: string): Promise<void> {
  if (isElectronDesktopRuntime()) {
    await invokeElectronHelper<void>("__ensureDirExist", path);
    return;
  }
  await tauriBridge.ensureDirExist(path);
}

export async function revealDesktopItemInDir(target: string): Promise<void> {
  if (isElectronDesktopRuntime()) {
    await invokeElectronHelper<void>("__revealItemInDir", target);
    return;
  }
  await tauriBridge.revealDesktopItemInDir(target);
}

export async function relaunchDesktopApp(): Promise<void> {
  if (isElectronDesktopRuntime()) {
    await window.__AIWORK_ELECTRON__?.shell?.relaunch?.();
    return;
  }
  await tauriBridge.relaunchDesktopApp();
}

export async function getDesktopHomeDir(): Promise<string> {
  if (isElectronDesktopRuntime()) {
    return invokeElectronHelper<string>("__homeDir");
  }
  return tauriBridge.getDesktopHomeDir();
}

export async function joinDesktopPath(...parts: string[]): Promise<string> {
  if (isElectronDesktopRuntime()) {
    return invokeElectronHelper<string>("__joinPath", ...parts);
  }
  return tauriBridge.joinDesktopPath(...parts);
}

export async function setDesktopZoomFactor(value: number): Promise<boolean> {
  if (isElectronDesktopRuntime()) {
    return invokeElectronHelper<boolean>("__setZoomFactor", value);
  }
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
  engineDoctor,
  pickDirectory,
  pickFile,
  saveFile,
  engineInstall,
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
  engineDoctor,
  pickDirectory,
  pickFile,
  saveFile,
  engineInstall,
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
