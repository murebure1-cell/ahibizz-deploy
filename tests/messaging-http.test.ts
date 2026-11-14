import assert from "node:assert/strict";
import test from "node:test";
import type { ChatConversation, ChatReceipt, ChatThread } from "../src/lib/messaging";
import { AccountAccessError } from "../src/server/auth/accounts";
import { MessagingAccessError, type MessagingService } from "../src/server/messaging";
import { createMessagingHttpHandler, handleMessagingRequest } from "../src/server/messaging-http";

const baseURL = "https://messaging-http-fixture.invalid",
  id = "11111111-1111-4111-8111-111111111111",
  key = "22222222-2222-4222-8222-222222222222",
  messageId = "33333333-3333-4333-8333-333333333333";
const when = "2026-11-14T13:00:00.000Z";
const thread: ChatThread = {
  id,
  kind: "person",
  inbox: "personal",
  title: "Ogledni sagovornik",
  targetId: "fixture-person",
  canSend: true,
  blockedByMe: false,
  blocked: false,
  latestSequence: 1,
  readSequence: 0,
  unreadCount: 1,
  lastMessage: { body: "Pozdrav", createdAt: when },
};
const conversation: ChatConversation = {
  thread,
  items: [{ id: messageId, sequence: 1, body: "Pozdrav", createdAt: when, from: "peer" }],
  hasMore: false,
};
const receipt: ChatReceipt = { threadId: id, messageId: null, sequence: null };
type Method = "list" | "open" | "read" | "send" | "markRead" | "block";
function fixture(
  options: {
    failure?: { method: Method; error: Error };
    malformed?: Method;
    extraPrivate?: boolean;
  } = {},
) {
  const calls: { method: Method; args: unknown[] }[] = [];
  const service = Object.fromEntries(
    (["list", "open", "read", "send", "markRead", "block"] as const).map((method) => [
      method,
      async (...args: unknown[]) => {
        calls.push({ method, args });
        if (options.failure?.method === method) throw options.failure.error;
        if (options.malformed === method) return { secret: "Never serialized" };
        if (method === "list")
          return {
            items: [options.extraPrivate ? { ...thread, actorSecret: "Never serialized" } : thread],
            page: 1,
            hasMore: false,
            privateToken: "Never serialized",
          };
        if (method === "read")
          return options.extraPrivate
            ? {
                ...conversation,
                ownerEmail: "Never serialized",
                items: conversation.items.map((item) => ({
                  ...item,
                  senderEmail: "Never serialized",
                })),
              }
            : conversation;
        if (method === "markRead") return { readSequence: 1, privateToken: "Never serialized" };
        return {
          ...receipt,
          ...(method === "send" ? { messageId, sequence: 1 } : {}),
          privateToken: "Never serialized",
        };
      },
    ]),
  ) as unknown as MessagingService;
  const http = createMessagingHttpHandler({ service, baseURL });
  async function send(
    method: string,
    path: string,
    options: {
      body?: BodyInit;
      origin?: string | null;
      type?: string | null;
      key?: string | null;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers = new Headers({ cookie: "fixture-session=only", ...options.headers });
    if (options.origin !== null) headers.set("origin", options.origin ?? baseURL);
    if (options.type !== null) headers.set("content-type", options.type ?? "application/json");
    if (options.key !== null) headers.set("idempotency-key", options.key ?? key);
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.body instanceof ReadableStream ? { duplex: "half" as const } : {}),
    };
    const response = await http(new Request(new URL(path, baseURL), init));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("set-cookie"), null);
    return response;
  }
  return { calls, http, send };
}

test("private GETs forward signed request headers and closed pagination, projecting only safe thread/message fields", async () => {
  const f = fixture({ extraPrivate: true });
  const listed = await f.send("GET", "/api/messaging/threads?inbox=business&page=2");
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { items: [thread], page: 1, hasMore: false });
  const read = await f.send("GET", `/api/messaging/threads/${id}?before=7`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), conversation);
  assert.deepEqual(
    f.calls.map((call) => [call.method, ...call.args.slice(1)]),
    [
      ["list", { inbox: "business", page: 2 }],
      ["read", id, { before: 7 }],
    ],
  );
  for (const call of f.calls) {
    assert.ok(call.args[0] instanceof Headers);
    assert.equal(call.args[0].get("cookie"), "fixture-session=only");
  }
  await f.send("GET", "/api/messaging/threads");
  assert.deepEqual(f.calls[2]?.args[1], { inbox: "personal", page: 1 });
  await f.send("GET", `/api/messaging/threads/${id}`);
  assert.deepEqual(f.calls[3]?.args[2], {});
});

