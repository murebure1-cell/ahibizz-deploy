import {
  type ConnectionItem,
  type ConnectionRelationship,
  type PublicPerson,
  readPublicPerson,
} from "../../lib/connections";
import { ConnectionRequestError, type connectionRequest } from "../../lib/connections-client";
import type { createPeoplePreviewApi } from "./people-preview-api";

const fixtures: [PublicPerson, PublicPerson] = [
  {
    id: "preview-designer",
    name: "Ogledna dizajnerica",
    verified: false,
    city: "Tuzla",
    countryCode: "BA",
    bio: "Dizajn prostora i vizuelnih identiteta.",
    skills: ["Grafički dizajn", "Enterijer"],
    workStatus: "open_to_collaboration",
    photoVersion: null,
    coverVersion: null,
  },
  {
    id: "preview-developer",
    name: "Ogledni programer",
    verified: false,
    city: "Sarajevo",
    countryCode: "BA",
    bio: "Razvoj web aplikacija i digitalnih proizvoda.",
    skills: ["Web razvoj", "Programiranje"],
    workStatus: "self_employed",
    photoVersion: null,
    coverVersion: null,
  },
];

/** Isolated in-memory social fixture. No fetch, email or external write. */
export function createConnectionsPreviewApi(people: ReturnType<typeof createPeoplePreviewApi>) {
  const ownId = people.getProfile().id;
  const entries = new Map<string, ConnectionItem>();
  const receipts = new Map<string, { intent: string; result: Record<string, unknown> }>();
  entries.set(fixtures[0].id, {
    id: "00000000-0000-4000-8000-000000000001",
    personId: fixtures[0].id,
    status: "pending",
    direction: "incoming",
    version: 1,
    person: fixtures[0],
  });
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const fail = (status: number, code: string): never => {
    throw new ConnectionRequestError(status, code);
  };
  const ownPublic = (): PublicPerson => readPublicPerson(people.getProfile());
  const personAt = (id: string) =>
    id === ownId
      ? people.getVisibility().isPublic
        ? ownPublic()
        : null
      : (fixtures.find((p) => p.id === id) ?? null);
  const relationship = (id: string): ConnectionRelationship => {
    const item = entries.get(id);
    return item
      ? {
          id: item.id,
          status: item.status,
          direction: item.direction,
          version: item.version,
          personId: id,
        }
      : { id: null, status: "none", direction: null, version: 0, personId: id };
  };
  const request: typeof connectionRequest = async (path, options = {}) => {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const expectedAccountId = new Headers(options.headers).get("X-AhiBizz-Account-ID");
    if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      fail(400, "INVALID_CONNECTION_INPUT");
    if (expectedAccountId !== null && expectedAccountId !== people.getProfile().id)
      fail(401, "ACCOUNT_IDENTITY_CHANGED");
    if (
      !/^(people(?:\?|\/|$)|connections(?:\?|\/|$)|visibility$)/.test(path) ||
      path.includes("..") ||
      path.includes("#")
    )
      return fail(404, "NOT_FOUND");
    const url = new URL(path, "https://fixture.invalid/"),
      route = url.pathname.slice(1),
      method = (options.method ?? "GET").toUpperCase();
    const allowedQuery =
      method === "GET" && route === "people"
        ? ["q", "page"]
        : method === "GET" && route === "connections"
          ? ["view", "page"]
          : [];
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (!allowedQuery.includes(key) || seen.has(key))
        return fail(400, "INVALID_CONNECTION_INPUT");
      seen.add(key);
      if (key === "page" && (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000))
        return fail(400, "INVALID_CONNECTION_INPUT");
      if (key === "view" && !["incoming", "outgoing", "contacts"].includes(value))
        return fail(400, "INVALID_CONNECTION_INPUT");
      if (
        key === "q" &&
        (value.length > 100 ||
          [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
      )
        return fail(400, "INVALID_CONNECTION_INPUT");
    }
    if (method === "GET") {
      if (route === "visibility") return { visibility: people.getVisibility() };
      if (route === "people") {
        const q = (url.searchParams.get("q") ?? "").normalize("NFKC").toLocaleLowerCase("bs");
        const all = [...fixtures, ...(people.getVisibility().isPublic ? [ownPublic()] : [])].filter(
          (p) =>
            `${p.name} ${p.city ?? ""} ${p.skills.join(" ")}`.toLocaleLowerCase("bs").includes(q),
        );
        const page = Number(url.searchParams.get("page") ?? 1);
        return {
          items: all.slice((page - 1) * 12, page * 12),
          page,
          hasMore: all.length > page * 12,
        };
      }
      const detail = /^people\/([^/]+)$/.exec(route);
      if (detail) {
        const id = decodeURIComponent(detail[1] as string),
          person = personAt(id);
        if (!person) return fail(404, "PERSON_NOT_FOUND");
        return { person, viewerId: ownId, relationship: relationship(id) };
      }
      if (route === "connections") {
        const view = url.searchParams.get("view") ?? "contacts",
          page = Number(url.searchParams.get("page") ?? 1);
        const all = [...entries.values()].filter((e) =>
          view === "contacts"
            ? e.status === "accepted"
            : e.status === "pending" && e.direction === view,
        );
        return {
          items: structuredClone(all.slice((page - 1) * 12, page * 12)),
          page,
          hasMore: all.length > page * 12,
        };
      }
      return fail(404, "NOT_FOUND");
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(String(options.body));
    } catch {
      return fail(400, "INVALID_CONNECTION_INPUT");
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !Number.isInteger(input.expectedVersion) ||
      (input.expectedVersion as number) < 0 ||
      (input.expectedVersion as number) > 2147483646 ||
      typeof input.idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.idempotencyKey,
      )
    )
      return fail(400, "INVALID_CONNECTION_INPUT");
    const allowed =
      route === "visibility"
        ? ["isPublic", "expectedVersion", "idempotencyKey"]
        : ["expectedVersion", "idempotencyKey"];
    if (
      Object.keys(input).some((k) => !allowed.includes(k)) ||
      allowed.some((k) => !Object.hasOwn(input, k))
    )
      return fail(400, "INVALID_CONNECTION_INPUT");
    const intent = JSON.stringify([route, method, input]),
      receipt = receipts.get(input.idempotencyKey);
    if (receipt) {
      if (receipt.intent !== intent) return fail(409, "IDEMPOTENCY_CONFLICT");
      return structuredClone(receipt.result);
    }
    let result: Record<string, unknown>;
    if (route === "visibility" && method === "PATCH") {
      if (typeof input.isPublic !== "boolean") return fail(400, "INVALID_CONNECTION_INPUT");
      if (input.expectedVersion !== people.getProfile().version)
        return fail(409, "VERSION_CONFLICT");
      result = {
        visibility: people.setVisibility(input.isPublic, input.expectedVersion as number),
      };
    } else {
      const create = /^people\/([^/]+)\/request$/.exec(route),
        transition = /^connections\/([^/]+)\/(accept|decline|cancel|remove)$/.exec(route);
      if (method !== "POST" || (!create && !transition)) return fail(404, "NOT_FOUND");
      const target = create
        ? decodeURIComponent(create[1] as string)
        : [...entries.values()].find((e) => e.id === transition?.[1])?.personId;
      if (!target || target === ownId) return fail(400, "INVALID_CONNECTION_INPUT");
      const before = relationship(target),
        person = personAt(target);
      if (before.version !== input.expectedVersion) return fail(409, "VERSION_CONFLICT");
      let status: ConnectionRelationship["status"];
      if (create) {
        if (!people.getVisibility().isPublic) return fail(403, "PUBLIC_PROFILE_REQUIRED");
        if (!person) return fail(404, "PERSON_NOT_FOUND");
        if (before.status === "pending" || before.status === "accepted")
          return fail(409, "CONNECTION_CONFLICT");
        status = "pending";
      } else {
        const action = transition?.[2];
        if (action === "accept") {
          if (!people.getVisibility().isPublic) return fail(403, "PUBLIC_PROFILE_REQUIRED");
          if (!person) return fail(404, "PERSON_NOT_FOUND");
        }
        const valid =
          action === "remove"
            ? before.status === "accepted"
            : before.status === "pending" &&
              before.direction === (action === "cancel" ? "outgoing" : "incoming");
        if (!valid) return fail(409, "INVALID_TRANSITION");
        status =
          action === "accept"
            ? "accepted"
            : action === "decline"
              ? "declined"
              : action === "cancel"
                ? "cancelled"
                : "removed";
      }
      const next: ConnectionItem = {
        id: before.id ?? crypto.randomUUID(),
        personId: target,
        status,
        direction: create ? "outgoing" : before.direction,
        version: before.version + 1,
        person,
      };
      entries.set(target, next);
      result = { relationship: relationship(target) };
    }
    receipts.set(input.idempotencyKey, { intent, result: structuredClone(result) });
    changed();
    return result;
  };
  return {
    request,
    personForMessaging(id: string) {
      const person = personAt(id);
      return person ? { id: person.id, name: person.name } : null;
    },
    imageUrl: (person: PublicPerson, kind: "photo" | "cover") =>
      person.id === ownId ? people.imageUrl(kind) : null,
    snapshotVersion: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
