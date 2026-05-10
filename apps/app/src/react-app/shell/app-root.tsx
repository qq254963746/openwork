/** @jsxImportSource react */

import { useSyncExternalStore } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { getLocaleSnapshot, subscribeLocale } from "../../i18n";
import { useDesktopFontZoomBehavior } from "./font-zoom";
import { LoadingOverlay } from "./loading-overlay";
import { DevProfiler, DevProfilerOverlay } from "./dev-profiler";
import { ReactRenderWatchdogOverlay } from "./react-render-watchdog-overlay";
import { AiWorkControlProvider, AiWorkRouteControlActions } from "./control/control-provider";
import { SessionRoute } from "./session-route";
import { SettingsRoute } from "./settings-route";
import { WelcomeRoute } from "./welcome-route";
import { AppLogWindowRoute } from "./app-log-window-route";

function AppRoutes() {
  const location = useLocation();
  const backgroundLocation = (location.state as { backgroundLocation?: typeof location } | null)?.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation ?? location}>
            <Route
              path="/welcome"
              element={
                <DevProfiler id="WelcomeRoute">
                  <WelcomeRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/devtools/app-log"
              element={
                <DevProfiler id="AppLogWindowRoute">
                  <AppLogWindowRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/session"
              element={
                <DevProfiler id="SessionRoute">
                  <SessionRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/session/:sessionId"
              element={
                <DevProfiler id="SessionRoute">
                  <SessionRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/workspace/:workspaceId/session"
              element={
                <DevProfiler id="SessionRoute">
                  <SessionRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/workspace/:workspaceId/session/:sessionId"
              element={
                <DevProfiler id="SessionRoute">
                  <SessionRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/workspace/:workspaceId/settings/*"
              element={
                <DevProfiler id="SettingsRoute">
                  <SettingsRoute />
                </DevProfiler>
              }
            />
            <Route
              path="/settings/*"
              element={
                <DevProfiler id="SettingsRoute">
                  <SettingsRoute />
                </DevProfiler>
              }
            />
            <Route path="/signin" element={<Navigate to="/session" replace />} />
            <Route path="/" element={<Navigate to="/session" replace />} />
            <Route path="*" element={<Navigate to="/session" replace />} />
          </Routes>
      {backgroundLocation ? (
        <Routes>
          <Route
            path="/workspace/:workspaceId/settings/*"
            element={
              <DevProfiler id="SettingsRouteOverlay">
                <SettingsRoute />
              </DevProfiler>
            }
          />
          <Route
            path="/settings/*"
            element={
              <DevProfiler id="SettingsRouteOverlay">
                <SettingsRoute />
              </DevProfiler>
            }
          />
        </Routes>
      ) : null}
    </>
  );
}

export function AppRoot() {
  useDesktopFontZoomBehavior();
  useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);

  return (
    <>
      <DevProfiler id="AppRoot">
        <AiWorkControlProvider>
          <AiWorkRouteControlActions />
          <AppRoutes />
        </AiWorkControlProvider>
        <LoadingOverlay />
      </DevProfiler>
      <DevProfilerOverlay />
      <ReactRenderWatchdogOverlay />
    </>
  );
}
