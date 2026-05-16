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
const constantsPath = resolve(__dirname, "..", "..", "..", "constants.json");

// opencodeVersion is kept as a fallback in case local source is unavailable
const opencodeVersion = (() => {
  try {
    const raw = readFileSync(constantsPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.opencodeVersion === "string" ? parsed.opencodeVersion.trim() || null : null;
  } catch {
    return null;
  }
})();

const normalizeVersion = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "latest") return null;
  return raw.startsWith("v") ? raw.slice(1) : raw;
};

const chromeDevtoolsMcpVersion =
  process.env.CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  process.env.AIWORK_CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  "0.17.0";

// Target triple for native platform binaries
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

const opencodeBaseName = isWindowsTarget ? "opencode.exe" : "opencode";
const opencodePath = join(sidecarDir, opencodeBaseName);
const opencodeTargetName = resolvedTargetTriple
  ? `opencode-${resolvedTargetTriple}${isWindowsTarget ? ".exe" : ""}`
  : null;
const opencodeTargetPath = opencodeTargetName ? join(sidecarDir, opencodeTargetName) : null;

const opencodeCandidatePath = opencodeTargetPath ?? opencodePath;
let existingOpencodeVersion = null;

// aiwork-server paths
const aiworkServerBaseName = "aiwork-server";
const aiworkServerName = isWindowsTarget ? `${aiworkServerBaseName}.exe` : aiworkServerBaseName;
const aiworkServerPath = join(sidecarDir, aiworkServerName);
const aiworkServerBuildName = bunTarget
  ? `${aiworkServerBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : aiworkServerName;
const aiworkServerBuildPath = join(sidecarDir, aiworkServerBuildName);
const aiworkServerTargetTriple = resolvedTargetTriple;
const aiworkServerTargetName = aiworkServerTargetTriple
  ? `${aiworkServerBaseName}-${aiworkServerTargetTriple}${aiworkServerTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const aiworkServerTargetPath = aiworkServerTargetName ? join(sidecarDir, aiworkServerTargetName) : null;

const aiworkServerDir = resolve(__dirname, "..", "..", "server");

// opencode local source directory (inside aiwork/opencode)
const opencodeSourceDir = resolve(__dirname, "..", "..", "..", "opencode");
const opencodePackageDir = resolve(opencodeSourceDir, "packages", "opencode");

const resolveBuildScript = (dir) => {
  const scriptPath = resolve(dir, "script", "build.ts");
  if (existsSync(scriptPath)) return scriptPath;
  const scriptsPath = resolve(dir, "scripts", "build.ts");
  if (existsSync(scriptsPath)) return scriptsPath;
  return scriptPath;
};

// chrome-devtools-mcp: now bundled as a node_modules dependency of
// @aiwork/desktop . The Bun-compiled shim
// sidecar is no longer built.  These variables are kept only so the
// versions.json metadata block below can record the pinned version without
// breaking the build.
const chromeDevtoolsBaseName = "chrome-devtools-mcp";
const chromeDevtoolsName = isWindowsTarget ? `${chromeDevtoolsBaseName}.exe` : chromeDevtoolsBaseName;
const chromeDevtoolsPath = join(sidecarDir, chromeDevtoolsName);

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
    if (entry.isDirectory()) {
      return readDirectory(next);
    }
    if (entry.isFile()) {
      return [next];
    }
    return [];
  });
};

const findOpencodeBinary = (dir) => {
  const candidates = readDirectory(dir);
  return (
    candidates.find((file) => file.endsWith(`/${opencodeBaseName}`) || file.endsWith(`\\${opencodeBaseName}`)) ??
    candidates.find((file) => file.endsWith("/opencode.exe") || file.endsWith("\\opencode.exe")) ??
    candidates.find((file) => file.endsWith("/opencode") || file.endsWith("\\opencode")) ??
    null
  );
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

const adHocSignDarwin = (filePath) => {
  if (process.platform !== "darwin" || !filePath || !existsSync(filePath)) return;
  const remove = spawnSync("codesign", ["--remove-signature", filePath], {
    encoding: "utf8",
  });
  if (remove.error && remove.error.code === "ENOENT") {
    throw new Error("codesign is required to prepare runnable macOS sidecars");
  }

  const sign = spawnSync("codesign", ["--force", "--sign", "-", filePath], {
    encoding: "utf8",
  });
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

const parseChecksum = (content, assetName) => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/);
    if (name === assetName) return hash.toLowerCase();
    if (trimmed.endsWith(` ${assetName}`)) {
      return trimmed.split(/\s+/)[0]?.toLowerCase() ?? null;
    }
  }
  return null;
};

