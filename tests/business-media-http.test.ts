import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessMediaManifest, BusinessMediaReceipt } from "../src/lib/business-media";
import { AccountAccessError } from "../src/server/auth/accounts";
import { BusinessMediaAccessError, type BusinessMediaService } from "../src/server/business-media";
import { createBusinessMediaHttpHandler } from "../src/server/business-media-http";

const baseURL = "https://business-media-http-fixture.invalid";
const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const manifest: BusinessMediaManifest = {
  businessId: id,
  businessVersion: 4,
  status: "published",
  logo: { kind: "logo", slot: 0, version: 2, width: 512, height: 512 },
  cover: { kind: "cover", slot: 0, version: 3, width: 1600, height: 600 },
  gallery: [{ kind: "gallery", slot: 1, version: 4, width: 800, height: 600 }],
};
const publicManifest = {
  businessId: id,
  logo: manifest.logo,
  cover: manifest.cover,
  gallery: manifest.gallery,
};
const image = {
  bytes: Buffer.from("fixture-normalized-image-bytes"),
  mime: "image/webp",
  width: 512,
  height: 512,
  version: 2,
};
const receipt: BusinessMediaReceipt = {
  businessId: id,
  businessVersion: 5,
  status: "pending",
  kind: "logo",
  slot: 0,
  mediaVersion: 5,
};
type Method = "readOwn" | "readPublic" | "readOwnImage" | "readPublicImage" | "save" | "remove";

function fixture(
  options: {
    failure?: { method: Method; error: Error };
    missingImage?: boolean;
    imageVersion?: number;
    extraPrivateFields?: boolean;
  } = {},
) {
  const calls: { method: Method; args: unknown[] }[] = [];
  const service = Object.fromEntries(
    (["readOwn", "readPublic", "readOwnImage", "readPublicImage", "save", "remove"] as const).map(
      (method) => [
        method,
        async (...args: unknown[]) => {
          calls.push({ method, args });
          if (options.failure?.method === method) throw options.failure.error;
          let result: unknown;
          if (method === "readOwn") result = manifest;
          else if (method === "readPublic") result = publicManifest;
          else if (method === "readOwnImage" || method === "readPublicImage")
            return options.missingImage
              ? null
              : { ...image, version: options.imageVersion ?? image.version };
          else if (method === "save") result = receipt;
          else result = { ...receipt, kind: "cover", mediaVersion: null };
          return options.extraPrivateFields
            ? {
                ...(result as Record<string, unknown>),
                ownerId: "private-owner",
                rawBytes: "never-return",
                contactEmail: "private-contact.invalid",
                status: "published",
                businessVersion: 4,
              }
            : result;
        },
      ],
    ),
  ) as unknown as BusinessMediaService;
  const http = createBusinessMediaHttpHandler({ service, baseURL });
  async function send(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      origin?: string | null;
      type?: string | null;
      match?: string | null;
      key?: string | null;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers = new Headers({ cookie: "fixture-session=only", ...options.headers });
    if (options.origin !== null) headers.set("origin", options.origin ?? baseURL);
    if (options.type !== null) headers.set("content-type", options.type ?? "image/png");
    if (options.match !== null) headers.set("if-match", options.match ?? '"4"');
    if (options.key !== null) headers.set("idempotency-key", options.key ?? requestId);
    const response = await http(
      new Request(new URL(path, baseURL), { method, headers, body: options.body }),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    return response;
  }
  return { calls, http, send };
}

test("business media manifests choose private/public authority and project only safe media metadata", async () => {
  const f = fixture({ extraPrivateFields: true });
  const own = await f.send("GET", `/api/business-media/mine/${id}`);
  assert.equal(own.status, 200);
  assert.deepEqual(await own.json(), { manifest });
  const publicReply = await f.send("GET", `/api/business-media/public/${id}`);
  assert.equal(publicReply.status, 200);
  assert.deepEqual(await publicReply.json(), { manifest: publicManifest });
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["readOwn", "readPublic"],
  );
  const headers = f.calls[0]?.args[0];
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("cookie"), "fixture-session=only");
  assert.equal(f.calls[0]?.args[1], id);
  assert.deepEqual(f.calls[1]?.args, [id]);
});

