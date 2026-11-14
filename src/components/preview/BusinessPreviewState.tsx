"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { BusinessMediaRequestError } from "../../lib/business-media-client";
import type { BusinessFields } from "../directory/BusinessEditor";
import { createBusinessMediaPreviewApi } from "./business-media-preview-api";

export type BusinessPreviewDraft = BusinessFields & {
  id: string;
  archived: boolean;
  version: number;
};
export function createBusinessPreviewStore() {
  let drafts: BusinessPreviewDraft[] = [],
    revision = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const media = createBusinessMediaPreviewApi({
    readBusiness: (id) => {
      const draft = drafts.find((d) => d.id === id);
      return draft
        ? { id: draft.id, version: draft.version, status: draft.archived ? "archived" : "draft" }
        : null;
    },
    bumpBusiness: (id, expected) => {
      const draft = drafts.find((d) => d.id === id);
      if (!draft || draft.version !== expected)
        throw new BusinessMediaRequestError(409, "VERSION_CONFLICT");
      drafts = drafts.map((d) => (d.id === id ? { ...d, version: d.version + 1 } : d));
      changed();
      return { id, version: expected + 1, status: draft.archived ? "archived" : "draft" };
    },
  });
  const unsubscribe = media.subscribe(changed);
  return {
    media,
    getDrafts: () => structuredClone(drafts),
    setDrafts(update: (previous: BusinessPreviewDraft[]) => BusinessPreviewDraft[]) {
      drafts = update(structuredClone(drafts));
      changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshotVersion: () => revision,
    dispose() {
      unsubscribe();
      media.dispose();
      listeners.clear();
    },
  };
}
const Context = createContext<ReturnType<typeof createBusinessPreviewStore> | null>(null);
export function BusinessPreviewProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createBusinessPreviewStore());
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useBusinessPreview() {
  const store = useContext(Context);
  if (!store) throw new Error("Business fixtures require isolated preview context");
  useSyncExternalStore(store.subscribe, store.snapshotVersion, store.snapshotVersion);
  return store;
}
