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
  ENGINE_BUMP: process.env["ENGINE_BUMP"],
  ENGINE_VERSION: process.env["ENGINE_VERSION"],
  ENGINE_RELEASE: process.env["ENGINE_RELEASE"],
}

export const Script = {
  get version() {
    return pkg.version
  },
  get release(): boolean {
    return !!env.ENGINE_RELEASE
  },
}
console.log(`engine script`, JSON.stringify(Script, null, 2))