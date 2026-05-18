import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// ─── Environment / CLI helpers ────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const readArg = (name) => {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.split("=")[1];
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
};

const hasFlag = (name) => process.argv.slice(2).includes(name);
const forceBuild = hasFlag("--force") || process.env.AIWORK_SIDECAR_FORCE_BUILD === "1";
const sidecarOverride = process.env.AIWORK_SIDECAR_DIR?.trim() || readArg("--outdir");
const sidecarDir = sidecarOverride ? resolve(sidecarOverride) : join(__dirname, "..", "src-tauri", "sidecars");

const chromeDevtoolsMcpVersion =
  process.env.CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  process.env.AIWORK_CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  "0.17.0";

// ─── Target triple resolution ─────────────────────────────────────────────────

const resolvedTargetTriple = (() => {
  const envTarget =
    process.env.TAURI_ENV_TARGET_TRIPLE ??
    process.env.CARGO_CFG_TARGET_TRIPLE ??
    process.env.TARGET;
  if (envTarget) return envTarget;
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
})();

const isWindowsTarget = process.platform === "win32" || resolvedTargetTriple?.includes("windows") === true;

/** Bun compile target string derived from the resolved Rust target triple. */
const bunTarget = (() => {
  switch (resolvedTargetTriple) {
    case "aarch64-apple-darwin":
      return "bun-darwin-arm64";
    case "x86_64-apple-darwin":
      return "bun-darwin-x64-baseline";
    case "aarch64-unknown-linux-gnu":
      return "bun-linux-arm64";
    case "x86_64-unknown-linux-gnu":
      return "bun-linux-x64-baseline";
    // Windows baseline artifacts intermittently fail to extract in CI
    // with Bun 1.3.6. Use the stable x64 target here for now.
    case "x86_64-pc-windows-msvc":
      return "bun-windows-x64";
    case "aarch64-pc-windows-msvc":
      return "bun-windows-arm64";
    default:
      return null;
  }
})();

// ─── Low-level file utilities ─────────────────────────────────────────────────

const readHeader = (filePath, length = 256) => {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

const isStubBinary = (filePath) => {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return true;
    if (stat.size < 1024) return true;
    const header = readHeader(filePath);
    if (header.startsWith("#!")) return true;
    if (header.includes("Sidecar missing") || header.includes("Bun is required")) return true;
  } catch {
    return true;
  }
  return false;
};

const readDirectory = (dir) => {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) return readDirectory(next);
    if (entry.isFile()) return [next];
    return [];
  });
};

