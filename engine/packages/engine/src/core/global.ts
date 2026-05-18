import path from "path"
import fs from "fs/promises"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"

const app = "engine"

let _baseDir: string | undefined
let _dirsEnsured = false

function resolveBaseDir(): string {
  if (_baseDir) return _baseDir
  const dir = (process.env.AIWORK_APP_LOCAL_DATA_DIR ?? "").trim()
  if (!dir) {
    throw new Error(
      "AIWORK_APP_LOCAL_DATA_DIR is required. Engine must be started via AiWork Desktop or with this env var set.",
    )
  }
  _baseDir = dir
  return dir
}

const paths = {
  get home() {
    return os.homedir()
  },
  get data() {
    return path.join(resolveBaseDir(), app, "data")
  },
  get cache() {
    return path.join(resolveBaseDir(), app, "cache")
  },
  get config() {
    return path.join(resolveBaseDir(), app, "config")
  },
  get state() {
    return path.join(resolveBaseDir(), app, "state")
  },
  get tmp() {
    return path.join(resolveBaseDir(), app, "tmp")
  },
  get bin() {
    return path.join(this.cache, "bin")
  },
  get log() {
    return path.join(this.data, "log")
  },
  /** Ensure all required directories exist. Must be called before using paths. */
  async ensure() {
    if (_dirsEnsured) return
    _dirsEnsured = true
    await Promise.all([
      fs.mkdir(paths.data, { recursive: true }),
      fs.mkdir(paths.config, { recursive: true }),
      fs.mkdir(paths.state, { recursive: true }),
      fs.mkdir(paths.tmp, { recursive: true }),
      fs.mkdir(paths.log, { recursive: true }),
      fs.mkdir(paths.bin, { recursive: true }),
    ])
  },
}

export const Path = paths

Flock.setGlobal({ get state() { return paths.state } })

export class Service extends Context.Service<Service, Interface>()("@engine/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.ENGINE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    ...input,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"