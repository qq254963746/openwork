/** @jsxImportSource react */
import * as React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { initializeAiWorkBootstrapConfig } from "./app/lib/aiwork-bootstrap";
import { getAiWorkDeployment } from "./app/lib/aiwork-deployment";
import { bootstrapTheme } from "./app/theme";
import { initLocale } from "./i18n";
import { getReactQueryClient } from "./react-app/infra/query-client";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "./react-app/kernel/platform";
import { AppProviders } from "./react-app/shell/providers";
import { AppRoot } from "./react-app/shell/app-root";
import { installDesktopLogViewerHostBridge } from "./react-app/shell/desktop-log-viewer-host-bridge";
import { installDesktopShellEventsBridgeListeners } from "./react-app/shell/desktop-shell-events-bridge";
import { applyLogViewerPopupNavigationFromStorage } from "./react-app/shell/open-app-log-window";
import { startDeepLinkBridge } from "./react-app/shell/startup-deep-links";
import "./app/index.css";

bootstrapTheme();
initLocale();
startDeepLinkBridge();
await initializeAiWorkBootstrapConfig();

applyLogViewerPopupNavigationFromStorage();
installDesktopLogViewerHostBridge();
await installDesktopShellEventsBridgeListeners();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

root.dataset.aiworkDeployment = getAiWorkDeployment();

const platform = createDefaultPlatform();
const queryClient = getReactQueryClient();
const Router =  HashRouter;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PlatformProvider value={platform}>
          <AppProviders>
            <Router>
              <AppRoot />
            </Router>
          </AppProviders>
        </PlatformProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
