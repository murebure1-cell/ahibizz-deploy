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
  await fails(normalizeBusinessImage(animated, "cover"));
});
