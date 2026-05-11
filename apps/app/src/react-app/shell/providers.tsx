/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";

import { hydrateAiWorkServerSettingsFromEnv } from "../../app/lib/aiwork-server";
import { StatusToastsProvider } from "../domains/shell-feedback/status-toasts";
import { LocalProvider } from "../kernel/local-provider";
import { ServerProvider } from "../kernel/server-provider";
import { BootStateProvider } from "./boot-state";
import { DesktopRuntimeBoot } from "./desktop-runtime-boot";
import { startDebugLogger, stopDebugLogger } from "./debug-logger";
import { resolveAiWorkConnection } from "./aiwork-connection";
import { ReloadCoordinatorProvider } from "./reload-coordinator";
import { LocaleSubscriptionProvider } from "./locale-subscription-provider";
import { ScrollbarOnScrollReveal } from "./scrollbar-on-scroll-reveal";

function resolveDefaultServerUrl(): string {
  return "http://127.0.0.1:4096";
}

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  hydrateAiWorkServerSettingsFromEnv();

  useEffect(() => {
    // Start the dev observability forwarder. Reads the current aiwork-server
    // URL on every flush so reconnects after port changes still work. In prod
    // builds `startDebugLogger` is a no-op.
    startDebugLogger({
      serverUrl: async () => (await resolveAiWorkConnection()).normalizedBaseUrl,
    });
    return () => {
      stopDebugLogger();
    };
  }, []);

  const defaultUrl = resolveDefaultServerUrl();
  return (
    <BootStateProvider>
      <ServerProvider defaultUrl={defaultUrl}>
        <DesktopRuntimeBoot />
          <LocalProvider>
            <StatusToastsProvider>
              <ReloadCoordinatorProvider>
                <LocaleSubscriptionProvider>
                  <ScrollbarOnScrollReveal />
                  {children}
                </LocaleSubscriptionProvider>
              </ReloadCoordinatorProvider>
            </StatusToastsProvider>
          </LocalProvider>
      </ServerProvider>
    </BootStateProvider>
  );
}
