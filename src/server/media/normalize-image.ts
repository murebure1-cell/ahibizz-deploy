import sharp from "sharp";
export class RasterImageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Image could not be normalized.");
  }
}

const MAX_INPUT = 4 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_OUTPUT = 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function invalid(): never {
  throw new RasterImageError(400, "MEDIA_INVALID");
}
function tooLarge(): never {
  throw new RasterImageError(413, "MEDIA_TOO_LARGE");
}
function detectedFormat(data: Buffer): "jpeg" | "png" | "webp" {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.subarray(0, 8).equals(pngSignature)) return "png";
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return invalid();
}

function requireStatic(data: Buffer, format: "jpeg" | "png" | "webp"): void {
  if (format === "jpeg") {
    // MPO stores multiple JPEG pictures in an MPF APP2 segment.
    for (let offset = 2; offset < data.length; ) {
      if (data[offset++] !== 0xff) invalid();
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === undefined || marker === 0xd8 || offset + 2 > data.length) invalid();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) invalid();
      if (marker === 0xe2 && data.toString("ascii", offset + 2, offset + 6) === "MPF\0") invalid();
      offset += length;
    }
    return;
  }
  if (format === "webp" && data.readUInt32LE(4) + 8 !== data.length) invalid();
  for (let offset = format === "png" ? 8 : 12; offset < data.length; ) {
    if (offset + (format === "png" ? 12 : 8) > data.length) invalid();
    const length = format === "png" ? data.readUInt32BE(offset) : data.readUInt32LE(offset + 4);
    const type = data.toString(
      "ascii",
      offset + (format === "png" ? 4 : 0),
      offset + (format === "png" ? 8 : 4),
    );
    const end = offset + length + (format === "png" ? 12 : 8 + (length % 2));
    if (end > data.length) invalid();
    if (["acTL", "fcTL", "fdAT", "ANIM", "ANMF"].includes(type)) invalid();
    if (format === "webp" && type === "VP8X" && length > 0 && (data[offset + 8] ?? 0) & 0x02)
      invalid();
    offset = end;
  }
}

/** Decode only bounded static raster input, strip metadata, and own its bytes before awaiting. */
export async function normalizeRasterImage(
  bytes: Uint8Array,
  options: { width: number; height: number; fit: "cover" | "inside"; withoutEnlargement?: boolean },
): Promise<{ bytes: Buffer; mime: "image/webp"; width: number; height: number }> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    !options ||
    !Number.isInteger(options.width) ||
    options.width < 1 ||
    options.width > 1600 ||
    !Number.isInteger(options.height) ||
    options.height < 1 ||
    options.height > 1200 ||
    !["cover", "inside"].includes(options.fit) ||
    (options.withoutEnlargement !== undefined && typeof options.withoutEnlargement !== "boolean")
  )
    invalid();
  if (bytes.byteLength > MAX_INPUT) tooLarge();
  const target = { ...options };
  const input = Buffer.from(bytes),
    format = detectedFormat(input);
  requireStatic(input, format);
  try {
    const image = sharp(input, {
      failOn: "warning",
      limitInputPixels: MAX_PIXELS,
      limitInputChannels: 4,
      animated: false,
      unlimited: false,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== format ||
      !Number.isSafeInteger(metadata.width) ||
      metadata.width <= 0 ||
      !Number.isSafeInteger(metadata.height) ||
      metadata.height <= 0 ||
      (metadata.pages !== undefined && metadata.pages !== 1) ||
      metadata.loop !== undefined ||
      metadata.delay !== undefined ||
      (metadata.pageHeight !== undefined && metadata.pageHeight !== metadata.height)
    )
      invalid();
    if (metadata.width * metadata.height > MAX_PIXELS) tooLarge();
    const output = await image
      .autoOrient()
      .resize(target.width, target.height, {
        fit: target.fit,
        position: "centre",
        withoutEnlargement: target.withoutEnlargement ?? false,
      })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.byteLength > MAX_OUTPUT) tooLarge();
    if (
      output.info.format !== "webp" ||
      !Number.isInteger(output.info.width) ||
      !Number.isInteger(output.info.height) ||
      output.info.width < 1 ||
      output.info.height < 1 ||
      output.info.width > target.width ||
      output.info.height > target.height ||
      (target.fit === "cover" &&
        !target.withoutEnlargement &&
        (output.info.width !== target.width || output.info.height !== target.height))
    )
      invalid();
    return {
      bytes: output.data,
      mime: "image/webp",
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof RasterImageError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) tooLarge();
    return invalid();
  }
}
