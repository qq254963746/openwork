/**
 * Normalizes hosted OpenWork web app / API base URLs (formerly routed via Den client helpers).
 */

export const DEFAULT_OPENWORK_APP_URL =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_BASE_URL === "string"
    ? import.meta.env.VITE_DEN_BASE_URL
    : "").trim() || "https://app.openworklabs.com";

const BUILD_OPENWORK_API_URL =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_API_BASE_URL === "string"
    ? import.meta.env.VITE_DEN_API_BASE_URL
    : "").trim() || undefined;

export type OpenworkAppBaseUrls = {
  baseUrl: string;
  apiBaseUrl: string;
};

export function normalizeOpenworkAppUrl(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isWebAppHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [first, second, third, fourth] = ipv4Match.slice(1).map(Number);
    const octets = [first, second, third, fourth];
    if (octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      if (
        first === 10 ||
        first === 127 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 169 && second === 254) ||
        (first === 100 && second >= 64 && second <= 127)
      ) {
        return true;
      }
    }
  }

  return normalized === "app.openworklabs.com" || normalized === "app.openwork.software" || normalized.startsWith("app.");
}

function stripApiDenBasePath(input: string | null | undefined): string | null {
  const normalized = normalizeOpenworkAppUrl(input);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    const suffix = "/api/den";
    if (!pathname.toLowerCase().endsWith(suffix)) {
      return normalized;
    }

    const nextPathname = pathname.slice(0, -suffix.length) || "/";
    url.pathname = nextPathname;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

function ensureApiDenBasePath(input: string | null | undefined): string | null {
  const normalized = normalizeOpenworkAppUrl(input);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    url.pathname = `${pathname}/api/den`.replace(/\/+/g, "/");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

function deriveApiBaseUrl(input: string | null | undefined): string {
  const normalized = normalizeOpenworkAppUrl(input) ?? DEFAULT_OPENWORK_APP_URL;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    if (isWebAppHost(url.hostname)) {
      return ensureApiDenBasePath(normalized) ?? normalized;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export function resolveOpenworkAppBaseUrls(input: {
  baseUrl?: string | null;
  apiBaseUrl?: string | null;
} | string | null | undefined): OpenworkAppBaseUrls {
  const rawBaseUrl = typeof input === "string" ? input : input?.baseUrl;
  const rawApiBaseUrl = typeof input === "string" ? null : input?.apiBaseUrl;
  const normalizedBaseUrl = normalizeOpenworkAppUrl(rawBaseUrl);
  const normalizedApiBaseUrl = normalizeOpenworkAppUrl(rawApiBaseUrl);
  const seedUrl = normalizedBaseUrl ?? normalizedApiBaseUrl ?? DEFAULT_OPENWORK_APP_URL;

  return {
    baseUrl: stripApiDenBasePath(normalizedBaseUrl ?? seedUrl) ?? DEFAULT_OPENWORK_APP_URL,
    apiBaseUrl: normalizedApiBaseUrl ?? deriveApiBaseUrl(seedUrl),
  };
}

export { BUILD_OPENWORK_API_URL };
