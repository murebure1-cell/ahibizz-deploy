"use client";

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";
import { createBookingPreviewApi } from "./booking-preview-api";

const BookingPreviewContext = createContext<ReturnType<typeof createBookingPreviewApi> | null>(
  null,
);

export function BookingPreviewProvider({ children }: { children: ReactNode }) {
  const [api] = useState(() => createBookingPreviewApi());
  return <BookingPreviewContext.Provider value={api}>{children}</BookingPreviewContext.Provider>;
}

export function useBookingPreview() {
  const api = useContext(BookingPreviewContext);
  if (!api) throw new Error("Booking fixtures require the isolated preview layout.");
  useSyncExternalStore(api.subscribe, api.snapshotVersion, api.snapshotVersion);
  return api;
}