test("closed business image slots, paths, verbs and query never dispatch malformed requests", async () => {
  const f = fixture();
  for (const path of [
    `/api/business-media/mine/${id}/logo/1?v=2`,
    `/api/business-media/mine/${id}/cover/8?v=2`,
    `/api/business-media/public/${id}/gallery/0?v=2`,
    `/api/business-media/public/${id}?v=2`,
    `/api/business-media/public/${id}/logo/0`,
    `/api/business-media/public/${id}/logo/0?v=2&v=3`,
    `/api/business-media/public/${id}/logo/0?v=01`,
    `/api/business-media/public/${id}/logo/0?v=0`,
    `/api/business-media/public/${id}/logo/0?v=2147483648`,
    `/api/business-media/mine/${id}?userId=other`,
    `/api/business-media/mine/${id}/logo/0?v=2&x=1`,
    `/api/business-media/mine/${id}?${"x".repeat(8200)}`,
  ])
    assert.equal((await f.send("GET", path)).status, 400, path);
  for (const [method, path] of [
    ["GET", `/api/business-media/mine/not-a-uuid`],
    ["GET", `/api/business-media/mine/${id}/gallery/9?v=1`],
    ["GET", `/api/business-media/mine/${id}/avatar/0?v=1`],
    ["PATCH", `/api/business-media/mine/${id}/logo/0`],
    ["PUT", `/api/business-media/public/${id}/logo/0`],
    ["DELETE", `/api/business-media/mine/${id}`],
    ["POST", `/api/business-media/mine/${id}`],
    ["GET", `/api/business-media-other/public/${id}`],
  ])
    assert.equal((await f.send(method as string, path as string)).status, 404, `${method} ${path}`);
  assert.equal(
    (await f.send("PUT", `/api/business-media/mine/${id}/logo/0?v=2`, { body: image.bytes }))
      .status,
    400,
  );
  assert.equal(f.calls.length, 0);
});

test("exact write origin, strong positive CAS and UUID receipts are checked before any upload body access", async () => {
  const f = fixture(),
    path = `/api/business-media/mine/${id}/logo/0`;
  for (const origin of [null, "https://other.invalid", `${baseURL}.evil.invalid`, `${baseURL}/`])
    assert.equal((await f.send("PUT", path, { origin, body: image.bytes })).status, 403);
  for (const match of [
    null,
    "4",
    'W/"4"',
    "*",
    '"4", "5"',
    '"0"',
    '"-1"',
    '"1.5"',
    '"2147483647"',
    '"99999999999"',
  ])
    assert.equal(
      (await f.send("PUT", path, { match, body: image.bytes })).status,
      400,
      String(match),
    );
  for (const key of [
    null,
    "",
    "receipt",
    "11111111-1111-6111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222,other",
  ])
    assert.equal((await f.send("PUT", path, { key, body: image.bytes })).status, 400, String(key));
  assert.equal(f.calls.length, 0);
});

test("unauthenticated and unauthorized writes fail before request stream access", async () => {
  for (const error of [
    new AccountAccessError(401, "AUTHENTICATION_REQUIRED"),
    new BusinessMediaAccessError(404, "BUSINESS_NOT_FOUND"),
  ]) {
    const f = fixture({ failure: { method: "readOwn", error } });
    let bodyReads = 0;
    const request = new Request(`${baseURL}/api/business-media/mine/${id}/logo/0`, {
      method: "PUT",
      headers: {
        origin: baseURL,
        "content-type": "image/png",
        "if-match": '"4"',
        "idempotency-key": requestId,
      },
    });
    Object.defineProperty(request, "body", {
      get() {
        bodyReads++;
        throw new Error("unauthorized upload must not be consumed");
      },
    });
    const response = await f.http(request);
    assert.equal(response.status, error.status);
    assert.deepEqual(await response.json(), { code: error.code });
    assert.equal(bodyReads, 0);
    assert.deepEqual(
      f.calls.map((c) => c.method),
      ["readOwn"],
    );
  }
});

