/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";

import { isWebDeployment } from "../../app/lib/openwork-deployment";
import { hydrateOpenworkServerSettingsFromEnv } from "../../app/lib/openwork-server";
import { isDesktopRuntime } from "../../app/utils";
import { StatusToastsProvider } from "../domains/shell-feedback/status-toasts";
import { LocalProvider } from "../kernel/local-provider";
import { ServerProvider } from "../kernel/server-provider";
import { BootStateProvider } from "./boot-state";
import { DesktopRuntimeBoot } from "./desktop-runtime-boot";
import { startDebugLogger, stopDebugLogger } from "./debug-logger";
import { resolveOpenworkConnection } from "./openwork-connection";
import { ReloadCoordinatorProvider } from "./reload-coordinator";
import { LocaleSubscriptionProvider } from "./locale-subscription-provider";
import { ScrollbarOnScrollReveal } from "./scrollbar-on-scroll-reveal";

function resolveDefaultServerUrl(): string {
  if (isDesktopRuntime()) return "http://127.0.0.1:4096";

  const openworkUrl =
    typeof import.meta.env?.VITE_OPENWORK_URL === "string"
      ? import.meta.env.VITE_OPENWORK_URL.trim()
      : "";
  if (openworkUrl) {
    return `${openworkUrl.replace(/\/+$/, "")}/opencode`;
  }

  if (isWebDeployment() && import.meta.env.PROD && typeof window !== "undefined") {
    return `${window.location.origin}/opencode`;
  }

  const envUrl =
    typeof import.meta.env?.VITE_OPENCODE_URL === "string"
      ? import.meta.env.VITE_OPENCODE_URL.trim()
      : "";
  return envUrl || "http://127.0.0.1:4096";
}

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  hydrateOpenworkServerSettingsFromEnv();

  useEffect(() => {
    // Start the dev observability forwarder. Reads the current openwork-server
    // URL on every flush so reconnects after port changes still work. In prod
    // builds `startDebugLogger` is a no-op.
    startDebugLogger({
      serverUrl: async () => (await resolveOpenworkConnection()).normalizedBaseUrl,
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
