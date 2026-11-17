"use client";
import { useMemo, useState } from "react";
import { ReviewsAdmin } from "../../src/components/reviews/ReviewsAdmin";
import {
  type ReviewCommand,
  type ReviewModerationItem,
  type ReviewModerationPage,
  type ReviewsAdminApi,
  ReviewsClientError,
} from "../../src/lib/reviews";

const administrator = "fixture-admin-a";
/** Stable API + stable component: late responses deliberately survive cancellation to test epoch guards. */
function boundaryHarness(notify: () => void) {
  let actor = administrator,
    holdList = false,
    holdModeration = false,
    reads = 0,
    writes = 0,
    aborts = 0,
    lastPage = 1;
  const rows: ReviewModerationItem[] = [1, 2].map((page) => ({
    id: `00000000-0000-4000-8000-0000000003${page}1`,
    businessId: "00000000-0000-4000-8000-000000000311",
    businessTitle: `Privatna provjera ${page}`,
    rating: 4,
    text: `ADMIN_PRIVATE_HIDDEN_BODY_${page}`,
    createdAt: "2026-11-17T12:00:00.000Z",
    updatedAt: "2026-11-17T12:00:00.000Z",
    author: { id: null, name: "Korisnik AhiBizza", photoVersion: null },
    version: 1,
    hidden: true,
    withdrawn: false,
  }));
  const pendingLists: (() => void)[] = [],
    pendingModeration: (() => void)[] = [];
  const api: ReviewsAdminApi = {
    list: async (page = 1, expected, signal) => {
      reads++;
      lastPage = page;
      signal?.addEventListener(
        "abort",
        () => {
          aborts++;
          notify();
        },
        { once: true },
      );
      const denied =
        actor !== administrator
          ? new ReviewsClientError("OWNER_REQUIRED", 403)
          : expected && expected !== actor
            ? new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401)
            : null;
      const snapshot: ReviewModerationPage = {
        accountId: administrator,
        page,
        hasMore: page === 1,
        items: structuredClone(rows.slice(page - 1, page)),
      };
      notify();
      if (!holdList) {
        if (denied) throw denied;
        return snapshot;
      }
      return new Promise<ReviewModerationPage>((resolve, reject) => {
        pendingLists.push(() => {
          if (denied) reject(denied);
          else resolve(snapshot);
        });
        notify();
      });
    },
    moderate: async (id, input, expected) => {
      if (actor !== administrator) throw new ReviewsClientError("OWNER_REQUIRED", 403);
      if (expected !== actor) throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
      const row = rows.find((row) => row.id === id);
      if (!row || row.version !== input.expectedVersion)
        throw new ReviewsClientError("VERSION_CONFLICT", 409);
      if (!input.reason.trim()) throw new ReviewsClientError("INVALID_REVIEW_INPUT", 400);
      writes++;
      row.hidden = input.hidden;
      row.version++;
      notify();
      const result = { id, version: row.version };
      if (!holdModeration) return result;
      return new Promise<ReviewCommand>((resolve) => {
        pendingModeration.push(() => resolve(result));
        notify();
      });
    },
  };
  return {
    api,
    snapshot: () => ({
      actor,
      holdList,
      holdModeration,
      reads,
      writes,
      aborts,
      lastPage,
      pendingLists: pendingLists.length,
      pendingModeration: pendingModeration.length,
    }),
    switchActor: (value: string) => {
      actor = value;
      notify();
    },
    toggleList: () => {
      holdList = !holdList;
      notify();
    },
    toggleModeration: () => {
      holdModeration = !holdModeration;
      notify();
    },
    releaseList: () => {
      pendingLists.shift()?.();
      notify();
    },
    releaseModeration: () => {
      pendingModeration.shift()?.();
      notify();
    },
    changeVersion: () => {
      const row = rows[lastPage - 1];
      if (row) row.version++;
      notify();
    },
  };
}
export function AdminReviewsBoundaryFixture() {
  const [, setRevision] = useState(0),
    [active, setActive] = useState(true),
    [synchronous, setSynchronous] = useState(""),
    harness = useMemo(() => boundaryHarness(() => setRevision((v) => v + 1)), []),
    snapshot = harness.snapshot();
  function fire(event: string, actor?: string) {
    if (actor) harness.switchActor(actor);
    window.dispatchEvent(new Event(event));
    const area = document.querySelector("#admin-review-private-area");
    setSynchronous(
      !area?.textContent?.includes("ADMIN_PRIVATE_HIDDEN_BODY") && !area?.querySelector("textarea")
        ? "DA"
        : "NE",
    );
  }
  return (
    <main
      style={{
        maxWidth: 900,
        margin: "auto",
        padding: 24,
        fontFamily: "Arial,sans-serif",
        background: "#f7f8fa",
      }}
    >
      <h1>Izolirana admin provjera promjene naloga</h1>
      <p>API, očekivani admin i komponenta ostaju isti. Nalog B je obični član.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={() => fire("focus")}>
          Fokus isti admin
        </button>
        <button type="button" onClick={() => fire("focus", administrator)}>
          Admin A i fokus
        </button>
        <button type="button" onClick={() => fire("focus", "fixture-member-b")}>
          Član B i fokus
        </button>
        <button type="button" onClick={() => fire("pagehide")}>
          Sakrij stranicu
        </button>
        <button type="button" onClick={() => fire("pageshow")}>
          Vrati stranicu
        </button>
        <button type="button" onClick={() => harness.toggleList()}>
          {snapshot.holdList ? "Provjere se zadržavaju" : "Zadrži provjere"}
        </button>
        <button type="button" onClick={() => harness.releaseList()}>
          Pusti prvu provjeru
        </button>
        <button type="button" onClick={() => harness.toggleModeration()}>
          {snapshot.holdModeration ? "Moderacija se zadržava" : "Zadrži odgovor moderacije"}
        </button>
        <button type="button" onClick={() => harness.releaseModeration()}>
          Pusti odgovor moderacije
        </button>
        <button type="button" onClick={() => harness.changeVersion()}>
          Promijeni verziju recenzije
        </button>
        <button type="button" onClick={() => setActive((v) => !v)}>
          {active ? "Sakrij panel" : "Prikaži panel"}
        </button>
      </div>
      <output aria-live="polite">
        <p>{`Nalog: ${snapshot.actor}; čitanja: ${snapshot.reads}; slanja: ${snapshot.writes}; prekinuti signali: ${snapshot.aborts}; zadnja stranica: ${snapshot.lastPage}; zadržane provjere: ${snapshot.pendingLists}; zadržane moderacije: ${snapshot.pendingModeration}`}</p>
        <p>Privatni DOM uklonjen prije povratka iz događaja: {synchronous || "—"}</p>
      </output>
      <div id="admin-review-private-area">
        <ReviewsAdmin expectedAccountId={administrator} active={active} api={harness.api} />
      </div>
    </main>
  );
}
