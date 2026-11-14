"use client";
import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";
import { createConnectionsPreviewApi } from "./connections-preview-api";
import { usePeoplePreview } from "./PeoplePreviewState";

const Context = createContext<ReturnType<typeof createConnectionsPreviewApi> | null>(null);
export function ConnectionsPreviewProvider({ children }: { children: ReactNode }) {
  const people = usePeoplePreview();
  const [api] = useState(() => createConnectionsPreviewApi(people));
  return <Context.Provider value={api}>{children}</Context.Provider>;
}
export function useConnectionsPreview() {
  const api = useContext(Context);
  if (!api) throw new Error("Connections fixtures require isolated preview layout.");
  useSyncExternalStore(api.subscribe, api.snapshotVersion, api.snapshotVersion);
  return api;
}
