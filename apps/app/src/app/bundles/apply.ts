import type { WorkspaceDisplay } from "../types";
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
  return Boolean(workspace.path?.trim());
}

export function resolveBundleImportTargetForWorkspace(
  workspace: WorkspaceDisplay | WorkspaceInfo | null,
): BundleImportTarget | undefined {
  if (!workspace) return undefined;
  const localRoot = workspace.path?.trim() ?? "";
  return localRoot ? { localRoot } : undefined;
}

export function describeWorkspaceForBundleToasts(workspace: WorkspaceDisplay | WorkspaceInfo | null): string {
  return (
    workspace?.displayName?.trim() ||
    workspace?.name?.trim() ||
    workspace?.path?.trim() ||
    "the selected worker"
  );
}
