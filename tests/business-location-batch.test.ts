import assert from "node:assert/strict";
import test from "node:test";
import { AdminRequestError } from "../src/components/admin/responses";
import {
  type LocationBatchApi,
  type LocationBatchJournal,
  loadLocationBatchJournal,
  locationBatchClient,
  locationBatchKey,
  parseLocationBatch,
  previewLocationBatch,
  retireLocationBatch,
  runLocationBatch,
} from "../src/lib/business-location-batch";
import type { DirectoryBusiness } from "../src/server/directory/types";

const actor = "fixture-owner",
  id = "18d9ab95-d83a-483a-9767-45017a9409a2";
const source = () => ({
  format: "ahibizz-reviewed-business-locations",
  version: 1,
  records: [
    {
      id,
      title: "Probna djelatnost",
      addressLine: "Probna ulica 7",
      city: "Probni grad",
      countryCode: "BA",
      expectedLatitude: null,
      expectedLongitude: null,
      proposed: { latitude: 44.5, longitude: 18.5 },
      provenance: {
        provider: "Photon/OpenStreetMap",
        kind: "address-building",
        osmType: "W",
        osmId: "12345",
        checkedUtc: "2026-11-17T12:00:00.000Z",
        responseSha256: "a".repeat(64),
      },
    },
  ],
});
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function firstRow(value: ReturnType<typeof source>) {
  const row = value.records[0];
  assert.ok(row);
  return row;
}
const rejectCode = (code: string) => (error: unknown) =>
  error instanceof Error && error.message === code;
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const initial = (): DirectoryBusiness => ({
  id,
  ownerId: actor,
  title: "Probna djelatnost",
  categoryId: "d9f7e6ab-41d9-4a4a-b193-10c81872a320",
  subcategoryId: null,
  description: "Sačuvani opis",
  contactEmail: "fixture@example.invalid",
  contactPhone: "+38761000000",
  websiteUrl: "https://example.invalid/",
  addressLine: "Probna ulica 7",
  city: "Probni grad",
  countryCode: "BA",
  latitude: null,
  longitude: null,
  status: "published",
  version: 7,
  verified: false,
  featured: false,
  createdAt: "2026-11-16T12:00:00.000Z",
  updatedAt: "2026-11-16T12:00:00.000Z",
  publishedAt: "2026-11-16T12:00:00.000Z",
  archivedAt: null,
});
async function setup() {
  const batch = await parseLocationBatch(encode(source())),
    storage = new MemoryStorage();
  let business = initial(),
    account = { id: actor, role: "owner", emailVerified: true, approval: "approved" };
  const writes: { id: string; version: number; point: unknown }[] = [];
  let mode = "normal";
  const api: LocationBatchApi = {
    async account() {
      return structuredClone(account);
    },
    async read() {
      return structuredClone(business);
    },
    async update(id, version, point) {
      writes.push({ id, version, point });
      const journal = loadLocationBatchJournal(storage, actor, batch);
      assert.equal(journal.pending?.id, id, "intent persisted before dispatch");
      if (mode === "lost-before") throw new TypeError("Lost response before dispatch");
      if (version !== business.version) throw new AdminRequestError(409);
      business = {
        ...business,
        ...point,
        version: version + 1,
        updatedAt: "2026-11-17T12:01:00.000Z",
      };
      if (mode === "lost-after" || mode === "lost-changed") {
        if (mode === "lost-changed") business.description = "Concurrent unexpected change";
        throw new TypeError("Lost response after commit");
      }
      return structuredClone(business);
    },
  };
  const options = { api, actor, batch, storage, signal: new AbortController().signal };
  return {
    ...options,
    writes,
    options,
    current: () => structuredClone(business),
    change: (patch: Partial<DirectoryBusiness>) => {
      business = { ...business, ...patch };
    },
    mode: (value: string) => {
      mode = value;
    },
    account: (patch: Partial<typeof account>) => {
      account = { ...account, ...patch };
    },
  };
}
test("bounded exact schema rejects arbitrary requests, personal fields, duplicates and uncertain points", async () => {
  const batch = await parseLocationBatch(encode(source()));
  assert.equal(batch.records.length, 1);
  for (const transform of [
    (s: ReturnType<typeof source>) => Object.assign(s, { url: "https://evil.invalid/" }),
    (s: ReturnType<typeof source>) => Object.assign(s.records[0] ?? {}, { ownerId: "different" }),
    (s: ReturnType<typeof source>) => {
      firstRow(s).expectedLatitude = 4 as unknown as null;
    },
    (s: ReturnType<typeof source>) => {
      firstRow(s).proposed.latitude = Infinity;
    },
    (s: ReturnType<typeof source>) => {
      firstRow(s).provenance.osmId = "https://evil.invalid/";
    },
    (s: ReturnType<typeof source>) => {
      firstRow(s).title = "<script>unsafe</script>";
    },
    (s: ReturnType<typeof source>) => {
      s.records.push(firstRow(s));
    },
    (s: ReturnType<typeof source>) => {
      s.records = Array.from({ length: 33 }, () => firstRow(s));
    },
  ]) {
    const data = source();
    transform(data);
    await assert.rejects(parseLocationBatch(encode(data)), rejectCode("INVALID_FILE"));
  }
  await assert.rejects(parseLocationBatch(new Uint8Array(65537)), rejectCode("INVALID_FILE"));
  await assert.rejects(parseLocationBatch(new Uint8Array([255])), rejectCode("INVALID_FILE"));
  const zero = source();
  firstRow(zero).proposed = { latitude: 0, longitude: 0 };
  assert.equal((await parseLocationBatch(encode(zero))).records[0]?.proposed.latitude, 0);
});
test("explicit preview only reads; apply preserves every field and status, increments one version, and never repeats a completed update", async () => {
  const s = await setup();
  const before = s.current();
  const preview = await previewLocationBatch({
    ...s.options,
    journal: loadLocationBatchJournal(s.storage, actor, s.batch),
  });
  assert.equal(preview[0]?.state, "ready");
  assert.equal(s.writes.length, 0);
  const journal = await runLocationBatch(s.options);
  assert.equal(journal.done.length, 1);
  assert.equal(journal.pending, null);
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.current(), {
    ...before,
    latitude: 44.5,
    longitude: 18.5,
    version: 8,
    updatedAt: "2026-11-17T12:01:00.000Z",
  });
  await runLocationBatch(s.options);
  assert.equal(s.writes.length, 1);
});
test("any identity, address or pre-existing point drift stops before dispatch", async () => {
  for (const patch of [
    { ownerId: "other" },
    { title: "Changed" },
    { addressLine: "Changed" },
    { city: "Changed" },
    { countryCode: "DE" },
    { latitude: 0, longitude: 0 },
  ]) {
    const s = await setup();
    s.change(patch);
    await assert.rejects(runLocationBatch(s.options), rejectCode("BUSINESS_CHANGED"));
    assert.equal(s.writes.length, 0);
  }
});
test("ineligible or changed signed actor stops before writes; aborted job never dispatches", async () => {
  for (const patch of [
    { id: "other" },
    { role: "member" },
    { emailVerified: false },
    { approval: "suspended" },
  ]) {
    const s = await setup();
    s.account(patch);
    await assert.rejects(runLocationBatch(s.options), rejectCode("ACTOR_CHANGED"));
    assert.equal(s.writes.length, 0);
  }
  const s = await setup(),
    stop = new AbortController();
  stop.abort();
  await assert.rejects(
    runLocationBatch({ ...s.options, signal: stop.signal }),
    rejectCode("STOPPED"),
  );
  assert.equal(s.writes.length, 0);
});
test("a lost committed reply is reconciled from one exact successor read, with no second write", async () => {
  const s = await setup();
  s.mode("lost-after");
  const result = await runLocationBatch(s.options);
  assert.equal(result.done.length, 1);
  assert.equal(s.writes.length, 1);
});
test("lost uncommitted reply remains pending across reload; repeated recovery only reads and never blindly resends", async () => {
  const s = await setup();
  s.mode("lost-before");
  await assert.rejects(runLocationBatch(s.options), rejectCode("UNCONFIRMED"));
  assert.equal(s.writes.length, 1);
  assert.ok(loadLocationBatchJournal(s.storage, actor, s.batch).pending);
  await assert.rejects(runLocationBatch(s.options), rejectCode("UNCONFIRMED"));
  assert.equal(s.writes.length, 1);
});
test("same successor version with changed fields is not accepted as our receipt", async () => {
  const s = await setup();
  s.mode("lost-changed");
  await assert.rejects(runLocationBatch(s.options), rejectCode("UNCONFIRMED"));
  assert.equal(s.writes.length, 1);
  assert.ok(loadLocationBatchJournal(s.storage, actor, s.batch).pending);
});
test("journal corruption, different file and durable storage failure block new writes", async () => {
  const s = await setup();
  s.storage.setItem(locationBatchKey(actor), "{}");
  assert.throws(
    () => loadLocationBatchJournal(s.storage, actor, s.batch),
    rejectCode("INVALID_JOURNAL"),
  );
  s.storage.removeItem(locationBatchKey(actor));
  await runLocationBatch(s.options);
  assert.throws(
    () => loadLocationBatchJournal(s.storage, actor, { ...s.batch, sha256: "b".repeat(64) }),
    rejectCode("DIFFERENT_BATCH"),
  );
  const fresh = await setup();
  await assert.rejects(
    runLocationBatch({
      ...fresh.options,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw Error("No quota");
        },
        removeItem: () => {},
      },
    }),
    rejectCode("STORAGE_UNAVAILABLE"),
  );
  assert.equal(fresh.writes.length, 0);
});
test("client constructs only fixed same-origin GET/PATCH paths with actor binding and coordinates-only body", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const client = locationBatchClient(
    actor,
    new AbortController().signal,
    async (path, init = {}) => {
      calls.push({ path, init });
      return Response.json(
        path === "/api/account" ? { account: { id: actor } } : { business: initial() },
      );
    },
  );
  await client.account();
  await client.read(id);
  await client.update(id, 7, { latitude: 44.5, longitude: 18.5 });
  assert.deepEqual(
    calls.map((c) => c.path),
    ["/api/account", `/api/directory/mine/${id}`, `/api/directory/mine/${id}`],
  );
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("X-AhiBizz-Account-ID"), actor);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.mode, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
  }
  assert.equal(calls[2]?.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[2]?.init.body)), {
    expectedVersion: 7,
    latitude: 44.5,
    longitude: 18.5,
  });
  await assert.rejects(client.read("https://evil.invalid/"));
  assert.equal(calls.length, 3);
});
test("actor-bound journal cannot be reused under a different signed actor", async () => {
  const s = await setup();
  await runLocationBatch(s.options);
  const raw = s.storage.getItem(locationBatchKey(actor));
  assert.ok(raw);
  const j = JSON.parse(raw) as LocationBatchJournal;
  j.actor = "other";
  s.storage.setItem(locationBatchKey(actor), JSON.stringify(j));
  assert.throws(
    () => loadLocationBatchJournal(s.storage, actor, s.batch),
    rejectCode("INVALID_JOURNAL"),
  );
});
test("explicit retirement permits a new file only after every recorded update is complete", async () => {
  const s = await setup();
  assert.throws(
    () => retireLocationBatch(s.storage, actor, s.batch),
    rejectCode("BATCH_INCOMPLETE"),
  );
  await runLocationBatch(s.options);
  retireLocationBatch(s.storage, actor, s.batch);
  assert.equal(s.storage.getItem(locationBatchKey(actor)), null);
});
test("write access denial remains visible to the component and never starts recovery reads", async () => {
  const s = await setup();
  let reads = 0;
  const api = {
    ...s.api,
    async read(id: string) {
      reads++;
      return s.api.read(id);
    },
    async update() {
      throw new AdminRequestError(403);
    },
  };
  await assert.rejects(
    runLocationBatch({ ...s.options, api }),
    (error: unknown) => error instanceof AdminRequestError && error.status === 403,
  );
  assert.equal(reads, 1);
  assert.ok(loadLocationBatchJournal(s.storage, actor, s.batch).pending);
});
