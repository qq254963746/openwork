import { createClient } from "../generated/client/index";
import type { Client, Config, CreateClientConfig } from "../generated/client/index";

export type AiWorkServerClientConfig = Config;
export type AiWorkServerClient = Client;
export type AiWorkServerClientFactory = CreateClientConfig;

export function normalizeServerBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "") || baseUrl;
}

export function createAiWorkServerClient(config: AiWorkServerClientConfig = {}): AiWorkServerClient {
  return createClient({
    ...config,
    baseUrl: config.baseUrl ? normalizeServerBaseUrl(config.baseUrl) : config.baseUrl,
  });
}
