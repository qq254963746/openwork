import type { ListModelsInput, ListModelsResult, ModelProviderType } from "./types.js";
import { listModels as listAnthropic } from "./anthropic.js";
import { listModels as listGoogle } from "./google.js";
import { listModels as listOpenAi } from "./openai.js";
import { listModels as listOpenAiCompatible } from "./openai-compatible.js";

const KNOWN_TYPES = new Set<string>(["openai", "openai-compatible", "anthropic", "google"]);

export function parseModelProviderType(raw: unknown): ModelProviderType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!KNOWN_TYPES.has(t)) return null;
  return t as ModelProviderType;
}

export async function listModelsByProviderType(
  providerType: ModelProviderType,
  input: ListModelsInput,
): Promise<ListModelsResult> {
  switch (providerType) {
    case "openai":
      return listOpenAi(input);
    case "openai-compatible":
      return listOpenAiCompatible(input);
    case "anthropic":
      return listAnthropic(input);
    case "google":
      return listGoogle(input);
    default:
      return { ok: false, message: "unknown providerType" };
  }
}
