import type { Session as SDKSession } from "@engine/sdk/v2"
import { Session } from "@/session/session"
import { MessageV2 } from "../../session/message-v2"
import { effectCmd } from "../effect-cmd"
import { Database } from "@/storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { InstanceRef } from "@/effect/instance-ref"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { Effect, Schema } from "effect"

const decodeMessageInfo = Schema.decodeUnknownSync(MessageV2.Info)
const decodePart = Schema.decodeUnknownSync(MessageV2.Part)

type ExportData = { info: SDKSession; messages: Array<{ info: MessageV2.Info; parts: MessageV2.Part[] }> }

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx.project.id)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, projectID: string) {
  const exportData = yield* Effect.promise(() =>
    Filesystem.readJson<ExportData>(file).catch(() => undefined),
  )
  if (!exportData) {
    process.stdout.write(`File not found: ${file}`)
    process.stdout.write(EOL)
    return
  }

  const info = Schema.decodeUnknownSync(Session.Info)({
    ...exportData.info,
    projectID,
  }) as Session.Info
  const row = Session.toRow(info)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values(row)
      .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
      .run(),
  )

  for (const msg of exportData.messages) {
    const msgInfo = decodeMessageInfo(msg.info) as MessageV2.Info
    const { id, sessionID: _, ...msgData } = msgInfo
    Database.use((db) =>
      db
        .insert(MessageTable)
        .values({
          id,
          session_id: row.id,
          time_created: msgInfo.time?.created ?? Date.now(),
          data: msgData,
        })
        .onConflictDoNothing()
        .run(),
    )

    for (const part of msg.parts) {
      const partInfo = decodePart(part) as MessageV2.Part
      const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
      Database.use((db) =>
        db
          .insert(PartTable)
          .values({
            id: partId,
            message_id: messageID,
            session_id: row.id,
            data: partData,
          })
          .onConflictDoNothing()
          .run(),
      )
    }
  }

  process.stdout.write(`Imported session: ${exportData.info.id}`)
  process.stdout.write(EOL)
})
