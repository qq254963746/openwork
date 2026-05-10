#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import os from "os"
import { createRequire } from "module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const rootDir = dirname(fileURLToPath(import.meta.url))

function detect() {
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  }
  const archMap = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  }

  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()
  return { platform, arch }
}

function packageName() {
  const { platform, arch } = detect()
  return `aiwork-orchestrator-${platform}-${arch}`
}

function binaryName() {
  const { platform } = detect()
  return platform === "windows" ? "aiwork.exe" : "aiwork"
}

function fallbackBinaryPath() {
  return join(rootDir, "dist", "bin", binaryName())
}

async function main() {
  try {
    const pkg = packageName()
    require.resolve(`${pkg}/package.json`)
    console.log(`aiwork-orchestrator: verified platform package: ${pkg}`)
    return
  } catch {
    if (existsSync(fallbackBinaryPath())) {
      console.log(`aiwork-orchestrator: using existing fallback binary at ${fallbackBinaryPath()}`)
      return
    }
  }
}

await main()
