import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { normalizeProfileImage } from "../src/server/people/media";
import { PeopleAccessError } from "../src/server/people/validation";

const fails = (operation: Promise<unknown>, code = "MEDIA_INVALID", status = 400) =>
  assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof PeopleAccessError && error.code === code && error.status === status,
  );

async function fixture(format: "jpeg" | "png" | "webp" = "png") {
  return sharp({
    create: {
      width: 80,
      height: 120,
      channels: 4,
      background: { r: 20, g: 37, b: 64, alpha: 0.5 },
    },
  })
    [format]()
    .toBuffer();
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("actual JPEG, PNG and WebP bytes normalize to fixed-size WebP without trusting a filename/MIME hint", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    for (const kind of ["photo", "cover"] as const) {
      const normalized = await normalizeProfileImage(await fixture(format), kind);
      const dimensions =
        kind === "photo" ? { width: 512, height: 512 } : { width: 1600, height: 600 };
      assert.equal(normalized.mime, "image/webp");
      assert.equal(Buffer.isBuffer(normalized.bytes), true);
      assert.ok(normalized.bytes.length <= 1024 * 1024);
      assert.equal(normalized.width, dimensions.width);
      assert.equal(normalized.height, dimensions.height);
      const metadata = await sharp(normalized.bytes).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, dimensions.width);
      assert.equal(metadata.height, dimensions.height);
      assert.ok(metadata.pages === undefined || metadata.pages === 1);
    }
  }
});

test("empty, corrupt, SVG, GIF, truncated and forged headers are rejected with safe typed errors", async () => {
  for (const data of [
    Buffer.alloc(0),
    Buffer.from("not an image"),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>private</script></svg>',
    ),
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .gif()
      .toBuffer(),
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), await fixture("png")]),
  ])
    await fails(normalizeProfileImage(data, "photo"));
  for (const format of ["jpeg", "png", "webp"] as const) {
    const data = await fixture(format);
    await fails(normalizeProfileImage(data.subarray(0, Math.floor(data.length / 2)), "photo"));
  }
  await fails(normalizeProfileImage(await fixture(), "avatar" as "photo"));
});

test("the input byte bound and declared dimension bomb are rejected before full pixel decoding", async () => {
  await fails(
    normalizeProfileImage(Buffer.alloc(4 * 1024 * 1024 + 1), "cover"),
    "MEDIA_TOO_LARGE",
    413,
  );
  const bomb = Buffer.from(await fixture("png"));
  assert.equal(bomb.toString("ascii", 12, 16), "IHDR");
  bomb.writeUInt32BE(5000, 16);
  bomb.writeUInt32BE(5000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  const header = await sharp(bomb, { limitInputPixels: false }).metadata();
  assert.equal(header.width, 5000);
  assert.equal(header.height, 5000);
  await fails(normalizeProfileImage(bomb, "photo"), "MEDIA_TOO_LARGE", 413);
});

test("animated WebP/APNG and multipicture JPEG markers are not silently reduced to a first frame", async () => {
  const pixels = Buffer.from([
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
    0, 0, 255, 255, 0, 0, 255, 255,
  ]);
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await fails(normalizeProfileImage(animated, "photo"));
  const png = await fixture("png"),
    control = Buffer.alloc(20);
  control.writeUInt32BE(8, 0);
  control.write("acTL", 4, "ascii");
  control.writeUInt32BE(2, 8);
  control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
  await fails(
    normalizeProfileImage(Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]), "photo"),
  );
  const jpeg = await fixture("jpeg");
  await fails(
    normalizeProfileImage(
      Buffer.concat([
        jpeg.subarray(0, 2),
        Buffer.from([0xff, 0xe2, 0, 6, 0x4d, 0x50, 0x46, 0]),
        jpeg.subarray(2),
      ]),
      "photo",
    ),
  );
});

test("orientation is applied while EXIF/GPS/ICC and other source metadata are stripped", async () => {
  const width = 600,
    height = 400,
    pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels[(y * width + x) * 3 + (x < width / 2 ? 0 : 2)] = 255;
  const original = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Artist: "synthetic-private-artist" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "44/1 30/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "18/1 40/1 0/1",
        },
      },
    })
    .jpeg()
    .toBuffer();
  const before = await sharp(original).metadata();
  assert.equal(before.orientation, 6);
  assert.ok(before.exif);
  assert.ok(before.icc);
  const result = await normalizeProfileImage(original, "photo"),
    metadata = await sharp(result.bytes).metadata();
  for (const field of ["exif", "icc", "xmp", "iptc", "orientation", "comments"] as const)
    assert.equal(metadata[field], undefined);
  const { data, info } = await sharp(result.bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const top = (20 * info.width + 256) * info.channels,
    bottom = (490 * info.width + 256) * info.channels;
  assert.ok((data[top] ?? 0) > 200 && (data[top + 2] ?? 255) < 50);
  assert.ok((data[bottom + 2] ?? 0) > 200 && (data[bottom] ?? 255) < 50);
});

test("transparent input remains safe alpha, and later caller mutation cannot change the decoder snapshot", async () => {
  const original = await fixture("png"),
    copy = Buffer.from(original);
  const promise = normalizeProfileImage(copy, "photo");
  copy.fill(0);
  const result = await promise,
    metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.hasAlpha, true);
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.ok((data[3] ?? 0) >= 126 && (data[3] ?? 255) <= 129);
  assert.equal(original.equals(copy), false);
});

test("a high-entropy alpha cover exceeding the output byte budget is rejected rather than stored", async () => {
  const source = await sharp(randomBytes(1600 * 600 * 4), {
    raw: { width: 1600, height: 600, channels: 4 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(source.length <= 4 * 1024 * 1024);
  await fails(normalizeProfileImage(source, "cover"), "MEDIA_TOO_LARGE", 413);
});
