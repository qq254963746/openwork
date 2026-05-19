import { spawn } from "node:child_process";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readFile, writeFile, rm, rename, readdir, stat } from "node:fs/promises";
import { ApiError } from "../errors.js";
import { exists, ensureDir, shortId } from "../utils.js";
import { logger as fileLogger } from "../log-util.js";
import type { Route, HandlerDeps, RequestContext } from "./handler-deps.js";
import { addRoute } from "./handler-deps.js";
import { ApiRoutes } from "@aiwork/server-sdk";

// ---------------------------------------------------------------------------
// Constants (moved from server.ts)
// ---------------------------------------------------------------------------

const FILE_SESSION_DEFAULT_TTL_MS = 15 * 60 * 1000;
const FILE_SESSION_MIN_TTL_MS = 30 * 1000;
const FILE_SESSION_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const FILE_SESSION_MAX_BATCH_ITEMS = 64;
const FILE_SESSION_MAX_FILE_BYTES = 5_000_000;
const FILE_SESSION_CATALOG_DEFAULT_LIMIT = 2000;
const FILE_SESSION_CATALOG_MAX_LIMIT = 10000;

const WORKSPACE_TEXT_SPECIAL_BASENAMES = new Set([
  "dockerfile", "gnumakefile", "makefile", "rakefile", "jenkinsfile", "gemfile", "podfile", "vagrantfile",
  ".gitignore", ".gitattributes", ".gitmodules", ".gitkeep", ".gitmessage", ".gitconfig",
  ".npmrc", ".npmignore", ".nvmrc", ".node-version", ".babelrc", ".browserslistrc",
  ".eslintignore", ".prettierignore", ".prettierrc", ".stylelintignore", ".nycrc", ".jshintrc", ".jshintignore",
  ".python-version", "pipfile", "requirements",
  ".rubocop.yml", ".ruby-version", "gemfile.lock",
  ".env", ".env.local", ".env.development", ".env.production", ".env.test", ".env.example", ".env.sample",
  ".bashrc", ".bash_profile", ".bash_logout", ".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout",
  ".profile", ".inputrc", ".vimrc", ".vim", ".emacs", ".editorconfig", ".direnvrc", ".envrc",
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml",
  ".stylelintrc", ".markdownlint", ".commitlintrc", ".lintstagedrc",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pipfile.lock", "composer.lock",
  ".travis.yml", "procfile",
  ".htaccess", ".curlrc", ".wgetrc", ".netrc",
  "license", "licence", "copying", "notice", "authors", "contributors", "changelog", "history",
  "readme", "todo", "install", "news",
]);

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function fileRevision(info: { mtimeMs: number; size: number }): string {
  return `${Math.floor(info.mtimeMs)}:${info.size}`;
}

function parseFileSessionTtlMs(input: unknown): number {
  const raw = typeof input === "number" && Number.isFinite(input) ? input : Number.NaN;
  if (Number.isNaN(raw)) return FILE_SESSION_DEFAULT_TTL_MS;
  const ttlMs = Math.floor(raw * 1000);
  if (ttlMs < FILE_SESSION_MIN_TTL_MS) return FILE_SESSION_MIN_TTL_MS;
  if (ttlMs > FILE_SESSION_MAX_TTL_MS) return FILE_SESSION_MAX_TTL_MS;
  return ttlMs;
}

function parseCatalogLimit(input: string | null): number {
  if (!input) return FILE_SESSION_CATALOG_DEFAULT_LIMIT;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return FILE_SESSION_CATALOG_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), FILE_SESSION_CATALOG_MAX_LIMIT);
}

function parseSessionCursor(input: string | null): number {
  if (!input) return 0;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function parseCatalogPathFilter(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return normalizeWorkspaceRelativePathLocal(trimmed, { allowSubdirs: true });
}

function matchesCatalogFilter(path: string, filter: string | null): boolean {
  if (!filter) return true;
  return path === filter || path.startsWith(`${filter}/`);
}

function normalizeResolvedRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}

