import assert from "node:assert/strict";
import test from "node:test";
import {
  type ChatConversation,
  type ChatThread,
  conversationReadThrough,
  messageLink,
  normalizeMessageBody,
  readChatConversation,
  readChatReceipt,
  readChatThread,
  readChatThreadPage,
  readMessageTarget,
} from "../src/lib/messaging";
import {
  MessagingRequestError,
  messagingError,
  messagingRequest,
  messagingWrite,
} from "../src/lib/messaging-client";

const id = "11111111-1111-4111-8111-111111111111",
  messageId = "22222222-2222-4222-8222-222222222222";
const when = "2026-11-14T13:00:00.000Z";
function thread(changes: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind: "person",
    inbox: "personal",
    title: "Ogledni sagovornik",
    targetId: "fixture-person",
    canSend: true,
    blockedByMe: false,
    blocked: false,
    latestSequence: 2,
    readSequence: 0,
    unreadCount: 1,
    lastMessage: { body: "Pozdrav", createdAt: when },
    ...changes,
  };
}
function conversation(): ChatConversation {
  return {
    thread: thread(),
    items: [
      { id: messageId, sequence: 1, body: "Prva poruka", createdAt: when, from: "me" },
      {
        id: "33333333-3333-4333-8333-333333333333",
        sequence: 2,
        body: "Pozdrav",
        createdAt: when,
        from: "peer",
      },
    ],
    hasMore: false,
  };
}

test("text normalization preserves real text and paragraphs while bounding controls, Unicode and encoded length", () => {
  assert.equal(normalizeMessageBody("  Zdravo\r\nDrugi red\t!  "), "Zdravo\nDrugi red\t!");
  assert.equal(
    normalizeMessageBody('<script>alert("plain text")</script>'),
    '<script>alert("plain text")</script>',
  );
  assert.equal(normalizeMessageBody("😀".repeat(1000)).length, 2000);
  assert.equal(normalizeMessageBody("a".repeat(2000)).length, 2000);
  for (const value of [
    undefined,
    null,
    0,
    {},
    [],
    "",
    " \n\t ",
    "a".repeat(2001),
    "😀".repeat(1001),
    "A\u0000B",
    "A\rB",
    "A\u007fB",
    "A\u0080B",
    "A\u202eB",
    "A\u2066B",
    "A\ud800B",
    "A\udc00B",
  ]) {
    assert.throws(() => normalizeMessageBody(value));
  }
});

test("profile links encode only a closed local target and parsers reject mixed, repeated, foreign and traversal input", () => {
  assert.equal(
    messageLink({ kind: "person", targetId: "fixture-person" }),
    "/nalog?odjeljak=poruke&osoba=fixture-person",
  );
  assert.equal(
    messageLink({ kind: "business", targetId: id }),
    `/nalog?odjeljak=poruke&djelatnost=${id}`,
  );
  assert.equal(
    messageLink({ kind: "person", targetId: "fixture-person" }, true),
    "/pregled/prostor/poruke?osoba=fixture-person",
  );
  assert.deepEqual(readMessageTarget(new URLSearchParams("odjeljak=poruke&osoba=fixture-person")), {
    kind: "person",
    targetId: "fixture-person",
  });
  assert.deepEqual(readMessageTarget(new URLSearchParams(`djelatnost=${id}`)), {
    kind: "business",
    targetId: id,
  });
  assert.equal(readMessageTarget(new URLSearchParams()), null);
  assert.equal(readMessageTarget(new URLSearchParams("odjeljak=poruke")), null);
  for (const value of [
    "osoba=a&osoba=b",
    "osoba=a&djelatnost=b",
    "return=https://evil.invalid",
    "osoba=..%2Fa",
    "osoba=https%3A%2F%2Fevil.invalid",
    "osoba=a%5Cb",
    "odjeljak=profil&osoba=a",
    "odjeljak=poruke&odjeljak=poruke&osoba=a",
    "dio=poruke&osoba=a",
    "osoba=",
    "djelatnost=%0Aa",
  ]) {
    assert.throws(() => readMessageTarget(new URLSearchParams(value)), value);
  }
  for (const target of [
    { kind: "invalid", targetId: "a" },
    { kind: "person", targetId: "../a" },
    { kind: "person", targetId: "a?return=evil" },
    { kind: "business", targetId: "https://evil.invalid" },
  ])
    assert.throws(() => messageLink(target as never));
});

