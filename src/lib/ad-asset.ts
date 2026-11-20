export const adAssetMaxBytes = 1000000;
export const adAssetTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "text/html",
] as const;
export type AdAssetType = (typeof adAssetTypes)[number];
export type AdAsset = { mimeType: string; version: number };
export function isAdAssetType(value: string): value is AdAssetType {
  return adAssetTypes.some((type) => type === value);
}
export const htmlAdPolicy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'";
export function adAssetPath(id: string, version: number) {
  return `/api/marketing/creative/${encodeURIComponent(id)}?v=${version}`;
}
