export type EmbeddedRuntimeBundle = {
  manifestPath: string;
  opencodePath: string;
  routerPath: string;
};

declare global {
  var __AIWORK_SERVER_V2_EMBEDDED_RUNTIME__:
    | EmbeddedRuntimeBundle
    | undefined;
}

export function registerEmbeddedRuntimeBundle(bundle: EmbeddedRuntimeBundle | undefined) {
  globalThis.__AIWORK_SERVER_V2_EMBEDDED_RUNTIME__ = bundle;
}

export function getEmbeddedRuntimeBundle() {
  return globalThis.__AIWORK_SERVER_V2_EMBEDDED_RUNTIME__ ?? null;
}
