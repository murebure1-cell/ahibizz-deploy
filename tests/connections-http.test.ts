import assert from "node:assert/strict";
import test from "node:test";
import type { PublicPerson } from "../src/lib/connections";
import { AccountAccessError } from "../src/server/auth/accounts";
import { ConnectionsAccessError, type ConnectionsService } from "../src/server/connections";
import { createConnectionsHttpHandler } from "../src/server/connections-http";

const baseURL = "https://connections-fixture.invalid";
const key = "78f214cd-6971-4a05-88ee-3af7f5874c4d";
const connectionId = "d170008a-cafe-4c60-8564-6c581bc758be";
const person: PublicPerson = {
  id: "fixture-person",
  name: "Fixture person",
  verified: false,
  platformFounder: false,
  platformAdministrator: false,
  city: "Tuzla",
  countryCode: "BA",
  bio: null,
  skills: [],
  workStatus: "not_specified",
  photoVersion: 2,
  coverVersion: null,
};
const relationship = {
  id: connectionId,
  personId: person.id,
  status: "pending",
  direction: "outgoing",
  version: 1,
};
const visibility = { isPublic: true, profileVersion: 3 };
const image = {
  bytes: Buffer.from("normalized-fixture-only"),
  mime: "image/webp",
  width: 512,
  height: 512,
  version: 2,
};
type Method = keyof ConnectionsService;
function fixture(
  options: {
    failure?: { method: Method; error: Error };
    viewer?: { id: string } | null;
    missingImage?: boolean;
    privatePeer?: boolean;
  } = {},
) {
  const calls: { method: Method; args: unknown[] }[] = [];
  const leakedPerson = {
    ...person,
    email: "must-not-leak@fixture.invalid",
    birthDate: "1990-01-01",
    role: "owner",
    canCustomizeCover: true,
  };
  const service = Object.fromEntries(
    (
      [
        "readVisibility",
        "setVisibility",
        "searchPublic",
        "readPublic",
        "readPublicStats",
        "readPublicMedia",
        "readViewer",
        "relationship",
        "relationships",
        "list",
        "request",
        "transition",
      ] as Method[]
    ).map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (options.failure?.method === method) throw options.failure.error;
        if (method === "readVisibility" || method === "setVisibility")
          return { ...visibility, email: "must-not-leak" };
        if (method === "readViewer")
          return options.viewer === undefined ? { id: "fixture-viewer" } : options.viewer;
        if (method === "searchPublic") return { items: [leakedPerson], page: 1, hasMore: false };
        if (method === "readPublic") return leakedPerson;
        if (method === "readPublicStats")
          return { businesses: 2, friends: 5, joinedYear: 2026, email: "must-not-leak" };
        if (method === "readPublicMedia") return options.missingImage ? null : image;
        if (method === "list")
          return {
            items: [
              {
                ...relationship,
                person: options.privatePeer ? null : leakedPerson,
                email: "must-not-leak",
              },
            ],
            page: 1,
            hasMore: false,
          };
        return { ...relationship, secret: "must-not-leak" };
      },
    ]),
  ) as unknown as ConnectionsService;
  const http = createConnectionsHttpHandler({ service, baseURL });
  async function send(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      origin?: string | null;
      type?: string | null;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers = new Headers({ cookie: "fixture=only", ...options.headers });
    if (options.origin !== null) headers.set("origin", options.origin ?? baseURL);
    if (options.type !== null) headers.set("content-type", options.type ?? "application/json");
    const response = await http(
      new Request(new URL(`/api/connections/${path}`, baseURL), {
        method,
        headers,
        body: options.body,
      }),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    return response;
  }
  return { calls, http, send };
}

test("public people endpoints whitelist person data and distinguish anonymous, own and connected viewers", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.send("GET", "people?q=Tuzla&page=1")).json(), {
    items: [person],
    page: 1,
    hasMore: false,
    viewerId: "fixture-viewer",
    relationships: {},
  });
  assert.deepEqual(f.calls[0]?.args[0], { q: "Tuzla", page: 1 });
  assert.deepEqual(await (await f.send("GET", `people/${person.id}`)).json(), {
    person,
    viewerId: "fixture-viewer",
    relationship,
    stats: { businesses: 2, friends: 5, joinedYear: 2026 },
    storyBusinessId: null,
  });
  const headers = f.calls.find((call) => call.method === "relationship")?.args[0];
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("cookie"), "fixture=only");
  for (const viewer of [null, { id: person.id }]) {
    const special = fixture({ viewer });
    assert.deepEqual(await (await special.send("GET", `people/${person.id}`)).json(), {
      person,
      viewerId: viewer?.id ?? null,
      relationship: { id: null, personId: person.id, status: "none", direction: null, version: 0 },
      stats: { businesses: 2, friends: 5, joinedYear: 2026 },
      storyBusinessId: null,
    });
    assert.equal(
      special.calls.some((call) => call.method === "relationship"),
      false,
    );
  }
});

