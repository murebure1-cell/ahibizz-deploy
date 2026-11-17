import { normalizeRasterImage, RasterImageError } from "../media/normalize-image";
import { BusinessMediaAccessError, fail } from "./validation";

export async function normalizeBusinessImage(
  bytes: Uint8Array,
  kind: "logo" | "cover" | "gallery",
) {
  if (kind !== "logo" && kind !== "cover" && kind !== "gallery")
    fail(400, "INVALID_BUSINESS_MEDIA_INPUT");
  try {
    return await normalizeRasterImage(bytes, {
      width: kind === "logo" ? 512 : 1600,
      height: kind === "logo" ? 512 : kind === "cover" ? 600 : 1200,
      fit: kind === "logo" ? "contain" : kind === "gallery" ? "inside" : "cover",
      withoutEnlargement: kind === "gallery",
    });
  } catch (error) {
    if (error instanceof RasterImageError)
      throw new BusinessMediaAccessError(error.status, error.code);
    throw new BusinessMediaAccessError(400, "MEDIA_INVALID");
  }
}
