import type { Provider as ConfigProvider, ProviderListResponse } from "@engine/sdk/v2/client";

const PINNED_PROVIDER_ORDER = ["engine", "openai", "anthropic"] as const;

export const providerPriorityRank = (id: string) => {
  const normalized = id.trim().toLowerCase();
  const index = PINNED_PROVIDER_ORDER.indexOf(
    normalized as (typeof PINNED_PROVIDER_ORDER)[number],
  );
  return index === -1 ? PINNED_PROVIDER_ORDER.length : index;
};

/**
 * When Engine does not surface `options.baseURL`, we still prefill the Connect
 * Providers field with the usual public endpoint for well-known providers.
 * Keep in sync with provider packages / docs where possible.
 */
const WELL_KNOWN_PROVIDER_API_BASE: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  cerebras: "https://api.cerebras.ai/v1",
  cohere: "https://api.cohere.com/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  nebius: "https://api.studio.nebius.ai/v1",
  "openai-compatible": "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * Value to prefill in the API base URL field: project `options.baseURL` if
 * present, otherwise a catalog default for common provider ids.
 */
export function resolveProviderInitialApiBaseUrl(
  providerId: string,
  options?: Record<string, unknown>,
): string {
  if (options && typeof options === "object") {
    const o = options as Record<string, unknown>;
    const fromOptions = o.baseURL ?? o.baseUrl;
    if (typeof fromOptions === "string" && fromOptions.trim()) {
      return fromOptions.trim();
    }
  }
  const key = providerId.trim().toLowerCase();
  return WELL_KNOWN_PROVIDER_API_BASE[key] ?? "";
}

export const compareProviders = (
  a: { id: string; name?: string },
  b: { id: string; name?: string },
) => {
  const rankDiff = providerPriorityRank(a.id) - providerPriorityRank(b.id);
  if (rankDiff !== 0) return rankDiff;

  const aName = (a.name ?? a.id).trim();
  const bName = (b.name ?? b.id).trim();
  return aName.localeCompare(bName);
};

// Starting with @engine/sdk@1.4.x, `ConfigProvider` (from `config.providers()`)
// and the provider items in `ProviderListResponse.all` share the same shape, so
// this mapper is effectively an identity function. It is kept for call-site
// stability and to normalize optional fields (`name`, `env`).
export const mapConfigProvidersToList = (
  providers: ConfigProvider[],
): ProviderListResponse["all"] =>
  providers.map((provider) => ({
    ...provider,
    name: provider.name ?? provider.id,
    env: provider.env ?? [],
  }));

export const filterProviderList = (
  value: ProviderListResponse,
  disabledProviders: string[],
): ProviderListResponse => {
  const disabled = new Set(disabledProviders.map((id) => id.trim()).filter(Boolean));
  if (!disabled.size) return value;
  return {
    all: value.all.filter((provider) => !disabled.has(provider.id)),
    connected: value.connected.filter((id) => !disabled.has(id)),
    default: Object.fromEntries(
      Object.entries(value.default).filter(([id]) => !disabled.has(id)),
    ),
  };
};
