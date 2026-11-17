import {
  type AdminRequest,
  AdminRequestError,
  adminActorRequest,
  record,
  responseData,
} from "../components/admin/responses";
import type { DirectoryBusiness } from "../server/directory/types";
import { businessKeys, uuid } from "../server/directory/validation";
import { type ImportStorage, importActor } from "./business-import";
import { readImportBusiness } from "./business-import-client";
import { isLocationPoint, type LocationPoint } from "./business-location";

export class LocationBatchError extends Error {}
function fail(code: string): never {
  throw new LocationBatchError(code);
}
const hashPattern = /^[a-f0-9]{64}$/;
const maxFile = 65536;
export type LocationBatchRow = {
  id: string;
  title: string;
  addressLine: string;
  city: string;
  countryCode: string;
  expectedLatitude: null;
  expectedLongitude: null;
  proposed: LocationPoint;
  provenance: {
    provider: "Photon/OpenStreetMap";
    kind: "address-building";
    osmType: "N" | "W" | "R";
    osmId: string;
    checkedUtc: string;
    responseSha256: string;
  };
};
export type LocationBatch = { sha256: string; records: LocationBatchRow[] };
export type LocationBatchApi = {
  account(): Promise<unknown>;
  read(id: string): Promise<DirectoryBusiness>;
  update(id: string, version: number, point: LocationPoint): Promise<DirectoryBusiness>;
};
type Receipt = { id: string; version: number; afterHash: string };
export type LocationBatchJournal = {
  schema: 1;
  actor: string;
  fileHash: string;
  done: Receipt[];
  pending: (Receipt & { beforeHash: string }) | null;
};
export type LocationBatchPreview = {
  id: string;
  version: number;
  state: "ready" | "done" | "pending";
};
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("INVALID_FILE");
  return value;
}
function plain(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value !== value.trim() ||
    value.length > max ||
    /[<>\u202a-\u202e\u2066-\u2069]/u.test(value) ||
    [...value].some((c) => {
      const code = c.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    fail("INVALID_FILE");
  return value;
}
async function digest(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function parseLocationBatch(raw: Uint8Array): Promise<LocationBatch> {
  if (!raw.length || raw.length > maxFile) fail("INVALID_FILE");
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    fail("INVALID_FILE");
  }
  const root = exact(input, ["format", "version", "records"]);
  if (
    root.format !== "ahibizz-reviewed-business-locations" ||
    root.version !== 1 ||
    !Array.isArray(root.records) ||
    root.records.length < 1 ||
    root.records.length > 32
  )
    fail("INVALID_FILE");
  const ids = new Set<string>();
  const rows = root.records.map((value): LocationBatchRow => {
    const row = exact(value, [
      "id",
      "title",
      "addressLine",
      "city",
      "countryCode",
      "expectedLatitude",
      "expectedLongitude",
      "proposed",
      "provenance",
    ]);
    let id: string;
    try {
      id = uuid(row.id);
    } catch {
      return fail("INVALID_FILE");
    }
    if (ids.has(id)) fail("INVALID_FILE");
    ids.add(id);
    const countryCode = plain(row.countryCode, 2);
    exact(row.proposed, ["latitude", "longitude"]);
    if (
      !/^[A-Z]{2}$/.test(countryCode) ||
      row.expectedLatitude !== null ||
      row.expectedLongitude !== null ||
      !isLocationPoint(row.proposed)
    )
      fail("INVALID_FILE");
    const provenance = exact(row.provenance, [
      "provider",
      "kind",
      "osmType",
      "osmId",
      "checkedUtc",
      "responseSha256",
    ]);
    if (
      provenance.provider !== "Photon/OpenStreetMap" ||
      provenance.kind !== "address-building" ||
      !["N", "W", "R"].includes(String(provenance.osmType)) ||
      typeof provenance.osmId !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(provenance.osmId) ||
      typeof provenance.checkedUtc !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(provenance.checkedUtc) ||
      !Number.isFinite(Date.parse(provenance.checkedUtc)) ||
      new Date(provenance.checkedUtc).toISOString() !== provenance.checkedUtc ||
      typeof provenance.responseSha256 !== "string" ||
      !hashPattern.test(provenance.responseSha256)
    )
      fail("INVALID_FILE");
    return {
      id,
      title: plain(row.title, 120),
      addressLine: plain(row.addressLine, 200),
      city: plain(row.city, 100),
      countryCode,
      expectedLatitude: null,
      expectedLongitude: null,
      proposed: { latitude: row.proposed.latitude, longitude: row.proposed.longitude },
      provenance: provenance as LocationBatchRow["provenance"],
    };
  });
  return { sha256: await digest(raw), records: rows };
}
export function locationBatchKey(actor: string): string {
  return `ahibizz:business-location-batch:v1:${actor}`;
}
function version(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) < 2147483647;
}
function writeJournal(storage: ImportStorage, journal: LocationBatchJournal) {
  try {
    const raw = JSON.stringify(journal);
    storage.setItem(locationBatchKey(journal.actor), raw);
    if (storage.getItem(locationBatchKey(journal.actor)) !== raw) fail("STORAGE_UNAVAILABLE");
  } catch {
    fail("STORAGE_UNAVAILABLE");
  }
}
export function loadLocationBatchJournal(
  storage: ImportStorage,
  actor: string,
  batch: LocationBatch,
): LocationBatchJournal {
  let raw: string | null;
  try {
    raw = storage.getItem(locationBatchKey(actor));
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }
  if (raw === null) return { schema: 1, actor, fileHash: batch.sha256, done: [], pending: null };
  try {
    if (raw.length > 16384) fail("INVALID_JOURNAL");
    const j = exact(JSON.parse(raw), ["schema", "actor", "fileHash", "done", "pending"]);
    if (j.schema !== 1 || j.actor !== actor || !Array.isArray(j.done)) fail("INVALID_JOURNAL");
    if (j.fileHash !== batch.sha256) fail("DIFFERENT_BATCH");
    const ids = new Set(batch.records.map((r) => r.id));
    const seen = new Set<string>();
    for (const value of [...j.done, ...(j.pending === null ? [] : [j.pending])]) {
      const pending = value === j.pending;
      const r = exact(
        value,
        pending ? ["id", "version", "afterHash", "beforeHash"] : ["id", "version", "afterHash"],
      );
      if (
        typeof r.id !== "string" ||
        !ids.has(r.id) ||
        seen.has(r.id) ||
        !version(r.version) ||
        typeof r.afterHash !== "string" ||
        !hashPattern.test(r.afterHash) ||
        (pending && (typeof r.beforeHash !== "string" || !hashPattern.test(r.beforeHash)))
      )
        fail("INVALID_JOURNAL");
      seen.add(r.id);
    }
    if (j.done.length > batch.records.length) fail("INVALID_JOURNAL");
    return j as LocationBatchJournal;
  } catch (error) {
    if (error instanceof LocationBatchError && error.message === "DIFFERENT_BATCH") throw error;
    return fail("INVALID_JOURNAL");
  }
}
export function retireLocationBatch(storage: ImportStorage, actor: string, batch: LocationBatch) {
  const journal = loadLocationBatchJournal(storage, actor, batch);
  if (journal.pending || journal.done.length !== batch.records.length) fail("BATCH_INCOMPLETE");
  try {
    storage.removeItem(locationBatchKey(actor));
    if (storage.getItem(locationBatchKey(actor)) !== null) fail("STORAGE_UNAVAILABLE");
  } catch {
    fail("STORAGE_UNAVAILABLE");
  }
}
function stopped(signal: AbortSignal) {
  if (signal.aborted) fail("STOPPED");
}
async function requireActor(api: LocationBatchApi, actor: string, signal: AbortSignal) {
  stopped(signal);
  if (!importActor(await api.account(), actor)) fail("ACTOR_CHANGED");
  stopped(signal);
}
function identity(current: DirectoryBusiness, row: LocationBatchRow, actor: string) {
  if (
    current.id !== row.id ||
    current.ownerId !== actor ||
    current.title !== row.title ||
    current.addressLine !== row.addressLine ||
    current.city !== row.city ||
    current.countryCode !== row.countryCode
  )
    fail("BUSINESS_CHANGED");
}
/** Hash all writable fields and immutable/status metadata; derived media and update time may change. */
async function businessHash(current: DirectoryBusiness): Promise<string> {
  return digest(
    new TextEncoder().encode(
      JSON.stringify([
        current.id,
        current.ownerId,
        current.status,
        current.verified,
        current.featured,
        current.createdAt,
        current.publishedAt,
        current.archivedAt,
        ...businessKeys.map((key) => current[key]),
      ]),
    ),
  );
}
async function verifyReceipt(current: DirectoryBusiness, receipt: Receipt) {
  if (
    current.version !== receipt.version + 1 ||
    (await businessHash(current)) !== receipt.afterHash
  )
    fail("UNCONFIRMED");
}
export async function previewLocationBatch({
  api,
  actor,
  batch,
  journal,
  signal,
}: {
  api: LocationBatchApi;
  actor: string;
  batch: LocationBatch;
  journal: LocationBatchJournal;
  signal: AbortSignal;
}): Promise<LocationBatchPreview[]> {
  await requireActor(api, actor, signal);
  const result: LocationBatchPreview[] = [];
  for (const row of batch.records) {
    stopped(signal);
    const current = await api.read(row.id);
    stopped(signal);
    identity(current, row, actor);
    const done = journal.done.find((r) => r.id === row.id);
    if (done) await verifyReceipt(current, done);
    else if (
      journal.pending?.id !== row.id &&
      (current.latitude !== null || current.longitude !== null)
    )
      fail("BUSINESS_CHANGED");
    result.push({
      id: row.id,
      version: current.version,
      state: done ? "done" : journal.pending?.id === row.id ? "pending" : "ready",
    });
  }
  await requireActor(api, actor, signal);
  return result;
}
export async function runLocationBatch({
  api,
  actor,
  batch,
  storage,
  signal,
  onProgress,
}: {
  api: LocationBatchApi;
  actor: string;
  batch: LocationBatch;
  storage: ImportStorage;
  signal: AbortSignal;
  onProgress?: (journal: LocationBatchJournal) => void;
}): Promise<LocationBatchJournal> {
  await requireActor(api, actor, signal);
  const journal = loadLocationBatchJournal(storage, actor, batch);
  const persist = () => {
    writeJournal(storage, journal);
    onProgress?.(structuredClone(journal));
  };
  persist();
  if (journal.pending) {
    const pending = journal.pending;
    const row = batch.records.find((r) => r.id === pending.id);
    if (!row) fail("INVALID_JOURNAL");
    const current = await api.read(row.id);
    stopped(signal);
    identity(current, row, actor);
    await verifyReceipt(current, pending);
    journal.done.push({ id: pending.id, version: pending.version, afterHash: pending.afterHash });
    journal.pending = null;
    persist();
  }
  for (const row of batch.records) {
    await requireActor(api, actor, signal);
    const current = await api.read(row.id);
    stopped(signal);
    identity(current, row, actor);
    const done = journal.done.find((r) => r.id === row.id);
    if (done) {
      await verifyReceipt(current, done);
      continue;
    }
    if (current.latitude !== null || current.longitude !== null) fail("BUSINESS_CHANGED");
    const next = { ...current, ...row.proposed };
    const pending = {
      id: row.id,
      version: current.version,
      beforeHash: await businessHash(current),
      afterHash: await businessHash(next),
    };
    journal.pending = pending;
    persist(); // A durable actor/file-bound pending intent must precede dispatch.
    stopped(signal);
    let confirmed: DirectoryBusiness;
    try {
      confirmed = await api.update(row.id, current.version, row.proposed);
    } catch (error) {
      stopped(signal);
      if (error instanceof AdminRequestError && [401, 403].includes(error.status)) throw error;
      // No retry of a write. A fresh read may only recognize the one exact expected successor.
      await requireActor(api, actor, signal);
      confirmed = await api.read(row.id).catch(() => fail("UNCONFIRMED"));
      if (error instanceof LocationBatchError && error.message === "ACTOR_CHANGED") throw error;
    }
    stopped(signal);
    identity(confirmed, row, actor);
    await verifyReceipt(confirmed, pending);
    journal.done.push({ id: pending.id, version: pending.version, afterHash: pending.afterHash });
    journal.pending = null;
    persist();
  }
  await requireActor(api, actor, signal);
  return journal;
}
export function locationBatchClient(
  actor: string,
  signal: AbortSignal,
  transport?: AdminRequest,
): LocationBatchApi {
  const request = adminActorRequest(actor, transport);
  const read = async (path: string, init: RequestInit = {}) =>
    responseData(
      await request(path, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      }),
    );
  const mine = (id: string) => `/api/directory/mine/${uuid(id)}`;
  return {
    async account() {
      return (await read("/api/account")).account;
    },
    async read(id) {
      return readImportBusiness((await read(mine(id))).business);
    },
    async update(id, expectedVersion, point) {
      return readImportBusiness(
        (
          await read(mine(id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersion,
              latitude: point.latitude,
              longitude: point.longitude,
            }),
          })
        ).business,
      );
    },
  };
}
export async function browserLocationBatchLock(
  actor: string,
  signal: AbortSignal,
  action: () => Promise<void>,
) {
  stopped(signal);
  if (!navigator.locks) fail("LOCK_UNAVAILABLE");
  await navigator.locks.request(
    `ahibizz-business-location-batch:${actor}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      stopped(signal);
      if (!lock) fail("BATCH_RUNNING");
      await action();
    },
  );
}
