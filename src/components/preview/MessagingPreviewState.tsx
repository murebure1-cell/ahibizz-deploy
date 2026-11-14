"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useBusinessPreview } from "./BusinessPreviewState";
import { useConnectionsPreview } from "./ConnectionsPreviewState";
import { previewBusinesses } from "./data";
import { createMessagingPreviewApi } from "./messaging-preview-api";
import { usePeoplePreview } from "./PeoplePreviewState";

type ContextValue = { api: ReturnType<typeof createMessagingPreviewApi>; ready: boolean };
const Context = createContext<ContextValue | null>(null);

export function MessagingPreviewProvider({ children }: { children: ReactNode }) {
  const people = usePeoplePreview(),
    connections = useConnectionsPreview(),
    businesses = useBusinessPreview();
  const [api] = useState(() =>
    createMessagingPreviewApi({
      self: () => {
        const person = people.getProfile();
        return { id: person.id, name: person.name };
      },
      person: (id) => {
        const fixture = previewBusinesses.find((item) => `preview-owner-${item.id}` === id);
        return fixture ? { id, name: `Tim ${fixture.name}` } : connections.personForMessaging(id);
      },
      business: (id) => {
        if (id === "preview-own-business")
          return {
            id,
            title: "Moja ogledna djelatnost",
            ownerId: people.getProfile().id,
            published: true,
          };
        const fixture = previewBusinesses.find((item) => item.id === id);
        if (fixture)
          return { id, title: fixture.name, ownerId: `preview-owner-${id}`, published: true };
        const draft = businesses.getDrafts().find((item) => item.id === id);
        return draft
          ? { id, title: draft.title, ownerId: people.getProfile().id, published: false }
          : null;
      },
    }),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() =>
        api.seedBusinessInquiry(
          "preview-own-business",
          "preview-designer",
          "Pozdrav! Ovo je probni upit za tvoju oglednu djelatnost.",
        ),
      )
      .then(() => {
        if (live) setReady(true);
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [api]);
  return <Context.Provider value={{ api, ready }}>{children}</Context.Provider>;
}

export function useMessagingPreview() {
  const value = useContext(Context);
  if (!value) throw new Error("Messaging fixtures require isolated preview context");
  useSyncExternalStore(value.api.subscribe, value.api.snapshotVersion, value.api.snapshotVersion);
  return value;
}
