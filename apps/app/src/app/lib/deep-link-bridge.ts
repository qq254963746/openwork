export const deepLinkBridgeEvent = "aiwork:deep-link";
export const nativeDeepLinkEvent = "aiwork:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __AIWORK__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean);
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__AIWORK__ ??= {};
  const pending = target.__AIWORK__.deepLinks ?? [];
  target.__AIWORK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__AIWORK__?.deepLinks ?? [];
  if (target.__AIWORK__) {
    target.__AIWORK__.deepLinks = [];
  }
  return [...pending];
}
