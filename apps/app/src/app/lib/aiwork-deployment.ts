export const AIWORK_DEPLOYMENT_ENV_VAR = "VITE_AIWORK_DEPLOYMENT";

export type AiWorkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): AiWorkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getAiWorkDeployment(): AiWorkDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_AIWORK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_AIWORK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}