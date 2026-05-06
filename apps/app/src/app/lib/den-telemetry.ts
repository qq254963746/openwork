/**
 * Hosted telemetry (formerly Den ingest) is disabled in this build — callers stay no-ops.
 */

export function trackTelemetryEvent(_type: string): void {}

export function trackSessionActive(): void {}

export function flushTelemetry(): void {}
