import type { McpServer } from "@agentclientprotocol/sdk"
import type { EngineClient } from "@engine/sdk/v2"
import type { ProviderID, ModelID } from "../provider/schema"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: EngineClient
  defaultModel?: {
    providerID: ProviderID
    modelID: ModelID
  }
}