let didBuildAiWorkServer = false;
let existingAiWorkServerVersion = null;
if (existsSync(aiworkServerPath) && !isStubBinary(aiworkServerPath)) {
  existingAiWorkServerVersion = readBinaryVersion(aiworkServerPath);
}

const desiredAiWorkServerVersion = (() => {
  try {
    const raw = readFileSync(resolve(aiworkServerDir, "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "").trim() || null;
  } catch {
    return null;
  }
})();

const shouldRebuildAiWorkServerForVersion = Boolean(
  desiredAiWorkServerVersion &&
    existingAiWorkServerVersion &&
    existingAiWorkServerVersion !== desiredAiWorkServerVersion,
);
const shouldBuildAiWorkServer =
  forceBuild ||
  shouldRebuildAiWorkServerForVersion ||
  !existsSync(aiworkServerBuildPath) ||
  isStubBinary(aiworkServerBuildPath);

if (shouldBuildAiWorkServer) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(aiworkServerBuildPath)) {
    try {
      unlinkSync(aiworkServerBuildPath);
    } catch {
      // ignore
    }
  }
  const aiworkServerScript = resolveBuildScript(aiworkServerDir);
  if (!existsSync(aiworkServerScript)) {
    console.error(`AiWork server build script not found at ${aiworkServerScript}`);
    process.exit(1);
  }
  const aiworkServerArgs = [aiworkServerScript, "--outdir", sidecarDir, "--filename", "aiwork-server"];
  if (bunTarget) {
    aiworkServerArgs.push("--target", bunTarget);
  }
  const buildResult = spawnSync("bun", aiworkServerArgs, {
    cwd: aiworkServerDir,
    stdio: "inherit",
    shell: true,
  });

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  didBuildAiWorkServer = true;
}

if (existsSync(aiworkServerBuildPath)) {
  const shouldCopyCanonical = didBuildAiWorkServer || !existsSync(aiworkServerPath) || isStubBinary(aiworkServerPath);
  if (shouldCopyCanonical && aiworkServerBuildPath !== aiworkServerPath) {
    try {
      if (existsSync(aiworkServerPath)) {
        unlinkSync(aiworkServerPath);
      }
    } catch {
      // ignore
    }
    copyFileSync(aiworkServerBuildPath, aiworkServerPath);
  }

  if (aiworkServerTargetPath) {
    const shouldCopyTarget =
      didBuildAiWorkServer || !existsSync(aiworkServerTargetPath) || isStubBinary(aiworkServerTargetPath);
    if (shouldCopyTarget && aiworkServerBuildPath !== aiworkServerTargetPath) {
      try {
        if (existsSync(aiworkServerTargetPath)) {
          unlinkSync(aiworkServerTargetPath);
        }
      } catch {
        // ignore
      }
      copyFileSync(aiworkServerBuildPath, aiworkServerTargetPath);
    }
  }
}

if (!existingOpencodeVersion && opencodeCandidatePath) {
  existingOpencodeVersion =
    existsSync(opencodeCandidatePath) && !isStubBinary(opencodeCandidatePath)
      ? readBinaryVersion(opencodeCandidatePath)
      : null;
}

