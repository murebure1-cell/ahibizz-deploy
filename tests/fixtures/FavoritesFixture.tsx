"use client";
import { useMemo, useState } from "react";
import { DirectoryResultCard } from "../../src/components/directory/DirectoryResultCard";
import { FavoriteButton } from "../../src/components/favorites/FavoriteButton";
import { FavoritesProvider } from "../../src/components/favorites/FavoritesProvider";
import { SavedBusinesses } from "../../src/components/favorites/SavedBusinesses";
import {
  type FavoriteCommand,
  type FavoritePage,
  type FavoriteState,
  type FavoriteStates,
  type FavoritesApi,
  FavoritesClientError,
} from "../../src/lib/favorites";
import { publicBusinessView } from "../../src/server/directory/public-view";
import type { PublicDirectoryBusiness } from "../../src/server/directory/types";

const accountA = "fixture-account-a",
  accountB = "fixture-account-b";
const ids = [
  "00000000-0000-4000-8000-000000000111",
  "00000000-0000-4000-8000-000000000112",
  "00000000-0000-4000-8000-000000000113",
];
const rows: PublicDirectoryBusiness[] = ids.map((id, index) => ({
  id,
  title: ["Poslovni studio", "Atelje za dom", "Servis i podrška"][index] as string,
  categoryId: "00000000-0000-4000-8000-000000000211",
  subcategoryId: null,
  description: "Izolirana provjera sačuvanog profila.",
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: "Tuzla",
  countryCode: "BA",
  latitude: null,
  longitude: null,
  verified: false,
  featured: false,
  createdAt: "2026-11-17T12:00:00.000Z",
  publishedAt: "2026-11-17T12:00:00.000Z",
  media: {
    logo: null,
    cover: { kind: "cover", slot: 0, version: 1, width: 1600, height: 900 },
    gallery: [],
  },
  details: null,
  reviews: { count: 12, sum: 58 },
}));
function harness(notify: () => void) {
  let actor = accountA,
    reads = 0,
    writes = 0,
    mutations = 0,
    aborts = 0,
    lost = false,
    holdRead = false,
    holdWrite = false,
    lostBefore = false,
    failPage = false,
    visible = true;
  const store = new Map<string, Map<string, FavoriteState>>([
      [
        accountA,
        new Map([[ids[0] as string, { businessId: ids[0] as string, saved: true, version: 1 }]]),
      ],
      [accountB, new Map()],
    ]),
    receipts = new Map<string, { fingerprint: string; state: FavoriteState }>(),
    pendingReads: (() => void)[] = [],
    pendingWrites: (() => void)[] = [],
    pendingBefore: (() => void)[] = [];
  const state = (id: string) =>
    store.get(actor)?.get(id) ?? { businessId: id, saved: false, version: 0 };
  function access(expected?: string) {
    if (actor === "anonymous") throw new FavoritesClientError("AUTHENTICATION_REQUIRED", 401);
    if (actor === "suspended") throw new FavoritesClientError("ACCOUNT_ACCESS_DENIED", 403);
    if (expected && actor !== expected)
      throw new FavoritesClientError("ACCOUNT_IDENTITY_CHANGED", 401);
  }
  function watch(signal?: AbortSignal) {
    signal?.addEventListener(
      "abort",
      () => {
        aborts++;
        notify();
      },
      { once: true },
    );
  }
  const api: FavoritesApi = {
    async states(targets, expected, signal) {
      reads++;
      watch(signal);
      let failure: unknown;
      try {
        access(expected);
      } catch (error) {
        failure = error;
      }
      const result = {
        accountId: actor,
        items: targets
          .filter((id) => ids.includes(id) && visible)
          .map((id) => structuredClone(state(id))),
      };
      notify();
      if (holdRead)
        return new Promise<FavoriteStates>((resolve, reject) => {
          pendingReads.push(() => (failure ? reject(failure) : resolve(result)));
          notify();
        });
      if (failure) throw failure;
      return result;
    },
    async set(id, input: FavoriteCommand, expected) {
      access(expected);
      writes++;
      const verifiedActor = actor;
      function apply() {
        const before = store.get(verifiedActor)?.get(id) ?? {
            businessId: id,
            saved: false,
            version: 0,
          },
          receiptKey = verifiedActor + input.idempotencyKey,
          fingerprint = JSON.stringify({ id, ...input }),
          prior = receipts.get(receiptKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new FavoritesClientError("IDEMPOTENCY_CONFLICT", 409);
          if (prior.state.version !== before.version)
            throw new FavoritesClientError("VERSION_CONFLICT", 409);
          return { accountId: verifiedActor, items: [structuredClone(prior.state)] };
        }
        if (!visible || before.version !== input.expectedVersion)
          throw new FavoritesClientError("VERSION_CONFLICT", 409);
        const after = { businessId: id, saved: input.saved, version: before.version + 1 };
        store.get(verifiedActor)?.set(id, after);
        receipts.set(receiptKey, { fingerprint, state: after });
        mutations++;
        const result = { accountId: verifiedActor, items: [structuredClone(after)] };
        return result;
      }
      if (lostBefore) {
        lostBefore = false;
        pendingBefore.push(() => {
          try {
            apply();
          } catch {}
          notify();
        });
        notify();
        throw new TypeError("fixture request delayed before server commit");
      }
      const result = apply();
      notify();
      if (lost) {
        lost = false;
        throw new TypeError("fixture lost committed response");
      }
      if (holdWrite)
        return new Promise<FavoriteStates>((resolve) => {
          pendingWrites.push(() => resolve(result));
          notify();
        });
      return result;
    },
    async list(page, expected, signal) {
      reads++;
      watch(signal);
      access(expected);
      if (page === 2 && failPage) throw new Error("fixture later page unavailable");
      const saved = visible ? rows.filter((row) => state(row.id).saved) : [],
        offset = (page - 1) * 2;
      const result: FavoritePage = {
        accountId: actor,
        page,
        hasMore: saved.length > offset + 2,
        items: structuredClone(saved.slice(offset, offset + 2)),
      };
      notify();
      if (holdRead)
        return new Promise((resolve) => {
          pendingReads.push(() => resolve(result));
          notify();
        });
      return result;
    },
  };
  return {
    api,
    snapshot: () => ({
      actor,
      reads,
      writes,
      mutations,
      aborts,
      lost,
      holdRead,
      holdWrite,
      lostBefore,
      failPage,
      visible,
      pendingReads: pendingReads.length,
      pendingWrites: pendingWrites.length,
      pendingBefore: pendingBefore.length,
      states: [...(store.get(accountA)?.values() ?? [])],
    }),
    actor: (value: string) => {
      actor = value;
      notify();
    },
    lost: () => {
      lost = true;
      notify();
    },
    lostBefore: () => {
      lostBefore = true;
      notify();
    },
    releaseBefore: () => {
      pendingBefore.shift()?.();
      notify();
    },
    toggleRead: () => {
      holdRead = !holdRead;
      notify();
    },
    toggleWrite: () => {
      holdWrite = !holdWrite;
      notify();
    },
    releaseRead: () => {
      pendingReads.shift()?.();
      notify();
    },
    releaseWrite: () => {
      pendingWrites.shift()?.();
      notify();
    },
    changeVersion: () => {
      const before = state(ids[0] as string);
      store
        .get(actor)
        ?.set(ids[0] as string, { ...before, version: before.version + 1, saved: !before.saved });
      notify();
    },
    allSaved: () => {
      for (const id of ids) {
        const before = state(id);
        store.get(actor)?.set(id, { businessId: id, saved: true, version: before.version + 1 });
      }
      notify();
    },
    togglePageFailure: () => {
      failPage = !failPage;
      notify();
    },
    toggleVisible: () => {
      visible = !visible;
      notify();
    },
  };
}
export function FavoritesFixture() {
  const [, setRevision] = useState(0),
    [active, setActive] = useState(true),
    [savedPanel, setSavedPanel] = useState(false),
    [synchronous, setSynchronous] = useState(""),
    h = useMemo(() => harness(() => setRevision((v) => v + 1)), []),
    s = h.snapshot();
  function event(name: string, actor?: string) {
    if (actor) h.actor(actor);
    window.dispatchEvent(new Event(name));
    setSynchronous(
      document.querySelectorAll('#favorites-private-area [aria-pressed="true"]').length === 0 &&
        document.querySelectorAll("#saved-private-area article").length === 0
        ? "DA"
        : "NE",
    );
  }
  return (
    <>
      <aside className="fixtureControls">
        <h1>Izolirana proba sačuvanih profila</h1>
        <p>Stvarne komponente; lokalna memorija. Nema stvarnih naloga, API-ja ni baze.</p>
        <div>
          <button type="button" onClick={() => event("focus", accountA)}>
            Nalog A i fokus
          </button>
          <button type="button" onClick={() => event("focus", accountB)}>
            Nalog B i fokus
          </button>
          <button type="button" onClick={() => event("focus", "anonymous")}>
            Odjava i fokus
          </button>
          <button type="button" onClick={() => event("focus", "suspended")}>
            Blokiran nalog i fokus
          </button>
          <button type="button" onClick={() => event("blur")}>
            Sakrij odmah
          </button>
          <button type="button" onClick={() => event("focus")}>
            Vrati fokus
          </button>
          <button type="button" onClick={() => h.lost()}>
            Izgubi naredni odgovor
          </button>
          <button type="button" onClick={() => h.lostBefore()}>
            Odloži zahtjev i izgubi odgovor
          </button>
          <button type="button" onClick={() => h.releaseBefore()}>
            Pusti zakašnjeli zahtjev
          </button>
          <button type="button" onClick={() => h.toggleRead()}>
            {s.holdRead ? "Čitanja zadržana" : "Zadrži čitanja"}
          </button>
          <button type="button" onClick={() => h.releaseRead()}>
            Pusti jedno čitanje
          </button>
          <button type="button" onClick={() => h.toggleWrite()}>
            {s.holdWrite ? "Spremanja zadržana" : "Zadrži odgovor spremanja"}
          </button>
          <button type="button" onClick={() => h.releaseWrite()}>
            Pusti odgovor spremanja
          </button>
          <button type="button" onClick={() => h.changeVersion()}>
            Vanjska izmjena prvog profila
          </button>
          <button
            type="button"
            onClick={() => {
              h.allSaved();
              event("focus");
            }}
          >
            Sačuvaj sva tri u memoriji
          </button>
          <button type="button" onClick={() => h.togglePageFailure()}>
            Kvar druge stranice
          </button>
          <button
            type="button"
            onClick={() => {
              h.toggleVisible();
              event("focus");
            }}
          >
            Promijeni javnu dostupnost
          </button>
          <button type="button" onClick={() => setSavedPanel((v) => !v)}>
            {savedPanel ? "Javne kartice" : "Sačuvani panel"}
          </button>
          <button type="button" onClick={() => setActive((v) => !v)}>
            {active ? "Deaktiviraj panel" : "Aktiviraj panel"}
          </button>
          <button
            type="button"
            onClick={() => {
              document.documentElement.dataset.theme =
                document.documentElement.dataset.theme === "dark" ? "light" : "dark";
            }}
          >
            Promijeni temu
          </button>
          <button
            type="button"
            onClick={() => {
              const b = document.querySelector<HTMLButtonElement>(
                '#favorites-private-area button[aria-label*="Poslovni studio"]',
              );
              b?.click();
              b?.click();
            }}
          >
            Dvostruki klik prvog srca
          </button>
        </div>
        <p>
          Sinhrono skriveno: <strong>{synchronous}</strong>
        </p>
        <pre>{JSON.stringify(s, null, 2)}</pre>
      </aside>
      <FavoritesProvider api={h.api}>
        <main id="favorites-private-area" className="fixtureMain">
          {!savedPanel && (
            <>
              <div className="fixtureGrid">
                {rows.slice(0, 2).map((row) => (
                  <DirectoryResultCard key={row.id} business={publicBusinessView(row, [])} />
                ))}
              </div>
              <section className="fixtureProfileAction">
                <h2>Radnja na javnom profilu</h2>
                <FavoriteButton businessId={ids[0] as string} title="Poslovni studio" />
              </section>
            </>
          )}
          <div id="saved-private-area">
            <SavedBusinesses
              active={active && savedPanel}
              expectedAccountId={accountA}
              api={h.api}
              categories={[]}
            />
          </div>
        </main>
      </FavoritesProvider>
    </>
  );
}
