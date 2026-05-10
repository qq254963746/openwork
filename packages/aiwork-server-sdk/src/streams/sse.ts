import { createSseClient } from "../../generated/core/serverSentEvents.gen";
import type { ServerSentEventsOptions, ServerSentEventsResult, StreamEvent } from "../../generated/core/serverSentEvents.gen";

export type AiWorkServerEventStreamOptions<TData = unknown> = ServerSentEventsOptions<TData>;
export type AiWorkServerEventStreamResult<TData = unknown> = ServerSentEventsResult<TData>;
export type AiWorkServerStreamEvent<TData = unknown> = StreamEvent<TData>;

export function createAiWorkServerEventStream<TData = unknown>(options: AiWorkServerEventStreamOptions<TData>) {
  return createSseClient<TData>(options as ServerSentEventsOptions<unknown>) as AiWorkServerEventStreamResult<TData>;
}