// Read desired opencode version from local source package.json
const desiredOpencodeVersion = (() => {
  try {
    const raw = readFileSync(resolve(opencodePackageDir, "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "").trim() || null;
  } catch {
    return null;
  }
})();

const normalizedOpencodeVersion = desiredOpencodeVersion ?? normalizeVersion(opencodeVersion);

if (!normalizedOpencodeVersion) {
  console.error(
    `OpenCode version could not be resolved from local source or ${constantsPath}.`
  );
  process.exit(1);
}

if (!existsSync(opencodePackageDir)) {
  console.error(
    `OpenCode source directory not found at ${opencodePackageDir}. ` +
    `Expected aiwork/opencode/packages/opencode to exist.`
  );
  process.exit(1);
}

const shouldRebuildOpencodeForVersion = Boolean(
  desiredOpencodeVersion &&
    existingOpencodeVersion &&
    existingOpencodeVersion !== desiredOpencodeVersion,
);
const shouldBuildOpencode =
  forceBuild ||
  shouldRebuildOpencodeForVersion ||
  !opencodeCandidatePath ||
  !existsSync(opencodeCandidatePath) ||
  isStubBinary(opencodeCandidatePath) ||
  !existingOpencodeVersion;

if (!shouldBuildOpencode) {
  console.log(`OpenCode sidecar already present (${existingOpencodeVersion}).`);
}

if (shouldBuildOpencode) {
  mkdirSync(sidecarDir, { recursive: true });

  const opencodeBuildScript = resolve(opencodePackageDir, "script", "build.ts");
  if (!existsSync(opencodeBuildScript)) {
    console.error(`OpenCode build script not found at ${opencodeBuildScript}`);
    process.exit(1);
  }

  // Ensure opencode workspace dependencies are installed (node_modules may not exist
  // if the source was copied without node_modules).
  const opencodeNodeModules = resolve(opencodeSourceDir, "node_modules");
  if (!existsSync(opencodeNodeModules)) {
    console.log(`Installing OpenCode dependencies at ${opencodeSourceDir}...`);
    const installResult = spawnSync("bun", ["install"], {
      cwd: opencodeSourceDir,
      stdio: "inherit",
      shell: true,
    });
    if (installResult.status !== 0) {
      process.exit(installResult.status ?? 1);
    }
  }

  // opencode build.ts uses --single to build only for the current platform.
  // It outputs to packages/opencode/dist/{name}/bin/opencode
  // --skip-install skips the extra "bun install --os=* --cpu=* @parcel/watcher" step
  // inside build.ts (not the workspace install above).
  const opencodeBuildArgs = [opencodeBuildScript, "--single", "--skip-install"];
  console.log(`Building OpenCode from local source at ${opencodePackageDir}...`);
  const opencodeBuildResult = spawnSync("bun", opencodeBuildArgs, {
    cwd: opencodePackageDir,
    stdio: "inherit",
    shell: true,
  });

  if (opencodeBuildResult.status !== 0) {
    process.exit(opencodeBuildResult.status ?? 1);
  }

  // Find the built binary in packages/opencode/dist/
  const opencodeDistDir = resolve(opencodePackageDir, "dist");
  const builtBinary = findOpencodeBinary(opencodeDistDir);
  if (!builtBinary) {
    console.error(`OpenCode binary not found in ${opencodeDistDir} after build.`);
    process.exit(1);
  }

  const opencodeTargets = [opencodeTargetPath, opencodePath].filter(Boolean);
  for (const target of opencodeTargets) {
    try {
      if (existsSync(target)) {
        unlinkSync(target);
      }
    } catch {
      // ignore
    }
    copyFileSync(builtBinary, target);
    try {
      chmodSync(target, 0o755);
    } catch {
      // ignore
    }
  }

  console.log(`OpenCode sidecar built and installed (${normalizedOpencodeVersion}).`);
}


// chrome-devtools-mcp is now a node_modules dependency — no sidecar build needed.

adHocSignDarwinSidecars([
  opencodePath,
  opencodeTargetPath,
  aiworkServerBuildPath,
  aiworkServerPath,
  aiworkServerTargetPath
]);

const aiworkServerVersion = desiredAiWorkServerVersion;

const versions = {
  opencode: {
    version: normalizedOpencodeVersion,
    sha256: opencodeCandidatePath && existsSync(opencodeCandidatePath) ? sha256File(opencodeCandidatePath) : null,
  },
  "aiwork-server": {
    version: aiworkServerVersion,
    sha256: existsSync(aiworkServerPath) ? sha256File(aiworkServerPath) : null,
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
    const targetSuffix = isWindowsTarget ? ".exe" : "";
    const targetVersionsPath = join(sidecarDir, `versions.json-${resolvedTargetTriple}${targetSuffix}`);
    writeFileSync(targetVersionsPath, content, "utf8");
  }
} catch (error) {
  console.error(`Failed to write versions.json: ${error}`);
  process.exit(1);
}
