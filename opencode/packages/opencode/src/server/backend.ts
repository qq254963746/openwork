import { Flag } from "@/core/flag/flag"
import { AiWorkEngineVersion } from "@/core/env/env"

export type Backend = "effect-httpapi" | "hono"

export type Selection = {
  backend: Backend
  reason: "env" | "stable" | "explicit"
}

export type Attributes = ReturnType<typeof attributes>

export function select(): Selection {
  if (Flag.AIWORK_ENGINE_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
  return { backend: "hono", reason: "stable" }
}

export function attributes(selection: Selection): Record<string, string> {
  return {
    "opencode.server.backend": selection.backend,
    "opencode.server.backend.reason": selection.reason,
    "opencode.server.version": AiWorkEngineVersion,
  }
}

export function force(selection: Selection, backend: Backend): Selection {
  return {
    backend,
    reason: selection.backend === backend ? selection.reason : "explicit",
  }
}
