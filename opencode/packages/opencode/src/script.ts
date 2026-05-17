import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]
import pkg from "../package.json"

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  AIWORK_ENGINE_CHANNEL: process.env["AIWORK_ENGINE_CHANNEL"],
  AIWORK_ENGINE_BUMP: process.env["AIWORK_ENGINE_BUMP"],
  AIWORK_ENGINE_VERSION: process.env["AIWORK_ENGINE_VERSION"],
  AIWORK_ENGINE_RELEASE: process.env["AIWORK_ENGINE_RELEASE"],
}

const CHANNEL = "latest"
const IS_PREVIEW = CHANNEL !== "latest"

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return pkg.version
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.AIWORK_ENGINE_RELEASE
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))