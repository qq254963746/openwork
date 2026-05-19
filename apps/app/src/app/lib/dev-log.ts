export type DevLogLevel = "debug" | "warn" | "perf";

export type DevLogRecord = {
  id: number;
  at: string;
  ts: number;
  level: DevLogLevel;
  source: string;
  label: string;
  payload?: unknown;
};

type DevRoot = typeof globalThis & {
  __aiworkDevLogSeq?: number;
  __aiworkDevLogs?: DevLogRecord[];
};

const DEV_LOG_LIMIT = 1500;

export const recordDevLog = (
  enabled: boolean,
  input: {
    level: DevLogLevel;
    source: string;
    label: string;
    payload?: unknown;
  },
) => {
  if (!enabled) return;

  const root = globalThis as DevRoot;
  const id = (root.__aiworkDevLogSeq ?? 0) + 1;
  root.__aiworkDevLogSeq = id;

  const entry: DevLogRecord = {
    id,
    at: new Date().toISOString(),
    ts: Date.now(),
    level: input.level,
    source: input.source,
    label: input.label,
    payload: input.payload,
  };

  const logs = root.__aiworkDevLogs ?? [];
  logs.push(entry);
  if (logs.length > DEV_LOG_LIMIT) {
    logs.splice(0, logs.length - DEV_LOG_LIMIT);
  }
  root.__aiworkDevLogs = logs;
};

export const readDevLogs = (limit = 200) => {
  const root = globalThis as DevRoot;
  const logs = root.__aiworkDevLogs ?? [];
  if (limit === 0) return logs.slice();
  if (limit < 0) return [];
  if (logs.length <= limit) return logs.slice();
  return logs.slice(logs.length - limit);
};
