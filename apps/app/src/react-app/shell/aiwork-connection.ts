import {
  isLoopbackAiWorkServerUrl,
  normalizeAiWorkServerUrl,
  readAiWorkServerSettings,
} from "../../app/lib/aiwork-server";
import { aiworkServerInfo, type AiWorkServerInfo } from "../../app/lib/desktop";

export type AiWorkConnectionSource = "desktop-runtime" | "stored-settings" | "empty";

export type ResolvedAiWorkConnection = {
  normalizedBaseUrl: string;
  resolvedToken: string;
  resolvedHostToken: string;
  hostInfo: AiWorkServerInfo | null;
  source: AiWorkConnectionSource;
};

function hasUsableConnection(url: string, token: string) {
  return url.trim().length > 0 && token.trim().length > 0;
}

/**
 * Resolve the AiWork server connection for routes that consume the server API.
 *
 * Local desktop-hosted servers expose ephemeral loopback ports and freshly
 * minted tokens on every boot, so live runtime info is the source of truth
 * there. Stored settings remain the fallback for remote/manual server
 * connections and for desktop cases where the runtime bridge is unavailable.
 */
export async function resolveAiWorkConnection(): Promise<ResolvedAiWorkConnection> {
  let staleDesktopRuntimeBaseUrl = "";

  try {
    const info = await aiworkServerInfo();
    const normalizedBaseUrl =
      normalizeAiWorkServerUrl(info.connectUrl ?? info.baseUrl ?? info.lanUrl ?? info.mdnsUrl ?? "") ??
      "";
    const resolvedToken = info.ownerToken?.trim() || info.clientToken?.trim() || "";
    if (info.running === true && hasUsableConnection(normalizedBaseUrl, resolvedToken)) {
      return {
        normalizedBaseUrl,
        resolvedToken,
        resolvedHostToken: info.hostToken?.trim() || "",
        hostInfo: info,
        source: "desktop-runtime",
      };
    }
    staleDesktopRuntimeBaseUrl = normalizedBaseUrl;
  } catch {
    // Fall through to stored settings for remote/manual connections.
  }

  const settings = readAiWorkServerSettings();
  const normalizedBaseUrl = normalizeAiWorkServerUrl(settings.urlOverride ?? "") ?? "";
  const resolvedToken = settings.token?.trim() ?? "";
  const resolvedHostToken =
    normalizedBaseUrl && isLoopbackAiWorkServerUrl(normalizedBaseUrl)
      ? settings.hostToken?.trim() ?? ""
      : "";
  const storedConnectionIsStaleDesktopRuntime = Boolean(
    staleDesktopRuntimeBaseUrl && normalizedBaseUrl === staleDesktopRuntimeBaseUrl,
  );
  const source =
    !storedConnectionIsStaleDesktopRuntime && hasUsableConnection(normalizedBaseUrl, resolvedToken)
      ? "stored-settings"
      : "empty";

  return {
    normalizedBaseUrl: source === "empty" ? "" : normalizedBaseUrl,
    resolvedToken: source === "empty" ? "" : resolvedToken,
    resolvedHostToken: source === "empty" ? "" : resolvedHostToken,
    hostInfo: null,
    source,
  };
}
