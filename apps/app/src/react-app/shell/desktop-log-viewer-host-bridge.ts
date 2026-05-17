import type {
  EngineInfo,
  AiWorkEngineEngineDiskLogsSnapshot,
  AiWorkServerInfo,
} from "../../app/lib/desktop-tauri";
import { engineInfo, aiworkServerInfo, readAiWorkEngineEngineDiskLogs } from "../../app/lib/desktop";

export async function fetchEngineInfoForLogViewer(): Promise<EngineInfo> {
  return engineInfo();
}

export async function fetchAiWorkEngineEngineDiskLogsForLogViewer(): Promise<AiWorkEngineEngineDiskLogsSnapshot> {
  return readAiWorkEngineEngineDiskLogs();
}

export async function fetchAiWorkServerInfoForLogViewer(): Promise<AiWorkServerInfo> {
  return aiworkServerInfo();
}
