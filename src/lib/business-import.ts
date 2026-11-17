import type { BusinessFields } from "../server/directory/types";
import { businessInput, completeFields, object, text, uuid } from "../server/directory/validation";

const placeholder = "11111111-1111-4111-8111-111111111111";
const publicKeys = [
  "title",
  "description",
  "contactEmail",
  "contactPhone",
  "websiteUrl",
  "addressLine",
  "city",
  "countryCode",
  "latitude",
  "longitude",
] as const;
export type ImportPublicFields = Omit<BusinessFields, "categoryId" | "subcategoryId">;
export type ImportLogo = { contentType: string; bytes: Uint8Array; sha256: string };
export type ImportRecord = {
  sourceId: string;
  business: ImportPublicFields;
  category: { name: string; subcategory: string | null };
  logo: ImportLogo | null;
};
export type ImportFile = { hash: string; archiveHash: string; records: ImportRecord[] };
export const importLimits = {
  file: 12 * 1024 * 1024,
  image: 4 * 1024 * 1024,
  images: 8 * 1024 * 1024,
  rows: 50,
  journal: 160 * 1024,
  inventory: 1000,
};
export class BusinessImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function importFail(code: string): never {
  throw new BusinessImportError(code);
}
export function importName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("bs").replace(/\s+/gu, " ");
}
export function importHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) importFail("INVALID_FILE");
  return value;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function bodyHash(value: BusinessFields): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(value)));
}
function exact(value: unknown, keys: readonly string[]) {
  const result = object(value, keys);
  if (keys.some((key) => !Object.hasOwn(result, key))) importFail("INVALID_FILE");
  return result;
}
function imageMagic(bytes: Uint8Array, type: string): boolean {
  if (type === "image/png")
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    type === "image/webp" &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  );
}
/** A reviewed public-only file, never the raw preregistration archive or account export. */
export async function parseBusinessImport(raw: Uint8Array): Promise<ImportFile> {
  if (!raw.length || raw.length > importLimits.file) importFail("FILE_TOO_LARGE");
  const bytes = new Uint8Array(raw);
  try {
    const input = exact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), [
      "format",
      "version",
      "sourceArchiveSha256",
      "records",
    ]);
    if (
      input.format !== "ahibizz-business-import" ||
      input.version !== 1 ||
      !Array.isArray(input.records) ||
      !input.records.length ||
      input.records.length > importLimits.rows
    )
      importFail("INVALID_FILE");
    const archiveHash = importHash(input.sourceArchiveSha256),
      records: ImportRecord[] = [];
    let imageBytes = 0;
    for (const entry of input.records) {
      const row = exact(entry, ["sourceId", "business", "category", "logo"]),
        sourceId = uuid(row.sourceId);
      const fields = completeFields(
        businessInput(
          { ...exact(row.business, publicKeys), categoryId: placeholder, subcategoryId: null },
          true,
        ) as BusinessFields,
      );
      const { categoryId: _category, subcategoryId: _subcategory, ...business } = fields;
      const category = exact(row.category, ["name", "subcategory"]);
      const name = text(category.name, 80) as string,
        subcategory = text(category.subcategory, 80, true);
      if (subcategory && importName(name) === importName(subcategory)) importFail("INVALID_FILE");
      let logo: ImportLogo | null = null;
      if (row.logo !== null) {
        const image = exact(row.logo, ["contentType", "base64", "sha256"]);
        if (
          typeof image.contentType !== "string" ||
          !["image/jpeg", "image/png", "image/webp"].includes(image.contentType) ||
          typeof image.base64 !== "string" ||
          image.base64.length > Math.ceil(importLimits.image / 3) * 4 ||
          image.base64.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)
        )
          importFail("INVALID_FILE");
        const binary = atob(image.base64),
          data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        if (btoa(binary) !== image.base64) importFail("INVALID_IMAGE");
        imageBytes += data.length;
        if (
          !data.length ||
          data.length > importLimits.image ||
          imageBytes > importLimits.images ||
          !imageMagic(data, image.contentType) ||
          (await sha256(data)) !== importHash(image.sha256)
        )
          importFail("INVALID_IMAGE");
        logo = { contentType: image.contentType, bytes: data, sha256: image.sha256 as string };
      }
      records.push({ sourceId, business, category: { name, subcategory }, logo });
    }
    if (
      new Set(records.map((r) => r.sourceId)).size !== records.length ||
      new Set(records.map((r) => importName(r.business.title))).size !== records.length
    )
      importFail("DUPLICATE_RECORD");
    return { hash: await sha256(bytes), archiveHash, records };
  } catch (error) {
    if (error instanceof BusinessImportError) throw error;
    importFail("INVALID_FILE");
  }
}

export type ImportRowState = {
  sourceId: string;
  stage: "todo" | "created" | "logo" | "done" | "existing";
  id: string | null;
  version: number | null;
  categoryId: string | null;
  subcategoryId: string | null;
  bodyHash: string | null;
};
export type ImportPending =
  | { kind: "category"; name: string; slug: string; parentId: string | null }
  | { kind: "create" | "publish" | "logo"; sourceId: string; key: string; version: number };
