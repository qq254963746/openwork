/** @jsxImportSource react */
import { useEffect } from "react";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync } from "./session-sync";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  engineBaseUrl: string;
  aiworkToken: string;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
  useEffect(() => {
    return ensureWorkspaceSessionSync({
      workspaceId: props.workspaceId,
      baseUrl: props.engineBaseUrl,
      aiworkToken: props.aiworkToken,
    });
  }, [props.workspaceId, props.engineBaseUrl, props.aiworkToken]);

  useEffect(() => {
    return trackWorkspaceSessionSync(
      {
        workspaceId: props.workspaceId,
        baseUrl: props.engineBaseUrl,
        aiworkToken: props.aiworkToken,
      },
      props.sessionId,
    );
  }, [props.workspaceId, props.sessionId, props.engineBaseUrl, props.aiworkToken]);

  return null;
}
