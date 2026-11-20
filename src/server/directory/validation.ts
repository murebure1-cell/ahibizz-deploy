import { type BusinessFields, fail } from "./types";

export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    fail(400, "UNEXPECTED_FIELD");
  return input as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    fail(400, "INVALID_DIRECTORY_INPUT");
  return value.toLowerCase();
}
export function text(
  value: unknown,
  max: number,
  nullable = false,
  multiline = false,
): string | null {
  if (nullable && (value === null || value === "")) return null;
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > max ||
    [...value].some((c) => {
      const code = c.charCodeAt(0);
      return (
        (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
        code === 127 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    })
  )
    fail(400, "INVALID_DIRECTORY_INPUT");
  return value.trim();
}
export function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) >= 2147483647)
    fail(400, "INVALID_DIRECTORY_INPUT");
  return value as number;
}
export const businessKeys = [
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
] as const;
export function businessInput(
  input: unknown,
  create: boolean,
): Partial<BusinessFields> & { expectedVersion?: number } {
  const value = object(input, create ? businessKeys : [...businessKeys, "expectedVersion"]);
  if (create && (!Object.hasOwn(value, "title") || !Object.hasOwn(value, "categoryId")))
    fail(400, "INVALID_DIRECTORY_INPUT");
  if (!create && (Object.keys(value).length < 2 || !Object.hasOwn(value, "expectedVersion")))
    fail(400, "INVALID_DIRECTORY_INPUT");
  const result: Partial<BusinessFields> & { expectedVersion?: number } = {};
  for (const key of businessKeys) {
    if (!Object.hasOwn(value, key)) {
      if (create && key !== "title" && key !== "categoryId") Object.assign(result, { [key]: null });
      continue;
    }
    if (key === "categoryId" || key === "subcategoryId") {
      Object.assign(result, {
        [key]: key === "subcategoryId" && value[key] === null ? null : uuid(value[key]),
      });
      continue;
    }
    if (key === "latitude" || key === "longitude") {
      const v = value[key],
        bound = key === "latitude" ? 90 : 180;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < -bound || v > bound))
        fail(400, "INVALID_DIRECTORY_INPUT");
      Object.assign(result, { [key]: v });
      continue;
    }
    const limits = {
      title: 120,
      description: 4000,
      contactEmail: 254,
      contactPhone: 40,
      websiteUrl: 2048,
      addressLine: 200,
      city: 100,
      countryCode: 2,
    };
    let normalized = text(value[key], limits[key], key !== "title", key === "description");
    if (normalized && key === "contactEmail") {
      if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalized))
        fail(400, "INVALID_DIRECTORY_INPUT");
      normalized = normalized.toLowerCase();
    }
    if (normalized && key === "contactPhone" && !/^[+0-9][0-9 ().-]{3,39}$/.test(normalized))
      fail(400, "INVALID_DIRECTORY_INPUT");
    if (normalized && key === "countryCode") {
      if (!/^[a-z]{2}$/i.test(normalized)) fail(400, "INVALID_DIRECTORY_INPUT");
      normalized = normalized.toUpperCase();
    }
    if (normalized && key === "websiteUrl") {
      try {
        const url = new URL(normalized);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
          fail(400, "INVALID_DIRECTORY_INPUT");
        normalized = url.href;
      } catch {
        fail(400, "INVALID_DIRECTORY_INPUT");
      }
    }
    Object.assign(result, { [key]: normalized });
  }
  if (!create) result.expectedVersion = expectedVersion(value.expectedVersion);
  return result;
}
export function completeFields(value: BusinessFields): BusinessFields {
  if ((value.latitude === null) !== (value.longitude === null))
    fail(400, "INVALID_DIRECTORY_INPUT");
  return value;
}
export function versionInput(input: unknown): number {
  const value = object(input, ["expectedVersion"]);
  return expectedVersion(value.expectedVersion);
}
export function pageInput(input: unknown = {}, publicOnly = false) {
  const value = object(input, [
    "page",
    "pageSize",
    "categoryId",
    "subcategoryId",
    "status",
    "q",
    ...(publicOnly ? ["city", "latitude", "longitude", "radiusKm", "openNow"] : []),
  ]);
  const page = value.page ?? 1,
    pageSize = value.pageSize ?? 20;
  if (
    !Number.isInteger(page) ||
    (page as number) < 1 ||
    (page as number) > 500 ||
    ![20, 50].includes(pageSize as number)
  )
    fail(400, "INVALID_DIRECTORY_INPUT");
  if (
    value.status !== undefined &&
    !["draft", "pending", "published", "archived"].includes(value.status as string)
  )
    fail(400, "INVALID_DIRECTORY_INPUT");
  const q =
    value.q === undefined || (typeof value.q === "string" && value.q.trim() === "")
      ? null
      : text(value.q, 120);
  const city =
    value.city === undefined || (typeof value.city === "string" && value.city.trim() === "")
      ? null
      : text(value.city, 100);
  if (value.openNow !== undefined && typeof value.openNow !== "boolean")
    fail(400, "INVALID_DIRECTORY_INPUT");
  let nearby: { latitude: number; longitude: number; radiusKm: number } | null = null;
  if (["latitude", "longitude", "radiusKm"].some((key) => Object.hasOwn(value, key))) {
    if (
      typeof value.latitude !== "number" ||
      !Number.isFinite(value.latitude) ||
      value.latitude < -90 ||
      value.latitude > 90 ||
      typeof value.longitude !== "number" ||
      !Number.isFinite(value.longitude) ||
      value.longitude < -180 ||
      value.longitude > 180 ||
      typeof value.radiusKm !== "number" ||
      !Number.isFinite(value.radiusKm) ||
      value.radiusKm < 1 ||
      value.radiusKm > 50
    )
      fail(400, "INVALID_DIRECTORY_INPUT");
    nearby = { latitude: value.latitude, longitude: value.longitude, radiusKm: value.radiusKm };
  }
  return {
    page: page as number,
    pageSize: pageSize as number,
    categoryId: value.categoryId === undefined ? null : uuid(value.categoryId),
    subcategoryId: value.subcategoryId === undefined ? null : uuid(value.subcategoryId),
    status: value.status as string | undefined,
    q,
    city,
    openNow: value.openNow === true,
    nearby,
  };
}