function normalizeWorkspaceRelativePathLocal(input: string, options: { allowSubdirs: boolean }): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (raw.includes("\u0000")) {
    throw new ApiError(400, "invalid_path", "Path contains null byte");
  }
  let normalized = raw.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^workspace\//, "");
  normalized = normalized.replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (!options.allowSubdirs && parts.length > 1) {
    throw new ApiError(400, "invalid_path", "Subdirectories are not allowed");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}

function isSupportedWorkspaceTextFilePath(relativePath: string): boolean {
  const lowered = relativePath.trim().toLowerCase();
  const base = lowered.split("/").pop() ?? lowered;
  if (base.startsWith("dockerfile.")) return true;
  if (WORKSPACE_TEXT_SPECIAL_BASENAMES.has(base)) return true;
  return [
    ".md", ".mdx", ".markdown",
    ".json", ".jsonc", ".json5",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".properties", ".env", ".envrc",
    ".xml", ".plist", ".xhtml",
    ".ts", ".tsx", ".mts", ".cts",
    ".js", ".jsx", ".mjs", ".cjs",
    ".html", ".htm", ".htmlx", ".svg",
    ".css", ".scss", ".sass", ".less", ".styl",
    ".sh", ".bash", ".zsh", ".fish", ".ksh", ".csh",
    ".ps1", ".psm1", ".psd1",
    ".py", ".pyw", ".pyi",
    ".rb", ".rake", ".gemspec",
    ".pl", ".pm",
    ".lua", ".r",
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx",
    ".rs", ".go",
    ".java", ".kt", ".kts",
    ".swift", ".cs", ".vb",
    ".php", ".scala",
    ".clj", ".cljs", ".cljc",
    ".ex", ".exs",
    ".erl", ".hrl",
    ".elm",
    ".ml", ".mli",
    ".hs", ".lhs",
    ".dart",
    ".erb", ".haml", ".slim",
    ".jinja", ".jinja2", ".j2",
    ".ejs", ".mustache", ".hbs",
    ".liquid",
    ".tf", ".tfvars",
    ".gradle", ".groovy",
    ".bazel", ".bzl",
    ".cmake", ".nix",
    ".sql", ".graphql", ".gql",
    ".csv", ".tsv",
    ".txt", ".log", ".diff", ".patch",
    ".rst", ".adoc", ".asciidoc", ".org",
    ".lock", ".sum", ".mod",
    ".vue", ".svelte", ".astro",
    ".mdoc",
    ".tex", ".sty", ".cls", ".bib",
  ].some((ext) => lowered.endsWith(ext));
}

async function listWorkspaceCatalogEntries(workspaceRoot: string): Promise<{
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  revision: string;
}[]> {
  const rootResolved = resolve(workspaceRoot);
  const items: {
    path: string;
    kind: "file" | "dir";
    size: number;
    mtimeMs: number;
    revision: string;
  }[] = [];

  const walk = async (dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absPath = join(dirPath, entry.name);
      const relRaw = relative(rootResolved, absPath).replace(/\\/g, "/");
      const rel = normalizeResolvedRelativePath(relRaw);

      if (entry.isDirectory()) {
        const info = await stat(absPath);
        items.push({ path: rel, kind: "dir", size: 0, mtimeMs: info.mtimeMs, revision: fileRevision({ mtimeMs: info.mtimeMs, size: 0 }) });
        await walk(absPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const info = await stat(absPath);
      items.push({ path: rel, kind: "file", size: info.size, mtimeMs: info.mtimeMs, revision: fileRevision(info) });
    }
  };

  if (await exists(rootResolved)) {
    await walk(rootResolved);
  }

  items.sort((a, b) => a.path.localeCompare(b.path));
  return items;
}

function parseBatchPathList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new ApiError(400, "invalid_payload", "paths must be an array");
  }
  if (!input.length) {
    throw new ApiError(400, "invalid_payload", "paths must not be empty");
  }
  if (input.length > FILE_SESSION_MAX_BATCH_ITEMS) {
    throw new ApiError(400, "invalid_payload", `paths must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`);
  }
  return input.map((raw) => normalizeWorkspaceRelativePathLocal(String(raw ?? ""), { allowSubdirs: true }));
}

