import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { createBusinessMediaPreviewApi } from "../src/components/preview/business-media-preview-api";
import {
  type BusinessMediaKind,
  type BusinessMediaReceipt,
  type BusinessMediaStatus,
  readBusinessMediaManifest,
  readBusinessMediaReceipt,
} from "../src/lib/business-media";
import { BusinessMediaRequestError } from "../src/lib/business-media-client";

type Normalized = { blob: Blob; width: number; height: number };
const originalFile = () => new Blob(["isolated-original-image"], { type: "image/png" });
const normalizedImage = (kind: BusinessMediaKind): Normalized => ({
  blob: new Blob(["isolated-normalized-webp"], { type: "image/webp" }),
  width: kind === "logo" ? 512 : 1600,
  height: kind === "logo" ? 512 : kind === "cover" ? 600 : 1200,
});
const rejected = (status: number, code: string) => (error: unknown) =>
  error instanceof BusinessMediaRequestError && error.status === status && error.code === code;

// Injected normalization verifies transaction/lifetime behavior only. Real raster decoding and
// normalization are covered separately by business-media-normalize.test.ts; no signature mock is used.
function fixture(
  t: TestContext,
  options: {
    status?: BusinessMediaStatus;
    normalize?: (file: Blob, kind: BusinessMediaKind) => Promise<Normalized>;
    rejectBump?: boolean;
  } = {},
) {
  let business = { id: "fixture-business", version: 1, status: options.status ?? "draft" },
    bumps = 0,
    normalizations = 0;
  const created: string[] = [],
    revoked: string[] = [];
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("The isolated business media preview must never call a network API.");
  });
  t.mock.method(URL, "createObjectURL", (blob: Blob) => {
    assert.equal(blob.type, "image/webp");
    const url = `blob:business-media-fixture-${created.length + 1}`;
    created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const api = createBusinessMediaPreviewApi({
    readBusiness: (id) => (id === business.id ? { ...business } : null),
    bumpBusiness: (id, expectedVersion) => {
      if (options.rejectBump || id !== business.id || business.version !== expectedVersion)
        throw new BusinessMediaRequestError(409, "VERSION_CONFLICT");
      if (business.status === "archived")
        throw new BusinessMediaRequestError(409, "BUSINESS_ARCHIVED");
      bumps++;
      business = {
        ...business,
        version: business.version + 1,
        status: business.status === "published" ? "pending" : business.status,
      };
      return { ...business };
    },
    normalizeImage: async (file, kind) => {
      normalizations++;
      return options.normalize ? options.normalize(file, kind) : normalizedImage(kind);
    },
  });
  t.after(() => {
    api.dispose();
    assert.equal(fetch.mock.callCount(), 0);
  });
  const put = (
    kind: BusinessMediaKind,
    slot: number,
    expectedVersion: number,
    key = randomUUID(),
    file = originalFile(),
  ) =>
    api.request(`mine/${business.id}/${kind}/${slot}`, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "If-Match": `"${expectedVersion}"`,
        "Idempotency-Key": key,
      },
      body: file,
    });
  const remove = (kind: BusinessMediaKind, slot: number, version: number, key = randomUUID()) =>
    api.request(`mine/${business.id}/${kind}/${slot}`, {
      method: "DELETE",
      headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
    });
  return {
    api,
    put,
    remove,
    created,
    revoked,
    business: () => ({ ...business }),
    bumps: () => bumps,
    normalizations: () => normalizations,
    externalEdit(status = business.status) {
      business = { ...business, status, version: business.version + 1 };
    },
  };
}

