import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import { lazy } from "../util/lazy"
import { Global } from "@/core/global"
import * as Log from "@/core/util/log"
import { NamedError } from "@/core/util/name-error"
import z from "zod"
import path from "path"
import { Flag } from "@/core/flag/flag"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init } from "#db"
import { SCHEMA_DDL } from "./schema.ddl"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export const Path = iife(() => {
  if (Flag.ENGINE_DB) {
    if (Flag.ENGINE_DB === ":memory:" || path.isAbsolute(Flag.ENGINE_DB)) return Flag.ENGINE_DB
    return path.join(Global.Path.data, Flag.ENGINE_DB)
  }
  return path.join(Global.Path.data, "engine.db")
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = OFF")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply full DDL schema (CREATE TABLE IF NOT EXISTS) instead of incremental migrations.
  // SCHEMA_DDL is an array of SQL statements — no string splitting needed.
  log.info("applying DDL schema", { statements: SCHEMA_DDL.length })
  for (const stmt of SCHEMA_DDL) {
    try {
      db.run(stmt)
    } catch (err: any) {
      // Ignore "already exists" errors — DDL is fully idempotent
      if (!err?.message?.includes("already exists")) {
        log.error("DDL statement failed", { sql: stmt.slice(0, 120), err: String(err) })
        throw err
      }
    }
  }

  db.run("PRAGMA foreign_keys = ON")

  return db
})

export function close() {
  if (!Client.loaded()) return
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}

export * as Database from "./db"
