import { AdminRequestError, categorySlug } from "../components/admin/responses";
import type {
  BusinessFields,
  DirectoryBusiness,
  DirectoryCategory,
} from "../server/directory/types";
import {
  bodyHash,
  type ImportFile,
  type ImportJournal,
  type ImportPending,
  type ImportRecord,
  type ImportRowState,
  type ImportStorage,
  importActor,
  importFail,
  importLimits,
  importName,
  loadImportJournal,
  saveImportJournal,
} from "./business-import";
import type { BusinessMediaManifest, BusinessMediaReceipt } from "./business-media";
import { directoryMutationFieldsMatch } from "./directory-mutation-recovery";

export type ImportPage = { items: DirectoryBusiness[]; page: number; hasMore: boolean };
export type ImportApi = {
  account(): Promise<unknown>;
  categories(): Promise<DirectoryCategory[]>;
  inventory(page: number, archived: boolean): Promise<ImportPage>;
  createCategory(input: {
    name: string;
    slug: string;
    parentId: string | null;
  }): Promise<DirectoryCategory>;
  create(fields: BusinessFields, key: string): Promise<DirectoryBusiness>;
  read(id: string): Promise<DirectoryBusiness>;
  publish(id: string, version: number): Promise<DirectoryBusiness>;
  manifest(id: string): Promise<BusinessMediaManifest>;
  logo(
    id: string,
    version: number,
    key: string,
    logo: NonNullable<ImportRecord["logo"]>,
  ): Promise<BusinessMediaReceipt>;
};
export type ImportPreview = {
  categories: DirectoryCategory[];
  existing: { sourceId: string; id: string }[];
  missingCategories: string[];
};
function categoryMatch(categories: DirectoryCategory[], name: string, parentId: string | null) {
  const matches = categories.filter(
    (c) => c.parentId === parentId && importName(c.name) === importName(name),
  );
  if (matches.length > 1) importFail("CATEGORY_CONFLICT");
  return matches[0];
}
export async function readImportInventory(api: ImportApi): Promise<DirectoryBusiness[]> {
  const rows: DirectoryBusiness[] = [];
  for (const archived of [false, true]) {
    for (let page = 1; ; page++) {
      const result = await api.inventory(page, archived);
      if (
        result.page !== page ||
        new Set(result.items.map((r) => r.id)).size !== result.items.length ||
        result.items.some((r) => (r.status === "archived") !== archived) ||
        result.items.some((r) => rows.some((old) => old.id === r.id))
      )
        importFail("INVENTORY_CHANGED");
      rows.push(...result.items);
      if (
        rows.length > importLimits.inventory ||
        (result.hasMore && (!result.items.length || page >= 50))
      )
        importFail("INVENTORY_TOO_LARGE");
      if (!result.hasMore) break;
    }
  }
  return rows;
}
export async function previewBusinessImport(
  api: ImportApi,
  actor: string,
  file: ImportFile,
): Promise<ImportPreview> {
  if (!importActor(await api.account(), actor)) importFail("ACTOR_CHANGED");
  const categories = await api.categories(),
    inventory = await readImportInventory(api),
    missing = new Set<string>();
  const existing = file.records.flatMap((r) => {
    const root = categoryMatch(categories, r.category.name, null);
    if (!root) missing.add(r.category.name);
    if (
      r.category.subcategory &&
      (!root || !categoryMatch(categories, r.category.subcategory, root.id))
    )
      missing.add(`${r.category.name} / ${r.category.subcategory}`);
    const matches = inventory.filter((b) => importName(b.title) === importName(r.business.title));
    return matches.map((b) => ({ sourceId: r.sourceId, id: b.id }));
  });
  return { categories, existing, missingCategories: [...missing] };
}
export type ImportRunOptions = {
  api: ImportApi;
  actor: string;
  file: ImportFile;
  storage: ImportStorage;
  signal: AbortSignal;
  onProgress?: (journal: ImportJournal) => void;
};