const readBinaryVersion = (filePath) => {
  try {
    const result = spawnSync(filePath, ["--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  } catch {
    // ignore
  }
  return null;
};

const sha256File = (filePath) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
};

const readPackageVersion = (packageDir) => {
  try {
    const raw = readFileSync(resolve(packageDir, "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "").trim() || null;
  } catch {
    return null;
  }
};

const resolveBuildScript = (dir) => {
  const scriptPath = resolve(dir, "script", "build.ts");
  if (existsSync(scriptPath)) return scriptPath;
  const scriptsPath = resolve(dir, "scripts", "build.ts");
  if (existsSync(scriptsPath)) return scriptsPath;
  return scriptPath; // return first candidate even if missing (caller will handle)
};

// ─── macOS ad-hoc signing ─────────────────────────────────────────────────────

const adHocSignDarwin = (filePath) => {
  if (process.platform !== "darwin" || !filePath || !existsSync(filePath)) return;
  const remove = spawnSync("codesign", ["--remove-signature", filePath], { encoding: "utf8" });
  if (remove.error && remove.error.code === "ENOENT") {
    throw new Error("codesign is required to prepare runnable macOS sidecars");
  }
  const sign = spawnSync("codesign", ["--force", "--sign", "-", filePath], { encoding: "utf8" });
  if (sign.error) {
    if (sign.error.code === "ENOENT") {
      throw new Error("codesign is required to prepare runnable macOS sidecars");
    }
    throw sign.error;
  }
  if (sign.status !== 0) {
    const stderr = sign.stderr?.trim();
    throw new Error(`Failed to codesign ${filePath}${stderr ? `: ${stderr}` : ""}`);
  }
};

const adHocSignDarwinSidecars = (paths) => {
  if (process.platform !== "darwin") return;
  for (const filePath of [...new Set(paths.filter(Boolean))]) {
    adHocSignDarwin(filePath);
  }
};

// ─── Sidecar path helpers ─────────────────────────────────────────────────────

/**
 * Compute all relevant paths for a sidecar binary that is compiled with Bun.
 *
 * @param {string} baseName - Binary base name without extension (e.g. "aiwork-server").
 * @returns {{ canonicalPath, buildPath, targetPath, targetName }}
 */
const bunSidecarPaths = (baseName) => {
  const ext = isWindowsTarget ? ".exe" : "";
  const canonicalPath = join(sidecarDir, `${baseName}${ext}`);

  const buildName = bunTarget
    ? `${baseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
    : `${baseName}${ext}`;
  const buildPath = join(sidecarDir, buildName);

  const targetName = resolvedTargetTriple
    ? `${baseName}-${resolvedTargetTriple}${resolvedTargetTriple.includes("windows") ? ".exe" : ""}`
    : null;
  const targetPath = targetName ? join(sidecarDir, targetName) : null;

  return { canonicalPath, buildPath, targetName, targetPath };
};

/**
 * Compute all relevant paths for a sidecar binary distributed as a native
 * Rust/Go binary (identified by target triple, not Bun target).
 *
 * @param {string} baseName - Binary base name without extension.
 * @returns {{ canonicalPath, candidatePath, targetName, targetPath }}
 */
const nativeSidecarPaths = (baseName) => {
  const ext = isWindowsTarget ? ".exe" : "";
  const canonicalPath = join(sidecarDir, `${baseName}${ext}`);

  const targetName = resolvedTargetTriple
    ? `${baseName}-${resolvedTargetTriple}${isWindowsTarget ? ".exe" : ""}`
    : null;
  const targetPath = targetName ? join(sidecarDir, targetName) : null;

  // Prefer the target-triple-suffixed path when available
  const candidatePath = targetPath ?? canonicalPath;

  return { canonicalPath, candidatePath, targetName, targetPath };
};

// ─── Generic Bun-compiled sidecar builder ─────────────────────────────────────

/**
 * Build (if needed) and install a Bun-compiled sidecar into `sidecarDir`.
 *
 * @param {object} opts
 * @param {string}   opts.label          - Human-readable name for log messages.
 * @param {string}   opts.baseName       - Binary base name (e.g. "aiwork-server").
 * @param {string}   opts.sourceDir      - Root of the source package (where package.json lives).
 * @param {string[]} [opts.extraBuildArgs] - Additional args passed to the build script.
 * @param {(distDir: string) => string|null} [opts.findBuiltBinary]
 *   - Optional callback to locate the compiled binary inside the dist dir.
 *     Defaults to looking for `<baseName>` or `<baseName>.exe`.
 *   - When `null` the caller expects the build script to write directly into
 *     `sidecarDir` (aiwork-server style) and no copy step is performed.
 * @returns {{ version: string|null, paths: ReturnType<typeof bunSidecarPaths>, didBuild: boolean }}
 */
const buildBunSidecar = (opts) => {
  const { label, baseName, sourceDir, extraBuildArgs = [], findBuiltBinary = undefined } = opts;
  const paths = bunSidecarPaths(baseName);
  const { canonicalPath, buildPath, targetPath } = paths;

  // Detect currently installed version
  let existingVersion =
    existsSync(canonicalPath) && !isStubBinary(canonicalPath) ? readBinaryVersion(canonicalPath) : null;

  const desiredVersion = readPackageVersion(sourceDir);

  const shouldRebuildForVersion = Boolean(
    desiredVersion && existingVersion && existingVersion !== desiredVersion,
  );
  const shouldBuild =
    forceBuild ||
    shouldRebuildForVersion ||
    !existsSync(buildPath) ||
    isStubBinary(buildPath);

  if (!shouldBuild) {
    console.log(`${label} sidecar already present (${existingVersion}).`);
    return { version: desiredVersion ?? existingVersion, paths, didBuild: false };
  }

  mkdirSync(sidecarDir, { recursive: true });

  // Remove stale build artefact
  if (existsSync(buildPath)) {
    try { unlinkSync(buildPath); } catch { /* ignore */ }
  }

  const buildScript = resolveBuildScript(sourceDir);
  if (!existsSync(buildScript)) {
    console.error(`${label} build script not found at ${buildScript}`);
    process.exit(1);
  }

  const buildArgs = [buildScript, "--outdir", sidecarDir, "--filename", baseName];
  if (bunTarget) buildArgs.push("--target", bunTarget);
  buildArgs.push(...extraBuildArgs);

  console.log(`Building ${label} from ${sourceDir}...`);
  const result = spawnSync("bun", buildArgs, { cwd: sourceDir, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);

  // Optional: copy from a dist sub-directory into sidecarDir
  if (typeof findBuiltBinary === "function") {
    const distDir = resolve(sourceDir, "dist");
    const builtBinary = findBuiltBinary(distDir);
    if (!builtBinary) {
      console.error(`${label} binary not found in ${distDir} after build.`);
      process.exit(1);
    }
    for (const dest of [targetPath, canonicalPath].filter(Boolean)) {
      try { if (existsSync(dest)) unlinkSync(dest); } catch { /* ignore */ }
      copyFileSync(builtBinary, dest);
      try { chmodSync(dest, 0o755); } catch { /* ignore */ }
    }
  } else {
    // Build script writes directly to sidecarDir; just ensure canonical copy exists
    if (existsSync(buildPath)) {
      if (buildPath !== canonicalPath) {
        try { if (existsSync(canonicalPath)) unlinkSync(canonicalPath); } catch { /* ignore */ }
        copyFileSync(buildPath, canonicalPath);
      }
      if (targetPath && buildPath !== targetPath) {
        try { if (existsSync(targetPath)) unlinkSync(targetPath); } catch { /* ignore */ }
        copyFileSync(buildPath, targetPath);
      }
    }
  }

  console.log(`${label} sidecar built and installed (${desiredVersion}).`);
  return { version: desiredVersion, paths, didBuild: true };
};

// ─── Generic native sidecar builder (non-Bun) ────────────────────────────────

/**
 * Build (if needed) a native sidecar (compiled via its own build script, not
 * Bun's bundler). Used for engine which ships its own build.ts.
 *
 * @param {object} opts
 * @param {string}   opts.label
 * @param {string}   opts.baseName
 * @param {string}   opts.packageDir     - Directory containing package.json and the build script.
 * @param {string}   [opts.workspaceDir] - Workspace root for `bun install` (defaults to packageDir).
 * @param {string[]} [opts.buildArgs]    - Args passed to the build script.
 * @param {(distDir: string) => string|null} opts.findBuiltBinary
 * @returns {{ version: string|null, paths: ReturnType<typeof nativeSidecarPaths>, didBuild: boolean }}
 */
const buildNativeSidecar = (opts) => {
  const {
    label,
    baseName,
    packageDir,
    workspaceDir = packageDir,
    buildArgs: customBuildArgs = [],
    findBuiltBinary,
  } = opts;

  const paths = nativeSidecarPaths(baseName);
  const { candidatePath, canonicalPath, targetPath } = paths;

  if (!existsSync(packageDir)) {
    console.error(
      `${label} source directory not found at ${packageDir}. ` +
        `Please ensure the source is present before building.`,
    );
    process.exit(1);
  }

  let existingVersion =
    existsSync(candidatePath) && !isStubBinary(candidatePath)
      ? readBinaryVersion(candidatePath)
      : null;

  const desiredVersion = readPackageVersion(packageDir);

  const shouldRebuildForVersion = Boolean(
    desiredVersion && existingVersion && existingVersion !== desiredVersion,
  );
  const shouldBuild =
    forceBuild ||
    shouldRebuildForVersion ||
    !candidatePath ||
    !existsSync(candidatePath) ||
    isStubBinary(candidatePath) ||
    !existingVersion;

  if (!shouldBuild) {
    console.log(`${label} sidecar already present (${existingVersion}).`);
    return { version: desiredVersion ?? existingVersion, paths, didBuild: false };
  }

  mkdirSync(sidecarDir, { recursive: true });

  // Ensure workspace dependencies are installed
  const nodeModules = resolve(workspaceDir, "node_modules");
  if (!existsSync(nodeModules)) {
    console.log(`Installing ${label} dependencies at ${workspaceDir}...`);
    const installResult = spawnSync("bun", ["install"], {
      cwd: workspaceDir,
      stdio: "inherit",
      shell: true,
    });
    if (installResult.status !== 0) process.exit(installResult.status ?? 1);
  }

  const buildScript = resolveBuildScript(packageDir);
  if (!existsSync(buildScript)) {
    console.error(`${label} build script not found at ${buildScript}`);
    process.exit(1);
  }

  console.log(`Building ${label} from local source at ${packageDir}...`);
  const result = spawnSync("bun", [buildScript, ...customBuildArgs], {
    cwd: packageDir,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);

  // Locate the compiled binary and copy to sidecarDir
  const distDir = resolve(packageDir, "dist");
  const builtBinary = findBuiltBinary(distDir);
  if (!builtBinary) {
    console.error(`${label} binary not found in ${distDir} after build.`);
    process.exit(1);
  }

  for (const dest of [targetPath, canonicalPath].filter(Boolean)) {
    try { if (existsSync(dest)) unlinkSync(dest); } catch { /* ignore */ }
    copyFileSync(builtBinary, dest);
    try { chmodSync(dest, 0o755); } catch { /* ignore */ }
  }

  console.log(`${label} sidecar built and installed (${desiredVersion}).`);
  return { version: desiredVersion, paths, didBuild: true };
};

// ─── Find binary helpers ──────────────────────────────────────────────────────

const makeFindBinary = (baseName) => (dir) => {
  const candidates = readDirectory(dir);
  const ext = isWindowsTarget ? ".exe" : "";
  return (
    candidates.find((f) => f.endsWith(`/${baseName}${ext}`) || f.endsWith(`\\${baseName}${ext}`)) ??
    candidates.find((f) => f.endsWith(`/${baseName}`) || f.endsWith(`\\${baseName}`)) ??
    null
  );
};

// ─── Source directories ───────────────────────────────────────────────────────

const aiworkServerDir = resolve(__dirname, "..", "..", "server");
const engineSourceDir = resolve(__dirname, "..", "..", "..", "engine");
const enginePackageDir = resolve(engineSourceDir, "packages", "engine");

// chrome-devtools-mcp: bundled as a node_modules dependency — no sidecar build.
const chromeDevtoolsBaseName = "chrome-devtools-mcp";
const chromeDevtoolsName = isWindowsTarget ? `${chromeDevtoolsBaseName}.exe` : chromeDevtoolsBaseName;
const chromeDevtoolsPath = join(sidecarDir, chromeDevtoolsName);

// ─── Build sidecars ───────────────────────────────────────────────────────────

const aiworkServerResult = buildBunSidecar({
  label: "AiWork Server",
  baseName: "aiwork-server",
  sourceDir: aiworkServerDir,
});

const engineResult = buildNativeSidecar({
  label: "Engine",
  baseName: "engine",
  packageDir: enginePackageDir,
  workspaceDir: engineSourceDir,
  // --single: build only for the current platform
  // --skip-install: skip the extra parcel/watcher install inside build.ts
  buildArgs: ["--single", "--skip-install"],
  findBuiltBinary: makeFindBinary("engine"),
});

// ─── macOS ad-hoc signing ─────────────────────────────────────────────────────

const { canonicalPath: aiworkServerCanonicalPath, buildPath: aiworkServerBuildPath, targetPath: aiworkServerTargetPath } =
  aiworkServerResult.paths;
const { canonicalPath: engineCanonicalPath, targetPath: engineTargetPath, candidatePath: engineCandidatePath } =
  engineResult.paths;

adHocSignDarwinSidecars([
  engineCanonicalPath,
  engineTargetPath,
  aiworkServerBuildPath,
  aiworkServerCanonicalPath,
  aiworkServerTargetPath,
]);

// ─── Write versions.json ──────────────────────────────────────────────────────

const versions = {
  engine: {
    version: engineResult.version,
    sha256:
      engineCandidatePath && existsSync(engineCandidatePath)
        ? sha256File(engineCandidatePath)
        : null,
  },
  "aiwork-server": {
    version: aiworkServerResult.version,
    sha256: existsSync(aiworkServerCanonicalPath) ? sha256File(aiworkServerCanonicalPath) : null,
  },
  "chrome-devtools-mcp": {
    version: chromeDevtoolsMcpVersion,
    // No longer a sidecar binary — bundled as a node_modules dependency.
    sha256: "bundled",
  },
};

const missing = Object.entries(versions)
  .filter(([, info]) => !info.version || !info.sha256)
  .map(([name]) => name);

if (missing.length) {
  console.error(`Sidecar version metadata incomplete for: ${missing.join(", ")}`);
  process.exit(1);
}

const versionsPath = join(sidecarDir, "versions.json");
try {
  mkdirSync(sidecarDir, { recursive: true });
  const content = JSON.stringify(versions, null, 2) + "\n";
  writeFileSync(versionsPath, content, "utf8");
  if (resolvedTargetTriple) {
    const targetVersionsPath = join(
      sidecarDir,
      `versions.json-${resolvedTargetTriple}${isWindowsTarget ? ".exe" : ""}`,
    );
    writeFileSync(targetVersionsPath, content, "utf8");
  }
} catch (error) {
  console.error(`Failed to write versions.json: ${error}`);
  process.exit(1);
}
