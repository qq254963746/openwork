import { BusEvent } from "@/bus/bus-event"
import { PositiveInt } from "@/util/schema"
import { Effect, Schema } from "effect"

const DEFAULT_TOAST_DURATION = 5000

/**
 * Generic notification events — not tied to any specific UI ( Web / Desktop).
 * Use these for cross-cutting user-facing notifications.
 */
export const Notification = {
  Show: BusEvent.define(
    "notification.show",
    Schema.Struct({
      title: Schema.optional(Schema.String),
      message: Schema.String,
      variant: Schema.Literals(["info", "success", "warning", "error"]),
      duration: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_TOAST_DURATION))).annotate({
        description: "Duration in milliseconds",
      }),
    }),
  ),
}