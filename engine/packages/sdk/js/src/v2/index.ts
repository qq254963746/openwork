export * from "./client.js"
export * from "./server.js"

import { createEngineClient } from "./client.js"
import { createEngineServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createEngine(options?: ServerOptions) {
  const server = await createEngineServer({
    ...options,
  })

  const client = createEngineClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
