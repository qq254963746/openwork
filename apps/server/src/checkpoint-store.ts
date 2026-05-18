/**
 * Shadow-git-based checkpoint store for AiWork sessions.
 *
 * Key guarantees:
 *  - We NEVER write inside the user's workspace directory. All git metadata lives
 *    in `~/Library/Application Support/AiWork/checkpoints/...` (see checkpoint-paths.ts).
 *  - We do NOT touch the user's own `.git/` if their project happens to be a git
 *    repo. A workspace-relative ignore for `.git/` is added to `info/exclude`.
 *  - We do NOT modify HEAD on restore: restore is a workdir-only operation
 *    (read-tree + checkout-index + targeted clean), so commit history is preserved
 *    and "redo" remains possible.
 *
 * messageID <-> sha mapping is stored in checkpoints.json. This is intentional:
 *  - Engine generates messageIDs server-side, so we commit first with a temporary
 *    label, then the frontend reports the real messageID once it appears in events.
 *
 * Concurrency: one shadow repo per session, so there is no contention with other
 * sessions. Within a session we serialize git operations with an in-memory mutex.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  checkpointsManifestFile,
  sessionCheckpointDir,
  shadowGitDir,
  shadowIndexFile,
  workspaceCheckpointDir,
} from "./checkpoint-paths.js";
import { ApiError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckpointEntry = {
  /** Short ID (sha-prefixed) used to address this checkpoint from the API. */
  id: string;
  /** Full commit SHA inside the shadow git repo. */
  sha: string;
  /** Real Engine messageID this checkpoint was created BEFORE. May be a pending placeholder. */
  messageID: string | null;
  /** Stable label set when the checkpoint was created (e.g. "before-message", "baseline"). */
  label: string;
  /** Free-form parent message id, useful for UIs. */
  parentMessageID: string | null;
  /** Unix epoch ms. */
  createdAt: number;
  /** Stats reported by `git diff --shortstat` against parent (or empty for baseline). */
  stats: { files: number; additions: number; deletions: number };
};

