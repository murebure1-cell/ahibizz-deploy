import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError } from "../src/server/auth/accounts";
import { BookingAccessError, type BookingService } from "../src/server/booking";
import { createBookingHttpHandler } from "../src/server/booking-http";

const baseURL = "https://booking-http-fixture.invalid";
const id = "7ab24391-8048-4b60-aefc-09806238db1b";
const key = "7d6fe998-ff40-4830-bb97-69712436eb5b";
const methods = [
  "publicConfig",
  "slots",
  "readSettings",
  "saveSettings",
  "calendar",
  "listMine",
  "createRequest",
  "createManual",
  "transition",
] as const;
type Method = (typeof methods)[number];

function fixture(failure?: Error) {
  const calls: { method: Method; args: unknown[] }[] = [];
  const values = Object.fromEntries(methods.map((method) => [method, { source: method }]));
  const service = Object.fromEntries(
    methods.map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (failure) throw failure;
        return values[method];
      },
    ]),
  ) as unknown as BookingService;
  const http = createBookingHttpHandler({ service, baseURL });
  async function send(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      origin?: string | null;
      contentType?: string | null;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers = new Headers({ cookie: "fixture=only", ...options.headers });
    if (options.origin !== null) headers.set("origin", options.origin ?? baseURL);
    if (options.contentType !== null)
      headers.set("content-type", options.contentType ?? "application/json");
    const response = await http(
      new Request(new URL(path, baseURL), { method, headers, body: options.body }),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    return { status: response.status, data: await response.json() };
  }
  return { calls, values, send };
}

test("public reads call only public service methods with the closed query", async () => {
  const f = fixture();
  assert.deepEqual(await f.send("GET", `/api/booking/businesses/${id}`), {
    status: 200,
    data: { booking: f.values.publicConfig },
  });
  assert.deepEqual(f.calls[0], { method: "publicConfig", args: [id] });
  assert.deepEqual(
    await f.send("GET", `/api/booking/businesses/${id}/slots?serviceId=${key}&date=2030-01-07`),
    {
      status: 200,
      data: f.values.slots,
    },
  );
  assert.deepEqual(f.calls[1], {
    method: "slots",
    args: [id, { serviceId: key, date: "2030-01-07" }],
  });
});

test("private reads forward actual request headers and the selected business/range/page to authority checks", async () => {
  const f = fixture();
  for (const [path, method, rest, result] of [
    ["/mine?page=2", "listMine", [{ page: 2 }], f.values.listMine],
    ["/mine?page=2&view=upcoming", "listMine", [{ page: 2, view: "upcoming" }], f.values.listMine],
    ["/mine?view=history", "listMine", [{ view: "history" }], f.values.listMine],
    [`/mine/businesses/${id}/settings`, "readSettings", [id], { settings: f.values.readSettings }],
    [
      `/mine/businesses/${id}/calendar?from=2030-01-07T00%3A00%3A00Z&to=2030-01-08T00%3A00%3A00Z`,
      "calendar",
      [id, { from: "2030-01-07T00:00:00Z", to: "2030-01-08T00:00:00Z" }],
      f.values.calendar,
    ],
  ] as const) {
    assert.deepEqual(await f.send("GET", `/api/booking${path}`), { status: 200, data: result });
    const call = f.calls.at(-1);
    assert.ok(call);
    assert.equal(call.method, method);
    const headers = call.args[0];
    assert.ok(headers instanceof Headers);
    assert.equal(headers.get("cookie"), "fixture=only");
    assert.deepEqual(call.args.slice(1), rest);
  }
});

test("settings, customer/manual creates and actions dispatch once with the original body and create UUID", async () => {
  const f = fixture();
  const cases: {
    method: string;
    path: string;
    operation: Method;
    body: unknown;
    status: number;
    wrapper: string;
    create?: boolean;
  }[] = [
    {
      method: "PATCH",
      path: `/mine/businesses/${id}/settings`,
      operation: "saveSettings",
      body: { expectedVersion: 2, enabled: false },
      status: 200,
      wrapper: "settings",
    },
    {
      method: "POST",
      path: `/businesses/${id}/requests`,
      operation: "createRequest",
      body: { serviceId: key, startsAt: "2030-01-07T08:00:00.000Z", configurationVersion: 2 },
      status: 201,
      wrapper: "entry",
      create: true,
    },
    {
      method: "POST",
      path: `/mine/businesses/${id}/entries`,
      operation: "createManual",
      body: {
        kind: "block",
        startsAt: "2030-01-07T08:00:00.000Z",
        endsAt: "2030-01-07T09:00:00.000Z",
      },
      status: 201,
      wrapper: "entry",
      create: true,
    },
    {
      method: "POST",
      path: `/entries/${id}/action`,
      operation: "transition",
      body: { expectedVersion: 2, action: "cancel" },
      status: 200,
      wrapper: "entry",
    },
  ];
  for (const item of cases) {
    assert.deepEqual(
      await f.send(item.method, `/api/booking${item.path}`, {
        body: JSON.stringify(item.body),
        headers: { "idempotency-key": key },
        contentType: "Application/JSON; charset=utf-8",
      }),
      {
        status: item.status,
        data: { [item.wrapper]: f.values[item.operation] },
      },
    );
    const call = f.calls.at(-1);
    assert.ok(call);
    assert.equal(call.method, item.operation);
    assert.ok(call.args[0] instanceof Headers);
    assert.equal(call.args[0].get("cookie"), "fixture=only");
    assert.deepEqual(call.args.slice(1), [id, item.body, ...(item.create ? [key] : [])]);
  }
  assert.equal(f.calls.length, cases.length);
});

