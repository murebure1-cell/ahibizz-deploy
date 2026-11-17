import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { normalizeBusinessImage } from "../src/server/business-media/normalize";
import { BusinessMediaAccessError } from "../src/server/business-media/validation";

const fixture = (width = 80, height = 120) =>
  sharp({ create: { width, height, channels: 4, background: { r: 16, g: 39, b: 61, alpha: 0.7 } } })
    .png()
    .toBuffer();
const fails = (promise: Promise<unknown>, status = 400, code = "MEDIA_INVALID") =>
  assert.rejects(
    promise,
    (error) =>
      error instanceof BusinessMediaAccessError && error.status === status && error.code === code,
  );
test("business logo and cover share the proven static-raster decoder and exact dimensions", async () => {
  const input = await fixture();
  for (const [kind, width, height] of [
    ["logo", 512, 512],
    ["cover", 1600, 600],
  ] as const) {
    const image = await normalizeBusinessImage(input, kind),
      metadata = await sharp(image.bytes).metadata();
    assert.equal(image.mime, "image/webp");
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(image.bytes.length <= 1048576);
  }
});
test("wide and tall logos retain edge artwork with transparent padding and no source metadata", async () => {
  for (const [width, height] of [
    [900, 200],
    [200, 900],
  ] as const) {
    const pixels = Buffer.alloc(width * height * 3, 120),
      horizontal = width > height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = horizontal ? x : y,
          length = horizontal ? width : height,
          offset = (y * width + x) * 3;
        if (position < length / 10) pixels.set([255, 0, 0], offset);
        if (position >= (length * 9) / 10) pixels.set([0, 0, 255], offset);
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .withMetadata({
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
      .png()
      .toBuffer();
    const before = await sharp(input).metadata();
    assert.ok(before.exif);
    assert.ok(before.icc);
    const output = await normalizeBusinessImage(input, "logo"),
      metadata = await sharp(output.bytes).metadata();
    assert.equal(output.width, 512);
    assert.equal(output.height, 512);
    assert.equal(metadata.hasAlpha, true);
    for (const field of ["exif", "icc", "xmp", "iptc", "orientation", "comments"] as const)
      assert.equal(metadata[field], undefined);
    const { data, info } = await sharp(output.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const first = ((horizontal ? 256 : 16) * info.width + (horizontal ? 16 : 256)) * info.channels,
      last = ((horizontal ? 256 : 495) * info.width + (horizontal ? 495 : 256)) * info.channels;
    assert.ok((data[first] ?? 0) > 200 && (data[first + 2] ?? 255) < 50);
    assert.ok((data[last + 2] ?? 0) > 200 && (data[last] ?? 255) < 50);
    assert.equal(data[first + 3], 255);
    assert.equal(data[last + 3], 255);
    assert.equal(data[3], 0);
    assert.equal(data[(511 * info.width + 511) * info.channels + 3], 0);
  }
});
test("gallery preserves landscape/portrait aspect ratio and never enlarges a small original", async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [2000, 400, 1600, 320],
    [1000, 2000, 600, 1200],
    [80, 120, 80, 120],
  ]) {
    const image = await normalizeBusinessImage(await fixture(width, height), "gallery");
    assert.equal(image.width, expectedWidth);
    assert.equal(image.height, expectedHeight);
    assert.ok(image.bytes.length <= 1048576);
  }
});
test("business image normalization snapshots original bytes before the first await", async () => {
  const bytes = await fixture();
  const result = normalizeBusinessImage(bytes, "logo");
  bytes.fill(0);
  assert.equal((await result).width, 512);
});
test("invalid, active/animated and oversized media never returns pixels or unsafe decoder details", async () => {
  await fails(
    normalizeBusinessImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "logo"),
  );
  await fails(normalizeBusinessImage(Buffer.from("not a raster"), "gallery"));
  await fails(
    normalizeBusinessImage(Buffer.alloc(4 * 1024 * 1024 + 1), "gallery"),
    413,
    "MEDIA_TOO_LARGE",
  );
  await fails(
    normalizeBusinessImage(await fixture(), "unknown" as "logo"),
    400,
    "INVALID_BUSINESS_MEDIA_INPUT",
  );
  const pixels = Buffer.alloc(2 * 4 * 4, 120);
  // Distinct frames prevent the encoder from legitimately optimizing this into a static image.
  pixels.fill(230, 2 * 2 * 4);
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  const metadata = await sharp(animated, { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  assert.ok(animated.includes(Buffer.from("ANIM")));
  assert.ok(animated.includes(Buffer.from("ANMF")));
  for (const kind of ["logo", "cover", "gallery"] as const)
    await fails(normalizeBusinessImage(animated, kind));
});
