declare global {
  const AIWORK_ENGINE_VERSION: string
}

export const AiWorkEngineVersion = typeof AIWORK_ENGINE_VERSION === "string" ? AIWORK_ENGINE_VERSION : "local"
export const IS_AIWORK_ENGINE_DEV_MODE = process.env.AIWORK_DEV_MODE === "1";