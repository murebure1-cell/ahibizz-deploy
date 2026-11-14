import { normalizeRasterImage, RasterImageError } from "../media/normalize-image";
import { PeopleAccessError } from "./validation";

/** Preserve the personal-profile image contract while sharing the audited raster decoder. */
export async function normalizeProfileImage(bytes: Uint8Array, kind: "photo" | "cover") {
  if (kind !== "photo" && kind !== "cover") throw new PeopleAccessError(400, "MEDIA_INVALID");
  try {
    return await normalizeRasterImage(bytes, {
      width: kind === "photo" ? 512 : 1600,
      height: kind === "photo" ? 512 : 600,
      fit: "cover",
    });
  } catch (error) {
    if (error instanceof RasterImageError) throw new PeopleAccessError(error.status, error.code);
    throw new PeopleAccessError(400, "MEDIA_INVALID");
  }
}
