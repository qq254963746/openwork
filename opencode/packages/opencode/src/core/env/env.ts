declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const OpenCodeVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const OpenCodeChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const IS_DEV_MODE = process.env.AIWORK_DEV_MODE === "1";