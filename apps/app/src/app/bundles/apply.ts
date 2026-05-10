import type { WorkspaceDisplay } from "../types";
import { parseAiWorkWorkspaceIdFromUrl } from "../lib/aiwork-server";
import type { WorkspaceInfo } from "../lib/desktop";
import type { BundleImportTarget, BundleV1 } from "./types";

export function buildImportPayloadFromBundle(bundle: BundleV1): {
  payload: Record<string, unknown>;
  importedSkillsCount: number;
} {
  if (bundle.type === "skill") {
    return {
      payload: {
        mode: { skills: "merge" },
        skills: [
          {
            name: bundle.name,
            description: bundle.description,
            trigger: bundle.trigger,
            content: bundle.content,
          },
        ],
      },
      importedSkillsCount: 1,
    };
  }

  if (bundle.type === "skills-set") {
    return {
      payload: {
        mode: { skills: "merge" },
        skills: bundle.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          trigger: skill.trigger,
          content: skill.content,
        })),
      },
      importedSkillsCount: bundle.skills.length,
    };
  }

  throw new Error(`Unsupported bundle type: ${(bundle as { type?: string }).type || "unknown"}`);
}

export function isBundleImportWorkspace(workspace: WorkspaceDisplay | WorkspaceInfo | null): boolean {
  if (!workspace?.id?.trim()) return false;
  if (workspace.workspaceType === "local") {
    return Boolean(workspace.path?.trim());
  }
  return Boolean(workspace.remoteType === "aiwork" || workspace.aiworkHostUrl?.trim() || workspace.aiworkWorkspaceId?.trim());
}

export function resolveBundleImportTargetForWorkspace(
  workspace: WorkspaceDisplay | WorkspaceInfo | null,
): BundleImportTarget | undefined {
  if (!workspace) return undefined;
  if (workspace.workspaceType === "local") {
    const localRoot = workspace.path?.trim() ?? "";
    return localRoot ? { localRoot } : undefined;
  }

  const workspaceId =
    workspace.aiworkWorkspaceId?.trim() ||
    parseAiWorkWorkspaceIdFromUrl(workspace.aiworkHostUrl ?? "") ||
    parseAiWorkWorkspaceIdFromUrl(workspace.baseUrl ?? "") ||
    null;
  const directoryHint = workspace.directory?.trim() || workspace.path?.trim() || null;
  if (workspaceId || directoryHint) {
    return {
      workspaceId,
      directoryHint,
    };
  }
  return undefined;
}

export function describeWorkspaceForBundleToasts(workspace: WorkspaceDisplay | WorkspaceInfo | null): string {
  return (
    workspace?.displayName?.trim() ||
    workspace?.aiworkWorkspaceName?.trim() ||
    workspace?.name?.trim() ||
    workspace?.directory?.trim() ||
    workspace?.path?.trim() ||
    workspace?.baseUrl?.trim() ||
    "the selected worker"
  );
}
