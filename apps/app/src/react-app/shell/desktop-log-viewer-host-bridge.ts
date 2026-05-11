import type {
  EngineInfo,
  OpencodeEngineDiskLogsSnapshot,
  AiWorkServerInfo,
} from "../../app/lib/desktop-tauri";
import { engineInfo, aiworkServerInfo, readOpencodeEngineDiskLogs } from "../../app/lib/desktop";

export async function fetchEngineInfoForLogViewer(): Promise<EngineInfo> {
  return engineInfo();
}

export async function fetchOpencodeEngineDiskLogsForLogViewer(): Promise<OpencodeEngineDiskLogsSnapshot> {
  return readOpencodeEngineDiskLogs();
}

export async function fetchAiWorkServerInfoForLogViewer(): Promise<AiWorkServerInfo> {
  return aiworkServerInfo();
}
