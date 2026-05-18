declare global {
  const ENGINE_VERSION: string
}

export const EngineVersion = typeof ENGINE_VERSION === "string" ? ENGINE_VERSION : "local"
export const IS_ENGINE_DEV_MODE = process.env.AIWORK_DEV_MODE === "1";