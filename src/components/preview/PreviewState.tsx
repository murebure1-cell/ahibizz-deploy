"use client";

import type { ReactNode } from "react";
import { BookingPreviewProvider } from "./BookingPreviewState";
import { BusinessPreviewProvider } from "./BusinessPreviewState";
import { ConnectionsPreviewProvider } from "./ConnectionsPreviewState";
import { MessagingPreviewProvider } from "./MessagingPreviewState";
import { PeoplePreviewProvider } from "./PeoplePreviewState";

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  return (
    <BookingPreviewProvider>
      <BusinessPreviewProvider>
        <PeoplePreviewProvider>
          <ConnectionsPreviewProvider>
            <MessagingPreviewProvider>{children}</MessagingPreviewProvider>
          </ConnectionsPreviewProvider>
        </PeoplePreviewProvider>
      </BusinessPreviewProvider>
    </BookingPreviewProvider>
  );
}
