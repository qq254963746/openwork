/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import {
  checkDesktopAppRestriction,
  type DesktopAppRestrictionChecker,
} from "../../../app/cloud/desktop-app-restrictions";
import type { DenDesktopConfig } from "../../../app/lib/den";

export type DesktopConfigStore = {
  config: DenDesktopConfig;
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * Stable checker function that matches the `DesktopAppRestrictionChecker`
   * shape Solid passes to its stores. Useful when wiring restriction gates
   * from non-hook code paths.
   */
  checkRestriction: DesktopAppRestrictionChecker;
};

const DesktopConfigContext = createContext<DesktopConfigStore | undefined>(
  undefined,
);

const DEFAULT_DESKTOP_CONFIG: DenDesktopConfig = {};

type DesktopConfigProviderProps = {
  children: ReactNode;
};

/**
 * Org-scoped desktop restrictions from Den are disabled in this build: no cloud
 * session, so config stays empty and gates see defaults until/unless wired again.
 */
export function DesktopConfigProvider({ children }: DesktopConfigProviderProps) {
  const value = useMemo<DesktopConfigStore>(() => {
    const checkRestriction: DesktopAppRestrictionChecker = ({ restriction }) =>
      checkDesktopAppRestriction({ config: DEFAULT_DESKTOP_CONFIG, restriction });
    return {
      config: DEFAULT_DESKTOP_CONFIG,
      loading: false,
      refresh: async () => {},
      checkRestriction,
    };
  }, []);

  return (
    <DesktopConfigContext.Provider value={value}>
      {children}
    </DesktopConfigContext.Provider>
  );
}

export function useDesktopConfig(): DesktopConfigStore {
  const context = useContext(DesktopConfigContext);
  if (!context) {
    throw new Error("useDesktopConfig must be used within a DesktopConfigProvider");
  }
  return context;
}

/**
 * Convenience hook that returns the raw `DesktopAppRestrictions` flags
 * (e.g. `{ blockZenModel: true }`). Callers usually just want the flags,
 * not the loading state — feature gates should read through this.
 */
export function useOrgRestrictions(): DenDesktopConfig {
  return useDesktopConfig().config;
}

/**
 * Hook variant that returns the stable `checkRestriction` function so
 * feature sites that already receive a "checker" (e.g. helpers ported
 * from Solid stores) can call it directly without reshaping.
 */
export function useCheckDesktopRestriction(): DesktopAppRestrictionChecker {
  return useDesktopConfig().checkRestriction;
}

/**
 * Single-restriction hook — returns true/false for a specific key.
 * Use this at feature sites that only care about one flag
 * (e.g. `useDesktopRestriction("blockMultipleWorkspaces")`).
 */
export function useDesktopRestriction(
  restriction: Parameters<DesktopAppRestrictionChecker>[0]["restriction"],
): boolean {
  return useDesktopConfig().checkRestriction({ restriction });
}
