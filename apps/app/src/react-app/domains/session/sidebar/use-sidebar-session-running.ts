import type { UIMessage } from "ai";
import type { SessionStatus } from "@engine/sdk/v2/client";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceSessionGroup } from "../../../../app/types";
import { getReactQueryClient } from "../../../infra/query-client";
import { statusKey, transcriptKey } from "../sync/session-sync";

function statusIndicatesRunning(status: SessionStatus | undefined): boolean {
  if (!status) return false;
  return status.type === "busy" || status.type === "retry";
}

function transcriptHasStreamingAssistant(messages: UIMessage[] | undefined): boolean {
  if (!messages?.length) return false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        if (part.state === "streaming") return true;
      }
    }
  }
  return false;
}

/** Server/session status is authoritative; transcript parts can stay `streaming` briefly after `session.idle`. */
function isSessionRunning(status: SessionStatus | undefined, transcript: UIMessage[] | undefined): boolean {
  if (status?.type === "idle") return false;
  if (statusIndicatesRunning(status)) return true;
  return transcriptHasStreamingAssistant(transcript);
}

export function sidebarSessionRunningKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

/**
 * Subscribes to React Query session status + transcript caches so sidebar rows can
 * show a "model running" indicator without relying on {@link sessionStatusById}
 * (often empty at the route shell).
 */
export function useSidebarSessionsRunning(workspaceSessionGroups: WorkspaceSessionGroup[]) {
  const queryClient = getReactQueryClient();
  const [tick, setTick] = useState(0);

  const pairSet = useMemo(() => {
    const next = new Set<string>();
    for (const group of workspaceSessionGroups) {
      const workspaceId = group.workspace.id;
      for (const session of group.sessions) {
        next.add(sidebarSessionRunningKey(workspaceId, session.id));
      }
    }
    return next;
  }, [workspaceSessionGroups]);

  useEffect(() => {
    if (pairSet.size === 0) return;
    return queryClient.getQueryCache().subscribe((event) => {
      const q = event?.query;
      const key = q?.queryKey;
      if (!Array.isArray(key) || key.length < 3) return;
      const prefix = key[0];
      if (prefix !== "react-session-status" && prefix !== "react-session-transcript") return;
      const ws = String(key[1] ?? "");
      const sid = String(key[2] ?? "");
      if (!ws || !sid) return;
      if (pairSet.has(sidebarSessionRunningKey(ws, sid))) {
        setTick((n) => n + 1);
      }
    });
  }, [pairSet, queryClient]);

  return useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const group of workspaceSessionGroups) {
      const workspaceId = group.workspace.id;
      for (const session of group.sessions) {
        const composite = sidebarSessionRunningKey(workspaceId, session.id);
        const status = queryClient.getQueryData<SessionStatus>(statusKey(workspaceId, session.id));
        const transcript = queryClient.getQueryData<UIMessage[]>(transcriptKey(workspaceId, session.id));
        out[composite] = isSessionRunning(status, transcript);
      }
    }
    return out;
  }, [queryClient, workspaceSessionGroups, tick]);
}
