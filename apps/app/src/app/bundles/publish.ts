import type {
  AiWorkServerClient,
  AiWorkWorkspaceExport,
} from "../lib/aiwork-server";
import type { SkillsSetBundleV1 } from "./types";

export function buildSkillsSetBundle(
  workspaceName: string,
  exported: AiWorkWorkspaceExport,
): SkillsSetBundleV1 {
  const skills = Array.isArray(exported.skills) ? exported.skills : [];
  if (!skills.length) {
    throw new Error("No skills found in this workspace.");
  }

  return {
    schemaVersion: 1,
    type: "skills-set",
    name: `${workspaceName} skills`,
    description: "Complete skills set from an AiWork workspace.",
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      content: skill.content,
    })),
  };
}

export async function publishSkillsSetBundleFromWorkspace(input: {
  client: AiWorkServerClient;
  workspaceId: string;
  workspaceName: string;
}) {
  const exported = await input.client.exportWorkspace(input.workspaceId, {
    sensitiveMode: "exclude",
  });
  const payload = buildSkillsSetBundle(input.workspaceName, exported);
  return input.client.publishBundle(payload, "skills-set", {
    name: payload.name,
  });
}
