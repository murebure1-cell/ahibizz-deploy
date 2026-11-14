"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { BookingPreviewProvider } from "./BookingPreviewState";
import { BusinessPreviewProvider } from "./BusinessPreviewState";
import { ConnectionsPreviewProvider } from "./ConnectionsPreviewState";
import { MessagingPreviewProvider } from "./MessagingPreviewState";
import { PeoplePreviewProvider } from "./PeoplePreviewState";

type PreviewState = {
  saved: ReadonlySet<string>;
  toggleSaved: (id: string) => void;
  place: string;
  setPlace: (place: string) => void;
};

const StateContext = createContext<PreviewState | null>(null);

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [place, setPlace] = useState("Tuzla");
  function toggleSaved(id: string) {
    setSaved((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <BookingPreviewProvider>
      <BusinessPreviewProvider>
        <PeoplePreviewProvider>
          <ConnectionsPreviewProvider>
            <MessagingPreviewProvider>
              <StateContext.Provider value={{ saved, toggleSaved, place, setPlace }}>
                {children}
              </StateContext.Provider>
            </MessagingPreviewProvider>
          </ConnectionsPreviewProvider>
        </PeoplePreviewProvider>
      </BusinessPreviewProvider>
    </BookingPreviewProvider>
  );
}

export function usePreviewState() {
  const state = useContext(StateContext);
  if (!state) throw new Error("Preview state requires its isolated layout.");
  return state;
}
