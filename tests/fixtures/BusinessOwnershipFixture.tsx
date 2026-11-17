"use client";
import { useMemo, useState } from "react";
import { BusinessOwnershipManager } from "../../src/components/directory/BusinessOwnershipManager";
import type {
  OwnershipCommand,
  OwnershipPerson,
  OwnershipReceipt,
  OwnershipSnapshot,
} from "../../src/lib/business-ownership";
import { createBusinessOwnershipApi } from "../../src/lib/business-ownership-client";
import type { DirectoryBusiness } from "../../src/server/directory/types";

const id = "00000000-0000-4000-8000-000000000471",
  admin = "fixture-admin-a",
  member = "fixture-member-b",
  target = "fixture-owner-c",
  storageKey = "fixture.ownership.backend.v1";
const people: Record<string, OwnershipPerson> = {
  [admin]: { id: admin, name: "PRIVATE_ADMIN_A", email: "admin@ownership-fixture.invalid" },
  [member]: { id: member, name: "Član B", email: "member@ownership-fixture.invalid" },
  [target]: { id: target, name: "PRIVATE_TARGET_C", email: "owner@ownership-fixture.invalid" },
};
const initial: DirectoryBusiness = {
  id,
  ownerId: admin,
  title: "Izolirana djelatnost",
  categoryId: "00000000-0000-4000-8000-000000000472",
  subcategoryId: null,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: "Tuzla",
  countryCode: "BA",
  latitude: null,
  longitude: null,
  status: "published",
  version: 3,
  verified: false,
  featured: false,
  createdAt: "2026-11-17T12:00:00.000Z",
  updatedAt: "2026-11-17T12:00:00.000Z",
  publishedAt: "2026-11-17T12:00:00.000Z",
  archivedAt: null,
};
function harness(notify: () => void) {
  let actor = admin,
    business = structuredClone(initial),
    reads = 0,
    writes = 0,
    mutations = 0,
    aborts = 0,
    holdRead = false,
    holdWrite = false,
    lostAfter = false,
    lostBefore = false,
    denyWrite = false;
  const receipts = new Map<string, { fingerprint: string; receipt: OwnershipReceipt }>(),
    pendingReads: (() => void)[] = [],
    pendingWrites: (() => void)[] = [],
    pendingBefore: (() => void)[] = [];
  try {
    const prior = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      prior?.business?.id === id &&
      Number.isInteger(prior.business.version) &&
      people[prior.business.ownerId]
    ) {
      business = prior.business;
      actor = people[prior.actor] ? prior.actor : admin;
      reads = prior.reads ?? 0;
      writes = prior.writes ?? 0;
      mutations = prior.mutations ?? 0;
      denyWrite = prior.denyWrite === true;
      for (const row of prior.receipts ?? []) receipts.set(row[0], row[1]);
    }
  } catch {}
  function persist() {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        actor,
        business,
        reads,
        writes,
        mutations,
        denyWrite,
        receipts: [...receipts],
      }),
    );
    notify();
  }
  function snapshot(requestId?: string): OwnershipSnapshot {
    return {
      business: structuredClone(business),
      currentOwner: structuredClone(people[business.ownerId] as OwnershipPerson),
      receipt: requestId ? structuredClone(receipts.get(requestId)?.receipt ?? null) : null,
    };
  }
  const fake: typeof fetch = async (input, options) => {
    const url = new URL(String(input), "http://127.0.0.1:4473"),
      expected = new Headers(options?.headers).get("X-AhiBizz-Account-ID"),
      method = options?.method ?? "GET";
    options?.signal?.addEventListener(
      "abort",
      () => {
        aborts++;
        notify();
      },
      { once: true },
    );
    if (actor !== admin) return Response.json({ code: "OWNER_REQUIRED" }, { status: 403 });
    if (expected !== actor)
      return Response.json({ code: "ACCOUNT_IDENTITY_CHANGED" }, { status: 401 });
    if (
      url.pathname !== `/api/directory/ownership/${id}` &&
      url.pathname !== `/api/directory/ownership/${id}/lookup`
    )
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (method === "GET") {
      reads++;
      const value = snapshot(url.searchParams.get("requestId") ?? undefined);
      persist();
      if (holdRead)
        return new Promise((resolve) => {
          pendingReads.push(() => resolve(Response.json(value)));
          notify();
        });
      return Response.json(value);
    }
    if (method === "POST") {
      reads++;
      const body = JSON.parse(String(options?.body));
      persist();
      if (body.email !== people[target]?.email)
        return Response.json({ code: "TARGET_ACCOUNT_NOT_FOUND" }, { status: 404 });
      const value = { ...snapshot(), candidate: structuredClone(people[target]) };
      if (holdRead)
        return new Promise((resolve) => {
          pendingReads.push(() => resolve(Response.json(value)));
          notify();
        });
      return Response.json(value);
    }
    if (method !== "PUT") return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    writes++;
    const command = JSON.parse(String(options?.body)) as OwnershipCommand,
      fingerprint = JSON.stringify(command);
    persist();
    function apply() {
      if (denyWrite) return Response.json({ code: "OWNER_REQUIRED" }, { status: 403 });
      const prior = receipts.get(command.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          return Response.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
        return Response.json(snapshot(command.idempotencyKey));
      }
      if (command.expectedVersion !== business.version)
        return Response.json({ code: "VERSION_CONFLICT" }, { status: 409 });
      if (command.targetAccountId !== target || command.targetEmail !== people[target]?.email)
        return Response.json({ code: "TARGET_ACCOUNT_CHANGED" }, { status: 409 });
      const receipt: OwnershipReceipt = {
        requestId: command.idempotencyKey,
        businessId: id,
        previousOwnerId: business.ownerId,
        targetAccountId: target,
        previousVersion: business.version,
        resultVersion: business.version + 1,
        recordedAt: new Date().toISOString(),
      };
      business = { ...business, version: business.version + 1, ownerId: target };
      receipts.set(command.idempotencyKey, { fingerprint, receipt });
      mutations++;
      persist();
      return Response.json(snapshot(command.idempotencyKey));
    }
    if (lostBefore) {
      lostBefore = false;
      pendingBefore.push(() => {
        apply();
        notify();
      });
      notify();
      throw new TypeError("fixture lost request before commit");
    }
    const response = apply();
    if (lostAfter) {
      lostAfter = false;
      throw new TypeError("fixture lost committed response");
    }
    if (holdWrite)
      return new Promise((resolve) => {
        pendingWrites.push(() => resolve(response));
        notify();
      });
    return response;
  };
  return {
    api: createBusinessOwnershipApi(fake),
    snapshot: () => ({
      actor,
      businessVersion: business.version,
      ownerId: business.ownerId,
      reads,
      writes,
      mutations,
      aborts,
      holdRead,
      holdWrite,
      lostAfter,
      lostBefore,
      denyWrite,
      pendingReads: pendingReads.length,
      pendingWrites: pendingWrites.length,
      pendingBefore: pendingBefore.length,
      receipts: receipts.size,
    }),
    actor: (value: string) => {
      actor = value;
      persist();
    },
    toggleRead: () => {
      holdRead = !holdRead;
      notify();
    },
    releaseRead: () => {
      pendingReads.shift()?.();
      notify();
    },
    toggleWrite: () => {
      holdWrite = !holdWrite;
      notify();
    },
    releaseWrite: () => {
      pendingWrites.shift()?.();
      notify();
    },
    lostAfter: () => {
      lostAfter = true;
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
    denyWrite: () => {
      denyWrite = !denyWrite;
      persist();
    },
    later: () => {
      business = { ...business, ownerId: admin, version: business.version + 1 };
      persist();
    },
    reset: () => {
      sessionStorage.removeItem(storageKey);
      for (const name of [admin, member])
        localStorage.removeItem(`ahibizz:ownership:v1:${name}:${id}`);
      window.location.reload();
    },
  };
}
export function BusinessOwnershipFixture() {
  const [, setRevision] = useState(0),
    [active, setActive] = useState(true),
    [key, setKey] = useState(0),
    [note, setNote] = useState(""),
    [synchronous, setSynchronous] = useState(""),
    h = useMemo(() => harness(() => setRevision((v) => v + 1)), []),
    s = h.snapshot();
  function event(name: string, actor?: string) {
    if (actor) h.actor(actor);
    window.dispatchEvent(new Event(name));
    const area = document.querySelector("#ownership-private-area");
    setSynchronous(
      !area?.textContent?.includes("PRIVATE_") && !area?.querySelector('input[type="email"]')
        ? "DA"
        : "NE",
    );
  }
  return (
    <>
      <aside className="fixtureControls">
        <h1>Izolirana provjera dodjele vlasnika</h1>
        <p>
          Stvarni obrazac, klijent i dnevnik; isključivo testna memorija. Email za probu:
          owner@ownership-fixture.invalid
        </p>
        <div>
          <button type="button" onClick={() => event("focus", admin)}>
            Admin A i fokus
          </button>
          <button type="button" onClick={() => event("focus", member)}>
            Član B i fokus
          </button>
          <button type="button" onClick={() => event("blur")}>
            Sakrij odmah
          </button>
          <button type="button" onClick={() => event("focus")}>
            Vrati fokus
          </button>
          <button type="button" onClick={() => h.toggleRead()}>
            {s.holdRead ? "Čitanja zadržana" : "Zadrži čitanja"}
          </button>
          <button type="button" onClick={() => h.releaseRead()}>
            Pusti jedno čitanje
          </button>
          <button type="button" onClick={() => h.toggleWrite()}>
            {s.holdWrite ? "Spremanja zadržana" : "Zadrži odgovor dodjele"}
          </button>
          <button type="button" onClick={() => h.releaseWrite()}>
            Pusti odgovor dodjele
          </button>
          <button type="button" onClick={() => h.lostAfter()}>
            Izgubi odgovor poslije izvršenja
          </button>
          <button type="button" onClick={() => h.lostBefore()}>
            Odloži zahtjev i izgubi odgovor
          </button>
          <button type="button" onClick={() => h.releaseBefore()}>
            Pusti zakašnjeli zahtjev
          </button>
          <button type="button" onClick={() => h.denyWrite()}>
            {s.denyWrite ? "Dodjela je odbijena 403" : "Odbij dodjelu 403"}
          </button>
          <button type="button" onClick={() => h.later()}>
            Kasnija promjena vlasnika
          </button>
          <button type="button" onClick={() => setKey((v) => v + 1)}>
            Ponovo otvori obrazac
          </button>
          <button type="button" onClick={() => setActive((v) => !v)}>
            {active ? "Deaktiviraj" : "Aktiviraj"}
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
              const control = [
                ...document.querySelectorAll<HTMLButtonElement>("#ownership-private-area button"),
              ].find((button) => button.textContent === "Dodijeli djelatnost");
              control?.click();
              control?.click();
            }}
          >
            Dvostruka dodjela
          </button>
          <button type="button" onClick={() => h.reset()}>
            Resetiraj probu
          </button>
        </div>
        <p>
          Sinhrono skriveno: <strong>{synchronous}</strong>
        </p>
        <p role="status">{note}</p>
        <pre>{JSON.stringify(s, null, 2)}</pre>
      </aside>
      <main id="ownership-private-area">
        <BusinessOwnershipManager
          key={key}
          businessId={id}
          active={active}
          expectedAccountId={admin}
          api={h.api}
          onChanged={(business) => setNote(`Trenutna verzija ${business.version}`)}
          onAccessDenied={() => {
            setNote("Pristup odbijen");
            return true;
          }}
          onBack={() => setActive(false)}
        />
      </main>
    </>
  );
}