export type ImportJournal = {
  format: 1;
  actor: string;
  fileHash: string;
  sourceIds: string[];
  baselineIds: string[];
  rows: ImportRowState[];
  pending: ImportPending | null;
};
export type ImportStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function importJournalKey(actor: string): string {
  return `ahibizz:business-import:v1:${actor}`;
}
export function importActor(value: unknown, expected: string): boolean {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    ["id", "role", "emailVerified", "approval"].every((k) => Object.hasOwn(a, k)) &&
    a.id === expected &&
    a.role === "owner" &&
    a.emailVerified === true &&
    a.approval === "approved" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(expected)
  );
}
function version(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) < 2147483647;
}
/** Persist only operation identifiers, versions and hashes. Logos and contact details stay in memory. */
export function saveImportJournal(storage: ImportStorage, value: ImportJournal) {
  const raw = JSON.stringify(value);
  if (raw.length > importLimits.journal) importFail("JOURNAL_TOO_LARGE");
  try {
    storage.setItem(importJournalKey(value.actor), raw);
    if (storage.getItem(importJournalKey(value.actor)) !== raw) importFail("STORAGE_UNAVAILABLE");
  } catch {
    importFail("STORAGE_UNAVAILABLE");
  }
}
export function loadImportJournal(
  storage: ImportStorage,
  actor: string,
  file: ImportFile,
): ImportJournal | null {
  let raw: string | null;
  try {
    raw = storage.getItem(importJournalKey(actor));
  } catch {
    importFail("STORAGE_UNAVAILABLE");
  }
  if (raw === null) return null;
  try {
    if (raw.length > importLimits.journal) importFail("INVALID_JOURNAL");
    const j = exact(JSON.parse(raw), [
      "format",
      "actor",
      "fileHash",
      "sourceIds",
      "baselineIds",
      "rows",
      "pending",
    ]);
    if (
      j.format !== 1 ||
      j.actor !== actor ||
      j.fileHash !== file.hash ||
      JSON.stringify(j.sourceIds) !== JSON.stringify(file.records.map((r) => r.sourceId))
    )
      importFail("DIFFERENT_IMPORT");
    if (
      !Array.isArray(j.baselineIds) ||
      j.baselineIds.length > importLimits.inventory ||
      new Set(j.baselineIds.map(uuid)).size !== j.baselineIds.length ||
      !Array.isArray(j.rows) ||
      j.rows.length !== file.records.length
    )
      importFail("INVALID_JOURNAL");
    for (const [i, entry] of j.rows.entries()) {
      const row = exact(entry, [
        "sourceId",
        "stage",
        "id",
        "version",
        "categoryId",
        "subcategoryId",
        "bodyHash",
      ]);
      if (
        row.sourceId !== file.records[i]?.sourceId ||
        typeof row.stage !== "string" ||
        !["todo", "created", "logo", "done", "existing"].includes(row.stage)
      )
        importFail("INVALID_JOURNAL");
      if (row.id !== null) uuid(row.id);
      if (row.version !== null && !version(row.version)) importFail("INVALID_JOURNAL");
      if (row.categoryId !== null) uuid(row.categoryId);
      if (row.subcategoryId !== null) uuid(row.subcategoryId);
      if (row.bodyHash !== null) importHash(row.bodyHash);
      if (
        ["created", "logo", "done"].includes(String(row.stage)) &&
        (!row.id ||
          !row.version ||
          !row.categoryId ||
          !row.bodyHash ||
          j.baselineIds.includes(row.id))
      )
        importFail("INVALID_JOURNAL");
      if (row.stage === "todo" && (row.id !== null || row.version !== null))
        importFail("INVALID_JOURNAL");
      if (row.stage === "existing" && (!row.id || !j.baselineIds.includes(row.id)))
        importFail("INVALID_JOURNAL");
    }
    if (j.pending !== null) {
      const p = j.pending as Record<string, unknown>;
      if (p.kind === "category") {
        exact(p, ["kind", "name", "slug", "parentId"]);
        text(p.name, 80);
        text(p.slug, 80);
        if (
          typeof p.slug !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ||
          (p.parentId !== null && uuid(p.parentId) !== p.parentId)
        )
          importFail("INVALID_JOURNAL");
        if (
          !file.records.some((r) => r.category.name === p.name || r.category.subcategory === p.name)
        )
          importFail("INVALID_JOURNAL");
      } else {
        exact(p, ["kind", "sourceId", "key", "version"]);
        if (
          typeof p.kind !== "string" ||
          !["create", "publish", "logo"].includes(p.kind) ||
          !(j.sourceIds as string[]).includes(p.sourceId as string) ||
          !version(p.version)
        )
          importFail("INVALID_JOURNAL");
        uuid(p.key);
        const row = j.rows.find((r) => r.sourceId === p.sourceId) as ImportRowState;
        if (
          p.kind === "create"
            ? row.stage !== "todo" ||
              p.key !== row.sourceId ||
              !row.bodyHash ||
              !row.categoryId ||
              p.version !== 1
            : !row.id ||
              row.version !== p.version ||
              (p.kind === "logo" ? row.stage !== "created" : row.stage !== "logo")
        )
          importFail("INVALID_JOURNAL");
      }
    }
    return j as ImportJournal;
  } catch (error) {
    if (error instanceof BusinessImportError) throw error;
    importFail("INVALID_JOURNAL");
  }
}

/** Explicit local retirement only after the exact original file proves every row terminal. */
export function retireCompletedImport(storage: ImportStorage, actor: string, file: ImportFile) {
  const current = loadImportJournal(storage, actor, file);
  if (
    !current ||
    current.pending ||
    !current.rows.length ||
    current.rows.some((row) => !["done", "existing"].includes(row.stage))
  )
    importFail("IMPORT_INCOMPLETE");
  try {
    storage.removeItem(importJournalKey(actor));
    if (storage.getItem(importJournalKey(actor)) !== null) importFail("STORAGE_UNAVAILABLE");
  } catch {
    importFail("STORAGE_UNAVAILABLE");
  }
}