test("thread DTOs expose only conversation fields and retain blocked and unread invariants", () => {
  const row = {
    ...thread(),
    email: "never-return",
    role: "owner",
    birthDate: "1990-01-01",
    sessionToken: "never-return",
  };
  assert.deepEqual(readChatThread(row), thread());
  assert.deepEqual(
    readChatThread({ ...thread({ canSend: false, blocked: true, blockedByMe: true }) }),
    thread({ canSend: false, blocked: true, blockedByMe: true }),
  );
  assert.deepEqual(
    readChatThread(thread({ kind: "business", inbox: "business", targetId: id })),
    thread({ kind: "business", inbox: "business", targetId: id }),
  );
  assert.deepEqual(
    readChatThread(
      thread({ latestSequence: 0, readSequence: 0, unreadCount: 0, lastMessage: null }),
    ),
    thread({ latestSequence: 0, readSequence: 0, unreadCount: 0, lastMessage: null }),
  );
  const invalid = [
    { id: "../thread" },
    { title: "" },
    { title: "a".repeat(257) },
    { title: "A\nB" },
    { kind: "admin" },
    { inbox: "business" },
    { canSend: "true" },
    { blocked: true, canSend: true },
    { blockedByMe: true, blocked: false },
    { latestSequence: -1 },
    { latestSequence: "2" },
    { readSequence: 3 },
    { unreadCount: 3 },
    { unreadCount: 0.5 },
    { lastMessage: null },
    { lastMessage: { body: "a".repeat(201), createdAt: when } },
    { lastMessage: { body: "a", createdAt: "2026-02-31T13:00:00.000Z" } },
    { lastMessage: { body: "a", createdAt: "2026-11-14T13:00:00+02:00" } },
  ];
  for (const changes of invalid) assert.throws(() => readChatThread({ ...thread(), ...changes }));
});

test("thread pages and chronological message pages reject duplicates, coercion and malformed/private response fields", () => {
  const page = {
    items: [{ ...thread(), cookie: "never-return" }],
    page: 1,
    hasMore: false,
    adminNotes: "never-return",
  };
  assert.deepEqual(readChatThreadPage(page), { items: [thread()], page: 1, hasMore: false });
  for (const changes of [
    { items: Array(31).fill(thread()) },
    { items: [thread(), thread()] },
    { page: 0 },
    { page: "1" },
    { page: 1001 },
    { hasMore: 1 },
  ])
    assert.throws(() => readChatThreadPage({ ...page, ...changes }));
  const data = conversation();
  assert.deepEqual(
    readChatConversation({
      ...data,
      ownerSecret: "never-return",
      items: data.items.map((item) => ({ ...item, rawActorEmail: "never-return" })),
    }),
    data,
  );
  for (const value of [
    { ...data, hasMore: "false" },
    { ...data, items: [...data.items].reverse() },
    { ...data, items: [data.items[0], data.items[0]] },
    { ...data, items: [{ ...data.items[1], sequence: 3 }] },
    { ...data, items: [{ ...data.items[0], body: " Trimmed " }] },
    { ...data, items: [{ ...data.items[0], from: "owner" }] },
    { ...data, items: Array(51).fill(data.items[0]) },
    { ...data, items: [{ ...data.items[0], sequence: 0 }] },
  ])
    assert.throws(() => readChatConversation(value));
  const old = { ...data, items: [data.items[0]], hasMore: false };
  assert.deepEqual(
    readChatConversation(old),
    old,
    "A historical before-page need not include latest sequence.",
  );
});

test("only a complete newest page can advance the read pointer; older metadata never acknowledges unseen messages", () => {
  const current = conversation();
  const [first, second] = current.items;
  assert.ok(first && second);
  assert.equal(conversationReadThrough(current), 2);
  const oldPage = {
    ...current,
    thread: thread({ latestSequence: 3, unreadCount: 2 }),
    items: [first],
  };
  assert.equal(conversationReadThrough(oldPage, 2), null);
  assert.throws(() => conversationReadThrough(oldPage));
  assert.throws(() => conversationReadThrough({ ...current, items: [] }));
  assert.equal(
    conversationReadThrough({
      thread: thread({ latestSequence: 0, readSequence: 0, unreadCount: 0, lastMessage: null }),
      items: [],
      hasMore: false,
    }),
    0,
  );
  assert.throws(
    () =>
      readChatConversation({
        ...current,
        thread: thread({ latestSequence: 3 }),
        items: [first, { ...second, sequence: 3 }],
      }),
    "A page may start after1 but cannot contain an internal sequence gap.",
  );
  const middlePage = {
    ...current,
    thread: thread({ latestSequence: 8 }),
    items: [
      { ...first, sequence: 5 },
      { ...second, sequence: 6 },
    ],
  };
  assert.deepEqual(readChatConversation(middlePage), middlePage);
  assert.equal(conversationReadThrough(middlePage, 7), null);
});

