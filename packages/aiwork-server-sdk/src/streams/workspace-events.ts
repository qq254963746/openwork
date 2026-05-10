import { normalizeServerBaseUrl } from "../client.js";
import type { AiWorkServerV2WorkspaceEvent } from "../../generated/types.gen";
import {
  createAiWorkServerEventStream,
  type AiWorkServerEventStreamOptions,
  type AiWorkServerEventStreamResult,
} from "./sse.js";

export type AiWorkServerWorkspaceEvent = AiWorkServerV2WorkspaceEvent;

export type AiWorkServerWorkspaceEventStreamOptions = Omit<
  AiWorkServerEventStreamOptions<AiWorkServerWorkspaceEvent>,
  "url"
> & {
  baseUrl: string;
  workspaceId: string;
};

export type AiWorkServerWorkspaceEventStreamResult = AiWorkServerEventStreamResult<AiWorkServerWorkspaceEvent>;

export function createAiWorkServerWorkspaceEventStream(
  options: AiWorkServerWorkspaceEventStreamOptions,
): AiWorkServerWorkspaceEventStreamResult {
  const baseUrl = normalizeServerBaseUrl(options.baseUrl);
  const url = `${baseUrl}/workspaces/${encodeURIComponent(options.workspaceId)}/events`;
  return createAiWorkServerEventStream<AiWorkServerWorkspaceEvent>({
    ...options,
    url,
  });
}