test("open, send, block and read dispatch exactly once with original intent/key and whitelist each acknowledgement", async () => {
  const f = fixture();
  const openInput = { kind: "person", targetId: "fixture-person" };
  let response = await f.send("POST", "/api/messaging/threads", {
    body: JSON.stringify(openInput),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { receipt });
  const input = { body: "  Zdravo\r\nSvijet  " };
  response = await f.send("POST", `/api/messaging/threads/${id}/messages`, {
    body: JSON.stringify(input),
    type: "application/json; charset=utf-8",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { receipt: { ...receipt, messageId, sequence: 1 } });
  response = await f.send("POST", `/api/messaging/threads/${id}/block`, {
    body: '{"blocked":true}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { receipt });
  response = await f.send("POST", `/api/messaging/threads/${id}/read`, {
    key: null,
    body: '{"throughSequence":1}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { readSequence: 1 });
  assert.deepEqual(
    f.calls.map((call) => [call.method, ...call.args.slice(1)]),
    [
      ["open", openInput, key],
      ["send", id, input, key],
      ["block", id, { blocked: true }, key],
      ["markRead", id, { throughSequence: 1 }],
    ],
  );
});

test("unsupported paths and verbs and foreign/duplicate/coerced query input never reach private service", async () => {
  const f = fixture();
  for (const [method, path] of [
    ["PUT", "/api/messaging/threads"],
    ["DELETE", `/api/messaging/threads/${id}`],
    ["GET", `/api/messaging/threads/${id}/messages`],
    ["GET", "/api/messaging/threads/not-a-uuid"],
    ["POST", `/api/messaging/threads/${id}`],
    ["POST", `/api/messaging/threads/${id}/unknown`],
    ["GET", "/api/messaging/threads/"],
    ["GET", "/api/messaging/admin"],
  ])
    assert.equal((await f.send(method as string, path as string)).status, 404);
  for (const path of [
    "/api/messaging/threads?inbox=personal&inbox=business",
    "/api/messaging/threads?inbox=admin",
    "/api/messaging/threads?page=0",
    "/api/messaging/threads?page=01",
    "/api/messaging/threads?page=1.0",
    "/api/messaging/threads?page=1001",
    "/api/messaging/threads?owner=other",
    `/api/messaging/threads/${id}?before=0`,
    `/api/messaging/threads/${id}?before=2147483648`,
    `/api/messaging/threads/${id}?before=2&before=3`,
    `/api/messaging/threads/${id}?page=1`,
    `/api/messaging/threads/${id}#secret`,
  ])
    assert.equal((await f.send("GET", path)).status, 400, path);
  assert.equal(
    (
      await f.send("POST", `/api/messaging/threads/${id}/messages?before=1`, {
        body: '{"body":"Hi"}',
      })
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});

test("writes reject cross-origin, wrong media types and missing command keys before reading the body", async () => {
  const f = fixture();
  let touched = 0;
  const request = (origin: string | null, type: string | null, command: string | null) => {
    const headers = new Headers();
    if (origin !== null) headers.set("origin", origin);
    if (type !== null) headers.set("content-type", type);
    if (command !== null) headers.set("idempotency-key", command);
    const value = {
      url: `${baseURL}/api/messaging/threads`,
      method: "POST",
      headers,
      get body() {
        touched++;
        throw Error("body must not be touched");
      },
    };
    return f.http(value as unknown as Request);
  };
  for (const origin of [null, "https://evil.invalid", `${baseURL}/`, "null"])
    assert.equal((await request(origin, "application/json", key)).status, 403);
  for (const type of [null, "text/plain", "application/json; charset=latin1"])
    assert.equal((await request(baseURL, type, key)).status, 415);
  for (const command of [null, "", "not-a-uuid"])
    assert.equal((await request(baseURL, "application/json", command)).status, 400);
  assert.equal(touched, 0);
  assert.equal(f.calls.length, 0);
});

test("closed bodies reject unknown fields, non-text content and control/spoofing input before mutation", async () => {
  const f = fixture();
  for (const value of [
    { kind: "admin", targetId: "person" },
    { kind: "business", targetId: "not-a-uuid" },
    { kind: "person", targetId: "../private" },
    { kind: "person", targetId: "person", role: "owner" },
    null,
    [],
    {},
  ])
    assert.equal(
      (await f.send("POST", "/api/messaging/threads", { body: JSON.stringify(value) })).status,
      400,
    );
  for (const value of [
    { body: "" },
    { body: "  " },
    { body: 1 },
    { body: "hi", senderId: "other" },
    { body: "A\u202eB" },
    { body: "A\u0000B" },
    { body: "x".repeat(2001) },
    {},
  ])
    assert.equal(
      (
        await f.send("POST", `/api/messaging/threads/${id}/messages`, {
          body: JSON.stringify(value),
        })
      ).status,
      400,
    );
  for (const value of [{ blocked: 1 }, { blocked: false, asAdmin: true }, {}])
    assert.equal(
      (await f.send("POST", `/api/messaging/threads/${id}/block`, { body: JSON.stringify(value) }))
        .status,
      400,
    );
  for (const value of [
    { throughSequence: -1 },
    { throughSequence: "1" },
    { throughSequence: 2147483648 },
    { throughSequence: 1, actorId: "other" },
    {},
  ])
    assert.equal(
      (
        await f.send("POST", `/api/messaging/threads/${id}/read`, {
          key: null,
          body: JSON.stringify(value),
        })
      ).status,
      400,
    );
  assert.equal(f.calls.length, 0);
});

test("JSON decoding validates UTF8 and caps actual streamed bytes despite misleading framing", async () => {
  const f = fixture();
  assert.equal((await f.send("POST", "/api/messaging/threads", { body: "{not-json" })).status, 400);
  assert.equal(
    (await f.send("POST", "/api/messaging/threads", { body: new Uint8Array([0xff]) })).status,
    400,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16385));
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal(
    (await f.send("POST", "/api/messaging/threads", { body, headers: { "Content-Length": "1" } }))
      .status,
    413,
  );
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 0);
});

test("typed denials keep only safe codes, while malformed acknowledgements and private server errors fail closed", async () => {
  for (const error of [
    new MessagingAccessError(409, "MESSAGING_BLOCKED"),
    new AccountAccessError(401, "AUTHENTICATION_REQUIRED"),
  ]) {
    const f = fixture({ failure: { method: "read", error } }),
      response = await f.send("GET", `/api/messaging/threads/${id}`);
    assert.equal(response.status, error.status);
    assert.deepEqual(await response.json(), { code: error.code });
  }
  const f = fixture({
      failure: { method: "read", error: new Error("private SQL/password details") },
    }),
    response = await f.send("GET", `/api/messaging/threads/${id}`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "MESSAGING_UNAVAILABLE" });
  for (const method of ["list", "read", "send", "markRead"] as const) {
    const broken = fixture({ malformed: method });
    const path =
      method === "list"
        ? "/api/messaging/threads"
        : `/api/messaging/threads/${id}${method === "send" ? "/messages" : method === "markRead" ? "/read" : ""}`;
    const result = await broken.send(
      method === "send" || method === "markRead" ? "POST" : "GET",
      path,
      method === "send"
        ? { body: '{"body":"Hi"}' }
        : method === "markRead"
          ? { body: '{"throughSequence":1}' }
          : {},
    );
    assert.equal(result.status, 503);
  }
});

test("an unconfigured endpoint stays unavailable without requiring a database or mail connection", async (t) => {
  const prior = process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_SECRET;
  t.after(() => {
    if (prior === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = prior;
  });
  const response = await handleMessagingRequest(new Request(`${baseURL}/api/messaging/threads`));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "MESSAGING_UNAVAILABLE" });
  assert.equal(response.headers.get("set-cookie"), null);
});
