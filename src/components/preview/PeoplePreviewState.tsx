"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createPeoplePreviewApi } from "./people-preview-api";

const Context = createContext<ReturnType<typeof createPeoplePreviewApi> | null>(null);
export function PeoplePreviewProvider({ children }: { children: ReactNode }) {
  const [api] = useState(() => createPeoplePreviewApi());
  useEffect(() => () => api.dispose(), [api]);
  return <Context.Provider value={api}>{children}</Context.Provider>;
}
export function usePeoplePreview() {
  const api = useContext(Context);
  if (!api) throw new Error("Personal profile fixtures require the isolated preview layout.");
  useSyncExternalStore(api.subscribe, api.snapshotVersion, api.snapshotVersion);
  return api;
}
