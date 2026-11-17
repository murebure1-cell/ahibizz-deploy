import { type ImportStorage, parseBusinessImport, sha256 } from "../../src/lib/business-import";
import type { ImportApi } from "../../src/lib/business-import-runner";
import type { BusinessMediaManifest, BusinessMediaReceipt } from "../../src/lib/business-media";
import type {
  BusinessFields,
  DirectoryBusiness,
  DirectoryCategory,
} from "../../src/server/directory/types";

export const fixtureActor = "fixture-approved-owner";
export const fixtureAccount = {
  id: fixtureActor,
  role: "owner",
  approval: "approved",
  emailVerified: true,
};
export const fixtureCategory: DirectoryCategory = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Servisi",
  slug: "servisi",
  parentId: null,
};
export const fixtureSource = "11111111-1111-4111-8111-111111111111";
export const secondSource = "11111111-1111-4111-8111-111111111112";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
export async function importFixtureData({
  logo = false,
  title = "Probni javni servis",
  sourceId = fixtureSource,
  category = "Servisi",
  subcategory = null as string | null,
} = {}) {
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  return {
    format: "ahibizz-business-import",
    version: 1,
    sourceArchiveSha256: "a".repeat(64),
    records: [
      {
        sourceId,
        business: {
          title,
          description: "Javni opis servisa.",
          contactEmail: "servis@example.invalid",
          contactPhone: null,
          websiteUrl: null,
          addressLine: null,
          city: "Tuzla",
          countryCode: "BA",
          latitude: null,
          longitude: null,
        },
        category: { name: category, subcategory },
        logo: logo ? { contentType: "image/png", base64: png, sha256: await sha256(bytes) } : null,
      },
    ],
  };
}
export function encodeFixture(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}
export async function importFixture(options: Parameters<typeof importFixtureData>[0] = {}) {
  return parseBusinessImport(encodeFixture(await importFixtureData(options)));
}
export class ImportMemoryStorage implements ImportStorage {
  values = new Map<string, string>();
  writes = 0;
  failAt = Infinity;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    if (++this.writes >= this.failAt) throw new Error("isolated storage failure");
    this.values.set(key, value);
  }
}
export class ImportMemoryApi implements ImportApi {
  actor: unknown = fixtureAccount;
  rows = new Map<string, DirectoryBusiness>();
  cats: DirectoryCategory[] = [structuredClone(fixtureCategory)];
  creates = new Map<string, { fields: string; id: string }>();
  media = new Map<string, BusinessMediaManifest>();
  mediaReceipts = new Map<string, { fingerprint: string; receipt: BusinessMediaReceipt }>();
  calls: { kind: string; value: unknown }[] = [];
  lost: "create" | "logo" | "publish" | "category" | null = null;
  noCommit = false;
  sequence = 0;
  account() {
    return Promise.resolve(structuredClone(this.actor));
  }
  categories() {
    return Promise.resolve(structuredClone(this.cats));
  }
  inventory(page: number, archived: boolean) {
    this.calls.push({ kind: "inventory", value: { page, archived } });
    const rows = [...this.rows.values()].filter((r) => (r.status === "archived") === archived);
    return Promise.resolve({
      items: structuredClone(rows.slice((page - 1) * 20, page * 20)),
      page,
      hasMore: rows.length > page * 20,
    });
  }
  id() {
    return `bbbbbbbb-bbbb-4bbb-8bbb-${String(++this.sequence).padStart(12, "0")}`;
  }
  lostResponse(kind: NonNullable<ImportMemoryApi["lost"]>) {
    if (this.lost === kind) {
      this.lost = null;
      throw new Error(`isolated lost ${kind} response`);
    }
  }
  createCategory(input: { name: string; slug: string; parentId: string | null }) {
    this.calls.push({ kind: "category", value: structuredClone(input) });
    const row = { id: this.id(), ...input };
    if (!this.noCommit) this.cats.push(row);
    this.lostResponse("category");
    return Promise.resolve(structuredClone(row));
  }
  create(fields: BusinessFields, key: string) {
    this.calls.push({ kind: "create", value: { key, fields: structuredClone(fields) } });
    const receipt = this.creates.get(key);
    if (receipt) {
      if (receipt.fields !== JSON.stringify(fields))
        throw new Error("fixture idempotency conflict");
      return this.read(receipt.id);
    }
    const row: DirectoryBusiness = {
      ...fields,
      id: this.id(),
      ownerId: fixtureActor,
      status: "draft",
      version: 1,
      verified: false,
      featured: false,
      createdAt: "2026-11-17T12:00:00.000Z",
      updatedAt: "2026-11-17T12:00:00.000Z",
      publishedAt: null,
      archivedAt: null,
    };
    if (!this.noCommit) {
      this.rows.set(row.id, row);
      this.creates.set(key, { fields: JSON.stringify(fields), id: row.id });
    }
    this.lostResponse("create");
    return Promise.resolve(structuredClone(row));
  }
  read(id: string) {
    const row = this.rows.get(id);
    if (!row) return Promise.reject(new Error("fixture business not found"));
    return Promise.resolve(structuredClone(row));
  }
  publish(id: string, version: number) {
    this.calls.push({ kind: "publish", value: { id, version } });
    const row = this.rows.get(id);
    if (!row || row.version !== version || row.status !== "draft")
      throw new Error("fixture version conflict");
    const next = {
      ...row,
      status: "published" as const,
      version: version + 1,
      publishedAt: "2026-11-17T12:01:00.000Z",
    };
    if (!this.noCommit) this.rows.set(id, next);
    this.lostResponse("publish");
    return Promise.resolve(structuredClone(next));
  }
  manifest(id: string) {
    const row = this.media.get(id);
    if (!row) return Promise.reject(new Error("fixture manifest not found"));
    return Promise.resolve(structuredClone(row));
  }
  async logo(
    id: string,
    version: number,
    key: string,
    logo: { contentType: string; bytes: Uint8Array; sha256: string },
  ) {
    const fingerprint = JSON.stringify({
      id,
      version,
      hash: await sha256(logo.bytes),
      type: logo.contentType,
    });
    this.calls.push({ kind: "logo", value: { id, version, key, hash: logo.sha256 } });
    const existing = this.mediaReceipts.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("fixture media receipt conflict");
      return structuredClone(existing.receipt);
    }
    const row = this.rows.get(id);
    if (!row || row.version !== version) throw new Error("fixture media version conflict");
    const receipt: BusinessMediaReceipt = {
      businessId: id,
      businessVersion: version + 1,
      status: "draft",
      kind: "logo",
      slot: 0,
      mediaVersion: version + 1,
    };
    this.rows.set(id, { ...row, version: version + 1 });
    this.media.set(id, {
      businessId: id,
      businessVersion: version + 1,
      status: "draft",
      logo: { kind: "logo", slot: 0, version: version + 1, width: 512, height: 512 },
      cover: null,
      gallery: [],
    });
    this.mediaReceipts.set(key, { fingerprint, receipt });
    this.lostResponse("logo");
    return structuredClone(receipt);
  }
}
