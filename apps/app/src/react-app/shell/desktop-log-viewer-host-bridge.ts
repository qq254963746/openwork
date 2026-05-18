import type {
  EngineInfo,
  EngineEngineDiskLogsSnapshot,
  AiWorkServerInfo,
} from "../../app/lib/desktop-tauri";
import { engineInfo, aiworkServerInfo, readEngineEngineDiskLogs } from "../../app/lib/desktop";

export async function fetchEngineInfoForLogViewer(): Promise<EngineInfo> {
  return engineInfo();
}

export async function fetchEngineEngineDiskLogsForLogViewer(): Promise<EngineEngineDiskLogsSnapshot> {
  return readEngineEngineDiskLogs();
}

export async function fetchAiWorkServerInfoForLogViewer(): Promise<AiWorkServerInfo> {
  return aiworkServerInfo();
}
