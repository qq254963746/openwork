import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".aiwork", "logs");
const LOG_FILE = join(LOG_DIR, "aiwork-server.log");

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaPart = meta ? " " + JSON.stringify(meta) : "";
  return `[${ts}] [${level}] ${message}${metaPart}\n`;
}

async function ensureLogDir(): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
}

async function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): Promise<void> {
  const line = formatMessage(level, message, meta);
  try {
    await ensureLogDir();
    await appendFile(LOG_FILE, line, "utf8");
  } catch {
    // silently ignore log write failures
  }
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog("INFO", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog("WARN", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog("ERROR", message, meta);
  },
  debug(message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog("DEBUG", message, meta);
  },
};

export { LOG_FILE, LOG_DIR };
