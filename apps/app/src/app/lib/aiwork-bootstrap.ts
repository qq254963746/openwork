import {
  getDesktopBootstrapConfig,
  setDesktopBootstrapConfig as setDesktopBootstrapConfigInShell,
  type DesktopBootstrapConfig as ShellDesktopBootstrapConfig,
} from "./desktop";
import { isDesktopRuntime } from "../utils";
import {
  BUILD_AIWORK_API_URL,
  DEFAULT_AIWORK_APP_URL,
  resolveAiWorkAppBaseUrls,
  type AiWorkAppBaseUrls,
} from "./aiwork-app-urls";

const STORAGE_BASE_URL = "aiwork.den.baseUrl";
const STORAGE_API_BASE_URL = "aiwork.den.apiBaseUrl";

const BUILD_REQUIRE_SIGNIN =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_REQUIRE_SIGNIN === "string"
    ? /^(1|true|yes|on)$/i.test(import.meta.env.VITE_DEN_REQUIRE_SIGNIN.trim())
    : false);

export type AiWorkBootstrapConfig = AiWorkAppBaseUrls & {
  requireSignin: boolean;
};

let desktopBootstrapConfig: AiWorkBootstrapConfig = resolveAiWorkBootstrapConfig({
  baseUrl: DEFAULT_AIWORK_APP_URL,
  apiBaseUrl: BUILD_AIWORK_API_URL,
  requireSignin: BUILD_REQUIRE_SIGNIN,
});

function resolveAiWorkBootstrapConfig(
  input: { baseUrl: string; apiBaseUrl?: string | null; requireSignin?: boolean | null },
): AiWorkBootstrapConfig {
  return {
    ...resolveAiWorkAppBaseUrls(input),
    requireSignin: input.requireSignin === true,
  };
}

function syncBootstrapSettingsToLocalStorage(config: AiWorkBootstrapConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_BASE_URL, config.baseUrl);
  window.localStorage.setItem(STORAGE_API_BASE_URL, config.apiBaseUrl);
}

function applyDesktopBootstrapConfig(config: AiWorkBootstrapConfig) {
  desktopBootstrapConfig = config;
  syncBootstrapSettingsToLocalStorage(config);
}

export function readAiWorkBootstrapConfig(): AiWorkBootstrapConfig {
  return desktopBootstrapConfig;
}

export async function initializeAiWorkBootstrapConfig(): Promise<AiWorkBootstrapConfig> {
  if (!isDesktopRuntime()) {
    desktopBootstrapConfig = resolveAiWorkBootstrapConfig({
      baseUrl: DEFAULT_AIWORK_APP_URL,
      apiBaseUrl: BUILD_AIWORK_API_URL,
      requireSignin: BUILD_REQUIRE_SIGNIN,
    });
    return desktopBootstrapConfig;
  }

  try {
    const bootstrap = await getDesktopBootstrapConfig();
    applyDesktopBootstrapConfig(resolveAiWorkBootstrapConfig(bootstrap));
  } catch {
    desktopBootstrapConfig = resolveAiWorkBootstrapConfig({
      baseUrl: DEFAULT_AIWORK_APP_URL,
      apiBaseUrl: BUILD_AIWORK_API_URL,
      requireSignin: BUILD_REQUIRE_SIGNIN,
    });
    syncBootstrapSettingsToLocalStorage(desktopBootstrapConfig);
  }

  return desktopBootstrapConfig;
}

export async function setAiWorkBootstrapConfig(
  next: ShellDesktopBootstrapConfig,
): Promise<AiWorkBootstrapConfig> {
  const normalized = resolveAiWorkBootstrapConfig(next);

  if (isDesktopRuntime()) {
    const persisted = await setDesktopBootstrapConfigInShell({
      baseUrl: normalized.baseUrl,
      apiBaseUrl: normalized.apiBaseUrl,
      requireSignin: normalized.requireSignin,
    });
    applyDesktopBootstrapConfig(resolveAiWorkBootstrapConfig(persisted));
  } else {
    applyDesktopBootstrapConfig(normalized);
  }

  return readAiWorkBootstrapConfig();
}
