import {
  type AdminRequest,
  adminActorRequest,
  category,
  categoryList,
  record,
  responseData,
} from "../components/admin/responses";
import type { BusinessFields, DirectoryBusiness } from "../server/directory/types";
import { businessInput, completeFields, uuid } from "../server/directory/validation";
import { importFail } from "./business-import";
import type { ImportApi } from "./business-import-runner";
import { readBusinessMediaManifest, readBusinessMediaReceipt } from "./business-media";

export function readImportBusiness(value: unknown): DirectoryBusiness {
  if (!record(value)) importFail("INVALID_RESPONSE");
  const id = uuid(value.id);
  if (
    typeof value.ownerId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.ownerId) ||
    typeof value.status !== "string" ||
    !["draft", "pending", "published", "archived"].includes(value.status) ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    (value.version as number) >= 2147483647 ||
    typeof value.verified !== "boolean" ||
    typeof value.featured !== "boolean"
  )
    importFail("INVALID_RESPONSE");
  const fields = Object.fromEntries(
    [
      "title",
      "categoryId",
      "subcategoryId",
      "description",
      "contactEmail",
      "contactPhone",
      "websiteUrl",
      "addressLine",
      "city",
      "countryCode",
      "latitude",
      "longitude",
    ].map((k) => [k, value[k]]),
  );
  const normalized = completeFields(businessInput(fields, true) as BusinessFields);
  for (const key of Object.keys(normalized) as (keyof BusinessFields)[])
    if (value[key] !== normalized[key]) importFail("INVALID_RESPONSE");
  for (const key of ["createdAt", "updatedAt", "publishedAt", "archivedAt"])
    if (
      value[key] !== null &&
      (typeof value[key] !== "string" || !Number.isFinite(Date.parse(value[key])))
    )
      importFail("INVALID_RESPONSE");
  return { ...value, ...normalized, id } as DirectoryBusiness;
}

/** All paths are constructed here, never accepted from the selected file or local journal. */
export function businessImportClient(
  actor: string,
  signal: AbortSignal,
  transport?: AdminRequest,
): ImportApi {
  const request = adminActorRequest(actor, transport);
  const read = async (path: string, init: RequestInit = {}) =>
    responseData(await request(path, { ...init, signal }));
  const json = (body: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const mine = (id: string) => `/api/directory/mine/${uuid(id)}`;
  return {
    async account() {
      return (await read("/api/account")).account;
    },
    async categories() {
      return categoryList(await read("/api/directory/categories"));
    },
    async inventory(page, archived) {
      if (!Number.isInteger(page) || page < 1 || page > 50) importFail("INVALID_PAGE");
      const data = await read(
        `/api/directory/admin?page=${page}${archived ? "&status=archived" : ""}`,
      );
      if (
        !Array.isArray(data.items) ||
        data.items.length > 20 ||
        data.page !== page ||
        data.pageSize !== 20 ||
        typeof data.hasMore !== "boolean"
      )
        importFail("INVALID_RESPONSE");
      return { items: data.items.map(readImportBusiness), page, hasMore: data.hasMore };
    },
    async createCategory(input) {
      const data = await read("/api/directory/categories", json(input));
      if (!category(data.category)) importFail("INVALID_RESPONSE");
      return data.category;
    },
    async create(fields, key) {
      return readImportBusiness(
        (
          await read("/api/directory/mine", {
            ...json(fields),
            headers: { "Content-Type": "application/json", "Idempotency-Key": uuid(key) },
          })
        ).business,
      );
    },
    async read(id) {
      return readImportBusiness((await read(mine(id))).business);
    },
    async publish(id, version) {
      return readImportBusiness(
        (await read(`${mine(id)}/publish`, json({ expectedVersion: version }))).business,
      );
    },
    async manifest(id) {
      return readBusinessMediaManifest(
        (await read(`/api/business-media/mine/${uuid(id)}`)).manifest,
      );
    },
    async logo(id, version, key, logo) {
      return readBusinessMediaReceipt(
        (
          await read(`/api/business-media/mine/${uuid(id)}/logo/0`, {
            method: "PUT",
            headers: {
              "Content-Type": logo.contentType,
              "Idempotency-Key": uuid(key),
              "If-Match": `"${version}"`,
            },
            body: new Uint8Array(logo.bytes),
          })
        ).receipt,
      );
    },
  };
}
