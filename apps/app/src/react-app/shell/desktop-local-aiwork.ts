import {
  engineInfo,
  engineStart,
  aiworkServerInfo,
} from "../../app/lib/desktop";
import { readAiWorkServerSettings, writeAiWorkServerSettings } from "../../app/lib/aiwork-server";
import { safeStringify } from "../../app/utils";
import { recordInspectorEvent } from "./app-inspector";

type LocalWorkspaceLike = {
  id: string;
  name?: string | null;
  displayNameResolved?: string | null;
  path?: string | null;
  workspaceType?: "local" | "remote" | string | null;
};

type EnsureDesktopLocalAiWorkOptions = {
  route: "session" | "settings";
  workspace: LocalWorkspaceLike | null | undefined;
  allWorkspaces: LocalWorkspaceLike[];
};

function emitAiWorkSettingsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("aiwork-server-settings-changed"));
  } catch {
    // ignore browser event dispatch failures
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : "Unknown error";
}

export async function ensureDesktopLocalAiWorkConnection(
  options: EnsureDesktopLocalAiWorkOptions,
) {
  const workspace = options.workspace;
  const workspaceRoot = workspace?.path?.trim() ?? "";
  if (!workspace || workspace.workspaceType !== "local" || !workspaceRoot) {
    return null;
  }

  const workspacePaths = Array.from(
    new Set(
      options.allWorkspaces
        .filter((item) => item.workspaceType === "local")
        .map((item) => item.path?.trim() ?? "")
        .filter((path) => path.length > 0),
    ),
  );
  if (!workspacePaths.includes(workspaceRoot)) {
    workspacePaths.unshift(workspaceRoot);
  }

  recordInspectorEvent("route.local_aiwork.ensure.start", {
    route: options.route,
    workspaceId: workspace.id,
    workspaceRoot,
  });

  try {
    const engine = await engineInfo().catch(() => null);
    if (!engine?.running || !engine.baseUrl) {
      await engineStart(workspaceRoot, {
        runtime: "direct",
        workspacePaths,
        aiworkRemoteAccess: readAiWorkServerSettings().remoteAccessEnabled === true,
      });
    }

    const info = await aiworkServerInfo();
    if (!info?.baseUrl) {
      throw new Error("AiWork server did not report a base URL after activation.");
    }

    writeAiWorkServerSettings({
      urlOverride: info.baseUrl,
      token: info.ownerToken?.trim() || info.clientToken?.trim() || undefined,
      hostToken: info.hostToken?.trim() || undefined,
      portOverride: info.port ?? undefined,
      remoteAccessEnabled: info.remoteAccessEnabled === true,
    });
    emitAiWorkSettingsChanged();

    recordInspectorEvent("route.local_aiwork.ensure.success", {
      route: options.route,
      workspaceId: workspace.id,
      workspaceRoot,
      baseUrl: info.baseUrl,
    });

    return info;
  } catch (error) {
    const message = describeError(error);
    console.error(`[${options.route}-route] local workspace reconnect failed`, error);
    recordInspectorEvent("route.local_aiwork.ensure.error", {
      route: options.route,
      workspaceId: workspace.id,
      workspaceRoot,
      message,
    });
    throw new Error(message);
  }
}
