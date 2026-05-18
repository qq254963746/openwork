// Patterns that indicate a path is a truncated system/absolute path rather than a workspace-relative path
const TRUNCATED_SYSTEM_PATH_PATTERNS = [
  /com\.[^/]+\.(aiwork|engine)/i, // macOS app bundle identifiers
  /\.aiwork\.dev\//i, // AiWork dev paths
  /Application Support\//i, // macOS Application Support
  /AppData[/\\]/i, // Windows AppData
  /\.local\/share\//i, // Linux XDG data
  /workspaces\/[^/]+\/workspaces\//i, // Nested workspaces paths (clearly malformed)
];

/**
 * Clean up an artifact path to extract the workspace-relative portion.
 * Returns null if the path should be rejected entirely.
 */
export function cleanArtifactPath(rawPath: string): string | null {
  const normalized = rawPath.trim().replace(/[\\/]+/g, "/");
  if (!normalized) return null;

  for (const pattern of TRUNCATED_SYSTEM_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      const workspacesMatch = normalized.match(/workspaces\/[^/]+\/(.+)$/i);
      if (workspacesMatch?.[1]) {
        const relative = workspacesMatch[1];
        if (!TRUNCATED_SYSTEM_PATH_PATTERNS.some((p) => p.test(relative))) {
          return relative;
        }
      }
      return null;
    }
  }

  return normalized;
}
