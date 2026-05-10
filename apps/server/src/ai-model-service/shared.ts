import { ApiError } from "../errors.js";

/** Same path rules as app `resolveOpenAiCompatibleModelsUrl`. */
export function resolveOpenAiCompatibleModelsListUrl(baseURL: string): string {
  const t = baseURL.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(t)) return `${t}/models`;
  return `${t}/v1/models`;
}

/** Reduce SSRF risk when the AiWork server proxies upstream HTTP calls. */
export function assertPublicHttpUrlForModelProxy(href: string): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new ApiError(400, "invalid_payload", "Invalid URL for models request");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "invalid_payload", "Models URL must be http or https");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  ) {
    throw new ApiError(
      400,
      "invalid_payload",
      "Refusing to proxy models list to loopback (use a reachable host or run the desktop app)",
    );
  }
}

export async function fetchWithModelsTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(60_000)
      : undefined;
  return fetch(url, { ...init, signal });
}