function parseBatchWriteList(input: unknown): Array<{ path: string; contentBase64: string; ifMatchRevision?: string; force?: boolean }> {
  if (!Array.isArray(input)) {
    throw new ApiError(400, "invalid_payload", "writes must be an array");
  }
  if (!input.length) {
    throw new ApiError(400, "invalid_payload", "writes must not be empty");
  }
  if (input.length > FILE_SESSION_MAX_BATCH_ITEMS) {
    throw new ApiError(400, "invalid_payload", `writes must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`);
  }

  return input.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new ApiError(400, "invalid_payload", "write entries must be objects");
    }
    const record = raw as Record<string, unknown>;
    const contentBase64 = typeof record.contentBase64 === "string" ? record.contentBase64.trim() : "";
    if (!contentBase64) {
      throw new ApiError(400, "invalid_payload", "contentBase64 is required");
    }
    const ifMatchRevision =
      typeof record.ifMatchRevision === "string" && record.ifMatchRevision.trim().length
        ? record.ifMatchRevision.trim()
        : undefined;
    return {
      path: normalizeWorkspaceRelativePathLocal(String(record.path ?? ""), { allowSubdirs: true }),
      contentBase64,
      ...(ifMatchRevision ? { ifMatchRevision } : {}),
      ...(record.force === true ? { force: true } : {}),
    };
  });
}

