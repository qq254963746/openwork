import type { ServerConfig, WorkspaceInfo } from "./types.js";

type AiWorkEngineConnection = {
  baseUrl?: string;
  authHeader?: string;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function resolveWorkspaceAiWorkEngineConnection(
  config: Pick<ServerConfig, "opencodeBaseUrl" | "opencodeUsername" | "opencodePassword">,
  workspace: WorkspaceInfo,
): AiWorkEngineConnection {
  const baseUrl = trim(workspace.opencode?.baseUrl) || trim(config.opencodeBaseUrl) || undefined;
  const username =
    trim(workspace.opencode?.username) || trim(workspace.opencodeUsername) || trim(config.opencodeUsername);
  const password =
    trim(workspace.opencode?.password) || trim(workspace.opencodePassword) || trim(config.opencodePassword);

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(username && password
      ? {
          authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        }
      : {}),
  };
}

export function inheritWorkspaceAiWorkEngineConnection(
  config: Pick<ServerConfig, "opencodeBaseUrl" | "opencodeUsername" | "opencodePassword">,
): Partial<WorkspaceInfo> {
  const baseUrl = trim(config.opencodeBaseUrl);
  const username = trim(config.opencodeUsername);
  const password = trim(config.opencodePassword);

  return {
    ...(baseUrl || username || password
      ? {
          opencode: {
            ...(baseUrl ? { baseUrl } : {}),
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          },
        }
      : {}),
    ...(username ? { opencodeUsername: username } : {}),
    ...(password ? { opencodePassword: password } : {}),
  };
}