test("preview media shares business CAS and historic receipts never masquerade as current status", async (t) => {
  const f = fixture(t, { status: "published" }),
    key = randomUUID(),
    file = originalFile();
  const response = await f.put("logo", 0, 1, key, file);
  const first = readBusinessMediaReceipt(response.receipt);
  assert.equal(first.businessVersion, 2);
  assert.equal(first.mediaVersion, 2);
  assert.equal(first.status, "pending");
  f.externalEdit("published");
  (response.receipt as BusinessMediaReceipt).status = "archived";
  assert.deepEqual((await f.put("logo", 0, 1, key, file)).receipt, first);
  const fresh = readBusinessMediaManifest((await f.api.request("mine/fixture-business")).manifest);
  assert.equal(fresh.businessVersion, 3);
  assert.equal(fresh.status, "published");
  assert.equal(fresh.logo?.version, 2);
  await assert.rejects(f.put("cover", 0, 2), rejected(409, "VERSION_CONFLICT"));
  assert.equal(f.bumps(), 1);
  assert.equal(f.normalizations(), 1);
  assert.equal(f.api.snapshotVersion(), 1);
});

test("confirmed media receipt replays after a later archive without another mutation", async (t) => {
  const f = fixture(t),
    key = randomUUID(),
    file = originalFile();
  const first = readBusinessMediaReceipt((await f.put("logo", 0, 1, key, file)).receipt);
  f.externalEdit("archived");
  assert.deepEqual((await f.put("logo", 0, 1, key, file)).receipt, first);
  assert.equal(f.api.getManifest("fixture-business").status, "archived");
  await assert.rejects(f.put("cover", 0, 3), rejected(409, "BUSINESS_ARCHIVED"));
  assert.equal(f.bumps(), 1);
  assert.equal(f.created.length, 1);
});

test("same idempotency key rejects changed bytes, slot, kind, version and operation", async (t) => {
  const f = fixture(t),
    key = randomUUID();
  await f.put("gallery", 1, 1, key);
  for (const attempt of [
    () => f.put("gallery", 1, 1, key, new Blob(["different-original"], { type: "image/png" })),
    () => f.put("gallery", 2, 1, key),
    () => f.put("logo", 0, 1, key),
    () => f.put("gallery", 1, 2, key),
    () => f.remove("gallery", 1, 1, key),
  ])
    await assert.rejects(attempt(), rejected(409, "IDEMPOTENCY_CONFLICT"));
  assert.equal(f.bumps(), 1);
  assert.equal(f.created.length, 1);
  assert.equal(f.api.getManifest("fixture-business").gallery.length, 1);
});

test("concurrent duplicate uploads commit once, announce once and share one immutable receipt", {
  timeout: 5000,
}, async (t) => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let started = 0;
  const f = fixture(t, {
    normalize: async (_file, kind) => {
      if (++started === 2) entered.resolve();
      await release.promise;
      return normalizedImage(kind);
    },
  });
  let notifications = 0;
  const unsubscribe = f.api.subscribe(() => {
    notifications++;
  });
  const key = randomUUID(),
    file = originalFile();
  const a = f.put("logo", 0, 1, key, file),
    b = f.put("logo", 0, 1, key, file);
  await entered.promise;
  assert.equal(f.bumps(), 0);
  release.resolve();
  const results = await Promise.all([a, b]);
  assert.deepEqual(results[0]?.receipt, results[1]?.receipt);
  assert.equal(f.bumps(), 1);
  assert.equal(notifications, 1);
  assert.equal(f.api.snapshotVersion(), 1);
  assert.equal(f.created.length, 1);
  unsubscribe();
});

for (const externalStatus of ["draft", "archived"] as const) {
  test(`delayed normalization cannot overwrite an external ${externalStatus === "draft" ? "edit" : "archive"}`, {
    timeout: 5000,
  }, async (t) => {
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const f = fixture(t, {
      normalize: async (_file, kind) => {
        entered.resolve();
        await release.promise;
        return normalizedImage(kind);
      },
    });
    const upload = f.put("logo", 0, 1);
    await entered.promise;
    f.externalEdit(externalStatus);
    release.resolve();
    await assert.rejects(
      upload,
      rejected(409, externalStatus === "archived" ? "BUSINESS_ARCHIVED" : "VERSION_CONFLICT"),
    );
    assert.equal(f.business().version, 2);
    assert.equal(f.bumps(), 0);
    assert.equal(f.api.snapshotVersion(), 0);
    assert.equal(f.created.length, 0);
    assert.equal(f.api.getManifest("fixture-business").logo, null);
  });
}

