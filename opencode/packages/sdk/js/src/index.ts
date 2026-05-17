export * from "./client.js"
export * from "./server.js"

import { createAiWorkEngineClient } from "./client.js"
import { createAiWorkEngineServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAiWorkEngine(options?: ServerOptions) {
  const server = await createAiWorkEngineServer({
    ...options,
  })

  const client = createAiWorkEngineClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
