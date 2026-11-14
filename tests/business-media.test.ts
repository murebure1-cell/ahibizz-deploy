import assert from "node:assert/strict";
import test from "node:test";
import {
  type BusinessMediaAsset,
  businessMediaUrl,
  readBusinessMediaAsset,
  readBusinessMediaManifest,
  readBusinessMediaReceipt,
  readBusinessMediaSummary,
  readPublicBusinessMediaManifest,
} from "../src/lib/business-media";
import { BusinessMediaRequestError, businessMediaRequest } from "../src/lib/business-media-client";

const logo: BusinessMediaAsset = { kind: "logo", slot: 0, version: 2, width: 512, height: 512 };
const cover: BusinessMediaAsset = { kind: "cover", slot: 0, version: 3, width: 1600, height: 600 };
const gallery = (slot = 1): BusinessMediaAsset => ({
  kind: "gallery",
  slot,
  version: 4,
  width: 800,
  height: 600,
});
const manifest = () => ({
  businessId: "fixture-business",
  businessVersion: 4,
  status: "published",
  logo: { ...logo },
  cover: { ...cover },
  gallery: [gallery()],
});

test("media asset reader accepts only supported fixed dimensions, bounded gallery slots and integer versions", () => {
  for (const asset of [logo, cover, gallery(), gallery(8)])
    assert.deepEqual(readBusinessMediaAsset(asset), asset);
  for (const asset of [
    null,
    [],
    "logo",
    {},
    { ...logo, kind: "photo" },
    { ...logo, slot: 1 },
    { ...cover, slot: -1 },
    { ...logo, width: 511 },
    { ...logo, height: 513 },
    { ...cover, height: 601 },
    { ...logo, version: 0 },
    { ...logo, version: 2.5 },
    { ...logo, version: "2" },
    { ...logo, version: 2147483648 },
    { ...gallery(), slot: 0 },
    { ...gallery(), slot: 9 },
    { ...gallery(), slot: 1.5 },
    { ...gallery(), width: 1601 },
    { ...gallery(), height: 1201 },
    { ...gallery(), width: 0 },
    { ...gallery(), height: Number.NaN },
  ])
    assert.throws(() => readBusinessMediaAsset(asset));
});

test("summary validates kind/slot uniqueness and returns ordered metadata without source bytes or private URLs", () => {
  const source = {
    logo: { ...logo, url: "private.invalid", filename: "private-name.png" },
    cover: null,
    gallery: [gallery(8), gallery(2), gallery(1)],
    bytes: "private",
  };
  const safe = readBusinessMediaSummary(source);
  assert.deepEqual(
    safe.gallery.map((asset) => asset.slot),
    [1, 2, 8],
  );
  assert.deepEqual(safe.logo, logo);
  assert.equal(Object.hasOwn(safe, "bytes"), false);
  assert.equal(Object.hasOwn(safe.logo as object, "url"), false);
  source.logo.version = 99;
  source.gallery[0] = gallery(7);
  assert.equal(safe.logo?.version, 2);
  assert.deepEqual(
    safe.gallery.map((asset) => asset.slot),
    [1, 2, 8],
  );
  for (const invalid of [
    { logo: cover, cover: null, gallery: [] },
    { logo: null, cover: logo, gallery: [] },
    { logo: null, cover: null, gallery: [logo] },
    { logo: null, cover: null, gallery: [gallery(), gallery()] },
    { logo: null, cover: null, gallery: Array.from({ length: 9 }, () => gallery()) },
    { logo: null, cover: null, gallery: {} },
    { cover: null, gallery: [] },
  ])
    assert.throws(() => readBusinessMediaSummary(invalid));
});

test("private manifest requires current business CAS/status and rejects assets from a future version", () => {
  assert.deepEqual(readBusinessMediaManifest(manifest()), manifest());
  for (const invalid of [
    { ...manifest(), businessId: "" },
    { ...manifest(), businessId: "a/b" },
    { ...manifest(), businessId: "https://private.invalid" },
    { ...manifest(), businessId: "a".repeat(129) },
    { ...manifest(), businessVersion: 0 },
    { ...manifest(), businessVersion: 3 },
    { ...manifest(), businessVersion: 2147483648 },
    { ...manifest(), businessVersion: "4" },
    { ...manifest(), status: "active" },
    { ...manifest(), status: null },
  ])
    assert.throws(() => readBusinessMediaManifest(invalid));
});