test("invalid normalized dimensions, MIME and size fail before business bump or object URL creation", async (t) => {
  let candidate = normalizedImage("logo");
  const f = fixture(t, { normalize: async () => candidate });
  const invalid: [BusinessMediaKind, Normalized][] = [
    ["logo", { ...normalizedImage("logo"), width: 511 }],
    ["logo", { ...normalizedImage("logo"), height: 513 }],
    ["cover", { ...normalizedImage("cover"), height: 601 }],
    ["gallery", { ...normalizedImage("gallery"), width: 1601 }],
    ["gallery", { ...normalizedImage("gallery"), height: 0 }],
    ["gallery", { ...normalizedImage("gallery"), width: Number.NaN }],
    ["logo", { ...normalizedImage("logo"), blob: new Blob(["wrong"], { type: "image/png" }) }],
    [
      "logo",
      {
        ...normalizedImage("logo"),
        blob: new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "image/webp" }),
      },
    ],
  ];
  for (const [kind, value] of invalid) {
    candidate = value;
    await assert.rejects(f.put(kind, kind === "gallery" ? 1 : 0, 1));
    assert.equal(f.bumps(), 0);
    assert.equal(f.created.length, 0);
    assert.equal(f.api.snapshotVersion(), 0);
  }
  candidate = normalizedImage("logo");
  assert.equal(readBusinessMediaReceipt((await f.put("logo", 0, 1)).receipt).businessVersion, 2);
});

test("logo replacement, deletion and all eight stable gallery slots revoke only obsolete URLs", async (t) => {
  const f = fixture(t);
  await f.put("logo", 0, 1);
  const firstLogo = f.api.getManifest("fixture-business").logo;
  assert.ok(firstLogo);
  const firstURL = f.api.imageUrl("fixture-business", firstLogo);
  assert.equal(firstURL, f.created[0]);
  await f.put("logo", 0, 2);
  assert.deepEqual(f.revoked, [firstURL]);
  assert.equal(f.api.imageUrl("fixture-business", firstLogo), null);
  await f.put("cover", 0, 3);
  for (let slot = 1; slot <= 8; slot++) await f.put("gallery", slot, 3 + slot);
  const manifest = f.api.getManifest("fixture-business");
  assert.deepEqual(
    manifest.gallery.map((asset) => asset.slot),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(manifest.businessVersion, 12);
  await assert.rejects(f.put("gallery", 9, 12), BusinessMediaRequestError);
  assert.equal(f.business().version, 12);
  const currentLogo = manifest.logo;
  assert.ok(currentLogo);
  const currentURL = f.api.imageUrl("fixture-business", currentLogo);
  const deleted = readBusinessMediaReceipt((await f.remove("logo", 0, 12)).receipt);
  assert.equal(deleted.mediaVersion, null);
  assert.equal(f.api.getManifest("fixture-business").logo, null);
  assert.equal(f.api.getManifest("fixture-business").gallery.length, 8);
  assert.deepEqual(f.revoked, [firstURL, currentURL]);
  f.api.dispose();
  assert.deepEqual([...f.revoked].sort(), [...f.created].sort());
  assert.equal(new Set(f.revoked).size, f.revoked.length);
});

test("failed final CAS revokes its newly allocated URL and leaves no asset or receipt", async (t) => {
  const f = fixture(t, { rejectBump: true });
  await assert.rejects(f.put("logo", 0, 1), rejected(409, "VERSION_CONFLICT"));
  assert.equal(f.bumps(), 0);
  assert.equal(f.business().version, 1);
  assert.equal(f.api.getManifest("fixture-business").logo, null);
  assert.equal(f.api.snapshotVersion(), 0);
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.revoked, f.created);
});

