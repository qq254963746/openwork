import type { AiWorkStore } from "./store";

export const selectActiveWorkspace = (state: AiWorkStore) =>
  state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  ) ?? null;

export const selectServerStatus = (state: AiWorkStore) => state.server.status;

export const selectServerUrl = (state: AiWorkStore) => state.server.url;

export const selectErrorBanner = (state: AiWorkStore) => state.errorBanner;
