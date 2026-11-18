export type BusinessMediaKind = "logo" | "cover" | "gallery";
export type BusinessMediaAsset = {
  kind: BusinessMediaKind;
  slot: number;
  version: number;
  width: number;
  height: number;
};
export type BusinessMediaSummary = {
  logo: BusinessMediaAsset | null;
  cover: BusinessMediaAsset | null;
  gallery: BusinessMediaAsset[];
};
export type BusinessMediaStatus = "draft" | "pending" | "published" | "archived";
export type PublicBusinessMediaManifest = BusinessMediaSummary & { businessId: string };
export type BusinessMediaManifest = PublicBusinessMediaManifest & {
  businessVersion: number;
  status: BusinessMediaStatus;
  pendingMedia?: true;
  approvedMedia?: BusinessMediaSummary;
};
export type BusinessMediaWriteResult = {
  businessId: string;
  businessVersion: number;
  status: BusinessMediaStatus;
  kind: BusinessMediaKind;
  slot: number;
  mediaVersion: number | null;
};
export type BusinessMediaReceipt = BusinessMediaWriteResult;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_business_media");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max = 2147483647): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function status(value: unknown): value is BusinessMediaStatus {
  return typeof value === "string" && ["draft", "pending", "published", "archived"].includes(value);
}
export function readBusinessMediaAsset(value: unknown): BusinessMediaAsset {
  const row = record(value);
  if (
    !["logo", "cover", "gallery"].includes(String(row.kind)) ||
    typeof row.kind !== "string" ||
    !integer(row.version, 1) ||
    !integer(row.width, 1, 1600) ||
    !integer(row.height, 1, 1200) ||
    !(row.kind === "gallery" ? integer(row.slot, 1, 8) : row.slot === 0) ||
    (row.kind === "logo" && (row.width !== 512 || row.height !== 512)) ||
    (row.kind === "cover" && (row.width !== 1600 || row.height !== 600))
  )
    throw new Error("invalid_business_media");
  return {
    kind: row.kind as BusinessMediaKind,
    slot: row.slot as number,
    version: row.version,
    width: row.width,
    height: row.height,
  };
}
export function readBusinessMediaSummary(value: unknown): BusinessMediaSummary {
  const row = record(value),
    logo = row.logo === null ? null : readBusinessMediaAsset(row.logo),
    cover = row.cover === null ? null : readBusinessMediaAsset(row.cover);
  if (!Array.isArray(row.gallery) || row.gallery.length > 8)
    throw new Error("invalid_business_media");
  const gallery = row.gallery.map(readBusinessMediaAsset);
  if (
    (logo && logo.kind !== "logo") ||
    (cover && cover.kind !== "cover") ||
    gallery.some((a) => a.kind !== "gallery") ||
    new Set(gallery.map((a) => a.slot)).size !== gallery.length
  )
    throw new Error("invalid_business_media");
  return { logo, cover, gallery: [...gallery].sort((a, b) => a.slot - b.slot) };
}
export function readPublicBusinessMediaManifest(value: unknown): PublicBusinessMediaManifest {
  const row = record(value);
  if (!id(row.businessId)) throw new Error("invalid_business_media");
  return { businessId: row.businessId, ...readBusinessMediaSummary(row) };
}
export function readBusinessMediaManifest(value: unknown): BusinessMediaManifest {
  const row = record(value),
    data = readPublicBusinessMediaManifest(row);
  const approved =
    row.approvedMedia === undefined ? undefined : readBusinessMediaSummary(row.approvedMedia);
  if (
    !integer(row.businessVersion, 1) ||
    !status(row.status) ||
    (approved && (row.status !== "published" || row.pendingMedia !== true)) ||
    [
      data.logo,
      data.cover,
      ...data.gallery,
      ...(approved ? [approved.logo, approved.cover, ...approved.gallery] : []),
    ].some((a) => a !== null && a.version > (row.businessVersion as number))
  )
    throw new Error("invalid_business_media");
  return {
    ...data,
    businessVersion: row.businessVersion,
    status: row.status,
    ...(row.pendingMedia === true ? { pendingMedia: true as const } : {}),
    ...(approved ? { approvedMedia: approved } : {}),
  };
}
/** Rooms and cars can attach only gallery slots that already exist in the canonical image table. */
export function inventoryMedia(manifest: BusinessMediaManifest): BusinessMediaSummary | null {
  if (manifest.status === "published" && manifest.pendingMedia)
    return manifest.approvedMedia ?? null;
  return { logo: manifest.logo, cover: manifest.cover, gallery: manifest.gallery };
}
export function readBusinessMediaWriteResult(value: unknown): BusinessMediaWriteResult {
  const row = record(value);
  if (
    !id(row.businessId) ||
    !integer(row.businessVersion, 1) ||
    !status(row.status) ||
    typeof row.kind !== "string" ||
    !["logo", "cover", "gallery"].includes(row.kind) ||
    !(row.kind === "gallery" ? integer(row.slot, 1, 8) : row.slot === 0) ||
    !(row.mediaVersion === null || integer(row.mediaVersion, 1)) ||
    (row.mediaVersion !== null && row.mediaVersion !== row.businessVersion)
  )
    throw new Error("invalid_business_media");
  return {
    businessId: row.businessId,
    businessVersion: row.businessVersion,
    status: row.status,
    kind: row.kind as BusinessMediaKind,
    slot: row.slot as number,
    mediaVersion: row.mediaVersion as number | null,
  };
}
export function businessMediaUrl(
  businessId: string,
  asset: BusinessMediaAsset,
  area: "mine" | "public" = "public",
): string {
  return `/api/business-media/${area}/${encodeURIComponent(businessId)}/${asset.kind}/${asset.slot}?v=${asset.version}`;
}
export const readBusinessMediaReceipt = readBusinessMediaWriteResult;
