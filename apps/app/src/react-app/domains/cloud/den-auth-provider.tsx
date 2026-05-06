/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type { DenUser } from "../../../app/lib/den";

export type DenAuthStatus = "checking" | "signed_in" | "signed_out";

export type DenAuthStore = {
  status: DenAuthStatus;
  user: DenUser | null;
  error: string | null;
  isSignedIn: boolean;
  refresh: () => Promise<void>;
};

const DenAuthContext = createContext<DenAuthStore | undefined>(undefined);

type DenAuthProviderProps = {
  children: ReactNode;
};

/**
 * OpenWork Cloud / Den authentication is disabled in this build (always signed out).
 */
export function DenAuthProvider({ children }: DenAuthProviderProps) {
  const value = useMemo<DenAuthStore>(
    () => ({
      status: "signed_out",
      user: null,
      error: null,
      isSignedIn: false,
      refresh: async () => {},
    }),
    [],
  );

  return (
    <DenAuthContext.Provider value={value}>{children}</DenAuthContext.Provider>
  );
}

export function useDenAuth(): DenAuthStore {
  const context = useContext(DenAuthContext);
  if (!context) {
    throw new Error("useDenAuth must be used within a DenAuthProvider");
  }
  return context;
}