/** One sequential batch. The UI also holds a browser lock across tabs of this actor. */
export async function runBusinessImport({
  api,
  actor,
  file,
  storage,
  signal,
  onProgress,
}: ImportRunOptions): Promise<ImportJournal> {
  const check = () => {
    if (signal.aborted) importFail("STOPPED");
  };
  const authorize = async () => {
    check();
    if (!importActor(await api.account(), actor)) importFail("ACTOR_CHANGED");
    check();
  };
  await authorize();
  let journal = loadImportJournal(storage, actor, file);
  const baseline = await readImportInventory(api);
  check();
  if (!journal) {
    journal = {
      format: 1,
      actor,
      fileHash: file.hash,
      sourceIds: file.records.map((r) => r.sourceId),
      baselineIds: baseline.map((r) => r.id),
      pending: null,
      rows: file.records.map((r) => {
        const found = baseline.find((b) => importName(b.title) === importName(r.business.title));
        return {
          sourceId: r.sourceId,
          stage: found ? "existing" : "todo",
          id: found?.id ?? null,
          version: null,
          categoryId: null,
          subcategoryId: null,
          bodyHash: null,
        };
      }),
    };
  }
  const j = journal;
  // Persist before the first write, including when storage is present but unwritable.
  const save = () => {
    check();
    saveImportJournal(storage, j);
    onProgress?.(structuredClone(j));
  };
  save();
  const fieldsFor = (r: ImportRecord, row: ImportRowState): BusinessFields => {
    if (!row.categoryId) importFail("INVALID_JOURNAL");
    return {
      categoryId: row.categoryId,
      subcategoryId: row.subcategoryId,
      ...r.business,
    };
  };
  const validateBusiness = (
    business: DirectoryBusiness,
    row: ImportRowState,
    fields: BusinessFields,
  ) => {
    if (
      business.ownerId !== actor ||
      j.baselineIds.includes(business.id) ||
      (row.id !== null && row.id !== business.id) ||
      !directoryMutationFieldsMatch(fields, business) ||
      business.verified ||
      business.featured
    )
      importFail("BUSINESS_CHANGED");
  };
  async function categoryFor(
    name: string,
    parent: DirectoryCategory | null,
  ): Promise<DirectoryCategory> {
    const list = await api.categories();
    check();
    const desired = { name, slug: categorySlug(name, parent?.slug), parentId: parent?.id ?? null };
    const found = categoryMatch(list, name, desired.parentId);
    if (j.pending?.kind === "category") {
      if (JSON.stringify(j.pending) !== JSON.stringify({ kind: "category", ...desired }))
        importFail("CATEGORY_CONFLICT");
      if (found) {
        if (found.slug !== desired.slug) importFail("CATEGORY_CONFLICT");
        j.pending = null;
        save();
        return found;
      }
      // Explicit resume: a fresh absent read permits only the exact persisted unique slug intent.
      if (list.some((c) => c.slug === desired.slug)) importFail("CATEGORY_CONFLICT");
    } else {
      if (found) return found;
      if (j.pending || list.some((c) => c.slug === desired.slug)) importFail("CATEGORY_CONFLICT");
    }
    await authorize();
    j.pending = { kind: "category", ...desired };
    save();
    let created: DirectoryCategory;
    try {
      created = await api.createCategory(desired);
    } catch (error) {
      check();
      if (error instanceof AdminRequestError && [401, 403].includes(error.status)) throw error;
      // A read may overtake a transaction. Retain this exact unique intent for explicit resume.
      const fresh = categoryMatch(await api.categories(), name, desired.parentId);
      check();
      if (fresh && fresh.slug === desired.slug) {
        j.pending = null;
        save();
        return fresh;
      }
      throw error;
    }
    check();
    if (
      created.name !== desired.name ||
      created.slug !== desired.slug ||
      created.parentId !== desired.parentId
    )
      importFail("CATEGORY_CONFLICT");
    j.pending = null;
    save();
    return created;
  }
  for (const [i, r] of file.records.entries()) {
    check();
    const row = j.rows[i] as ImportRowState;
    if (row.stage === "done" || row.stage === "existing") continue;
    if (j.pending?.kind === "category") {
      // Pending child creation must first resolve its already existing root without another write.
      const pending = j.pending;
      if (pending.name !== r.category.name && pending.name !== r.category.subcategory)
        importFail("CATEGORY_CONFLICT");
      const list = await api.categories();
      check();
      const parent = pending.parentId === null ? null : categoryMatch(list, r.category.name, null);
      if (pending.parentId !== null && parent?.id !== pending.parentId)
        importFail("CATEGORY_CONFLICT");
      await categoryFor(pending.name, parent ?? null);
    }
    const root = await categoryFor(r.category.name, null),
      sub = r.category.subcategory ? await categoryFor(r.category.subcategory, root) : null;
    if (
      row.categoryId !== null &&
      (row.categoryId !== root.id || row.subcategoryId !== (sub?.id ?? null))
    )
      importFail("CATEGORY_CONFLICT");
    row.categoryId = root.id;
    row.subcategoryId = sub?.id ?? null;
    const fields = fieldsFor(r, row),
      hash = await bodyHash(fields);
    check();
    if (row.bodyHash !== null && row.bodyHash !== hash) importFail("DIFFERENT_IMPORT");
    row.bodyHash = hash;
    if (row.stage === "todo") {
      // An unrelated profile created since the preview must never be overwritten or duplicated.
      if (
        baseline.some((b) => importName(b.title) === importName(r.business.title)) &&
        j.pending?.kind !== "create"
      )
        importFail("BUSINESS_EXISTS");
      if (j.pending && (j.pending.kind !== "create" || j.pending.sourceId !== r.sourceId))
        importFail("INVALID_JOURNAL");
      await authorize();
      j.pending = { kind: "create", sourceId: r.sourceId, key: r.sourceId, version: 1 };
      save();
      const created = await api.create(fields, r.sourceId);
      check();
      validateBusiness(created, row, fields);
      if (created.status !== "draft" || created.version !== 1) importFail("BUSINESS_CHANGED");
      row.id = created.id;
      row.version = created.version;
      row.stage = "created";
      j.pending = null;
      save();
    } else {
      // Re-establish server receipt provenance after reload; a local journal cannot authorize an ID.
      await authorize();
      const receipt = await api.create(fields, r.sourceId);
      check();
      validateBusiness(receipt, row, fields);
      if (receipt.version < (row.version as number)) importFail("BUSINESS_CHANGED");
    }
    const id = row.id as string;
    if (j.pending?.kind === "publish") {
      if (j.pending.sourceId !== r.sourceId) importFail("INVALID_JOURNAL");
      const fresh = await api.read(id);
      check();
      validateBusiness(fresh, row, fields);
      if (fresh.status === "published" && fresh.version === (row.version as number) + 1) {
        row.version = fresh.version;
        row.stage = "done";
        j.pending = null;
        save();
        continue;
      }
      if (fresh.status !== "draft" || fresh.version !== row.version) importFail("BUSINESS_CHANGED");
      // Explicit resume after a fresh same-version read: retry exactly this ID and CAS version.
      await authorize();
      save();
      let published: DirectoryBusiness;
      try {
        published = await api.publish(id, j.pending.version);
      } catch (error) {
        if (!(error instanceof AdminRequestError) || error.status !== 409) throw error;
        published = await api.read(id);
      }
      check();
      validateBusiness(published, row, fields);
      if (published.status !== "published" || published.version !== (row.version as number) + 1)
        importFail("BUSINESS_CHANGED");
      row.version = published.version;
      row.stage = "done";
      j.pending = null;
      save();
      continue;
    }
    if (row.stage === "created") {
      if (r.logo) {
        if (j.pending && (j.pending.kind !== "logo" || j.pending.sourceId !== r.sourceId))
          importFail("INVALID_JOURNAL");
        if (!j.pending) {
          const fresh = await api.read(id);
          check();
          validateBusiness(fresh, row, fields);
          if (fresh.status !== "draft" || fresh.version !== row.version)
            importFail("BUSINESS_CHANGED");
          j.pending = {
            kind: "logo",
            sourceId: r.sourceId,
            key: crypto.randomUUID(),
            version: row.version as number,
          };
          save();
        }
        await authorize();
        const pending = j.pending as Extract<
          ImportPending,
          { kind: "create" | "publish" | "logo" }
        >;
        const receipt = await api.logo(id, pending.version, pending.key, r.logo);
        check();
        const manifest = await api.manifest(id);
        check();
        if (
          receipt.businessId !== id ||
          receipt.kind !== "logo" ||
          receipt.slot !== 0 ||
          receipt.status !== "draft" ||
          receipt.businessVersion !== pending.version + 1 ||
          receipt.mediaVersion !== receipt.businessVersion ||
          manifest.businessId !== id ||
          manifest.status !== "draft" ||
          manifest.businessVersion !== receipt.businessVersion ||
          manifest.logo?.version !== receipt.mediaVersion
        )
          importFail("BUSINESS_CHANGED");
        row.version = receipt.businessVersion;
        j.pending = null;
      }
      row.stage = "logo";
      save();
    }
    const fresh = await api.read(id);
    check();
    validateBusiness(fresh, row, fields);
    if (fresh.status !== "draft" || fresh.version !== row.version) importFail("BUSINESS_CHANGED");
    await authorize();
    j.pending = {
      kind: "publish",
      sourceId: r.sourceId,
      key: r.sourceId,
      version: row.version as number,
    };
    save();
    // On any uncertain publish, retain the intent. A later run reads fresh state before continuing.
    const published = await api.publish(id, row.version as number);
    check();
    validateBusiness(published, row, fields);
    if (published.status !== "published" || published.version !== (row.version as number) + 1)
      importFail("BUSINESS_CHANGED");
    row.version = published.version;
    row.stage = "done";
    j.pending = null;
    save();
  }
  return structuredClone(j);
}