test("raster uploads forward original bytes, slot, current global version and stable receipt key", async () => {
  const f = fixture();
  for (const [kind, slot, type] of [
    ["logo", 0, "image/jpeg"],
    ["cover", 0, "image/png; charset=binary"],
    ["gallery", 8, "image/webp"],
  ] as const) {
    const response = await f.send("PUT", `/api/business-media/mine/${id}/${kind}/${slot}`, {
      body: image.bytes,
      type,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { receipt });
    const call = f.calls.at(-1);
    assert.equal(call?.method, "save");
    assert.deepEqual(call?.args.slice(1), [
      id,
      kind,
      slot,
      { expectedVersion: 4, bytes: new Uint8Array(image.bytes) },
      requestId,
    ]);
  }
  for (const type of [null, "image/svg+xml", "image/gif", "text/plain", "application/octet-stream"])
    assert.equal(
      (await f.send("PUT", `/api/business-media/mine/${id}/logo/0`, { body: image.bytes, type }))
        .status,
      415,
    );
  for (const body of [undefined, "", new Uint8Array()])
    assert.equal(
      (await f.send("PUT", `/api/business-media/mine/${id}/logo/0`, { body })).status,
      400,
    );
  assert.equal(f.calls.filter((c) => c.method === "save").length, 3);
});

test("actual streamed upload bytes exceed four MiB despite false Content-Length and stop before storage", async () => {
  const f = fixture();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(`${baseURL}/api/business-media/mine/${id}/gallery/1`, {
    method: "PUT",
    headers: {
      origin: baseURL,
      "content-type": "image/png",
      "content-length": "1",
      "if-match": '"4"',
      "idempotency-key": requestId,
    },
    body,
    duplex: "half",
  } as RequestInit);
  const response = await f.http(request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { code: "REQUEST_TOO_LARGE" });
  assert.equal(cancelled, true);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["readOwn"],
  );
});

test("private and public images require the exact requested version and always return protected no-store bytes", async () => {
  const f = fixture({ imageVersion: 2147483647 });
  for (const area of ["mine", "public"]) {
    const response = await f.send("GET", `/api/business-media/${area}/${id}/logo/0?v=2147483647`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(
      response.headers.get("content-disposition"),
      'inline; filename="business-logo-0.webp"',
    );
    const call = f.calls.at(-1);
    assert.equal(call?.method, area === "mine" ? "readOwnImage" : "readPublicImage");
    assert.deepEqual(area === "mine" ? call?.args.slice(1) : call?.args, [
      id,
      "logo",
      0,
      2147483647,
    ]);
  }
  const missing = await fixture({ missingImage: true }).send(
    "GET",
    `/api/business-media/public/${id}/logo/0?v=2`,
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: "MEDIA_NOT_FOUND" });
  assert.equal(
    (await fixture().send("GET", `/api/business-media/public/${id}/logo/0?v=3`)).status,
    404,
  );
});

test("removal has no request body and returns an original command receipt without pretending it is fresh state", async () => {
  const f = fixture(),
    path = `/api/business-media/mine/${id}/cover/0`;
  const response = await f.send("DELETE", path);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    receipt: { ...receipt, kind: "cover", mediaVersion: null },
  });
  const call = f.calls.at(-1);
  assert.equal(call?.method, "remove");
  assert.deepEqual(call?.args.slice(1), [id, "cover", 0, { expectedVersion: 4 }, requestId]);
  assert.equal((await f.send("DELETE", path, { body: "" })).status, 400);
  assert.equal((await f.send("DELETE", path, { body: "{}" })).status, 400);
  assert.equal(f.calls.filter((c) => c.method === "remove").length, 1);
});

test("revoked public media and typed conflicts retain safe errors; internals and storage details are redacted", async () => {
  for (const [method, path, error, status, code] of [
    [
      "GET",
      `/api/business-media/public/${id}`,
      new BusinessMediaAccessError(404, "BUSINESS_NOT_FOUND"),
      404,
      "BUSINESS_NOT_FOUND",
    ],
    [
      "GET",
      `/api/business-media/public/${id}/logo/0?v=2`,
      new BusinessMediaAccessError(404, "BUSINESS_NOT_FOUND"),
      404,
      "BUSINESS_NOT_FOUND",
    ],
    [
      "PUT",
      `/api/business-media/mine/${id}/logo/0`,
      new BusinessMediaAccessError(409, "VERSION_CONFLICT"),
      409,
      "VERSION_CONFLICT",
    ],
    [
      "PUT",
      `/api/business-media/mine/${id}/logo/0`,
      new BusinessMediaAccessError(409, "IDEMPOTENCY_CONFLICT"),
      409,
      "IDEMPOTENCY_CONFLICT",
    ],
    [
      "PUT",
      `/api/business-media/mine/${id}/logo/0`,
      new Error("private database URL and raw image bytes"),
      503,
      "BUSINESS_MEDIA_UNAVAILABLE",
    ],
  ] as const) {
    const failureMethod: Method =
      method === "PUT" ? "save" : path.includes("/logo/") ? "readPublicImage" : "readPublic";
    const f = fixture({ failure: { method: failureMethod, error } }),
      response = await f.send(method, path, { body: method === "PUT" ? image.bytes : undefined });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  }
});
