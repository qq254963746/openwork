import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { createRuntimeManager } from "./runtime.mjs";
import { exportWorkspaceConfig, importWorkspaceConfig } from "./workspace-archive.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_DEEP_LINK_EVENT = "aiwork:deep-link-native";
const TAURI_APP_IDENTIFIER = "com.fengai.aiwork";
const DEV_APP_IDENTIFIER = "com.fengai.aiwork.dev";
const DESKTOP_PROTOCOL_SCHEME = "aiwork";
const isDevMode = process.env.AIWORK_DEV_MODE === "1";
const APP_NAME = isDevMode ? "AiWork - Dev" : "AiWork";
const APP_IDENTIFIER = isDevMode ? DEV_APP_IDENTIFIER : TAURI_APP_IDENTIFIER;

// Production Electron shares the same on-disk state folder as the Tauri shell. Dev mode uses the
// separate dev identifier so it can run beside the production app.
//
// Override via AIWORK_ELECTRON_USERDATA so dogfooders can isolate their
// Electron install from the real Tauri app.
app.setName(APP_NAME);
app.setAppUserModelId(APP_IDENTIFIER);
if (app.isPackaged) {
  app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME);
}
const userDataOverride = process.env.AIWORK_ELECTRON_USERDATA?.trim();
if (userDataOverride) {
  app.setPath("userData", userDataOverride);
} else {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), APP_IDENTIFIER),
  );
}

// Resolve and cache the app icon (reused for BrowserWindow + mac dock).
// Packaged builds ship icons via electron-builder config, but for `dev:electron`
// the Electron default icon is shown without this.
function resolveAppIconPath() {
  const candidates = [
    // Dev: match Tauri's separate dev icon so the dev app is visibly distinct.
    ...(isDevMode
      ? [
          path.resolve(__dirname, "../resources/icons/dev/icon.png"),
          path.resolve(__dirname, "../resources/icons/dev/128x128@2x.png"),
          path.resolve(__dirname, "../resources/icons/dev/icon-dev.icns"),
        ]
      : []),
    // Repo-relative path to the Electron resource icon set.
    path.resolve(__dirname, "../resources/icons/icon.png"),
    // Packaged: electron-builder copies extraResources but we fall back to this
    // if custom packaging ever exposes the icon here.
    path.join(process.resourcesPath ?? "", "icons", "icon.png"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const APP_ICON_PATH = resolveAppIconPath();
const APP_ICON_IMAGE = APP_ICON_PATH ? nativeImage.createFromPath(APP_ICON_PATH) : null;

if (process.platform === "darwin" && APP_ICON_IMAGE && !APP_ICON_IMAGE.isEmpty() && app.dock) {
  app.dock.setIcon(APP_ICON_IMAGE);
}

// Optional: expose Chrome DevTools Protocol so external tools (chrome-devtools
// MCP, raw CDP clients, etc.) can attach to this Electron instance.
// Enable by setting AIWORK_ELECTRON_REMOTE_DEBUG_PORT=<port> before launch.
const remoteDebugPort = Number.parseInt(
  process.env.AIWORK_ELECTRON_REMOTE_DEBUG_PORT?.trim() ?? "",
  10,
);
if (Number.isFinite(remoteDebugPort) && remoteDebugPort > 0) {
  app.commandLine.appendSwitch("remote-debugging-port", String(remoteDebugPort));
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}
function envFlagDisabled(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

async function installReactDevToolsForDev() {
  if (app.isPackaged || envFlagDisabled("AIWORK_REACT_DEVTOOLS")) return;
  try {
    const mod = await import("electron-devtools-installer");
    const installExtension =
      typeof mod.installExtension === "function"
        ? mod.installExtension
        : typeof mod.default === "function"
          ? mod.default
          : typeof mod.default?.installExtension === "function"
            ? mod.default.installExtension
            : null;
    const reactDevtools = mod.REACT_DEVELOPER_TOOLS ?? mod.default?.REACT_DEVELOPER_TOOLS;
    if (typeof installExtension !== "function" || !reactDevtools) {
      throw new Error("electron-devtools-installer did not expose React DevTools");
    }
    const name = await installExtension(reactDevtools);
    console.info(`[devtools] installed ${name}`);
  } catch (error) {
    console.warn("[devtools] failed to install React Developer Tools", error);
  }
}

const EMPTY_WORKSPACE_LIST = Object.freeze({
  selectedId: "",
  watchedId: null,
  activeId: null,
  workspaces: [],
});


let mainWindow = null;
const pendingDeepLinks = [];

function forwardedDeepLinks(argv) {
  return argv
    .slice(1)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.startsWith("aiwork://") ||
        entry.startsWith("aiwork-dev://") ||
        entry.startsWith("https://") ||
        entry.startsWith("http://"),
    );
}

function queueDeepLinks(urls) {
  const nextUrls = urls.filter(Boolean);
  if (nextUrls.length === 0) return;
  pendingDeepLinks.push(...nextUrls);
  if (mainWindow?.webContents) {
    mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, nextUrls);
  }
}

function flushPendingDeepLinks() {
  if (!mainWindow?.webContents || pendingDeepLinks.length === 0) return;
  const urls = pendingDeepLinks.splice(0, pendingDeepLinks.length);
  mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, urls);
}

function workspaceStatePath() {
  return path.join(app.getPath("userData"), "aiwork-workspaces.json");
}

function configHomePath() {
  if (process.env.XDG_CONFIG_HOME?.trim()) {
    return process.env.XDG_CONFIG_HOME.trim();
  }
  if (process.platform === "win32" && process.env.APPDATA?.trim()) {
    return process.env.APPDATA.trim();
  }
  return path.join(os.homedir(), ".config");
}

function globalOpencodeRoot() {
  const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(configHomePath(), "opencode");
}

function execResult(ok, stdout = "", stderr = "", status = ok ? 0 : 1) {
  return { ok, status, stdout, stderr };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
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


function sanitizeCommandName(raw) {
  const trimmed = String(raw ?? "").trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  const safe = Array.from(trimmed)
    .filter((char) => /[A-Za-z0-9_-]/.test(char))
    .join("");
  return safe || null;
}

function escapeYamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function serializeCommandFrontmatter(command) {
  const template = String(command?.template ?? "").trim();
  if (!template) {
    throw new Error("command.template is required");
  }

  let output = "---\n";
  if (typeof command?.description === "string" && command.description.trim()) {
    output += `description: ${escapeYamlScalar(command.description.trim())}\n`;
  }
  if (typeof command?.agent === "string" && command.agent.trim()) {
    output += `agent: ${escapeYamlScalar(command.agent.trim())}\n`;
  }
  if (typeof command?.model === "string" && command.model.trim()) {
    output += `model: ${escapeYamlScalar(command.model.trim())}\n`;
  }
  if (command?.subtask === true) {
    output += "subtask: true\n";
  }
  output += `---\n\n${template}\n`;
  return output;
}

function validateSkillName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new Error("skill name must be kebab-case");
  }
  return trimmed;
}

