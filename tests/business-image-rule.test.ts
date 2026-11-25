import assert from "node:assert/strict";
import test from "node:test";
import { safeBusinessImage } from "../src/lib/public-business";

const image = (src: string) => ({ src, alt: "Fotografija" });
const published = "/api/business-media/public/fixture-business/cover/0?v=3";
const own = "/api/business-media/mine/fixture-business/cover/0?v=3";

test("a public card shows only published photographs", () => {
  assert.deepEqual(safeBusinessImage(image(published)), image(published));
  // The owner's own copy of a photograph is not something a public card may carry.
  assert.equal(safeBusinessImage(image(own)), undefined);
  assert.equal(safeBusinessImage(image("/preview/cafe.webp")), undefined);
  assert.equal(safeBusinessImage(image("https://example.invalid/a.jpg")), undefined);
});

test("an owner previewing a draft sees their own photographs", () => {
  assert.deepEqual(safeBusinessImage(image(own), true), image(own));
  assert.deepEqual(safeBusinessImage(image(published), true), image(published));
  assert.deepEqual(
    safeBusinessImage(image("/preview/cafe.webp"), true),
    image("/preview/cafe.webp"),
  );
});

test("the preview accepts no other address either", () => {
  for (const src of [
    "/api/business-media/mine/fixture-business/cover/9?v=3",
    "/api/business-media/mine/fixture-business/cover/0?v=0",
    "/api/business-media/mine/fixture-business/cover/0?v=3&x=1",
    "/api/business-media/mine/../public/cover/0?v=3",
    "/api/account/password",
    "//example.invalid/api/business-media/mine/a/cover/0?v=3",
    "/api/business-media/mine/fixture business/cover/0?v=3",
  ])
    assert.equal(safeBusinessImage(image(src), true), undefined, src);
});