test("receipts are original command acknowledgements with an all-or-none message identity", () => {
  const open = { threadId: id, messageId: null, sequence: null };
  const sent = { threadId: id, messageId, sequence: 2 };
  assert.deepEqual(readChatReceipt({ ...open, secret: "never-return" }), open);
  assert.deepEqual(readChatReceipt(sent), sent);
  for (const value of [
    { ...sent, messageId: null },
    { ...open, sequence: 1 },
    { ...sent, sequence: 0 },
    { ...sent, sequence: 2147483648 },
    { ...sent, threadId: "../bad" },
    { ...sent, sequence: "2" },
  ])
    assert.throws(() => readChatReceipt(value));
});

test("client paths stay same-origin and query-closed before fetch, preserving fixed cookie/cache/redirect policy", async (t) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ ok: true });
    },
  );
  for (const path of [
    "https://evil.invalid/threads",
    "//evil.invalid/threads",
    "../threads",
    "threads/../threads",
    "threads?inbox=admin",
    "threads?inbox=personal&inbox=business",
    "threads?page=0",
    "threads?page=1001",
    "threads?page=01",
    "threads?page=1x1000",
    `threads/${id}?before=0`,
    `threads/${id}?before=2147483648`,
    `threads/${id}?before=1&before=2`,
    `threads/${id}?inbox=personal`,
    `threads/${id}/messages?before=2`,
    `threads/${id}%2fmessages`,
    `threads/${id}#x`,
    "threads?return=https://evil.invalid",
  ]) {
    await assert.rejects(messagingRequest(path), MessagingRequestError, path);
  }
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  await messagingRequest("threads?inbox=personal&page=1000", {
    credentials: "omit",
    cache: "force-cache",
    redirect: "follow",
    mode: "cors",
    signal: controller.signal,
  });
  assert.equal(calls[0]?.url, "/api/messaging/threads?inbox=personal&page=1000");
  assert.deepEqual(
    { ...calls[0]?.init },
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      mode: "same-origin",
      signal: controller.signal,
    },
  );
  await messagingRequest(`threads/${id}?before=2147483647`);
  await messagingRequest(`threads/${id}/messages`, messagingWrite({ body: "Pozdrav" }, messageId));
  assert.equal(calls[2]?.init?.body, '{"body":"Pozdrav"}');
  assert.equal(new Headers(calls[2]?.init?.headers).get("idempotency-key"), messageId);
  assert.throws(() => messagingWrite({}, "not-a-uuid"), MessagingRequestError);
});

test("client caps actual response bytes and malformed/empty/error replies cannot acknowledge an unknown write", async (t) => {
  let response: Response = Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(
    messagingRequest("threads"),
    (error: unknown) =>
      error instanceof MessagingRequestError &&
      error.status === 401 &&
      error.code === "AUTHENTICATION_REQUIRED",
  );
  for (const invalid of [
    new Response("not-json"),
    Response.json([]),
    new Response(null, { status: 204 }),
    new Response(new Uint8Array([0xff])),
    new Response(JSON.stringify({ payload: "x".repeat(1048576) }), {
      headers: { "Content-Length": "1" },
    }),
  ]) {
    response = invalid;
    await assert.rejects(
      messagingRequest("threads"),
      (error: unknown) =>
        error instanceof MessagingRequestError && error.code === "MESSAGING_UNAVAILABLE",
    );
  }
  assert.equal(
    messagingError(new MessagingRequestError(409, "MESSAGING_BLOCKED")),
    "Poruke su blokirane u ovom razgovoru.",
  );
  assert.equal(
    messagingError(new Error("secret database fixture detail")),
    "Zahtjev nije potvrđen. Pokušaj ponovo.",
  );
});