function defaultWorkspaceAiWorkConfig(workspacePath, preset = null) {
  return {
    version: 1,
    workspace: workspacePath
      ? {
          name: path.basename(workspacePath) || "Workspace",
          createdAt: Date.now(),
          preset: preset || null,
        }
      : null,
    authorizedRoots: workspacePath ? [workspacePath] : [],
    reload: null,
  };
}

async function normalizeLocalWorkspacePath(rawPath) {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) return "";
  const expanded = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  const resolved = path.resolve(expanded);
  return realpath(resolved).catch(() => resolved);
}

function normalizeWorkspacePathKey(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? path.resolve(trimmed).replace(/\\/g, "/").toLowerCase() : "";
}

function stableWorkspaceId(value) {
  return `ws_${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

function localWorkspaceId(workspacePath) {
  return stableWorkspaceId(workspacePath);
}

async function readWorkspaceAiWorkConfig(workspacePath) {
  const aiworkPath = path.join(workspacePath, ".aiwork-opencode", "aiwork.json");
  if (!(await pathExists(aiworkPath))) {
    return defaultWorkspaceAiWorkConfig(workspacePath);
  }
  const raw = await readFile(aiworkPath, "utf8");
  return JSON.parse(raw);
}

async function writeWorkspaceAiWorkConfig(workspacePath, config) {
  const aiworkPath = path.join(workspacePath, ".aiwork-opencode", "aiwork.json");
  await mkdir(path.dirname(aiworkPath), { recursive: true });
  await writeFile(aiworkPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return execResult(true, `Wrote ${aiworkPath}`);
}

async function readWorkspaceState() {
  const state = await readJsonFile(workspaceStatePath(), EMPTY_WORKSPACE_LIST);
  return {
    selectedId:
      typeof state?.selectedId === "string"
        ? state.selectedId
        : typeof state?.selectedWorkspaceId === "string"
          ? state.selectedWorkspaceId
          : typeof state?.activeId === "string"
            ? state.activeId
            : "",
    watchedId:
      typeof state?.watchedId === "string"
        ? state.watchedId
        : typeof state?.watchedWorkspaceId === "string"
          ? state.watchedWorkspaceId
          : null,
    activeId: typeof state?.activeId === "string" ? state.activeId : null,
    workspaces: Array.isArray(state?.workspaces) ? state.workspaces : [],
  };
}

async function writeWorkspaceState(nextState) {
  const outputPath = workspaceStatePath();
  const selectedId = String(nextState?.selectedId ?? nextState?.activeId ?? "");
  const watchedId = typeof nextState?.watchedId === "string" ? nextState.watchedId : "";
  const output = {
    ...nextState,
    // Tauri's Rust state uses selectedWorkspaceId/watchedWorkspaceId on disk
    // (with activeId as a legacy alias). Keep Electron's selectedId/watchedId
    // too so older Electron builds can still read the same file.
    selectedId,
    selectedWorkspaceId: selectedId,
    watchedId: watchedId || null,
    watchedWorkspaceId: watchedId,
    activeId: selectedId || null,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

const runtimeManager = createRuntimeManager({
  app,
  desktopRoot: path.resolve(__dirname, ".."),
  listLocalWorkspacePaths: async () =>
    (await readWorkspaceState())
      .workspaces.map((entry) => String(entry?.path ?? "").trim())
      .filter(Boolean),
});

let runtimeDisposedForQuit = false;
let runtimeBootstrapPromise = null;

async function disposeRuntimeBeforeQuit() {
  if (runtimeDisposedForQuit) return;
  runtimeDisposedForQuit = true;
  await runtimeManager.dispose().catch(() => undefined);
}

function assertAiWorkServerReady(info) {
  if (!info?.running) {
    throw new Error("AiWork server did not stay running after startup.");
  }
  if (!info.baseUrl) {
    throw new Error("AiWork server did not report a base URL after startup.");
  }
  if (!info.ownerToken && !info.clientToken) {
    throw new Error("AiWork server did not report an access token after startup.");
  }
  return info;
}

async function bootRuntimeForSelectedWorkspace() {
  const list = await readWorkspaceState();
  const selectedId = list.selectedId || list.activeId || list.workspaces[0]?.id || "";
  const workspace = selectedId
    ? list.workspaces.find((entry) => entry?.id === selectedId)
    : list.workspaces[0];
  const workspaceRoot = String(workspace?.path ?? "").trim();
  if (!workspaceRoot) {
    return { ok: true, skipped: true, reason: "no-local-workspace" };
  }

  const workspacePaths = [];
  for (const entry of list.workspaces) {
    const workspacePath = String(entry?.path ?? "").trim();
    if (workspacePath && !workspacePaths.includes(workspacePath)) workspacePaths.push(workspacePath);
  }
  if (!workspacePaths.includes(workspaceRoot)) workspacePaths.unshift(workspaceRoot);

  let bootWorkspace = workspace;
  let bootWorkspaceRoot = workspaceRoot;
  let engine;
  try {
    engine = await runtimeManager.engineStart(workspaceRoot, {
      runtime: "direct",
      workspacePaths,
    });
  } catch (error) {
    const fallback = list.workspaces.find((entry) => {
      const candidatePath = String(entry?.path ?? "").trim();
      return candidatePath && candidatePath !== workspaceRoot;
    });
    const fallbackRoot = String(fallback?.path ?? "").trim();
    if (!fallback || !fallbackRoot) throw error;
    console.warn("[runtime] selected workspace failed during boot; trying fallback workspace", {
      selectedWorkspaceId: workspace?.id ?? null,
      fallbackWorkspaceId: fallback.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallbackWorkspacePaths = [
      fallbackRoot,
      ...workspacePaths.filter((entry) => entry !== fallbackRoot && entry !== workspaceRoot),
    ];
    engine = await runtimeManager.engineStart(fallbackRoot, {
      runtime: "direct",
      workspacePaths: fallbackWorkspacePaths,
    });
    bootWorkspace = fallback;
    bootWorkspaceRoot = fallbackRoot;
    await writeWorkspaceState({
      ...list,
      selectedId: String(fallback.id ?? ""),
      watchedId: String(fallback.id ?? ""),
    }).catch(() => undefined);
  }
  const aiworkServer = assertAiWorkServerReady(await runtimeManager.aiworkServerInfo());
  return { ok: true, skipped: false, engine, aiworkServer, workspaceId: bootWorkspace.id ?? null };
}

function ensureRuntimeBootstrap() {
  if (!runtimeBootstrapPromise) {
    runtimeBootstrapPromise = bootRuntimeForSelectedWorkspace().catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
  return runtimeBootstrapPromise;
}

function normalizeWorkspaceEntry(input) {
  return {
    id: String(input.id),
    name: String(input.name ?? "Workspace"),
    path: String(input.path ?? ""),
    preset: String(input.preset ?? "starter"),
    displayName: input.displayName ?? null,
  };
}

async function mutateWorkspaceState(mutator) {
  const current = await readWorkspaceState();
  const next = await mutator({ ...current, workspaces: [...current.workspaces] });
  return writeWorkspaceState(next);
}

function resolveOpencodeConfigPath(scope, projectDir) {
  let root;
  if (scope === "project") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    root = projectDir;
  } else if (scope === "global") {
    root = globalOpencodeRoot();
  } else {
    throw new Error("scope must be 'project' or 'global'");
  }

  const jsoncPath = path.join(root, "opencode.jsonc");
  const jsonPath = path.join(root, "opencode.json");
  return { jsoncPath, jsonPath };
}

async function readOpencodeConfig(scope, projectDir) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const chosenPath = (await pathExists(jsoncPath)) ? jsoncPath : (await pathExists(jsonPath)) ? jsonPath : jsoncPath;
  const exists = await pathExists(chosenPath);
  return {
    path: chosenPath,
    exists,
    content: exists ? await readFile(chosenPath, "utf8") : null,
  };
}

function opencodeAuthJsonPathCandidates() {
  const out = [];
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  if (xdgData) {
    out.push(path.join(xdgData, "opencode", "auth.json"));
  }
  const home = os.homedir();
  out.push(path.join(home, ".local", "share", "opencode", "auth.json"));
  if (process.platform === "darwin") {
    out.push(path.join(home, "Library", "Application Support", "opencode", "auth.json"));
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
      out.push(path.join(appData, "opencode", "auth.json"));
    }
  }
  return out;
}

async function readOpencodeAuthJson() {
  for (const candidate of opencodeAuthJsonPathCandidates()) {
    if (await pathExists(candidate)) {
      const content = await readFile(candidate, "utf8");
      return { path: candidate, content };
    }
  }
  return { path: null, content: null };
}

async function writeOpencodeConfig(scope, projectDir, content) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const targetPath = (await pathExists(jsoncPath)) ? jsoncPath : (await pathExists(jsonPath)) ? jsonPath : jsoncPath;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return execResult(true, `Wrote ${targetPath}`);
}

function resolveCommandsDir(scope, projectDir) {
  if (scope === "workspace") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    return path.join(projectDir, ".aiwork-opencode", "commands");
  }
  if (scope === "global") {
    return path.join(globalOpencodeRoot(), "commands");
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

async function listCommandNames(scope, projectDir) {
  const commandsDir = resolveCommandsDir(scope, projectDir);
  if (!(await isDirectory(commandsDir))) {
    return [];
  }
  const entries = await readdir(commandsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
}

async function writeCommandFile(scope, projectDir, command) {
  const safeName = sanitizeCommandName(command?.name);
  if (!safeName) {
    throw new Error("command.name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  await mkdir(commandsDir, { recursive: true });
  const filePath = path.join(commandsDir, `${safeName}.md`);
  await writeFile(filePath, serializeCommandFrontmatter({ ...command, name: safeName }), "utf8");
  return execResult(true, `Wrote ${filePath}`);
}

async function deleteCommandFile(scope, projectDir, name) {
  const safeName = sanitizeCommandName(name);
  if (!safeName) {
    throw new Error("name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  const filePath = path.join(commandsDir, `${safeName}.md`);
  if (await pathExists(filePath)) {
    await rm(filePath, { force: true });
  }
  return execResult(true, `Deleted ${filePath}`);
}

async function collectProjectSkillRoots(projectDir) {
  const roots = [];
  let current = path.resolve(projectDir);

  while (true) {
    const opencodeSkills = path.join(current, ".aiwork-opencode", "skills");
    const legacySkills = path.join(current, ".aiwork-opencode", "skill");
    const claudeSkills = path.join(current, ".claude", "skills");

    if (await isDirectory(opencodeSkills)) roots.push(opencodeSkills);
    if (await isDirectory(legacySkills)) roots.push(legacySkills);
    if (await isDirectory(claudeSkills)) roots.push(claudeSkills);

    if (await pathExists(path.join(current, ".git"))) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

async function collectGlobalSkillRoots() {
  const roots = [];
  const candidates = [
    path.join(globalOpencodeRoot(), "skills"),
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".agent", "skills"),
  ];

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      roots.push(candidate);
    }
  }

  return roots;
}

async function collectSkillRoots(projectDir) {
  const roots = [...(await collectProjectSkillRoots(projectDir)), ...(await collectGlobalSkillRoots())];
  return roots.filter((value, index) => roots.indexOf(value) === index);
}

async function findSkillDirsInRoot(root) {
  const found = [];
  if (!(await isDirectory(root))) return found;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const direct = path.join(root, entry.name);
    if (await pathExists(path.join(direct, "SKILL.md"))) {
      found.push(direct);
      continue;
    }

    const nestedEntries = await readdir(direct, { withFileTypes: true }).catch(() => []);
    for (const nested of nestedEntries) {
      if (!nested.isDirectory()) continue;
      const nestedDir = path.join(direct, nested.name);
      if (await pathExists(path.join(nestedDir, "SKILL.md"))) {
        found.push(nestedDir);
      }
    }
  }

  return found;
}

function extractFrontmatterValue(raw, keys) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return null;
}

function extractTrigger(raw) {
  return extractFrontmatterValue(raw, ["trigger", "when"]);
}

function extractDescription(raw) {
  let inFrontmatter = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.replace(/`/g, "");
    return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
  }
  return null;
}

