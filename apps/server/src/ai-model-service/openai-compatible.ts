import type { ListModelsInput, ListModelsResult } from "./types.js";
import { listModels as listOpenAiStyleModels } from "./openai.js";

/** OpenAI-compatible `GET .../v1/models` (Bearer) — same wire shape as OpenAI. */
export async function listModels(input: ListModelsInput): Promise<ListModelsResult> {
  return listOpenAiStyleModels(input);
}
