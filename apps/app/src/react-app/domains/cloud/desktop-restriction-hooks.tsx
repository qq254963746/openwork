/** @jsxImportSource react */
import { useMemo } from "react";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";

/**
 * Hosted org restriction policy is disabled in this build — gates always see defaults.
 */
export function useCheckDesktopRestriction(): DesktopAppRestrictionChecker {
  return useMemo(
    () => () => false,
    [],
  );
}