async function listLocalSkills(projectDir) {
  if (!String(projectDir ?? "").trim()) {
    throw new Error("projectDir is required");
  }

  const seen = new Set();
  const out = [];
  for (const root of await collectSkillRoots(projectDir)) {
    for (const skillDir of await findSkillDirsInRoot(root)) {
      const name = path.basename(skillDir);
      if (seen.has(name)) continue;
      seen.add(name);
      let raw = "";
      try {
        raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
      } catch {
        raw = "";
      }
      out.push({
        name,
        path: skillDir,
        description: extractDescription(raw) ?? undefined,
        trigger: extractTrigger(raw) ?? undefined,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function findSkillFile(projectDir, name) {
  const safeName = validateSkillName(name);
  for (const root of await collectSkillRoots(projectDir)) {
    const direct = path.join(root, safeName, "SKILL.md");
    if (await pathExists(direct)) return direct;

    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(root, entry.name, safeName, "SKILL.md");
      if (await pathExists(nested)) return nested;
    }
  }
  return null;
}

async function ensureProjectSkillRoot(projectDir) {
  if (!String(projectDir ?? "").trim()) {
    throw new Error("projectDir is required");
  }
  const opencodeRoot = path.join(projectDir, ".aiwork-opencode");
  const legacy = path.join(opencodeRoot, "skill");
  const modern = path.join(opencodeRoot, "skills");
  if ((await isDirectory(legacy)) && !(await pathExists(modern))) {
    await rename(legacy, modern);
  }
  await mkdir(modern, { recursive: true });
  return modern;
}

function engineDoctor(options = {}) {
  return runtimeManager.engineDoctor(options);
}

function activeWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
}

async function handleDesktopInvoke(event, command, ...args) {
  switch (command) {
    case "workspaceBootstrap":
      return readWorkspaceState();
    case "workspaceSetSelected":
      return mutateWorkspaceState((state) => {
        const workspaceId = typeof args[0] === "string" ? args[0] : "";
        state.selectedId = workspaceId;
        state.activeId = workspaceId || null;
        return state;
      });
    case "workspaceSetRuntimeActive":
      return mutateWorkspaceState((state) => {
        state.watchedId = typeof args[0] === "string" && args[0].trim() ? args[0] : null;
        return state;
      });
    case "workspaceReorder": {
      const raw = args[0];
      const workspaceIds = Array.isArray(raw) ? raw : [];
      const ids = workspaceIds.map((id) => String(id ?? "").trim()).filter(Boolean);
      return mutateWorkspaceState((state) => {
        const known = new Set(state.workspaces.map((entry) => entry.id));
        if (ids.length !== known.size || ids.length !== state.workspaces.length) {
          throw new Error("workspaceIds must list every workspace exactly once");
        }
        const seen = new Set();
        for (const id of ids) {
          if (!known.has(id) || seen.has(id)) {
            throw new Error("Invalid or duplicate workspace id in reorder list");
          }
          seen.add(id);
        }
        const byId = new Map(state.workspaces.map((entry) => [entry.id, entry]));
        const next = ids.map((id) => byId.get(id)).filter(Boolean);
        if (next.length !== ids.length) {
          throw new Error("Missing workspace during reorder");
        }
        state.workspaces = next;
        return state;
      });
    }
    case "workspaceCreate": {
      const input = args[0] ?? {};
      const rawFolderPath = String(input.folderPath ?? "").trim();
      if (!rawFolderPath) throw new Error("folderPath is required");
      const folderPath = await normalizeLocalWorkspacePath(rawFolderPath);
      await mkdir(folderPath, { recursive: true });
      const preset = String(input.preset ?? "starter");
      const workspace = normalizeWorkspaceEntry({
        id: localWorkspaceId(folderPath),
        name: String(input.name ?? (path.basename(folderPath) || "Workspace")),
        displayName: String(input.name ?? (path.basename(folderPath) || "Workspace")),
        path: folderPath,
        preset,
      });
      await mkdir(path.join(folderPath, ".aiwork-opencode"), { recursive: true });
      await writeWorkspaceAiWorkConfig(folderPath, defaultWorkspaceAiWorkConfig(folderPath, preset));
      return mutateWorkspaceState((state) => {
        const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
        state.workspaces = state.workspaces.filter(
          (entry) => entry.id !== workspace.id && normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
        );
        state.workspaces.push(workspace);
        state.selectedId = workspace.id;
        state.activeId = workspace.id;
        state.watchedId = workspace.id;
        return state;
      });
    }
    case "workspaceUpdateDisplayName": {
      const input = args[0] ?? {};
      const workspaceId = String(input.workspaceId ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      return mutateWorkspaceState((state) => {
        state.workspaces = state.workspaces.map((entry) =>
          entry.id === workspaceId ? { ...entry, displayName: input.displayName ?? null } : entry,
        );
        return state;
      });
    }
    case "workspaceForget": {
      const workspaceId = String(args[0] ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      return mutateWorkspaceState((state) => {
        state.workspaces = state.workspaces.filter((entry) => entry.id !== workspaceId);
        if (state.selectedId === workspaceId) state.selectedId = "";
        if (state.activeId === workspaceId) state.activeId = null;
        if (state.watchedId === workspaceId) state.watchedId = null;
        return state;
      });
    }
    case "workspaceAddAuthorizedRoot": {
      const input = args[0] ?? {};
      const workspacePath = String(input.workspacePath ?? "").trim();
      const authorizedRoot = String(input.folderPath ?? input.authorizedRoot ?? "").trim();
      if (!workspacePath || !authorizedRoot) {
        throw new Error("workspacePath and folderPath are required");
      }
      const config = await readWorkspaceAiWorkConfig(workspacePath);
      if (!Array.isArray(config.authorizedRoots)) {
        config.authorizedRoots = [];
      }
      if (!config.authorizedRoots.includes(authorizedRoot)) {
        config.authorizedRoots.push(authorizedRoot);
      }
      return writeWorkspaceAiWorkConfig(workspacePath, config);
    }
    case "workspaceAiWorkRead":
      return readWorkspaceAiWorkConfig(String(args[0]?.workspacePath ?? "").trim());
    case "workspaceAiWorkWrite":
      return writeWorkspaceAiWorkConfig(
        String(args[0]?.workspacePath ?? "").trim(),
        args[0]?.config ?? defaultWorkspaceAiWorkConfig(""),
      );
    case "workspaceExportConfig": {
      const input = args[0] ?? {};
      const workspaceId = String(input.workspaceId ?? "").trim();
      const outputPath = String(input.outputPath ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      if (!outputPath) throw new Error("outputPath is required");
      const state = await readWorkspaceState();
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) throw new Error("Unknown workspaceId");
      return exportWorkspaceConfig({ workspace, outputPath });
    }
    case "workspaceImportConfig": {
      const input = args[0] ?? {};
      const archivePath = String(input.archivePath ?? "").trim();
      const targetDirRaw = String(input.targetDir ?? "").trim();
      if (!archivePath) throw new Error("archivePath is required");
      if (!targetDirRaw) throw new Error("targetDir is required");
      const targetDir = await normalizeLocalWorkspacePath(targetDirRaw);
      const imported = await importWorkspaceConfig({
        archivePath,
        targetDir,
        name: input.name ?? null,
      });
      const workspace = normalizeWorkspaceEntry({
        id: localWorkspaceId(targetDir),
        name: imported.workspaceName,
        displayName: null,
        path: targetDir,
        preset: imported.preset,
      });
      return mutateWorkspaceState((state) => {
        const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
        state.workspaces = state.workspaces.filter(
          (entry) => entry.id !== workspace.id && normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
        );
        state.workspaces.push(workspace);
        state.selectedId = workspace.id;
        state.activeId = workspace.id;
        state.watchedId = workspace.id;
        return state;
      });
    }
    case "opencodeCommandList":
      return listCommandNames(String(args[0]?.scope ?? "").trim(), String(args[0]?.projectDir ?? "").trim());
    case "opencodeCommandWrite":
      return writeCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        args[0]?.command ?? {},
      );
    case "opencodeCommandDelete":
      return deleteCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        String(args[0]?.name ?? "").trim(),
      );
    case "engineStart": {
      const projectDir = String(args[0] ?? "").trim();
      const options = args[1] ?? {};
      return runtimeManager.engineStart(projectDir, options);
    }
    case "prepareFreshRuntime":
      return runtimeManager.prepareFreshRuntime();
    case "runtimeBootstrap":
      return ensureRuntimeBootstrap();
    case "runtimeStatus":
      return runtimeManager.runtimeStatus();
    case "engineStop":
      return runtimeManager.engineStop();
    case "engineRestart":
      return runtimeManager.engineRestart(args[0] ?? {});
    case "engineInfo":
      return runtimeManager.engineInfo();
    case "readOpencodeEngineDiskLogs":
      return runtimeManager.readOpencodeEngineDiskLogs();
    case "engineDoctor":
      return engineDoctor(args[0]);
    case "engineInstall":
      return runtimeManager.engineInstall();
    case "appBuildInfo":
      return {
        version: app.getVersion(),
        gitSha: process.env.AIWORK_GIT_SHA ?? null,
        buildEpoch: process.env.AIWORK_BUILD_EPOCH ?? null,
        aiworkDevMode: process.env.AIWORK_DEV_MODE === "1",
      };
    case "nukeAiWorkAndOpencodeConfigAndExit": {
      await rm(app.getPath("userData"), { recursive: true, force: true });
      app.exit(0);
      return undefined;
    }
    case "aiworkServerInfo":
      return runtimeManager.aiworkServerInfo();
    case "aiworkServerRestart":
      return runtimeManager.aiworkServerRestart(args[0] ?? {});
    case "pickDirectory": {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple
        ? ["openDirectory", "createDirectory", "multiSelections"]
        : ["openDirectory", "createDirectory"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
    }
    case "pickFile": {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple ? ["openFile", "multiSelections"] : ["openFile"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
    }
    case "saveFile": {
      const options = args[0] ?? {};
      const result = await dialog.showSaveDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
    }
    case "importSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const sourceDir = String(args[1] ?? "").trim();
      const overwrite = args[2]?.overwrite === true;
      if (!projectDir || !sourceDir) {
        throw new Error("projectDir and sourceDir are required");
      }
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const name = validateSkillName(path.basename(sourceDir));
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(false, "", `Skill already exists at ${destination}`);
        }
        await rm(destination, { recursive: true, force: true });
      }
      await cp(sourceDir, destination, { recursive: true });
      return execResult(true, `Imported skill to ${destination}`);
    }
    case "installSkillTemplate": {
      const projectDir = String(args[0] ?? "").trim();
      const name = validateSkillName(args[1]);
      const content = String(args[2] ?? "");
      const overwrite = args[3]?.overwrite === true;
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(false, "", `Skill already exists at ${destination}`);
        }
        await rm(destination, { recursive: true, force: true });
      }
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "SKILL.md"), content, "utf8");
      return execResult(true, `Installed skill to ${destination}`);
    }
    case "listLocalSkills":
      return listLocalSkills(String(args[0] ?? "").trim());
    case "readLocalSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        throw new Error("Skill not found");
      }
      return { path: skillPath, content: await readFile(skillPath, "utf8") };
    }
    case "writeLocalSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(false, "", "Skill not found");
      }
      const content = String(args[2] ?? "");
      const next = content.endsWith("\n") ? content : `${content}\n`;
      await writeFile(skillPath, next, "utf8");
      return execResult(true, `Saved skill ${path.basename(path.dirname(skillPath))}`);
    }
    case "uninstallSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(false, "", "Skill not found in .aiwork-opencode/skills or .claude/skills");
      }
      await rm(path.dirname(skillPath), { recursive: true, force: true });
      return execResult(true, `Removed skill ${args[1]}`);
    }
    case "desktopAppPaths": {
      const executablePath = app.isPackaged ? app.getPath("exe") : process.execPath;
      return {
        executablePath,
        appBundlePath:
          process.platform === "darwin"
            ? path.resolve(executablePath, "../../..")
            : path.dirname(executablePath),
      };
    }
    case "readOpencodeConfig":
      return readOpencodeConfig(String(args[0] ?? "").trim(), String(args[1] ?? "").trim());
    case "readOpencodeAuthJson":
      return readOpencodeAuthJson();
    case "writeOpencodeConfig":
      return writeOpencodeConfig(
        String(args[0] ?? "").trim(),
        String(args[1] ?? "").trim(),
        String(args[2] ?? ""),
      );
    case "resetAiWorkState": {
      await rm(workspaceStatePath(), { force: true });
      return undefined;
    }
    case "resetOpencodeCache":
      return { removed: [], missing: [], errors: [] };
    case "opencodeMcpAuth":
      return runtimeManager.opencodeMcpAuth(String(args[0] ?? "").trim(), String(args[1] ?? "").trim());
    case "setWindowDecorations":
      return undefined;
    case "__openPath": {
      const target = String(args[0] ?? "").trim();
      if (!target) return "Path is required.";
      return shell.openPath(target);
    }
    case "__revealItemInDir": {
      const target = String(args[0] ?? "").trim();
      if (!target) return undefined;
      shell.showItemInFolder(target);
      return undefined;
    }
    case "__fetch": {
      const url = String(args[0] ?? "").trim();
      const init = args[1] ?? {};
      if (!url) throw new Error("URL is required.");
      const response = await fetch(url, {
        method: typeof init.method === "string" ? init.method : undefined,
        headers: init.headers && typeof init.headers === "object" ? init.headers : undefined,
        body: typeof init.body === "string" ? init.body : undefined,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body: await response.text(),
      };
    }
    case "__homeDir":
      return os.homedir();
    case "__joinPath":
      return path.join(...args.map((value) => String(value ?? "")));
    case "__setZoomFactor": {
      const factor = Number(args[0]);
      const window = activeWindowFromEvent(event);
      if (!window || !Number.isFinite(factor) || factor <= 0) {
        return false;
      }
      window.webContents.setZoomFactor(factor);
      return true;
    }
    case "resolveChromeDevtoolsMcpBin": {
      // Resolve the bundled chrome-devtools-mcp bin path so the renderer
      // can write a command to opencode.json that doesn't require npx.
      try {
        const require_ = createRequire(import.meta.url);
        const pkgJsonPath = require_.resolve("chrome-devtools-mcp/package.json");
        const binPath = path.join(path.dirname(pkgJsonPath), "build", "src", "index.js");
        if (existsSync(binPath)) {
          return [process.execPath, binPath];
        }
      } catch {
        // package not found — fall through to null
      }
      return null;
    }
    default:
      throw new Error(`Electron desktop bridge method is not implemented yet: ${command}`);
  }
}

