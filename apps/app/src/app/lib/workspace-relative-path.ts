/**
 * Normalize paths from tools / transcripts / OS into workspace-relative POSIX segments
 * for AiWork server APIs (`readWorkspaceFile`, etc.). Keeps message transcript + workspace
 * panel aligned with server `normalizeWorkspaceRelativePath`.
 */

export function looksAbsoluteWorkspacePath(p: string): boolean {
  const n = p.trim().replace(/\\/g, "/");
  return n.startsWith("/") || /^[a-zA-Z]:\//.test(n);
}

export function normalizeWorkspaceRelativeFetchPath(raw: string): string {
  let s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  s = s.replace(/^\/+/, "");
  s = s.replace(/^\.\//, "");
  s = s.replace(/^workspace\//i, "");
  s = s.replace(/^\/+/, "");
  const parts = s.split("/").filter(Boolean);
  return parts.join("/");
}

export function tryStripWorkspaceRootPrefix(posixPath: string, workspaceRoot: string): string | null {
  const root = workspaceRoot.trim().replace(/[/\\]+$/, "").replace(/\\/g, "/");
  if (!root) return null;
  const p = posixPath.replace(/\\/g, "/");
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (p === root) return "";
  if (!p.startsWith(prefix)) return null;
  const rest = p.slice(prefix.length);
  const n = normalizeWorkspaceRelativeFetchPath(rest);
  return n || null;
}

/**
 * Path string suitable for `readWorkspaceFile(workspaceId, path)` / GET .../files/content?path=
 */
export function workspaceRelativePathForServerRead(raw: string, workspaceRoot: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const slash = trimmed.replace(/\\/g, "/");

  if (/^[a-zA-Z]:\//.test(slash)) {
    return tryStripWorkspaceRootPrefix(slash, workspaceRoot);
  }

  if (slash.startsWith("/")) {
    const rootTrim = workspaceRoot.trim();
    if (rootTrim) {
      const stripped = tryStripWorkspaceRootPrefix(slash, workspaceRoot);
      if (stripped != null) return stripped;
    }
    if (/^\/(Users|home|Volumes|private)\//i.test(slash)) {
      return null;
    }
    const n = normalizeWorkspaceRelativeFetchPath(slash);
    return n || null;
  }

  const rel = normalizeWorkspaceRelativeFetchPath(slash);
  return rel || null;
}
