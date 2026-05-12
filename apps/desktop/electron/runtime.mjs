import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DIRECT_RUNTIME = "direct";

function truncateOutput(value, limit = 8000) {
  const text = String(value ?? "");
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function appendOutput(state, key, chunk) {
  const next = `${state[key] ?? ""}${String(chunk ?? "")}`;
  state[key] = truncateOutput(next);
}

function normalizeWorkspaceKey(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return path.resolve(trimmed).replace(/\\/g, "/").toLowerCase();
}

function nowMs() {
  return Date.now();
}

function createEngineState() {
  return {
    child: null,
    childExited: true,
    runtime: DIRECT_RUNTIME,
    projectDir: null,
    hostname: null,
    port: null,
    baseUrl: null,
    opencodeUsername: null,
    opencodePassword: null,
    opencodeBinPath: null,
    opencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

function snapshotEngineState(state) {
  const child = state.childExited ? null : state.child;
  return {
    running: Boolean(child && child.exitCode === null && !child.killed),
    runtime: state.runtime,
    baseUrl: state.baseUrl,
    projectDir: state.projectDir,
    hostname: state.hostname,
    port: state.port,
    opencodeUsername: state.opencodeUsername,
    opencodePassword: state.opencodePassword,
    opencodeBinPath: state.opencodeBinPath,
    opencodeBinSource: state.opencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

function createAiWorkServerState() {
  return {
    child: null,
    childExited: true,
    host: null,
    port: null,
    baseUrl: null,
    connectUrl: null,
    mdnsUrl: null,
    lanUrl: null,
    clientToken: null,
    ownerToken: null,
    hostToken: null,
    managedOpencodeBinPath: null,
    managedOpencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

function snapshotAiWorkServerState(state) {
  const child = state.childExited ? null : state.child;
  return {
    running: Boolean(child && child.exitCode === null && !child.killed),
    host: state.host,
    port: state.port,
    baseUrl: state.baseUrl,
    connectUrl: state.connectUrl,
    mdnsUrl: state.mdnsUrl,
    lanUrl: state.lanUrl,
    clientToken: state.clientToken,
    ownerToken: state.ownerToken,
    hostToken: state.hostToken,
    managedOpencodeBinPath: state.managedOpencodeBinPath,
    managedOpencodeBinSource: state.managedOpencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

function assertAiWorkServerReady(snapshot) {
  if (!snapshot?.running) {
    throw new Error("AiWork server did not stay running after startup.");
  }
  if (!snapshot.baseUrl) {
    throw new Error("AiWork server did not report a base URL after startup.");
  }
  if (!snapshot.ownerToken && !snapshot.clientToken) {
    throw new Error("AiWork server did not report an access token after startup.");
  }
  return snapshot;
}

async function fileExists(targetPath) {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(targetPath, fallback) {
  try {
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function targetTriple() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  return null;
}

function binaryFileNames(baseName) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const triple = targetTriple();
  return [
    triple ? `${baseName}-${triple}${ext}` : null,
    `${baseName}${ext}`,
  ].filter(Boolean);
}

function isDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function nvmVersionBinPaths(home) {
  const base = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(base, entry.name, "bin"))
      .filter(isDirectory)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function pathHelperEntries() {
  if (process.platform !== "darwin") return [];
  const result = spawnSync("/usr/libexec/path_helper", ["-s"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];
  const stdout = String(result.stdout ?? "");
  const match = stdout.match(/PATH="([^"]+)"/) ?? stdout.match(/PATH=([^;\n]+)/);
  return match?.[1]?.split(path.delimiter).filter(Boolean) ?? [];
}

function extraPathEntries() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push(
      ...pathHelperEntries(),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      path.join(home, ".fnm", "current", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, "Library", "pnpm"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".pyenv", "shims"),
      path.join(home, ".local", "bin"),
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      path.join(home, ".fnm", "current", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".pyenv", "shims"),
      path.join(home, ".local", "bin"),
    );
  }

  if (process.platform === "win32") {
    candidates.push(
      path.join(home, ".volta", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "pnpm") : null,
    );
  }

  return candidates.filter((entry) => entry && isDirectory(entry));
}

function enrichedPath(sidecarDirs, currentPath) {
  const entries = [
    ...sidecarDirs.filter(isDirectory),
    ...extraPathEntries(),
    ...String(currentPath ?? "").split(path.delimiter).filter(Boolean),
  ];
  const deduped = entries.filter((entry, index) => entries.indexOf(entry) === index);
  return deduped.length > 0 ? deduped.join(path.delimiter) : null;
}

async function portAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a free port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "Request did not succeed.";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(lastError);
}

async function fetchJson(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Resolves ~/.config/aiwork/env.json (or %APPDATA%\aiwork\env.json on
// Windows) — must agree byte-for-byte with apps/server/src/env-file.ts and
// apps/desktop/src-tauri/src/env_file.rs. Honor AIWORK_ENV_STORE override.
function resolveUserEnvFilePath() {
  const override = String(process.env.AIWORK_ENV_STORE ?? "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const appData = String(process.env.APPDATA ?? "").trim();
    const root = appData || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(root, "aiwork", "env.json");
  }
  return path.join(os.homedir(), ".config", "aiwork", "env.json");
}

const USER_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USER_ENV_RESERVED_PREFIXES = ["AIWORK_", "OPENCODE_"];

// Synchronous, best-effort; absent or malformed returns {}. Reserved prefixes
// are stripped so a tampered file can never shadow AIWORK_* / OPENCODE_*.
function loadUserEnvFile() {
  try {
    const raw = readFileSync(resolveUserEnvFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.variables)) return {};
    const out = {};
    for (const entry of parsed.variables) {
      if (!entry || typeof entry !== "object") continue;
      const { key, value } = entry;
      if (typeof key !== "string" || typeof value !== "string") continue;
      if (!USER_ENV_KEY_PATTERN.test(key)) continue;
      if (USER_ENV_RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function createRuntimeManager({ app, desktopRoot, listLocalWorkspacePaths }) {
  const engineState = createEngineState();
  const aiworkServerState = createAiWorkServerState();
  // Serialize engine lifecycle operations. Without this, concurrent renderer
  // invocations of engineStart/engineStop/engineRestart race: each call's
  // stopAllRuntimeChildren kills the previous call's freshly-spawned
  let runtimeLifecycleQueue = Promise.resolve();
  let lifecycleState = "idle";
  function withRuntimeLifecycle(fn) {
    const next = runtimeLifecycleQueue.then(fn, fn);
    runtimeLifecycleQueue = next.catch(() => {});
    return next;
  }

  const userDataDir = app.getPath("userData");
  const sidecarDirs = [
    path.join(desktopRoot, "resources", "sidecars"),
    process.resourcesPath ? path.join(process.resourcesPath, "sidecars") : null,
    path.join(path.dirname(app.getPath("exe")), "sidecars"),
  ].filter(Boolean);

  function aiworkServerTokenStorePath() {
    return path.join(userDataDir, "aiwork-server-tokens.json");
  }

  function aiworkServerStatePath() {
    return path.join(userDataDir, "aiwork-server-state.json");
  }

  function managedOpencodeWorkdir() {
    return path.join(userDataDir, "managed-opencode-workdir");
  }

  async function loadTokenStore() {
    return readJsonFile(aiworkServerTokenStorePath(), { version: 1, workspaces: {} });
  }

  async function saveTokenStore(store) {
    const filePath = aiworkServerTokenStorePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async function loadPortState() {
    return readJsonFile(aiworkServerStatePath(), {
      version: 3,
      workspacePorts: {},
      preferredPort: null,
    });
  }

  async function savePortState(state) {
    const filePath = aiworkServerStatePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async function loadOrCreateWorkspaceTokens(workspaceKey) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (store.workspaces?.[normalized]) {
      return store.workspaces[normalized];
    }
    const next = {
      clientToken: randomUUID(),
      hostToken: randomUUID(),
      ownerToken: null,
      updatedAt: nowMs(),
    };
    store.workspaces ??= {};
    store.workspaces[normalized] = next;
    await saveTokenStore(store);
    return next;
  }

  async function persistWorkspaceOwnerToken(workspaceKey, ownerToken) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (!store.workspaces?.[normalized]) return;
    store.workspaces[normalized].ownerToken = ownerToken;
    store.workspaces[normalized].updatedAt = nowMs();
    await saveTokenStore(store);
  }

  async function readPreferredAiWorkPort(workspaceKey) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (normalized && state.workspacePorts?.[normalized]) {
      return state.workspacePorts[normalized];
    }
    return state.preferredPort ?? null;
  }

  async function persistPreferredAiWorkPort(workspaceKey, port) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    state.version = 3;
    state.workspacePorts ??= {};
    if (normalized) {
      state.workspacePorts[normalized] = port;
      state.preferredPort = null;
    } else {
      state.preferredPort = port;
    }
    await savePortState(state);
  }

  async function resolveAiWorkPort(host, workspaceKey) {
    // Use a fresh port every boot. Persisted preferred ports made prod starts
    // fragile when an old sidecar held the previous port or shutdown was
    // unclean; Electron publishes the chosen URL to React after boot.
    return findFreePort(host);
  }

  async function ensureDevModePaths() {
    const root = path.join(userDataDir, "aiwork-dev-data");
    const paths = {
      homeDir: path.join(root, "home"),
      xdgConfigHome: path.join(root, "xdg", "config"),
      xdgDataHome: path.join(root, "xdg", "data"),
      xdgCacheHome: path.join(root, "xdg", "cache"),
      xdgStateHome: path.join(root, "xdg", "state"),
      opencodeConfigDir: path.join(root, "config", "opencode"),
    };

    for (const dir of Object.values(paths)) {
      await mkdir(dir, { recursive: true });
    }
    await mkdir(path.join(paths.xdgDataHome, "opencode"), { recursive: true });
    return paths;
  }

  async function buildChildEnv(extra = {}) {
    /** @type {NodeJS.ProcessEnv} */
    // User env is layered first so process.env + any caller overrides always
    // win. See apps/server/src/env-file.ts and src-tauri/src/env_file.rs —
    // all three loaders must agree on path + reserved-keys policy.
    const env = {
      ...loadUserEnvFile(),
      ...process.env,
      BUN_CONFIG_DNS_RESULT_ORDER: "verbatim",
      ...extra,
    };
    const pathKey =
      Object.prototype.hasOwnProperty.call(env, "PATH") ||
      !Object.prototype.hasOwnProperty.call(env, "Path")
        ? "PATH"
        : "Path";
    const pathEnv = enrichedPath(sidecarDirs, env[pathKey]);
    if (pathEnv) {
      env[pathKey] = pathEnv;
    }
    if (process.env.AIWORK_DEV_MODE === "1") {
      const devPaths = await ensureDevModePaths();
      env.AIWORK_DEV_MODE = "1";
      env.HOME = devPaths.homeDir;
      env.USERPROFILE = devPaths.homeDir;
      env.XDG_CONFIG_HOME = devPaths.xdgConfigHome;
      env.XDG_DATA_HOME = devPaths.xdgDataHome;
      env.XDG_CACHE_HOME = devPaths.xdgCacheHome;
      env.XDG_STATE_HOME = devPaths.xdgStateHome;
      env.OPENCODE_CONFIG_DIR = devPaths.opencodeConfigDir;
      env.OPENCODE_TEST_HOME = devPaths.homeDir;
    }
    return env;
  }

  const OPENCODE_DISK_LOG_TAIL_BYTES = 256 * 1024;

  function resolveOpencodeDiskLogDirCandidates() {
    /** @type {{ variant: string; dir: string }[]} */
    const candidates = [];
    const home = app.getPath("home");

    if (process.env.AIWORK_DEV_MODE === "1") {
      if (process.platform === "darwin") {
        candidates.push({
          variant: "macos_electron_dev",
          dir: path.join(
            home,
            "Library/Application Support/com.fengai.aiwork.dev/aiwork-dev-data/xdg/data/opencode/log",
          ),
        });
      }
      candidates.push({
        variant: "aiwork_dev_isolated",
        dir: path.join(userDataDir, "aiwork-dev-data", "xdg", "data", "opencode", "log"),
      });
    }

    const xdgData =
      process.env.XDG_DATA_HOME?.trim() ||
      (process.platform === "win32" ? process.env.LOCALAPPDATA?.trim() : path.join(home, ".local", "share"));
    if (xdgData) {
      candidates.push({
        variant: "standard_data_home",
        dir: path.join(xdgData, "opencode", "log"),
      });
    }

    const seen = new Set();
    /** @type {{ variant: string; dir: string }[]} */
    const out = [];
    for (const entry of candidates) {
      const abs = path.resolve(entry.dir);
      const key = abs.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ variant: entry.variant, dir: abs });
    }
    return out;
  }

  async function pickLatestOpencodeLogFile(logDir) {
    /** @type {import("node:fs").Dirent[]} */
    let dirents = [];
    try {
      dirents = await readdir(logDir, { withFileTypes: true });
    } catch {
      return null;
    }
    const files = dirents.filter((d) => d.isFile() && d.name.endsWith(".log"));
    if (!files.length) return null;
    let bestPath = null;
    let bestMtime = -Infinity;
    for (const d of files) {
      const fp = path.join(logDir, d.name);
      try {
        const st = await stat(fp);
        const m = st.mtimeMs;
        if (m >= bestMtime) {
          bestMtime = m;
          bestPath = fp;
        }
      } catch {
        /* skip */
      }
    }
    return bestPath;
  }

  async function readUtf8Tail(filePath, maxBytes) {
    const st = await stat(filePath);
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      await fh.close();
    }
  }

  async function readOpencodeEngineDiskLogs() {
    const ordered = resolveOpencodeDiskLogDirCandidates();
    for (const { variant, dir } of ordered) {
      if (!existsSync(dir)) {
        continue;
      }
      const latest = await pickLatestOpencodeLogFile(dir);
      if (!latest) {
        continue;
      }
      try {
        const label = path.basename(latest);
        const content = await readUtf8Tail(latest, OPENCODE_DISK_LOG_TAIL_BYTES);
        return {
          dir,
          resolvedVariant: variant,
          fileLabel: label,
          content,
          error: null,
        };
      } catch (error) {
        return {
          dir,
          resolvedVariant: variant,
          fileLabel: path.basename(latest),
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const fallbackDir = ordered.at(-1)?.dir ?? "";
    return {
      dir: fallbackDir,
      resolvedVariant: "none",
      fileLabel: null,
      content: "",
      error: "log_directory_not_found",
    };
  }

  function resolveBinaryInfo(baseName, extraPaths = []) {
    for (const directory of [...sidecarDirs, ...extraPaths]) {
      for (const fileName of binaryFileNames(baseName)) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) {
          return { path: candidate, source: "bundled" };
        }
      }
    }

    const pathEntries = (enrichedPath([], process.env.PATH) ?? "")
      .split(path.delimiter)
      .filter(Boolean);
    for (const entry of pathEntries) {
      for (const fileName of binaryFileNames(baseName)) {
        const candidate = path.join(entry, fileName);
        if (existsSync(candidate)) {
          return { path: candidate, source: "path" };
        }
      }
    }

    if (baseName === "opencode") {
      for (const candidate of [
        path.join(app.getPath("home"), ".aiwork-opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
        path.join("/opt/homebrew/bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
        path.join("/usr/local/bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
        path.join("/usr/bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
      ]) {
        if (existsSync(candidate)) {
          return { path: candidate, source: "known-location" };
        }
      }
    }

    return null;
  }

  function resolveBinary(baseName, extraPaths = []) {
    return resolveBinaryInfo(baseName, extraPaths)?.path ?? null;
  }

  function resolveOpencodeBinary(opencodeBinPath) {
    const explicitPath = typeof opencodeBinPath === "string" ? opencodeBinPath.trim() : "";
    return explicitPath ? { path: explicitPath, source: "custom" } : resolveBinaryInfo("opencode");
  }

  async function runShellCommand(program, args, options = {}) {
    const result = spawnSync(program, args, {
      encoding: "utf8",
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      timeout: options.timeoutMs,
    });
    return {
      status: typeof result.status === "number" ? result.status : -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  function engineDoctor(options = {}) {
    const resolved = resolveOpencodeBinary(options?.opencodeBinPath);
    if (!resolved?.path) {
      return {
        found: false,
        inPath: false,
        resolvedPath: null,
        resolvedSource: null,
        version: null,
        supportsServe: false,
        notes: ["OpenCode binary not found in bundled sidecars or PATH."],
        serveHelpStatus: null,
        serveHelpStdout: null,
        serveHelpStderr: null,
      };
    }

    const versionResult = spawnSync(resolved.path, ["--version"], { encoding: "utf8" });
    const helpResult = spawnSync(resolved.path, ["serve", "--help"], { encoding: "utf8" });
    const notes = [`Using ${resolved.source}: ${resolved.path}`];
    if (versionResult.status !== 0) {
      notes.push("OpenCode version probe failed.");
    }
    if (helpResult.status !== 0) {
      notes.push("OpenCode serve --help probe failed.");
    }

    return {
      found: true,
      inPath: resolved.source === "path",
      resolvedPath: resolved.path,
      resolvedSource: resolved.source,
      version: versionResult.stdout?.trim() || versionResult.stderr?.trim() || null,
      supportsServe: helpResult.status === 0,
      notes,
      serveHelpStatus: typeof helpResult.status === "number" ? helpResult.status : null,
      serveHelpStdout: helpResult.stdout?.trim() || null,
      serveHelpStderr: helpResult.stderr?.trim() || null,
    };
  }

  async function pinnedOpencodeInstallCommand() {
    const constantsPath = path.resolve(desktopRoot, "../../constants.json");
    const payload = JSON.parse(await readFile(constantsPath, "utf8"));
    const version = String(payload?.opencodeVersion ?? "").trim().replace(/^v/, "");
    if (!version) {
      throw new Error("constants.json is missing opencodeVersion");
    }
    return `curl -fsSL https://opencode.ai/install | bash -s -- --version ${version} --no-modify-path`;
  }

  function spawnManagedChild(state, program, args, options = {}) {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    state.child = child;
    state.childExited = false;
    state.lastStdout = null;
    state.lastStderr = null;

    child.stdout?.on("data", (chunk) => appendOutput(state, "lastStdout", chunk.toString()));
    child.stderr?.on("data", (chunk) => appendOutput(state, "lastStderr", chunk.toString()));
    child.on("exit", (code) => {
      state.childExited = true;
      if (code != null && code !== 0) {
        appendOutput(state, "lastStderr", `Process exited with code ${code}.\n`);
      }
      options.onExit?.(code);
    });
    child.on("error", (error) => {
      state.childExited = true;
      appendOutput(state, "lastStderr", `${error instanceof Error ? error.message : String(error)}\n`);
    });

    return child;
  }

  function processMatchesSidecar(command) {
    const value = String(command ?? "");
    return sidecarDirs.some((dir) => value.includes(dir)) &&
      (
        value.includes("aiwork-server") ||
        value.includes("opencode serve")
      );
  }

  function killProcessId(pid, signal = "SIGTERM") {
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited or is not ours.
    }
  }

  async function cleanupPackagedSidecars() {
    if (!app.isPackaged) return;

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Safety net: an unclean Electron quit can orphan sidecars. Packaged builds
    // should always own a fresh runtime per app launch, so remove any leftover
    // sidecars from this app bundle before choosing ports for the new runtime.
    const result = spawnSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" });
    const rows = String(result.stdout ?? "").split(/\r?\n/);
    const pids = [];
    for (const row of rows) {
      const match = row.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const command = match[2] ?? "";
      if (processMatchesSidecar(command)) pids.push(pid);
    }
    for (const pid of pids) killProcessId(pid, "SIGTERM");
    if (pids.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      for (const pid of pids) killProcessId(pid, "SIGKILL");
    }
  }

  async function stopChild(state, options = {}) {
    const child = state.child;
    state.child = null;
    state.childExited = true;
    if (!child || child.exitCode != null || child.killed) return;

    if (options.requestShutdown) {
      try {
        const shutdownRequested = await options.requestShutdown();
        if (shutdownRequested) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      } catch {
        // ignore
      }
    }

    if (child.exitCode == null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (child.exitCode == null && !child.killed) {
        child.kill("SIGKILL");
      }
    }
  }

  async function ensureOpencodeConfig(projectDir) {
    const jsoncPath = path.join(projectDir, "opencode.jsonc");
    const jsonPath = path.join(projectDir, "opencode.json");
    if ((await fileExists(jsoncPath)) || (await fileExists(jsonPath))) return;
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      jsoncPath,
      `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
      "utf8",
    );
  }

  async function issueOwnerToken(baseUrl, hostToken) {
    const payload = await fetchJson(
      `${baseUrl.replace(/\/+$/, "")}/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AiWork-Host-Token": hostToken,
        },
        body: JSON.stringify({ scope: "owner", label: "AiWork desktop owner token" }),
      },
      5000,
    );
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";
    return token || null;
  }

  async function startAiWorkServer(options) {
    await stopChild(aiworkServerState);

    const workspacePaths = options.workspacePaths.filter((value) => value.trim().length > 0);
    const activeWorkspace = workspacePaths[0] ?? "";
    const host = "127.0.0.1";
    const port = await resolveAiWorkPort(host, activeWorkspace);
    const baseUrl = `http://127.0.0.1:${port}`;
    const tokens = await loadOrCreateWorkspaceTokens(activeWorkspace);
    const program = resolveBinary("aiwork-server");
    if (!program) {
      throw new Error("Failed to locate aiwork-server.");
    }

    const args = [
      "--host",
      host,
      "--port",
      String(port),
      "--cors",
      "*",
      "--approval",
      "auto",
      ...workspacePaths.flatMap((workspacePath) => ["--workspace", workspacePath]),
      ...(options.opencodeBaseUrl ? ["--opencode-base-url", options.opencodeBaseUrl] : []),
      ...(activeWorkspace ? ["--opencode-directory", activeWorkspace] : []),
    ];

    const managedOpencode = options.manageOpencode ? resolveOpencodeBinary(options.opencodeBinPath) : null;
    aiworkServerState.managedOpencodeBinPath = managedOpencode?.path ?? null;
    aiworkServerState.managedOpencodeBinSource = managedOpencode?.source ?? null;
    if (options.manageOpencode) {
      engineState.opencodeBinPath = managedOpencode?.path ?? null;
      engineState.opencodeBinSource = managedOpencode?.source ?? null;
    }

    const env = await buildChildEnv({
      AIWORK_TOKEN: tokens.clientToken,
      AIWORK_HOST_TOKEN: tokens.hostToken,
      ...(options.manageOpencode ? { AIWORK_MANAGE_OPENCODE: "1" } : {}),
      ...(options.manageOpencode ? { AIWORK_OPENCODE_BIN: managedOpencode?.path ?? "" } : {}),
      ...(options.manageOpencode ? { AIWORK_MANAGED_OPENCODE_CWD: managedOpencodeWorkdir() } : {}),
      ...(options.opencodeUsername ? { AIWORK_OPENCODE_USERNAME: options.opencodeUsername } : {}),
      ...(options.opencodePassword ? { AIWORK_OPENCODE_PASSWORD: options.opencodePassword } : {}),
    });

    spawnManagedChild(aiworkServerState, program, args, {
      cwd: activeWorkspace || desktopRoot,
      env,
    });

    aiworkServerState.host = host;
    aiworkServerState.port = port;
    aiworkServerState.baseUrl = baseUrl;
    aiworkServerState.clientToken = tokens.clientToken;
    aiworkServerState.hostToken = tokens.hostToken;

    const connectUrls = { connectUrl: null, mdnsUrl: null, lanUrl: null };
    aiworkServerState.connectUrl = connectUrls.connectUrl;
    aiworkServerState.mdnsUrl = connectUrls.mdnsUrl;
    aiworkServerState.lanUrl = connectUrls.lanUrl;

    await waitForHttpOk(`${baseUrl}/health`, 10_000);
    // Owner tokens live in the AiWork server token store, which can be reset
    // independently from the desktop runtime token cache. Always mint a fresh
    // owner token for the newly-started server instead of trusting the cached
    // value; otherwise the renderer can receive a stale bearer token and all
    // workspace calls fail with 401.
    const ownerToken = await issueOwnerToken(baseUrl, tokens.hostToken);
    aiworkServerState.ownerToken = ownerToken;
    if (ownerToken) {
      await persistWorkspaceOwnerToken(activeWorkspace, ownerToken);
    }
    if (ownerToken) {
      try {
        const list = await fetchJson(`${baseUrl}/workspaces`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }, 5000);
        const first = Array.isArray(list?.items) ? list.items[0] : undefined;
        const opencode = first?.opencode;
        if (opencode?.baseUrl) {
          engineState.runtime = DIRECT_RUNTIME;
          engineState.projectDir = opencode.directory ?? activeWorkspace ?? null;
          engineState.hostname = new URL(opencode.baseUrl).hostname;
          engineState.port = Number(new URL(opencode.baseUrl).port) || null;
          engineState.baseUrl = opencode.baseUrl;
          engineState.opencodeUsername = opencode.username ?? null;
          engineState.opencodePassword = opencode.password ?? null;
          engineState.child = null;
          engineState.childExited = false;
        }
      } catch (error) {
        appendOutput(aiworkServerState, "lastStderr", `AiWork server workspace probe: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    await persistPreferredAiWorkPort(activeWorkspace, port);
    return snapshotAiWorkServerState(aiworkServerState);
  }

  async function stopAllRuntimeChildren() {
    await stopChild(aiworkServerState);
    await stopChild(engineState);

    Object.assign(engineState, createEngineState());
    Object.assign(aiworkServerState, createAiWorkServerState());
  }

  async function prepareFreshRuntime() {
    lifecycleState = "cleaning";
    await stopAllRuntimeChildren();
    await cleanupPackagedSidecars();
    lifecycleState = "idle";
  }

  async function ensureAiWork(options) {
    let aiworkServer;
    try {
      aiworkServer = await startAiWorkServer({
        workspacePaths: options.workspacePaths,
        opencodeBaseUrl: engineState.baseUrl,
        opencodeUsername: engineState.opencodeUsername,
        opencodePassword: engineState.opencodePassword,
        manageOpencode: options.manageOpencode === true,
        opencodeBinPath: options.opencodeBinPath,
      });
    } catch (error) {
      appendOutput(engineState, "lastStderr", `AiWork server: ${error instanceof Error ? error.message : String(error)}\n`);
      throw error;
    }

    assertAiWorkServerReady(aiworkServer);
  }

  async function engineStart(projectDir, options = {}) {
    const safeProjectDir = String(projectDir ?? "").trim();
    if (!safeProjectDir) {
      throw new Error("projectDir is required");
    }
    await mkdir(safeProjectDir, { recursive: true });
    await ensureOpencodeConfig(safeProjectDir);
    await prepareFreshRuntime();

    const workspacePaths = [safeProjectDir, ...((options.workspacePaths ?? []).filter(Boolean))].filter(
      (value, index, list) => list.indexOf(value) === index,
    );
    const runtime = DIRECT_RUNTIME;

    try {
      lifecycleState = "starting";
      engineState.runtime = runtime;
      engineState.projectDir = safeProjectDir;
      engineState.child = null;
      engineState.childExited = true;

      await ensureAiWork({
        projectDir: safeProjectDir,
        workspacePaths,
        manageOpencode: true,
        opencodeBinPath: options.opencodeBinPath,
      });

      lifecycleState = "healthy";
      return snapshotEngineState(engineState);
    } catch (error) {
      lifecycleState = "error";
      throw error;
    }
  }

  async function engineStop() {
    lifecycleState = "stopping";
    await stopAllRuntimeChildren();
    lifecycleState = "idle";
    return snapshotEngineState(engineState);
  }

  async function engineRestart(options = {}) {
    const projectDir = engineState.projectDir;
    if (!projectDir) {
      throw new Error("OpenCode is not configured for a local workspace");
    }
    return engineStart(projectDir, {
      runtime: engineState.runtime,
      workspacePaths: [projectDir],
    });
  }

  async function engineInfo() {
    return { ...snapshotEngineState(engineState), lifecycleState };
  }

  async function runtimeStatus() {
    return {
      lifecycleState,
      engine: await engineInfo(),
      aiworkServer: snapshotAiWorkServerState(aiworkServerState),
    };
  }

  async function aiworkServerInfo() {
    return snapshotAiWorkServerState(aiworkServerState);
  }

  async function aiworkServerRestart(options = {}) {
    const workspacePaths = (await listLocalWorkspacePaths()).filter(Boolean);
    return startAiWorkServer({
      workspacePaths,
      opencodeBaseUrl: engineState.baseUrl,
      opencodeUsername: engineState.opencodeUsername,
      opencodePassword: engineState.opencodePassword,
    });
  }

  async function engineInstall() {
    if (process.platform === "win32") {
      return {
        ok: false,
        status: -1,
        stdout: "",
        stderr:
          "Guided install is not supported on Windows yet. Install the AiWork-pinned OpenCode version manually, then restart AiWork.",
      };
    }

    const installDir = path.join(app.getPath("home"), ".aiwork-opencode", "bin");
    const command = await pinnedOpencodeInstallCommand();
    const result = await runShellCommand("bash", ["-lc", command], {
      env: { ...(await buildChildEnv()), OPENCODE_INSTALL_DIR: installDir },
      timeoutMs: 180_000,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function opencodeMcpAuth(projectDir, serverName) {
    const safeProjectDir = String(projectDir ?? "").trim();
    const safeServerName = String(serverName ?? "").trim();
    if (!safeProjectDir) {
      throw new Error("project_dir is required");
    }
    if (!safeServerName) {
      throw new Error("server_name is required");
    }

    const program = resolveBinary("opencode");
    if (!program) {
      throw new Error("Failed to locate opencode.");
    }

    const result = await runShellCommand(program, ["mcp", "auth", safeServerName], {
      cwd: safeProjectDir,
      env: await buildChildEnv(),
      timeoutMs: 120_000,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    engineStart: (projectDir, options) => withRuntimeLifecycle(() => engineStart(projectDir, options)),
    engineStop: () => withRuntimeLifecycle(() => engineStop()),
    engineRestart: (options) => withRuntimeLifecycle(() => engineRestart(options)),
    prepareFreshRuntime: () => withRuntimeLifecycle(() => prepareFreshRuntime()),
    dispose: () => withRuntimeLifecycle(() => stopAllRuntimeChildren()),
    runtimeStatus,
    engineInfo,
    readOpencodeEngineDiskLogs,
    engineDoctor,
    engineInstall,
    aiworkServerInfo,
    aiworkServerRestart,
    opencodeMcpAuth,
  };
}
