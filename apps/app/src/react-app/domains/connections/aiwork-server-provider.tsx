/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { AiWorkServerStore } from "./aiwork-server-store";

const AiWorkServerContext = createContext<AiWorkServerStore | null>(null);

export function AiWorkServerProvider(props: {
  store: AiWorkServerStore;
  children: ReactNode;
}) {
  return (
    <AiWorkServerContext.Provider value={props.store}>
      {props.children}
    </AiWorkServerContext.Provider>
  );
}

export function useAiWorkServer() {
  const store = useContext(AiWorkServerContext);
  if (!store) {
    throw new Error("useAiWorkServer must be used within an AiWorkServerProvider");
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
