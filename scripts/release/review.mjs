import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const strict = args.includes("--strict");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");

const readCargoVersion = (path) => {
  const content = readText(path);
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
};

const appPkg = readJson(resolve(root, "apps", "app", "package.json"));
const desktopPkg = readJson(resolve(root, "apps", "desktop", "package.json"));
const serverPkg = readJson(resolve(root, "apps", "server", "package.json"));
const enginePkg = readJson(resolve(root, "engine", "packages", "engine", "package.json"));
const tauriConfig = readJson(
  resolve(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
);
const cargoVersion = readCargoVersion(
  resolve(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
);

const versions = {
  app: appPkg.version ?? null,
  desktop: desktopPkg.version ?? null,
  tauri: tauriConfig.version ?? null,
  cargo: cargoVersion ?? null,
  server: serverPkg.version ?? null,
  engine: enginePkg.version || null
};

const checks = [];
const warnings = [];
let ok = true;

const addCheck = (label, pass, details) => {
  checks.push({ label, ok: pass, details });
  if (!pass) ok = false;
};

const addWarning = (message) => warnings.push(message);

addCheck(
  "App/desktop versions match",
  versions.app && versions.desktop && versions.app === versions.desktop,
  `${versions.app ?? "?"} vs ${versions.desktop ?? "?"}`,
);
addCheck(
  "App/aiwork-server versions match",
  versions.app && versions.server && versions.app === versions.server,
  `${versions.app ?? "?"} vs ${versions.server ?? "?"}`,
);
addCheck(
  "Desktop/Tauri versions match",
  versions.desktop && versions.tauri && versions.desktop === versions.tauri,
  `${versions.desktop ?? "?"} vs ${versions.tauri ?? "?"}`,
);
addCheck(
  "Desktop/Cargo versions match",
  versions.desktop && versions.cargo && versions.desktop === versions.cargo,
  `${versions.desktop ?? "?"} vs ${versions.cargo ?? "?"}`,
);
addCheck(
  "AiWork version pin exists",
  Boolean(versions.engine),
  String(versions.engine),
);

if (!process.env.SOURCE_DATE_EPOCH) {
  addWarning(
    "SOURCE_DATE_EPOCH is not set (sidecar manifests will include current time).",
  );
}

const report = { ok, versions, checks, warnings };

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Release review");
  for (const check of checks) {
    const status = check.ok ? "ok" : "fail";
    console.log(`- ${status}: ${check.label} (${check.details})`);
  }
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

if (strict && !ok) {
  process.exit(1);
}
