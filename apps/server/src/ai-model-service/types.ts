export type ModelProviderType = "openai" | "openai-compatible" | "anthropic" | "google";

export type ListModelsInput = {
  baseURL: string;
  apiKey: string;
};

export type ListModelsResult =
  | { ok: true; ids: string[] }
  | { ok: false; message: string; httpStatus?: number };