test("public manifest projection never returns owner, business state, byte data or arbitrary image URLs", () => {
  const publicValue = readPublicBusinessMediaManifest({
    ...manifest(),
    ownerId: "private-owner",
    contactEmail: "private@example.invalid",
    bytes: "secret",
    logo: {
      ...logo,
      url: "https://private.invalid/photo",
      bytes: "secret-photo",
      storageKey: "secret-key",
    },
  });
  assert.deepEqual(publicValue, {
    businessId: "fixture-business",
    logo,
    cover,
    gallery: [gallery()],
  });
  assert.deepEqual(Object.keys(publicValue).sort(), ["businessId", "cover", "gallery", "logo"]);
  assert.deepEqual(Object.keys(publicValue.logo as object).sort(), [
    "height",
    "kind",
    "slot",
    "version",
    "width",
  ]);
});

test("write receipts retain only historical command metadata and require an exact resulting media version", () => {
  const receipt = {
    businessId: "fixture-business",
    businessVersion: 5,
    status: "pending",
    kind: "logo",
    slot: 0,
    mediaVersion: 5,
  };
  assert.deepEqual(
    readBusinessMediaReceipt({ ...receipt, ownerId: "private", fingerprint: "private" }),
    receipt,
  );
  assert.deepEqual(readBusinessMediaReceipt({ ...receipt, mediaVersion: null }), {
    ...receipt,
    mediaVersion: null,
  });
  for (const invalid of [
    { ...receipt, businessId: "../other" },
    { ...receipt, status: "active" },
    { ...receipt, businessVersion: 0 },
    { ...receipt, businessVersion: 2147483648 },
    { ...receipt, mediaVersion: 4 },
    { ...receipt, mediaVersion: "5" },
    { ...receipt, mediaVersion: 0 },
    { ...receipt, mediaVersion: undefined },
    { ...receipt, slot: 1 },
    { ...receipt, kind: "gallery", slot: 0 },
    { ...receipt, kind: "gallery", slot: 9 },
  ])
    assert.throws(() => readBusinessMediaReceipt(invalid));
});

test("media URLs use only relative same-origin paths, area and versioned asset slots", () => {
  assert.equal(
    businessMediaUrl("fixture-business", logo),
    "/api/business-media/public/fixture-business/logo/0?v=2",
  );
  assert.equal(
    businessMediaUrl("fixture-business", cover, "mine"),
    "/api/business-media/mine/fixture-business/cover/0?v=3",
  );
  assert.equal(
    businessMediaUrl("fixture-business", gallery(8), "mine"),
    "/api/business-media/mine/fixture-business/gallery/8?v=4",
  );
  assert.equal(
    businessMediaUrl("host/id?secret#x", logo, "mine"),
    "/api/business-media/mine/host%2Fid%3Fsecret%23x/logo/0?v=2",
  );
});

test("client rejects foreign/traversal/query paths before fetch and sends authorized paths with private no-store semantics", async (t) => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({ input: String(input), init });
      return Response.json({ manifest: manifest() });
    },
  );
  for (const path of [
    "https://evil.invalid/mine/fixture-business",
    "//evil.invalid/mine/fixture-business",
    "../mine/fixture-business",
    "mine/fixture-business?all=1",
    "mine/fixture-business/logo/0?v=2&owner=1",
    "mine/fixture-business/../logo/0",
  ])
    await assert.rejects(
      businessMediaRequest(path),
      (error: unknown) => error instanceof BusinessMediaRequestError && error.status === 400,
    );
  assert.equal(calls.length, 0);
  const response = await businessMediaRequest("mine/fixture-business");
  assert.deepEqual(readBusinessMediaManifest(response.manifest), manifest());
  assert.equal(calls[0]?.input, "/api/business-media/mine/fixture-business");
  assert.equal(calls[0]?.init?.credentials, "same-origin");
  assert.equal(calls[0]?.init?.cache, "no-store");
});

test("client failures retain typed status/code and malformed JSON cannot become an acknowledgement", async (t) => {
  let response = Response.json({ code: "VERSION_CONFLICT" }, { status: 409 });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(
    businessMediaRequest("mine/fixture-business"),
    (error: unknown) =>
      error instanceof BusinessMediaRequestError &&
      error.status === 409 &&
      error.code === "VERSION_CONFLICT",
  );
  response = new Response("broken-json", { status: 200 });
  await assert.rejects(businessMediaRequest("mine/fixture-business"), BusinessMediaRequestError);
  response = Response.json([], { status: 200 });
  await assert.rejects(businessMediaRequest("mine/fixture-business"), BusinessMediaRequestError);
});
