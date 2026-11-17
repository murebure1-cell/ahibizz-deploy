"use client";
import { useMemo, useState } from "react";
import { BusinessReviews } from "../../src/components/reviews/BusinessReviews";
import {
  type OwnReviewState,
  type ReviewCommand,
  type ReviewsApi,
  ReviewsClientError,
} from "../../src/lib/reviews";

const businessId = "00000000-0000-4000-8000-000000000211";
/** Account switches keep the exact same api object and component instance. No real session or network. */
function boundaryHarness(notify: () => void) {
  let actor = "fixture-a",
    holdOwn = false,
    holdSave = false,
    reads = 0,
    publicReads = 0,
    writes = 0;
  const states: Record<string, OwnReviewState> = {
    "fixture-a": {
      accountId: "fixture-a",
      canReview: true,
      review: {
        id: "00000000-0000-4000-8000-000000000212",
        rating: 4,
        text: "Povučena privatna recenzija naloga A.",
        version: 1,
        withdrawn: true,
        hidden: false,
      },
    },
    "fixture-b": { accountId: "fixture-b", canReview: true, review: null },
  };
  const pendingOwn: { snapshot: OwnReviewState; resolve: (state: OwnReviewState) => void }[] = [],
    pendingSave: (() => void)[] = [];
  const api: ReviewsApi = {
    list: async () => {
      publicReads++;
      const items = Object.values(states).flatMap((state) =>
        state.review && !state.review.withdrawn && !state.review.hidden
          ? [
              {
                id: state.review.id,
                rating: state.review.rating,
                text: state.review.text,
                createdAt: "2026-11-17T12:00:00.000Z",
                updatedAt: "2026-11-17T12:00:00.000Z",
                author: { id: null, name: "Korisnik AhiBizza", photoVersion: null },
              },
            ]
          : [],
      );
      notify();
      return {
        items,
        page: 1,
        hasMore: false,
        summary: { count: items.length, sum: items.reduce((sum, item) => sum + item.rating, 0) },
      };
    },
    own: async () => {
      reads++;
      const snapshot = structuredClone(states[actor] as OwnReviewState);
      notify();
      if (!holdOwn) return snapshot;
      return new Promise((resolve) => {
        pendingOwn.push({ snapshot, resolve });
        notify();
      });
    },
    save: async (_, input, expected) => {
      if (expected !== actor) throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
      const state = states[actor] as OwnReviewState;
      if ((state.review?.version ?? 0) !== input.expectedVersion)
        throw new ReviewsClientError("VERSION_CONFLICT", 409);
      writes++;
      state.review = {
        id: state.review?.id ?? crypto.randomUUID(),
        rating: input.rating,
        text: input.text,
        version: (state.review?.version ?? 0) + 1,
        withdrawn: false,
        hidden: false,
      };
      notify();
      const result = { id: state.review.id, version: state.review.version };
      if (!holdSave) return result;
      return new Promise<ReviewCommand>((resolve) => {
        pendingSave.push(() => resolve(result));
        notify();
      });
    },
    withdraw: async (_, input, expected) => {
      if (expected !== actor) throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
      const state = states[actor] as OwnReviewState;
      if (!state.review || state.review.version !== input.expectedVersion)
        throw new ReviewsClientError("VERSION_CONFLICT", 409);
      writes++;
      state.review = { ...state.review, withdrawn: true, version: state.review.version + 1 };
      notify();
      return { id: state.review.id, version: state.review.version };
    },
  };
  return {
    api,
    snapshot: () => ({
      actor,
      holdOwn,
      holdSave,
      reads,
      publicReads,
      writes,
      pendingOwn: pendingOwn.length,
      pendingSave: pendingSave.length,
    }),
    switchActor: (value: string) => {
      actor = value;
      notify();
    },
    holdRead: () => {
      holdOwn = !holdOwn;
      notify();
    },
    holdWrite: () => {
      holdSave = !holdSave;
      notify();
    },
    releaseOwn: () => {
      const pending = pendingOwn.shift();
      pending?.resolve(pending.snapshot);
      notify();
    },
    releaseSave: () => {
      pendingSave.shift()?.();
      notify();
    },
  };
}
export function BusinessReviewsBoundaryFixture() {
  const [, setRevision] = useState(0),
    [syncCleared, setSyncCleared] = useState(""),
    harness = useMemo(() => boundaryHarness(() => setRevision((v) => v + 1)), []),
    snapshot = harness.snapshot();
  function focus(actor?: string) {
    if (actor) harness.switchActor(actor);
    window.dispatchEvent(new Event("focus"));
    setSyncCleared(document.querySelector("#recenzije textarea") === null ? "DA" : "NE");
  }
  return (
    <main
      style={{
        maxWidth: 900,
        margin: "auto",
        padding: 24,
        fontFamily: "Arial, sans-serif",
        background: "#f7f8fa",
      }}
    >
      <h1>Izolirana provjera promjene naloga</h1>
      <p>Komponenta se ne premontira. API objekat je isti tokom svih provjera.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button type="button" onClick={() => focus()}>
          Fokus isti nalog
        </button>
        <button type="button" onClick={() => focus("fixture-a")}>
          Nalog A i fokus
        </button>
        <button type="button" onClick={() => focus("fixture-b")}>
          Nalog B i fokus
        </button>
        <button type="button" onClick={() => harness.holdRead()}>
          {snapshot.holdOwn ? "Provjere se zadržavaju" : "Zadrži provjere"}
        </button>
        <button type="button" onClick={() => harness.releaseOwn()}>
          Pusti prvu provjeru
        </button>
        <button type="button" onClick={() => harness.holdWrite()}>
          {snapshot.holdSave ? "Slanje se zadržava" : "Zadrži odgovor slanja"}
        </button>
        <button type="button" onClick={() => harness.releaseSave()}>
          Pusti odgovor slanja
        </button>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("pagehide"));
            setSyncCleared(document.querySelector("#recenzije textarea") === null ? "DA" : "NE");
          }}
        >
          Sakrij stranicu
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new Event("pageshow"))}>
          Vrati stranicu
        </button>
      </div>
      <output aria-live="polite">
        <p>
          {`Nalog: ${snapshot.actor}; čitanja: ${snapshot.reads}; javna čitanja: ${snapshot.publicReads}; slanja: ${snapshot.writes}; zadržane provjere: ${snapshot.pendingOwn}; zadržana slanja: ${snapshot.pendingSave}`}
        </p>
        <p>Privatni DOM uklonjen prije povratka iz događaja: {syncCleared || "—"}</p>
      </output>
      <BusinessReviews businessId={businessId} api={harness.api} />
    </main>
  );
}
