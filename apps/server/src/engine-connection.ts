import type { ServerConfig, WorkspaceInfo } from "./types.js";

type EngineConnection = {
  baseUrl?: string;
  authHeader?: string;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function resolveWorkspaceEngineConnection(
  config: Pick<ServerConfig, "engineBaseUrl" | "engineUsername" | "enginePassword">,
  workspace: WorkspaceInfo,
): EngineConnection {
  const baseUrl = trim(workspace.engine?.baseUrl) || trim(config.engineBaseUrl) || undefined;
  const username =
    trim(workspace.engine?.username) || trim(workspace.engineUsername) || trim(config.engineUsername);
  const password =
    trim(workspace.engine?.password) || trim(workspace.enginePassword) || trim(config.enginePassword);

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(username && password
      ? {
          authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        }
      : {}),
  };
}

export function inheritWorkspaceEngineConnection(
  config: Pick<ServerConfig, "engineBaseUrl" | "engineUsername" | "enginePassword">,
): Partial<WorkspaceInfo> {
  const baseUrl = trim(config.engineBaseUrl);
  const username = trim(config.engineUsername);
  const password = trim(config.enginePassword);

  return {
    ...(baseUrl || username || password
      ? {
          engine: {
            ...(baseUrl ? { baseUrl } : {}),
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          },
        }
      : {}),
    ...(username ? { engineUsername: username } : {}),
    ...(password ? { enginePassword: password } : {}),
  };
}
