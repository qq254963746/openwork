import {
  getDesktopBootstrapConfig,
  setDesktopBootstrapConfig as setDesktopBootstrapConfigInShell,
  type DesktopBootstrapConfig as ShellDesktopBootstrapConfig,
} from "./desktop";
import { isDesktopRuntime } from "../utils";
import {
  BUILD_OPENWORK_API_URL,
  DEFAULT_OPENWORK_APP_URL,
  resolveOpenworkAppBaseUrls,
  type OpenworkAppBaseUrls,
} from "./openwork-app-urls";

const STORAGE_BASE_URL = "openwork.den.baseUrl";
const STORAGE_API_BASE_URL = "openwork.den.apiBaseUrl";

const BUILD_REQUIRE_SIGNIN =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_REQUIRE_SIGNIN === "string"
    ? /^(1|true|yes|on)$/i.test(import.meta.env.VITE_DEN_REQUIRE_SIGNIN.trim())
    : false);

export type OpenworkBootstrapConfig = OpenworkAppBaseUrls & {
  requireSignin: boolean;
};

let desktopBootstrapConfig: OpenworkBootstrapConfig = resolveOpenworkBootstrapConfig({
  baseUrl: DEFAULT_OPENWORK_APP_URL,
  apiBaseUrl: BUILD_OPENWORK_API_URL,
  requireSignin: BUILD_REQUIRE_SIGNIN,
});

function resolveOpenworkBootstrapConfig(
  input: { baseUrl: string; apiBaseUrl?: string | null; requireSignin?: boolean | null },
): OpenworkBootstrapConfig {
  return {
    ...resolveOpenworkAppBaseUrls(input),
    requireSignin: input.requireSignin === true,
  };
}

function syncBootstrapSettingsToLocalStorage(config: OpenworkBootstrapConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_BASE_URL, config.baseUrl);
  window.localStorage.setItem(STORAGE_API_BASE_URL, config.apiBaseUrl);
}

function applyDesktopBootstrapConfig(config: OpenworkBootstrapConfig) {
  desktopBootstrapConfig = config;
  syncBootstrapSettingsToLocalStorage(config);
}

export function readOpenworkBootstrapConfig(): OpenworkBootstrapConfig {
  return desktopBootstrapConfig;
}

export async function initializeOpenworkBootstrapConfig(): Promise<OpenworkBootstrapConfig> {
  if (!isDesktopRuntime()) {
    desktopBootstrapConfig = resolveOpenworkBootstrapConfig({
      baseUrl: DEFAULT_OPENWORK_APP_URL,
      apiBaseUrl: BUILD_OPENWORK_API_URL,
      requireSignin: BUILD_REQUIRE_SIGNIN,
    });
    return desktopBootstrapConfig;
  }

  try {
    const bootstrap = await getDesktopBootstrapConfig();
    applyDesktopBootstrapConfig(resolveOpenworkBootstrapConfig(bootstrap));
  } catch {
    desktopBootstrapConfig = resolveOpenworkBootstrapConfig({
      baseUrl: DEFAULT_OPENWORK_APP_URL,
      apiBaseUrl: BUILD_OPENWORK_API_URL,
      requireSignin: BUILD_REQUIRE_SIGNIN,
    });
    syncBootstrapSettingsToLocalStorage(desktopBootstrapConfig);
  }

  return desktopBootstrapConfig;
}

export async function setOpenworkBootstrapConfig(
  next: ShellDesktopBootstrapConfig,
): Promise<OpenworkBootstrapConfig> {
  const normalized = resolveOpenworkBootstrapConfig(next);

  if (isDesktopRuntime()) {
    const persisted = await setDesktopBootstrapConfigInShell({
      baseUrl: normalized.baseUrl,
      apiBaseUrl: normalized.apiBaseUrl,
      requireSignin: normalized.requireSignin,
    });
    applyDesktopBootstrapConfig(resolveOpenworkBootstrapConfig(persisted));
  } else {
    applyDesktopBootstrapConfig(normalized);
  }

  return readOpenworkBootstrapConfig();
}
