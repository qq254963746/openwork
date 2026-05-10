/** @jsxImportSource react */
import { useEffect } from "react";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync } from "./session-sync";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  opencodeBaseUrl: string;
  aiworkToken: string;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
  useEffect(() => {
    return ensureWorkspaceSessionSync({
      workspaceId: props.workspaceId,
      baseUrl: props.opencodeBaseUrl,
      aiworkToken: props.aiworkToken,
    });
  }, [props.workspaceId, props.opencodeBaseUrl, props.aiworkToken]);

  useEffect(() => {
    return trackWorkspaceSessionSync(
      {
        workspaceId: props.workspaceId,
        baseUrl: props.opencodeBaseUrl,
        aiworkToken: props.aiworkToken,
      },
      props.sessionId,
    );
  }, [props.workspaceId, props.sessionId, props.opencodeBaseUrl, props.aiworkToken]);

  return null;
}