test("unsupported paths and verbs never invoke a read or mutation", async () => {
  const f = fixture();
  for (const [method, path] of [
    ["GET", "/api/booking-other/mine"],
    ["GET", "/api/booking/mine/extra"],
    ["GET", `/api/booking/businesses/${id}/requests`],
    ["POST", `/api/booking/mine/businesses/${id}/settings`],
    ["PUT", `/api/booking/mine/businesses/${id}/settings`],
    ["DELETE", `/api/booking/entries/${id}/action`],
    ["POST", `/api/booking/businesses/${id}/slots`],
  ])
    assert.deepEqual(
      await f.send(method as string, path as string, { body: method === "GET" ? undefined : "{}" }),
      { status: 404, data: { code: "NOT_FOUND" } },
    );
  assert.equal(f.calls.length, 0);
});

test("duplicate, unknown and malformed query parameters fail before service dispatch", async () => {
  const f = fixture();
  for (const path of [
    `/businesses/${id}?actorId=other`,
    `/businesses/${id}/slots?serviceId=${key}&serviceId=${key}&date=2030-01-07`,
    "/mine?page=1&page=2",
    "/mine?page=1.5",
    "/mine?page=abc",
    "/mine?ownerId=other",
    "/mine?view=upcoming&view=history",
    "/mine?view=all",
    "/mine?view=UPCOMING",
    "/mine?view=",
    `/mine/businesses/${id}/settings?version=1`,
    `/mine/businesses/${id}/calendar?from=x&to=y&customerId=other`,
  ])
    assert.deepEqual(await f.send("GET", `/api/booking${path}`), {
      status: 400,
      data: { code: "INVALID_BOOKING_INPUT" },
    });
  assert.equal(
    (
      await f.send("PATCH", `/api/booking/mine/businesses/${id}/settings?enabled=true`, {
        body: "{}",
      })
    ).status,
    400,
  );
  assert.equal((await f.send("GET", `/api/booking/mine?${"x".repeat(8200)}`)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("writes require the exact origin and JSON media type before any authority or mutation call", async () => {
  const f = fixture(),
    path = `/api/booking/businesses/${id}/requests`;
  for (const origin of [null, "https://other.invalid", `${baseURL}.other.invalid`])
    assert.deepEqual(await f.send("POST", path, { origin, body: "{}" }), {
      status: 403,
      data: { code: "INVALID_ORIGIN" },
    });
  for (const contentType of [null, "text/plain", "application/jsonp"])
    assert.deepEqual(await f.send("POST", path, { contentType, body: "{}" }), {
      status: 415,
      data: { code: "INVALID_CONTENT_TYPE" },
    });
  assert.equal(f.calls.length, 0);
});

test("body decoding rejects malformed JSON/UTF8 and measures actual bytes despite a false Content-Length", async () => {
  const f = fixture(),
    path = `/api/booking/businesses/${id}/requests`;
  for (const body of [undefined, "", '{"broken":}', new Uint8Array([0xff])])
    assert.deepEqual(await f.send("POST", path, { body }), {
      status: 400,
      data: { code: "INVALID_BOOKING_INPUT" },
    });
  assert.deepEqual(
    await f.send("POST", path, {
      body: JSON.stringify({ text: "😀".repeat(5000) }),
      headers: { "content-length": "1" },
    }),
    {
      status: 413,
      data: { code: "REQUEST_TOO_LARGE" },
    },
  );
  assert.equal(f.calls.length, 0);
});

test("typed authority/conflict failures retain safe codes while unknown internal failures are redacted", async () => {
  for (const [error, status, code] of [
    [new AccountAccessError(401, "AUTHENTICATION_REQUIRED"), 401, "AUTHENTICATION_REQUIRED"],
    [new BookingAccessError(409, "VERSION_CONFLICT"), 409, "VERSION_CONFLICT"],
    [new Error("postgresql://private:secret@private.invalid/db"), 503, "BOOKING_UNAVAILABLE"],
  ] as const) {
    const f = fixture(error);
    const response = await f.send("GET", "/api/booking/mine");
    assert.deepEqual(response, { status, data: { code } });
    assert.equal(JSON.stringify(response).includes("secret"), false);
    assert.equal(f.calls.length, 1);
  }
});