export type DiffFileEntry = {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "type-changed" | "unknown";
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type DiffSummary = {
  files: DiffFileEntry[];
  additions: number;
  deletions: number;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: Array<{ kind: "context" | "add" | "del"; text: string }>;
};

export type DiffFileDetail = DiffFileEntry & {
  hunks: DiffHunk[];
  /** True when the file is treated as binary (no line-level diff produced). */
  truncated?: boolean;
};

type Manifest = {
  version: 1;
  sessionId: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAt: number;
  baselineSha: string | null;
  entries: CheckpointEntry[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TRACKED_FILE_BYTES = 5 * 1024 * 1024; // skip files > 5 MB
const GIT_TIMEOUT_MS = 30_000;
const GIT_AUTHOR_NAME = "AiWork";
const GIT_AUTHOR_EMAIL = "ai@aiwork.local";

const DEFAULT_EXCLUDE_LINES: string[] = [
  // Always ignore the user's own VCS metadata
  ".git/",
  ".hg/",
  ".svn/",
  // Heavy build / dep dirs
  "node_modules/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".turbo/",
  "dist/",
  "build/",
  "out/",
  "target/",
  ".gradle/",
  ".cache/",
  ".parcel-cache/",
  ".pytest_cache/",
  ".mypy_cache/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "env/",
  ".terraform/",
  "coverage/",
  ".nyc_output/",
  // OS / editor
  ".DS_Store",
  "Thumbs.db",
  ".idea/",
  ".vscode/",
  // Logs / tmp
  "*.log",
  "*.tmp",
  "*.swp",
  // Secrets we never want in a snapshot, even if user forgot to gitignore
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  // Big binary blobs
  "*.iso",
  "*.dmg",
  "*.pkg",
  "*.zip",
  "*.tar",
  "*.tar.gz",
  "*.tgz",
  "*.7z",
];

// ---------------------------------------------------------------------------
// CheckpointStore
// ---------------------------------------------------------------------------

const sessionMutexes = new Map<string, Promise<unknown>>();

export class CheckpointStore {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  private readonly gitDir: string;
  private readonly indexFile: string;
  private readonly manifestFile: string;
  private readonly sessionDir: string;

  constructor(input: { workspaceId: string; sessionId: string; workspaceRoot: string }) {
    if (!input.workspaceId) throw new ApiError(400, "invalid_payload", "workspaceId is required");
    if (!input.sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    if (!input.workspaceRoot || !isAbsolute(input.workspaceRoot)) {
      throw new ApiError(400, "invalid_payload", "workspaceRoot must be an absolute path");
    }

    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.workspaceRoot = resolve(input.workspaceRoot);
    this.gitDir = shadowGitDir(input.workspaceId, input.sessionId);
    this.indexFile = shadowIndexFile(input.workspaceId, input.sessionId);
    this.manifestFile = checkpointsManifestFile(input.workspaceId, input.sessionId);
    this.sessionDir = sessionCheckpointDir(input.workspaceId, input.sessionId);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async ensureInitialized(): Promise<void> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();
    });
  }

  /**
   * Create a new checkpoint commit reflecting the current state of the workspace.
   * messageID may be a temporary placeholder; callers can later rewrite it with
   * `bindMessageId`.
   */
  async createCheckpoint(input: {
    messageID: string | null;
    label?: string;
    parentMessageID?: string | null;
  }): Promise<CheckpointEntry> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();
      await this.refreshExcludeFile();

      const label = (input.label ?? "checkpoint").slice(0, 80);
      const messageID = (input.messageID ?? "").trim() || null;
      const parentMessageID = (input.parentMessageID ?? "").trim() || null;

      // Stage all changes (respecting gitignore + info/exclude); skip oversized files.
      await this.skipOversizedFiles();
      await this.git(["add", "-A", "--"], { allowEmpty: true });

      const summary = label + (messageID ? `:${messageID}` : "");
      await this.git(
        [
          "-c",
          `user.name=${GIT_AUTHOR_NAME}`,
          "-c",
          `user.email=${GIT_AUTHOR_EMAIL}`,
          "commit",
          "--allow-empty",
          "-m",
          summary,
        ],
      );

      const sha = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
      const stats = await this.shortStat(sha);

      const entry: CheckpointEntry = {
        id: sha.slice(0, 12),
        sha,
        messageID,
        label,
        parentMessageID,
        createdAt: Date.now(),
        stats,
      };

      const manifest = await this.readManifest();
      if (!manifest.baselineSha) manifest.baselineSha = sha;
      manifest.entries.push(entry);
      await this.writeManifest(manifest);

      return entry;
    });
  }

  /**
   * Rebind a temporary placeholder messageID (e.g. "pending:<tsId>") to the
   * real Engine messageID once it becomes known. Idempotent.
   */
  async bindMessageId(input: { fromMessageID: string; toMessageID: string }): Promise<boolean> {
    return this.withLock(async () => {
      const manifest = await this.readManifest();
      let changed = false;
      for (const entry of manifest.entries) {
        if (entry.messageID === input.fromMessageID) {
          entry.messageID = input.toMessageID;
          changed = true;
        }
      }
      if (changed) await this.writeManifest(manifest);
      return changed;
    });
  }

  async list(): Promise<CheckpointEntry[]> {
    const manifest = await this.readManifest();
    return manifest.entries.slice();
  }

  async findByMessageId(messageID: string): Promise<CheckpointEntry | null> {
    const list = await this.list();
    for (let idx = list.length - 1; idx >= 0; idx -= 1) {
      if (list[idx].messageID === messageID) return list[idx];
    }
    return null;
  }

  async findById(id: string): Promise<CheckpointEntry | null> {
    const list = await this.list();
    return list.find((entry) => entry.id === id || entry.sha === id) ?? null;
  }

  /**
   * Restore the working directory to a given checkpoint.
   *
   * Strategy:
   *   1. Optionally take a "safety" checkpoint of the current state so the user can recover.
   *   2. read-tree <sha> -> stage that tree in our shadow index.
   *   3. checkout-index -a -f -> write the staged tree into the workdir.
   *   4. Remove tracked files that the target tree no longer contains.
   *
   * We do NOT update HEAD here (no `git reset`), so list/redo remain accurate.
   */
  async restoreTo(input: {
    sha: string;
    safetyCheckpoint?: boolean;
    safetyLabel?: string;
  }): Promise<{
    restored: number;
    removed: number;
    safetySha: string | null;
  }> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();
      await this.refreshExcludeFile();

      let safetySha: string | null = null;
      if (input.safetyCheckpoint !== false) {
        const safety = await this.unsafeCreateSafetyCheckpoint(input.safetyLabel ?? "before-restore");
        safetySha = safety?.sha ?? null;
      }

      // Verify target exists.
      const verify = await this.git(["cat-file", "-t", input.sha], { allowFailure: true });
      if (verify.code !== 0 || verify.stdout.trim() !== "commit") {
        throw new ApiError(404, "checkpoint_not_found", `Checkpoint ${input.sha} not found`);
      }

      // Stage current workdir so we can diff against the target.
      await this.git(["add", "-A", "--"], { allowEmpty: true });

      // Find files that differ between current HEAD and the target commit.
      // "changed" = modified or deleted in workdir vs target
      // "added"   = exists in target but not in current HEAD
      const changedResult = await this.git(
        ["diff", "--name-only", "-z", "HEAD", input.sha],
        { allowFailure: true },
      );
      const changedFiles = changedResult.stdout
        .split("\0")
        .filter(Boolean);

      const addedResult = await this.git(
        ["diff", "--name-only", "--diff-filter=A", "-z", "HEAD", input.sha],
        { allowFailure: true },
      );

      // Files that exist NOW (current HEAD -> workdir) and files in target.
      const before = await this.listTrackedFiles("HEAD");
      const targetFiles = await this.listTrackedFiles(input.sha);

      let restored = 0;
      let removed = 0;

      if (changedFiles.length > 0) {
        // Only restore the files that actually differ. `checkout` from
        // the target commit for those specific paths. This avoids touching
        // every file's mtime (and thus avoids spurious file-watcher events
        // for unchanged files like engine.jsonc).
        //
        // Strategy:
        //   1. read-tree <target> to populate our shadow index with the target tree.
        //   2. checkout-index with explicit path list so only those files are
        //      materialised into the workdir.
        await this.git(["read-tree", input.sha]);
        for (const path of changedFiles) {
          // checkout-index -f writes a single file from the index to the worktree.
          // `--` ensures paths with special characters are handled safely.
          const result = await this.git(
            ["checkout-index", "-f", "--", path],
            { allowFailure: true },
          );
          if (result.code === 0) restored += 1;
        }
      }

      // Remove files present in current HEAD but absent from target.
      const targetSet = new Set(targetFiles);
      for (const path of before) {
        if (!targetSet.has(path)) {
          const abs = resolve(this.workspaceRoot, path);
          await rm(abs, { force: true }).catch(() => undefined);
          removed += 1;
        }
      }

      // After partial restore, re-stage the workdir into shadow git so HEAD
      // reflects reality. `git add -A` picks up restored + removed files.
      await this.git(["add", "-A", "--"], { allowEmpty: true });

      return {
        restored,
        removed,
        safetySha,
      };
    });
  }

  /**
   * Restore by messageID. Restores to the checkpoint that was taken BEFORE the
   * given message was sent.
   */
  async restoreToMessage(input: {
    messageID: string;
    safetyCheckpoint?: boolean;
  }): Promise<{ restored: number; removed: number; safetySha: string | null; sha: string }> {
    const entry = await this.findByMessageId(input.messageID);
    if (!entry) {
      throw new ApiError(404, "checkpoint_not_found", `No checkpoint found for message ${input.messageID}`);
    }
    const result = await this.restoreTo({
      sha: entry.sha,
      safetyCheckpoint: input.safetyCheckpoint,
      safetyLabel: `before-restore-to:${input.messageID}`,
    });
    return { ...result, sha: entry.sha };
  }

  /** Diff between a checkpoint and the current workdir, summary only. */
  async diffSummaryAgainstWorkdir(sha: string): Promise<DiffSummary> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();
      await this.refreshExcludeFile();
      // Stage current workdir into a temporary index so we can diff it precisely.
      await this.git(["add", "-A", "--"], { allowEmpty: true });
      return this.diffSummary(sha, null);
    });
  }

  async diffSummary(fromSha: string, toSha: string | null): Promise<DiffSummary> {
    const args = ["diff", "--numstat", "-z", "--no-color", "--no-ext-diff"];
    if (toSha) args.push(fromSha, toSha);
    else args.push("--cached", fromSha);
    const result = await this.git(args, { allowFailure: true });
    if (result.code !== 0) return { files: [], additions: 0, deletions: 0 };
    return parseNumstat(result.stdout);
  }

  /** Detailed line-level diff. `toSha=null` means diff against current workdir. */
  async diffDetailed(input: {
    fromSha: string;
    toSha: string | null;
    contextLines?: number;
  }): Promise<DiffFileDetail[]> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();
      await this.refreshExcludeFile();
      if (input.toSha === null) {
        await this.git(["add", "-A", "--"], { allowEmpty: true });
      }
      const ctx = Math.max(0, Math.min(input.contextLines ?? 3, 20));
      const args = [
        "diff",
        `-U${ctx}`,
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/",
      ];
      if (input.toSha) args.push(input.fromSha, input.toSha);
      else args.push("--cached", input.fromSha);
      const result = await this.git(args, { allowFailure: true, maxBufferBytes: 16 * 1024 * 1024 });
      if (result.code !== 0) return [];
      const summary = await this.diffSummary(input.fromSha, input.toSha);
      return parseUnifiedDiff(result.stdout, summary);
    });
  }

  /**
   * Read a single file's content from a specific checkpoint commit.
   * Uses `git show <sha>:<path>` to retrieve the file blob.
   *
   * Returns null when the file did not exist in that commit (e.g. new file
   * created by a later checkpoint). Callers should fall back to the live
   * workspace file when null is returned.
   */
  async readFileAtCommit(input: {
    sha: string;
    filePath: string;
  }): Promise<{ content: string; bytes: number } | null> {
    return this.withLock(async () => {
      await this.ensureInitializedUnlocked();

      // `git show <sha>:<path>` outputs the blob content to stdout.
      const result = await this.git(
        ["show", `${input.sha}:${input.filePath}`],
        { allowFailure: true, maxBufferBytes: 5 * 1024 * 1024 },
      );

      if (result.code !== 0) return null;

      const content = result.stdout;
      const bytes = Buffer.byteLength(content, "utf8");
      return { content, bytes };
    });
  }

  async destroy(): Promise<void> {
    return this.withLock(async () => {
      await rm(this.sessionDir, { recursive: true, force: true });
      sessionMutexes.delete(this.lockKey);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private get lockKey(): string {
    return `${this.workspaceId}::${this.sessionId}`;
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = sessionMutexes.get(this.lockKey) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    sessionMutexes.set(
      this.lockKey,
      next.catch(() => undefined),
    );
    return next;
  }

  private async ensureInitializedUnlocked(): Promise<void> {
    // Guard: workspace root must exist.
    try {
      const info = await stat(this.workspaceRoot);
      if (!info.isDirectory()) {
        throw new ApiError(400, "invalid_workspace_root", "Workspace root is not a directory");
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, "invalid_workspace_root", "Workspace root does not exist");
    }

    await mkdir(this.sessionDir, { recursive: true });

    const headFile = join(this.gitDir, "HEAD");
    if (!(await fileExists(headFile))) {
      await mkdir(this.gitDir, { recursive: true });
      // `--bare` makes git treat <gitDir> as the git metadata dir directly,
      // instead of creating a nested `.git/` inside it. We later flip
      // core.bare=false so the same directory can be used with GIT_WORK_TREE
      // pointing at the user's workspace.
      await this.git(["init", "--quiet", "--bare", "-b", "main", this.gitDir], {
        skipEnv: true,
        cwdOverride: this.sessionDir,
        useWorktree: false,
      });
      // Configure core.* so it behaves predictably no matter the user's global git config.
      await this.git(["config", "core.bare", "false"], { useWorktree: false });
      await this.git(["config", "core.autocrlf", "false"], { useWorktree: false });
      await this.git(["config", "core.fileMode", "false"], { useWorktree: false });
      await this.git(["config", "core.precomposeunicode", "true"], { useWorktree: false });
      await this.git(["config", "core.quotepath", "false"], { useWorktree: false });
      await this.git(["config", "core.longpaths", "true"], { useWorktree: false });
      await this.git(["config", "gc.auto", "0"], { useWorktree: false });
      await this.refreshExcludeFile();
      // Empty baseline commit so HEAD is always valid.
      await this.git(
        [
          "-c",
          `user.name=${GIT_AUTHOR_NAME}`,
          "-c",
          `user.email=${GIT_AUTHOR_EMAIL}`,
          "commit",
          "--allow-empty",
          "--allow-empty-message",
          "-m",
          "",
        ],
        { useWorktree: false },
      );
    }

    if (!(await fileExists(this.manifestFile))) {
      const manifest: Manifest = {
        version: 1,
        sessionId: this.sessionId,
        workspaceId: this.workspaceId,
        workspaceRoot: this.workspaceRoot,
        createdAt: Date.now(),
        baselineSha: null,
        entries: [],
      };
      await this.writeManifest(manifest);
    }

    // Ensure parent dir for index file exists (sessionDir is already created above).
    await mkdir(dirname(this.indexFile), { recursive: true });
  }

  private async refreshExcludeFile(): Promise<void> {
    const excludeFile = join(this.gitDir, "info", "exclude");
    await mkdir(dirname(excludeFile), { recursive: true });
    const lines = [
      "# AiWork shadow git exclude — managed automatically",
      ...DEFAULT_EXCLUDE_LINES,
    ].join("\n");
    await writeFile(excludeFile, `${lines}\n`, "utf8");
  }

  /**
   * Walk workdir and add oversized files to a per-add exclude list.
   * We do this via `git update-index --add --skip-worktree` would be more elegant,
   * but the simplest reliable approach is to use `git ls-files -o --exclude-standard`
   * to enumerate untracked files, then explicitly skip ones over the threshold.
   *
   * For now we rely on .gitignore + info/exclude to filter heavy dirs, and rely on
   * the size check inside `add` only for very large blobs. We approximate by appending
   * sizes via `find`-like logic from Node. Implemented best-effort; not critical.
   */
  private async skipOversizedFiles(): Promise<void> {
    // Cheap heuristic: get untracked file list, stat each, append oversized ones to a temp exclude.
    const untracked = await this.git(["ls-files", "-o", "--exclude-standard", "-z"], { allowFailure: true });
    if (untracked.code !== 0 || !untracked.stdout) return;
    const paths = untracked.stdout.split("\0").filter(Boolean);
    const oversized: string[] = [];
    for (const rel of paths) {
      try {
        const abs = resolve(this.workspaceRoot, rel);
        const info = await stat(abs);
        if (info.isFile() && info.size > MAX_TRACKED_FILE_BYTES) {
          oversized.push(rel);
        }
      } catch {
        // ignore
      }
    }
    if (!oversized.length) return;
    const excludeFile = join(this.gitDir, "info", "exclude");
    const previous = await readFile(excludeFile, "utf8").catch(() => "");
    const marker = "# >>> aiwork:oversized";
    const before = previous.split(marker)[0] ?? previous;
    const block = `${marker}\n${oversized.join("\n")}\n# <<< aiwork:oversized\n`;
    await writeFile(excludeFile, `${before.replace(/\s+$/, "\n")}${block}`, "utf8");
  }

  private async unsafeCreateSafetyCheckpoint(label: string): Promise<CheckpointEntry | null> {
    try {
      await this.skipOversizedFiles();
      const addRes = await this.git(["add", "-A", "--"], { allowEmpty: true, allowFailure: true });
      if (addRes.code !== 0) return null;
      const status = await this.git(["status", "--porcelain"], { allowFailure: true });
      // Allow empty so safety always exists, but only if there is a difference vs HEAD.
      const dirty = status.stdout.trim().length > 0;
      const commit = await this.git(
        [
          "-c",
          `user.name=${GIT_AUTHOR_NAME}`,
          "-c",
          `user.email=${GIT_AUTHOR_EMAIL}`,
          "commit",
          ...(dirty ? [] : ["--allow-empty"]),
          "-m",
          `safety:${label}`,
        ],
        { allowFailure: true },
      );
      if (commit.code !== 0) return null;

      const sha = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
      const stats = await this.shortStat(sha);
      const entry: CheckpointEntry = {
        id: sha.slice(0, 12),
        sha,
        messageID: null,
        label: `safety:${label}`,
        parentMessageID: null,
        createdAt: Date.now(),
        stats,
      };
      const manifest = await this.readManifest();
      manifest.entries.push(entry);
      await this.writeManifest(manifest);
      return entry;
    } catch {
      return null;
    }
  }

  private async listTrackedFiles(ref: string): Promise<string[]> {
    const result = await this.git(["ls-tree", "-r", "--name-only", "-z", ref], { allowFailure: true });
    if (result.code !== 0 || !result.stdout) return [];
    return result.stdout.split("\0").filter(Boolean);
  }

  private async shortStat(sha: string): Promise<{ files: number; additions: number; deletions: number }> {
    const parent = await this.git(["rev-list", "--parents", "-n", "1", sha], { allowFailure: true });
    const parts = parent.stdout.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      // Initial commit — diff against empty tree.
      const empty = await this.git(["hash-object", "-t", "tree", "/dev/null"], { allowFailure: true });
      const emptySha = empty.stdout.trim() || "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      const diff = await this.git(["diff", "--numstat", "-z", emptySha, sha], { allowFailure: true });
      const summary = parseNumstat(diff.stdout);
      return { files: summary.files.length, additions: summary.additions, deletions: summary.deletions };
    }
    const [, parentSha] = parts;
    const diff = await this.git(["diff", "--numstat", "-z", parentSha, sha], { allowFailure: true });
    const summary = parseNumstat(diff.stdout);
    return { files: summary.files.length, additions: summary.additions, deletions: summary.deletions };
  }

  private async readManifest(): Promise<Manifest> {
    try {
      const raw = await readFile(this.manifestFile, "utf8");
      const parsed = JSON.parse(raw) as Manifest;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error("invalid manifest");
      }
      return parsed;
    } catch {
      return {
        version: 1,
        sessionId: this.sessionId,
        workspaceId: this.workspaceId,
        workspaceRoot: this.workspaceRoot,
        createdAt: Date.now(),
        baselineSha: null,
        entries: [],
      };
    }
  }

  private async writeManifest(manifest: Manifest): Promise<void> {
    await mkdir(dirname(this.manifestFile), { recursive: true });
    await writeFile(this.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  private git(
    args: string[],
    options: {
      allowFailure?: boolean;
      allowEmpty?: boolean;
      cwdOverride?: string;
      useWorktree?: boolean;
      skipEnv?: boolean;
      maxBufferBytes?: number;
    } = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolveProm, rejectProm) => {
      const useWorktree = options.useWorktree !== false;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        // Defang user's global / system git config that could break us.
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        // Some installers respect HOME for hooks/config; redirect.
        HOME: this.sessionDir,
      };
      if (!options.skipEnv) {
        env.GIT_DIR = this.gitDir;
        if (useWorktree) {
          env.GIT_WORK_TREE = this.workspaceRoot;
          env.GIT_INDEX_FILE = this.indexFile;
        }
      }

      const baseArgs = ["--no-pager"];
      const cwd = options.cwdOverride ?? this.workspaceRoot;
      const maxBuffer = options.maxBufferBytes ?? 4 * 1024 * 1024;

      const child = spawn("git", [...baseArgs, ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let killed = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }, GIT_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBuffer) {
          if (!killed) {
            killed = true;
            try { child.kill("SIGTERM"); } catch { /* ignore */ }
          }
          return;
        }
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 256 * 1024) return;
        stderr += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        rejectProm(new ApiError(500, "git_spawn_failed", `git ${args.join(" ")}: ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          rejectProm(new ApiError(504, "git_timeout", `git ${args.join(" ")} timed out`));
          return;
        }
        const exitCode = code ?? -1;
        if (exitCode !== 0 && !options.allowFailure && !options.allowEmpty) {
          rejectProm(
            new ApiError(500, "git_failed", `git ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`),
          );
          return;
        }
        resolveProm({ code: exitCode, stdout, stderr });
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseNumstat(raw: string): DiffSummary {
  if (!raw) return { files: [], additions: 0, deletions: 0 };
  const out: DiffFileEntry[] = [];
  let totalAdd = 0;
  let totalDel = 0;

  // numstat -z output: each entry is "ADD\tDEL\tPATH\0", or for renames
  // "ADD\tDEL\t\0OLDPATH\0NEWPATH\0"
  const tokens = raw.split("\0");
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i];
    if (!head) {
      i += 1;
      continue;
    }
    const tabs = head.split("\t");
    if (tabs.length < 3) {
      i += 1;
      continue;
    }
    const additions = tabs[0] === "-" ? 0 : Number(tabs[0]) || 0;
    const deletions = tabs[1] === "-" ? 0 : Number(tabs[1]) || 0;
    const binary = tabs[0] === "-" || tabs[1] === "-";
    let path = tabs.slice(2).join("\t");
    let oldPath: string | undefined;
    if (path === "") {
      // rename: the next two tokens are oldPath, newPath
      oldPath = tokens[i + 1] ?? "";
      path = tokens[i + 2] ?? "";
      i += 3;
    } else {
      i += 1;
    }
    if (!path) continue;
    out.push({
      path,
      oldPath,
      status: oldPath ? "renamed" : "modified", // refined later by name-status
      additions,
      deletions,
      binary,
    });
    totalAdd += additions;
    totalDel += deletions;
  }
  return { files: out, additions: totalAdd, deletions: totalDel };
}

function parseUnifiedDiff(raw: string, summary: DiffSummary): DiffFileDetail[] {
  if (!raw) return [];
  const summaryByPath = new Map<string, DiffFileEntry>();
  for (const f of summary.files) summaryByPath.set(f.path, f);

  const files: DiffFileDetail[] = [];
  const lines = raw.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("diff --git ")) {
      i += 1;
      continue;
    }

    // Parse header until first @@ hunk or next diff
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let isBinary = false;
    let isAdded = false;
    let isDeleted = false;
    let isRenamed = false;
    let typeChanged = false;
    i += 1;
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
      const l = lines[i];
      if (l.startsWith("--- ")) {
        const p = l.slice(4).trim();
        oldPath = p === "/dev/null" ? undefined : p.replace(/^a\//, "");
      } else if (l.startsWith("+++ ")) {
        const p = l.slice(4).trim();
        newPath = p === "/dev/null" ? undefined : p.replace(/^b\//, "");
      } else if (l.startsWith("new file mode")) {
        isAdded = true;
      } else if (l.startsWith("deleted file mode")) {
        isDeleted = true;
      } else if (l.startsWith("rename from")) {
        isRenamed = true;
      } else if (l.startsWith("old mode") || l.startsWith("new mode")) {
        typeChanged = true;
      } else if (l.startsWith("Binary files ") || l.includes("GIT binary patch")) {
        isBinary = true;
      }
      i += 1;
    }

    const path = newPath ?? oldPath ?? "(unknown)";
    let status: DiffFileEntry["status"] = "modified";
    if (isAdded) status = "added";
    else if (isDeleted) status = "deleted";
    else if (isRenamed) status = "renamed";
    else if (typeChanged) status = "type-changed";

    const summaryEntry = summaryByPath.get(path);
    const detail: DiffFileDetail = {
      path,
      oldPath: isRenamed ? oldPath : summaryEntry?.oldPath,
      status,
      additions: summaryEntry?.additions ?? 0,
      deletions: summaryEntry?.deletions ?? 0,
      binary: isBinary || (summaryEntry?.binary ?? false),
      hunks: [],
    };
    if (detail.binary) {
      detail.truncated = true;
    }

    while (i < lines.length && lines[i].startsWith("@@")) {
      const header = lines[i];
      const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const hunk: DiffHunk = {
        oldStart: m ? Number(m[1]) : 0,
        oldLines: m && m[2] ? Number(m[2]) : 1,
        newStart: m ? Number(m[3]) : 0,
        newLines: m && m[4] ? Number(m[4]) : 1,
        header,
        lines: [],
      };
      i += 1;
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
        const l = lines[i];
        if (l.startsWith("\\ No newline at end of file")) {
          i += 1;
          continue;
        }
        if (l.startsWith("+")) hunk.lines.push({ kind: "add", text: l.slice(1) });
        else if (l.startsWith("-")) hunk.lines.push({ kind: "del", text: l.slice(1) });
        else if (l.startsWith(" ")) hunk.lines.push({ kind: "context", text: l.slice(1) });
        else if (l === "") hunk.lines.push({ kind: "context", text: "" });
        else hunk.lines.push({ kind: "context", text: l });
        i += 1;
      }
      detail.hunks.push(hunk);
    }

    files.push(detail);
  }

  return files;
}

// Re-export for routes.
export async function destroySessionCheckpoints(workspaceId: string, sessionId: string): Promise<void> {
  const dir = sessionCheckpointDir(workspaceId, sessionId);
  await rm(dir, { recursive: true, force: true });
}

export async function destroyWorkspaceCheckpoints(workspaceId: string): Promise<void> {
  const dir = workspaceCheckpointDir(workspaceId);
  await rm(dir, { recursive: true, force: true });
}


