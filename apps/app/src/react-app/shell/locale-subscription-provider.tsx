/** @jsxImportSource react */
import { useSyncExternalStore, type ReactNode } from "react";

import { getLocaleSnapshot, subscribeLocale } from "../../i18n";

/** Subscribes subtree to `setLocale` via `useSyncExternalStore` so `t()` updates reliably. */
export function LocaleSubscriptionProvider(props: { children: ReactNode }) {
  useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);
  return props.children;
}