async function createMainWindow() {
  if (mainWindow) return mainWindow;

  const preloadPath = path.join(__dirname, "preload.mjs");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    show: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 14, y: 16 },
        }
      : {}),
    ...(APP_ICON_IMAGE && !APP_ICON_IMAGE.isEmpty() ? { icon: APP_ICON_IMAGE } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDevMode) {
    mainWindow.on("page-title-updated", (event) => {
      event.preventDefault();
      mainWindow?.setTitle(APP_NAME);
    });
    mainWindow.setTitle(APP_NAME);
  }

  mainWindow.once("ready-to-show", () => {
    if (isDevMode) {
      mainWindow?.setTitle(APP_NAME);
    }
    mainWindow?.show();
    flushPendingDeepLinks();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const local =
      url.startsWith("file://") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost");
    if (!local) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    // Allow window.open() for local URLs and inject preload script so child windows
    // have the same __AIWORK_ELECTRON__ bridge as the main window.
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      },
    };
  });

  const startUrl = process.env.AIWORK_ELECTRON_START_URL?.trim() || process.env.ELECTRON_START_URL?.trim();
  if (startUrl) {
    await mainWindow.loadURL(startUrl);
  } else {
    const packagedIndexPath = path.join(process.resourcesPath, "app-dist", "index.html");
    const devIndexPath = path.resolve(__dirname, "../../app/dist/index.html");
    await mainWindow.loadFile(app.isPackaged ? packagedIndexPath : devIndexPath);
  }

  return mainWindow;
}

