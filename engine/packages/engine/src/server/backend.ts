import { Flag } from "@/core/flag/flag"
import { EngineVersion } from "@/core/env/env"

export type Backend = "effect-httpapi" | "hono"

export type Selection = {
  backend: Backend
  reason: "env" | "stable" | "explicit"
}

export type Attributes = ReturnType<typeof attributes>

export function select(): Selection {
  if (Flag.ENGINE_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
  return { backend: "hono", reason: "stable" }
}

export function attributes(selection: Selection): Record<string, string> {
  return {
    "engine.server.backend": selection.backend,
    "engine.server.backend.reason": selection.reason,
    "engine.server.version": EngineVersion,
  }
}

export function force(selection: Selection, backend: Backend): Selection {
  return {
    backend,
    reason: selection.backend === backend ? selection.reason : "explicit",
  }
}