test("disposal revokes existing assets and invalidates a delayed upload before mutation", {
  timeout: 5000,
}, async (t) => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let delay = false;
  const f = fixture(t, {
    normalize: async (_file, kind) => {
      if (delay) {
        entered.resolve();
        await release.promise;
      }
      return normalizedImage(kind);
    },
  });
  await f.put("logo", 0, 1);
  delay = true;
  const upload = f.put("cover", 0, 2);
  await entered.promise;
  f.api.dispose();
  assert.deepEqual(f.revoked, f.created);
  release.resolve();
  await assert.rejects(upload, { name: "AbortError" });
  assert.equal(f.bumps(), 1);
  assert.equal(f.created.length, 1);
  assert.equal(f.api.getManifest("fixture-business").cover, null);
});

test("aborting during normalization cannot create an image or bump its business", {
  timeout: 5000,
}, async (t) => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const f = fixture(t, {
    normalize: async (_file, kind) => {
      entered.resolve();
      await release.promise;
      return normalizedImage(kind);
    },
  });
  const controller = new AbortController();
  const upload = f.api.request("mine/fixture-business/logo/0", {
    method: "PUT",
    signal: controller.signal,
    body: originalFile(),
    headers: { "Content-Type": "image/png", "If-Match": '"1"', "Idempotency-Key": randomUUID() },
  });
  await entered.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(upload, { name: "AbortError" });
  assert.equal(f.bumps(), 0);
  assert.equal(f.api.snapshotVersion(), 0);
  assert.equal(f.created.length, 0);
  assert.equal(f.api.getManifest("fixture-business").logo, null);
});

test("private/public reads clone media and public projection is visible only while published", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.api.request("public/fixture-business"),
    rejected(404, "BUSINESS_NOT_FOUND"),
  );
  await f.put("logo", 0, 1);
  const selected = f.api.getManifest("fixture-business");
  assert.ok(selected.logo);
  selected.logo.version = 99;
  assert.equal(f.api.getManifest("fixture-business").logo?.version, 2);
  f.externalEdit("published");
  const response = await f.api.request("public/fixture-business");
  assert.deepEqual(Object.keys(response.manifest as object).sort(), [
    "businessId",
    "cover",
    "gallery",
    "logo",
  ]);
  assert.equal(Object.hasOwn(response.manifest as object, "businessVersion"), false);
  assert.equal(Object.hasOwn(response.manifest as object, "status"), false);
  (response.manifest as { logo: { width: number } }).logo.width = 1;
  assert.equal(f.api.getManifest("fixture-business").logo?.width, 512);
  f.externalEdit("pending");
  await assert.rejects(
    f.api.request("public/fixture-business"),
    rejected(404, "BUSINESS_NOT_FOUND"),
  );
});

test("transport rejects foreign paths, wrong slots, invalid commands and pre-aborted reads without mutation", async (t) => {
  const f = fixture(t);
  for (const path of [
    "https://evil.invalid/mine/fixture-business",
    "../mine/fixture-business",
    "mine/fixture-business?all=1",
    "mine/missing",
    "public/fixture-business/logo/0",
  ])
    await assert.rejects(f.api.request(path), BusinessMediaRequestError);
  await assert.rejects(f.put("gallery", 0, 1), rejected(400, "INVALID_BUSINESS_MEDIA_INPUT"));
  await assert.rejects(f.put("logo", 1, 1), rejected(400, "INVALID_BUSINESS_MEDIA_INPUT"));
  await assert.rejects(
    f.api.request("mine/fixture-business/logo/0", {
      method: "PUT",
      body: originalFile(),
      headers: { "If-Match": '"1"', "Idempotency-Key": "invalid", "Content-Type": "image/png" },
    }),
    rejected(400, "INVALID_BUSINESS_MEDIA_INPUT"),
  );
  await assert.rejects(f.api.request("mine/fixture-business", { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
  assert.equal(f.bumps(), 0);
  assert.equal(f.normalizations(), 0);
  assert.equal(f.created.length, 0);
});