ipcMain.handle("aiwork:desktop", handleDesktopInvoke);
ipcMain.handle("aiwork:shell:openExternal", async (_event, url) => {
  if (typeof url === "string" && url.trim().length > 0) {
    await shell.openExternal(url);
  }
});
ipcMain.handle("aiwork:shell:relaunch", async () => {
  app.relaunch();
  app.exit(0);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("before-quit", (event) => {
    if (runtimeDisposedForQuit) return;
    event.preventDefault();
    void Promise.all([disposeRuntimeBeforeQuit()]).finally(() => app.quit());
  });

  app.on("second-instance", async (_event, argv) => {
    const win = await createMainWindow();
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    queueDeepLinks(forwardedDeepLinks(argv));
  });

  app.on("open-url", async (event, url) => {
    event.preventDefault();
    await createMainWindow();
    queueDeepLinks([url]);
  });

  app.whenReady().then(async () => {
    await installReactDevToolsForDev();
    await runtimeManager.prepareFreshRuntime().catch(() => undefined);

    queueDeepLinks(forwardedDeepLinks(process.argv));
    const win = await createMainWindow();
    win.webContents.on("did-finish-load", () => {
      flushPendingDeepLinks();
    });
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
      return;
    }
    const win = await createMainWindow();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => {
    // Match the Tauri shell: closing the main window exits the app so dev
    // supervisors can tear down the Vite server they started.
    app.quit();
  });
}