function runGitStatus(cwd: string): Promise<Record<string, string>> {
  return new Promise((resolveFn) => {
    let stdout = "";
    let timedOut = false;
    const child = spawn("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "ignore"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
      resolveFn({});
    }, 5000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("binary"); });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut || code !== 0) {
        resolveFn({});
        return;
      }
      const entries: Record<string, string> = {};
      const records = stdout.split("\0");
      for (const record of records) {
        if (record.length < 4) continue;
        const xy = record.slice(0, 2);
        const path = record.slice(3).replace(/\\/g, "/");
        if (!path) continue;
        const x = xy[0] ?? " ";
        const y = xy[1] ?? " ";
        let status: string;
        if (x === "?" && y === "?") {
          status = "?";
        } else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
          status = "U";
        } else if (x !== " " && x !== "?") {
          status = x;
        } else if (y !== " " && y !== "?") {
          status = y;
        } else {
          status = x;
        }
        entries[path] = status;
      }
      resolveFn(entries);
    });

    child.on("error", () => {
      clearTimeout(timeout);
      if (!timedOut) resolveFn({});
    });
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerFileRoutes(routes: Route[], deps: HandlerDeps): void {
  const {
    config, fileSessions, resolveWorkspace, ensureWritable, requireClientScope, requireApproval,
    readJsonBody, jsonResponse, resolveSafeChildPath, normalizeWorkspaceRelativePath,
  } = deps;

  const serializeFileSession = (session: {
    id: string; workspaceId: string; createdAt: number;
    expiresAt: number; canWrite: boolean;
  }) => ({
    id: session.id,
    workspaceId: session.workspaceId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ttlMs: Math.max(0, session.expiresAt - Date.now()),
    canWrite: session.canWrite,
  });

  const resolveFileSession = (ctx: RequestContext, sessionId: string) => {
    const session = fileSessions.get(sessionId);
    if (!session) {
      throw new ApiError(404, "file_session_not_found", "File session not found");
    }
    if (!ctx.actor?.tokenHash || session.actorTokenHash !== ctx.actor.tokenHash) {
      throw new ApiError(403, "forbidden", "File session does not belong to this token");
    }
    const workspace = config.workspaces.find((item) => item.id === session.workspaceId);
    if (!workspace) {
      throw new ApiError(404, "workspace_not_found", "Workspace not found for this file session");
    }
    return { session, workspace };
  };

  const recordWorkspaceFileEvent = (workspaceId: string, input: { type: "write" | "delete" | "rename" | "mkdir"; path: string; toPath?: string; revision?: string }) => {
    return fileSessions.recordWorkspaceEvent({ workspaceId, ...input });
  };

  function scopeRank(scope: string): number {
    if (scope === "viewer") return 1;
    if (scope === "collaborator") return 2;
    return 3;
  }

  // POST /workspace/:id/files/sessions
  addRoute(routes, "POST", ApiRoutes.WORKSPACE_FILES_SESSIONS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const ttlMs = parseFileSessionTtlMs((body as Record<string, unknown>).ttlSeconds);
    const requestWrite = (body as Record<string, unknown>).write !== false;
    const canWrite =
      requestWrite &&
      !config.readOnly &&
      scopeRank(ctx.actor?.scope ?? "viewer") >= scopeRank("collaborator");

    const session = fileSessions.create({
      workspaceId: workspace.id,
      workspaceRoot: workspace.path,
      actorTokenHash: ctx.actor?.tokenHash ?? "",
      actorScope: ctx.actor?.scope ?? "viewer",
      canWrite,
      ttlMs,
    });

    return jsonResponse({ session: serializeFileSession(session) });
  });

  // POST /files/sessions/:sessionId/renew
  addRoute(routes, "POST", ApiRoutes.FILES_SESSIONS_RENEW, "client", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const ttlMs = parseFileSessionTtlMs((body as Record<string, unknown>).ttlSeconds);
    const { session } = resolveFileSession(ctx, ctx.params.sessionId);
    const renewed = fileSessions.renew(session.id, ttlMs);
    if (!renewed) {
      throw new ApiError(404, "file_session_not_found", "File session not found");
    }
    return jsonResponse({ session: serializeFileSession(renewed) });
  });

  // DELETE /files/sessions/:sessionId
  addRoute(routes, "DELETE", ApiRoutes.FILES_SESSIONS_DELETE, "client", async (ctx) => {
    const { session } = resolveFileSession(ctx, ctx.params.sessionId);
    fileSessions.close(session.id);
    return jsonResponse({ ok: true });
  });

  // GET /files/sessions/:sessionId/catalog/snapshot
  addRoute(routes, "GET", ApiRoutes.FILES_SESSIONS_CATALOG_SNAPSHOT, "client", async (ctx) => {
    const { workspace } = resolveFileSession(ctx, ctx.params.sessionId);
    const prefix = parseCatalogPathFilter(ctx.url.searchParams.get("prefix"));
    const after = parseCatalogPathFilter(ctx.url.searchParams.get("after"));
    const includeDirs = ctx.url.searchParams.get("includeDirs") !== "false";
    const limit = parseCatalogLimit(ctx.url.searchParams.get("limit"));

    const entries = await listWorkspaceCatalogEntries(workspace.path);
    const filtered = entries.filter((entry) => {
      if (!includeDirs && entry.kind === "dir") return false;
      if (!matchesCatalogFilter(entry.path, prefix)) return false;
      if (after && entry.path <= after) return false;
      return true;
    });

    const items = filtered.slice(0, limit);
    const truncated = filtered.length > items.length;
    const nextAfter = truncated ? items[items.length - 1]?.path : undefined;
    const events = fileSessions.listWorkspaceEvents(workspace.id, Number.MAX_SAFE_INTEGER);

    return jsonResponse({
      sessionId: ctx.params.sessionId,
      workspaceId: workspace.id,
      generatedAt: Date.now(),
      cursor: events.cursor,
      total: filtered.length,
      truncated,
      nextAfter,
      items,
    });
  });

  // GET /files/sessions/:sessionId/catalog/events
  addRoute(routes, "GET", ApiRoutes.FILES_SESSIONS_CATALOG_EVENTS, "client", async (ctx) => {
    const { workspace } = resolveFileSession(ctx, ctx.params.sessionId);
    const since = parseSessionCursor(ctx.url.searchParams.get("since"));
    const events = fileSessions.listWorkspaceEvents(workspace.id, since);
    return jsonResponse(events);
  });

  // POST /files/sessions/:sessionId/read-batch
  addRoute(routes, "POST", ApiRoutes.FILES_SESSIONS_READ_BATCH, "client", async (ctx) => {
    const { workspace } = resolveFileSession(ctx, ctx.params.sessionId);
    const body = await readJsonBody(ctx.request);
    const paths = parseBatchPathList((body as Record<string, unknown>).paths);
    const items: Array<Record<string, unknown>> = [];

    for (const relativePath of paths) {
      try {
        const absPath = resolveSafeChildPath(workspace.path, relativePath);
        if (!(await exists(absPath))) {
          items.push({ ok: false, path: relativePath, code: "file_not_found", message: "File not found" });
          continue;
        }
        const info = await stat(absPath);
        if (!info.isFile()) {
          items.push({ ok: false, path: relativePath, code: "file_not_found", message: "File not found" });
          continue;
        }
        if (info.size > FILE_SESSION_MAX_FILE_BYTES) {
          items.push({ ok: false, path: relativePath, code: "file_too_large", message: "File exceeds size limit", maxBytes: FILE_SESSION_MAX_FILE_BYTES, size: info.size });
          continue;
        }
        const content = await readFile(absPath);
        items.push({ ok: true, path: relativePath, kind: "file", bytes: info.size, updatedAt: info.mtimeMs, revision: fileRevision(info), contentBase64: content.toString("base64") });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Unable to read file";
        const code = error instanceof ApiError ? error.code : "read_failed";
        items.push({ ok: false, path: relativePath, code, message });
      }
    }

    return jsonResponse({ items });
  });

  // POST /files/sessions/:sessionId/write-batch
  addRoute(routes, "POST", ApiRoutes.FILES_SESSIONS_WRITE_BATCH, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const { session, workspace } = resolveFileSession(ctx, ctx.params.sessionId);
    if (!session.canWrite) {
      throw new ApiError(403, "forbidden", "File session is read-only");
    }

    const body = await readJsonBody(ctx.request);
    const writes = parseBatchWriteList((body as Record<string, unknown>).writes);
    const items: Array<Record<string, unknown>> = [];

    const plan: Array<{
      path: string; absPath: string; bytes: Buffer;
      ifMatchRevision?: string; force?: boolean;
      beforeRevision: string | null;
    }> = [];

    for (const write of writes) {
      try {
        const absPath = resolveSafeChildPath(workspace.path, write.path);
        const bytes = Buffer.from(write.contentBase64, "base64");
        if (bytes.byteLength > FILE_SESSION_MAX_FILE_BYTES) {
          items.push({ ok: false, path: write.path, code: "file_too_large", message: "File exceeds size limit", maxBytes: FILE_SESSION_MAX_FILE_BYTES, size: bytes.byteLength });
          continue;
        }

        const before = (await exists(absPath)) ? await stat(absPath) : null;
        if (before && !before.isFile()) {
          items.push({ ok: false, path: write.path, code: "invalid_path", message: "Path must point to a file" });
          continue;
        }
        const beforeRevision = before ? fileRevision(before) : null;
        if (!write.force && write.ifMatchRevision && write.ifMatchRevision !== beforeRevision) {
          items.push({ ok: false, path: write.path, code: "conflict", message: "File changed since it was loaded", expectedRevision: write.ifMatchRevision, currentRevision: beforeRevision });
          continue;
        }

        plan.push({ path: write.path, absPath, bytes, beforeRevision, ...(write.ifMatchRevision ? { ifMatchRevision: write.ifMatchRevision } : {}), ...(write.force ? { force: true } : {}) });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Invalid write request";
        const code = error instanceof ApiError ? error.code : "invalid_payload";
        items.push({ ok: false, path: write.path, code, message });
      }
    }

    if (plan.length) {
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "workspace.files.session.write",
        summary: `Write ${plan.length} file(s) via file session`,
        paths: plan.map((item) => item.absPath),
      });
    }

    for (const entry of plan) {
      try {
        const before = (await exists(entry.absPath)) ? await stat(entry.absPath) : null;
        const currentRevision = before ? fileRevision(before) : null;
        if (!entry.force && entry.ifMatchRevision && currentRevision !== entry.ifMatchRevision) {
          items.push({ ok: false, path: entry.path, code: "conflict", message: "File changed before write could be applied", expectedRevision: entry.ifMatchRevision, currentRevision });
          continue;
        }

        await ensureDir(dirname(entry.absPath));
        const tmp = `${entry.absPath}.tmp-${shortId()}`;
        await writeFile(tmp, entry.bytes);
        await rename(tmp, entry.absPath);
        const after = await stat(entry.absPath);
        const revision = fileRevision(after);

        recordWorkspaceFileEvent(workspace.id, { type: "write", path: entry.path, revision });

        fileLogger.info("workspace.files.session.write", { workspaceId: workspace.id, summary: `Wrote ${entry.path} via file session` });
        items.push({ ok: true, path: entry.path, bytes: entry.bytes.byteLength, updatedAt: after.mtimeMs, revision, previousRevision: entry.beforeRevision });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to write file";
        items.push({ ok: false, path: entry.path, code: "write_failed", message });
      }
    }

    const events = fileSessions.listWorkspaceEvents(workspace.id, Number.MAX_SAFE_INTEGER);
    return jsonResponse({ items, cursor: events.cursor });
  });

  // POST /files/sessions/:sessionId/ops
  addRoute(routes, "POST", ApiRoutes.FILES_SESSIONS_OPS, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const { session, workspace } = resolveFileSession(ctx, ctx.params.sessionId);
    if (!session.canWrite) {
      throw new ApiError(403, "forbidden", "File session is read-only");
    }

    const body = await readJsonBody(ctx.request);
    const operations = Array.isArray((body as Record<string, unknown>).operations)
      ? ((body as Record<string, unknown>).operations as Array<Record<string, unknown>>)
      : null;
    if (!operations || !operations.length) {
      throw new ApiError(400, "invalid_payload", "operations must be a non-empty array");
    }
    if (operations.length > FILE_SESSION_MAX_BATCH_ITEMS) {
      throw new ApiError(400, "invalid_payload", `operations must include <= ${FILE_SESSION_MAX_BATCH_ITEMS} items`);
    }

    const items: Array<Record<string, unknown>> = [];
    const approvalPaths: string[] = [];
    for (const op of operations) {
      if (typeof op?.path === "string" && op.path.trim()) {
        approvalPaths.push(resolveSafeChildPath(workspace.path, normalizeWorkspaceRelativePathLocal(op.path, { allowSubdirs: true })));
      }
      if (typeof op?.from === "string" && op.from.trim()) {
        approvalPaths.push(resolveSafeChildPath(workspace.path, normalizeWorkspaceRelativePathLocal(op.from, { allowSubdirs: true })));
      }
      if (typeof op?.to === "string" && op.to.trim()) {
        approvalPaths.push(resolveSafeChildPath(workspace.path, normalizeWorkspaceRelativePathLocal(op.to, { allowSubdirs: true })));
      }
    }

    if (approvalPaths.length) {
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "workspace.files.session.ops",
        summary: `Apply ${operations.length} file operation(s) via file session`,
        paths: approvalPaths,
      });
    }

    for (const op of operations) {
      const type = String(op.type ?? "").trim();
      try {
        if (type === "mkdir") {
          const path = normalizeWorkspaceRelativePathLocal(String(op.path ?? ""), { allowSubdirs: true });
          const absPath = resolveSafeChildPath(workspace.path, path);
          await ensureDir(absPath);
          recordWorkspaceFileEvent(workspace.id, { type: "mkdir", path });
          items.push({ ok: true, type, path });
          continue;
        }

        if (type === "delete") {
          const path = normalizeWorkspaceRelativePathLocal(String(op.path ?? ""), { allowSubdirs: true });
          const absPath = resolveSafeChildPath(workspace.path, path);
          if (!(await exists(absPath))) {
            items.push({ ok: false, type, path, code: "file_not_found", message: "Path not found" });
            continue;
          }
          await rm(absPath, { recursive: op.recursive === true, force: false });
          recordWorkspaceFileEvent(workspace.id, { type: "delete", path });
          items.push({ ok: true, type, path });
          continue;
        }

        if (type === "rename") {
          const from = normalizeWorkspaceRelativePathLocal(String(op.from ?? ""), { allowSubdirs: true });
          const to = normalizeWorkspaceRelativePathLocal(String(op.to ?? ""), { allowSubdirs: true });
          const fromAbs = resolveSafeChildPath(workspace.path, from);
          const toAbs = resolveSafeChildPath(workspace.path, to);
          if (!(await exists(fromAbs))) {
            items.push({ ok: false, type, from, to, code: "file_not_found", message: "Source path not found" });
            continue;
          }
          await ensureDir(dirname(toAbs));
          await rename(fromAbs, toAbs);
          recordWorkspaceFileEvent(workspace.id, { type: "rename", path: from, toPath: to });
          items.push({ ok: true, type, from, to });
          continue;
        }

        items.push({ ok: false, type, code: "invalid_operation", message: `Unsupported operation type: ${type}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Operation failed";
        items.push({ ok: false, type, code: "operation_failed", message });
      }
    }

    const events = fileSessions.listWorkspaceEvents(workspace.id, Number.MAX_SAFE_INTEGER);
    return jsonResponse({ items, cursor: events.cursor });
  });

  // GET /workspace/:id/files/list
  addRoute(routes, "GET", ApiRoutes.WORKSPACE_FILES_LIST, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const requested = (ctx.url.searchParams.get("path") ?? "").trim();
    const rootResolved = resolve(workspace.path);

    let dirAbs: string;
    if (!requested) {
      dirAbs = rootResolved;
    } else {
      const relPath = normalizeWorkspaceRelativePathLocal(requested, { allowSubdirs: true });
      dirAbs = resolve(rootResolved, relPath.split("/").join(sep));
      const prefix = rootResolved + sep;
      if (dirAbs !== rootResolved && !dirAbs.startsWith(prefix)) {
        throw new ApiError(400, "invalid_path", "Path escapes workspace root");
      }
    }

    if (!(await exists(dirAbs))) {
      throw new ApiError(404, "dir_not_found", "Directory not found");
    }
    const dirStat = await stat(dirAbs);
    if (!dirStat.isDirectory()) {
      throw new ApiError(400, "not_a_directory", "Path is not a directory");
    }

    const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
    const rawEntries = await readdir(dirAbs, { withFileTypes: true });
    const pending = rawEntries.filter((ent) => !SKIP_DIR_NAMES.has(ent.name));
    const entries: Array<{ name: string; kind: "file" | "directory"; updatedAt?: number }> = await Promise.all(
      pending.map(async (ent) => {
        const childAbs = resolve(dirAbs, ent.name);
        let updatedAt: number | undefined;
        try { updatedAt = (await stat(childAbs)).mtimeMs; } catch { updatedAt = undefined; }
        if (ent.isDirectory()) return { name: ent.name, kind: "directory" as const, updatedAt };
        if (ent.isFile()) return { name: ent.name, kind: "file" as const, updatedAt };
        return null;
      }),
    ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const maxEntries = 400;
    const limited = entries.slice(0, maxEntries);
    const relativePrefix = dirAbs === rootResolved ? "" : relative(rootResolved, dirAbs).replace(/\\/g, "/");

    return jsonResponse({ path: relativePrefix, entries: limited, truncated: entries.length > maxEntries });
  });

  // GET /workspace/:id/git/status
  addRoute(routes, "GET", ApiRoutes.WORKSPACE_GIT_STATUS, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const cwd = resolve(workspace.path);
    const entries = await runGitStatus(cwd);
    return jsonResponse({ entries });
  });

  // GET /workspace/:id/files/content
  addRoute(routes, "GET", ApiRoutes.WORKSPACE_FILES_CONTENT, "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const requested = (ctx.url.searchParams.get("path") ?? "").trim();
    const optionalRaw = ctx.url.searchParams.get("optional");
    const optional = optionalRaw === "1" || optionalRaw === "true";
    const relativePath = normalizeWorkspaceRelativePathLocal(requested, { allowSubdirs: true });
    if (!isSupportedWorkspaceTextFilePath(relativePath)) {
      throw new ApiError(400, "invalid_path", "Only Markdown and Engine plugin text files are supported");
    }

    const absPath = resolveSafeChildPath(workspace.path, relativePath);
    if (!(await exists(absPath))) {
      if (optional) return jsonResponse({ path: relativePath, content: "", bytes: 0, missing: true });
      throw new ApiError(404, "file_not_found", "File not found");
    }
    const info = await stat(absPath);
    if (!info.isFile()) {
      if (optional) return jsonResponse({ path: relativePath, content: "", bytes: 0, missing: true });
      throw new ApiError(404, "file_not_found", "File not found");
    }

    const maxBytes = FILE_SESSION_MAX_FILE_BYTES;
    if (info.size > maxBytes) {
      throw new ApiError(413, "file_too_large", "File exceeds size limit", { maxBytes, size: info.size });
    }

    const content = await readFile(absPath, "utf8");
    return jsonResponse({ path: relativePath, content, bytes: info.size, updatedAt: info.mtimeMs });
  });

  // POST /workspace/:id/files/content
  addRoute(routes, "POST", ApiRoutes.WORKSPACE_FILES_CONTENT_WRITE, "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);

    const requestedPath = String(body.path ?? "");
    const relativePath = normalizeWorkspaceRelativePathLocal(requestedPath, { allowSubdirs: true });
    if (!isSupportedWorkspaceTextFilePath(relativePath)) {
      throw new ApiError(400, "invalid_path", "Only Markdown and Engine plugin text files are supported");
    }

    if (typeof body.content !== "string") {
      throw new ApiError(400, "invalid_payload", "content must be a string");
    }
    const content = body.content;
    const bytes = Buffer.byteLength(content, "utf8");
    const maxBytes = FILE_SESSION_MAX_FILE_BYTES;
    if (bytes > maxBytes) {
      throw new ApiError(413, "file_too_large", "File exceeds size limit", { maxBytes, size: bytes });
    }

    const baseUpdatedAtRaw = body.baseUpdatedAt;
    const baseUpdatedAt = typeof baseUpdatedAtRaw === "number" && Number.isFinite(baseUpdatedAtRaw) ? baseUpdatedAtRaw : null;
    const force = body.force === true;

    const absPath = resolveSafeChildPath(workspace.path, relativePath);

    const before = (await exists(absPath)) ? await stat(absPath) : null;
    if (before && !before.isFile()) {
      throw new ApiError(400, "invalid_path", "Path must point to a file");
    }
    const beforeUpdatedAt = before ? before.mtimeMs : null;
    if (!force && beforeUpdatedAt !== null && baseUpdatedAt !== null && beforeUpdatedAt !== baseUpdatedAt) {
      throw new ApiError(409, "conflict", "File changed since it was loaded", { baseUpdatedAt, currentUpdatedAt: beforeUpdatedAt });
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "workspace.file.write",
      summary: `Write ${relativePath}`,
      paths: [absPath],
    });

    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, absPath);
    const after = await stat(absPath);
    const revision = fileRevision(after);

    recordWorkspaceFileEvent(workspace.id, { type: "write", path: relativePath, revision });

    fileLogger.info("workspace.file.write", { workspaceId: workspace.id, summary: `Wrote ${relativePath}` });
    return jsonResponse({ ok: true, path: relativePath, bytes, updatedAt: after.mtimeMs, revision });
  });
}