test("private connection lists return nullable peers without identity fields and retain removable relationship state", async () => {
  for (const privatePeer of [false, true]) {
    const f = fixture({ privatePeer });
    assert.deepEqual(await (await f.send("GET", "connections?view=contacts&page=2")).json(), {
      items: [{ ...relationship, person: privatePeer ? null : person }],
      page: 1,
      hasMore: false,
    });
    assert.deepEqual(f.calls[0]?.args[1], { view: "contacts", page: 2 });
  }
  assert.deepEqual(await (await fixture().send("GET", "visibility")).json(), { visibility });
});

test("unknown routes and unsupported methods never fall through to a service mutation", async () => {
  const f = fixture();
  for (const [method, path] of [
    ["GET", ""],
    ["GET", "people/person/private"],
    ["GET", "people/person/media/avatar?v=1"],
    ["POST", "people"],
    ["DELETE", "visibility"],
    ["PATCH", `people/${person.id}/request`],
    ["POST", `connections/not-a-uuid/accept`],
    ["POST", `connections/${connectionId}/arbitrary`],
  ]) {
    assert.equal((await f.send(method as string, path as string)).status, 404);
  }
  assert.equal(f.calls.length, 0);
});

test("queries reject duplicates, unexpected fields, malformed versions and unbounded pages before service calls", async () => {
  const f = fixture();
  for (const path of [
    "people?q=a&q=b",
    "people?page=0",
    "people?page=1001",
    "people?page=1.0",
    "people?page=01",
    "people?page=-1",
    "people?email=private",
    "people?q=%00",
    `people?q=${"x".repeat(101)}`,
    "connections?view=contacts&view=incoming",
    "connections?view=accepted",
    "connections",
    `people/${person.id}?owner=private`,
    "visibility?isPublic=true",
    `people/${person.id}/media/photo`,
    `people/${person.id}/media/photo?v=0`,
    `people/${person.id}/media/photo?v=2147483648`,
    `people/${person.id}/media/photo?v=1&v=2`,
    `people/${person.id}/request?x=1`,
    `people?${"q".repeat(8200)}`,
  ]) {
    assert.equal(
      (
        await f.send(path.includes("/request") ? "POST" : "GET", path, {
          body: path.includes("/request") ? "{}" : undefined,
        })
      ).status,
      400,
      path,
    );
  }
  assert.equal(f.calls.length, 0);
});

test("writes require exact Origin and fresh authority before touching request body", async () => {
  const f = fixture();
  for (const origin of [null, "https://untrusted.invalid", `${baseURL}.untrusted.invalid`])
    assert.equal((await f.send("PATCH", "visibility", { origin, body: "{}" })).status, 403);
  assert.equal(f.calls.length, 0);
  const denied = fixture({
    failure: {
      method: "readVisibility",
      error: new AccountAccessError(401, "AUTHENTICATION_REQUIRED"),
    },
  });
  let touched = false;
  const request = new Request(`${baseURL}/api/connections/people/${person.id}/request`, {
    method: "POST",
    headers: { origin: baseURL, "content-type": "application/json" },
  });
  Object.defineProperty(request, "body", {
    get() {
      touched = true;
      throw new Error("private body must not be read");
    },
  });
  assert.equal((await denied.http(request)).status, 401);
  assert.equal(touched, false);
  assert.deepEqual(
    denied.calls.map((call) => call.method),
    ["readVisibility"],
  );
});

test("writes preserve idempotency, expected version and route-defined action while stripping private response fields", async () => {
  const f = fixture();
  const response = await f.send("POST", `people/${person.id}/request`, {
    body: JSON.stringify({ expectedVersion: 0, idempotencyKey: key }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { relationship });
  assert.deepEqual(f.calls.at(-1)?.args.slice(1), [person.id, { expectedVersion: 0 }, key]);
  for (const action of ["accept", "decline", "cancel", "remove"]) {
    const response = await f.send("POST", `connections/${connectionId}/${action}`, {
      body: JSON.stringify({ expectedVersion: 2, idempotencyKey: key }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { relationship });
    assert.deepEqual(f.calls.at(-1)?.args.slice(1), [
      connectionId,
      { action, expectedVersion: 2 },
      key,
    ]);
  }
  const visibilityResponse = await f.send("PATCH", "visibility", {
    body: JSON.stringify({ isPublic: false, expectedVersion: 3, idempotencyKey: key }),
  });
  assert.deepEqual(await visibilityResponse.json(), { visibility });
  assert.deepEqual(f.calls.at(-1)?.args.slice(1), [{ isPublic: false, expectedVersion: 3 }, key]);
});

test("JSON inputs are closed, strictly decoded and limited by actual stream bytes", async () => {
  const f = fixture();
  const valid = { expectedVersion: 0, idempotencyKey: key };
  for (const body of [
    undefined,
    "",
    "null",
    "[]",
    '{"bad":}',
    new Uint8Array([0xff]),
    JSON.stringify({ ...valid, recipientId: "spoof" }),
    JSON.stringify({ ...valid, expectedVersion: -1 }),
    JSON.stringify({ ...valid, expectedVersion: 2147483647 }),
    JSON.stringify({ ...valid, expectedVersion: 1.1 }),
    JSON.stringify({ ...valid, idempotencyKey: "not-a-uuid" }),
    JSON.stringify({ expectedVersion: 0 }),
    `{"expectedVersion":1,"expectedVersion":0,"idempotencyKey":"${key}"}`,
    `{"expectedVersion":0,"expectedVersion":0,"idempotencyKey":"${key}"}`,
    `{"expectedVersion":0,"expected\\u0056ersion":0,"idempotencyKey":"${key}"}`,
  ])
    assert.equal((await f.send("POST", `people/${person.id}/request`, { body })).status, 400);
  assert.equal(
    (await f.send("PATCH", "visibility", { body: JSON.stringify({ ...valid, isPublic: "true" }) }))
      .status,
    400,
  );
  assert.equal(
    (await f.send("POST", `connections/${connectionId}/accept`, { body: JSON.stringify(valid) }))
      .status,
    400,
  );
  for (const type of [null, "text/plain", "application/json-patch+json"])
    assert.equal(
      (await f.send("POST", `people/${person.id}/request`, { body: JSON.stringify(valid), type }))
        .status,
      415,
    );
  const oversized = await f.send("POST", `people/${person.id}/request`, {
    body: JSON.stringify({ idempotencyKey: "😀".repeat(1100), expectedVersion: 0 }),
    headers: { "content-length": "1" },
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { code: "REQUEST_TOO_LARGE" });
  assert.equal(
    f.calls.some((call) => ["request", "setVisibility", "transition"].includes(call.method)),
    false,
  );
});

test("public media checks exact current version without viewer identity and uses revocable no-store binary responses", async () => {
  const f = fixture();
  const response = await f.send("GET", `people/${person.id}/media/photo?v=2`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(
    response.headers.get("content-disposition"),
    'inline; filename="profile-photo.webp"',
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ["readPublicMedia"],
  );
  assert.deepEqual(f.calls[0]?.args, [person.id, "photo", 2]);
  assert.equal((await f.send("GET", `people/${person.id}/media/photo?v=2147483647`)).status, 200);
  assert.deepEqual(f.calls.at(-1)?.args, [person.id, "photo", 2147483647]);
  assert.equal(
    (await fixture({ missingImage: true }).send("GET", `people/${person.id}/media/cover?v=2`))
      .status,
    404,
  );
});

test("safe typed errors retain their code and generic errors reveal no database or credential detail", async () => {
  for (const [error, status, code] of [
    [new ConnectionsAccessError(409, "VERSION_CONFLICT"), 409, "VERSION_CONFLICT"],
    [new AccountAccessError(403, "ACCOUNT_SUSPENDED"), 403, "ACCOUNT_SUSPENDED"],
    [
      new Error("postgresql://private:password@fixture.invalid/private"),
      503,
      "CONNECTIONS_UNAVAILABLE",
    ],
  ] as const) {
    const response = await fixture({ failure: { method: "readPublic", error } }).send(
      "GET",
      `people/${person.id}`,
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  }
});
