import assert from "node:assert/strict";
import test from "node:test";
import { createMessagingPreviewApi } from "../src/components/preview/messaging-preview-api";
import {
  normalizeMessageBody,
  readChatConversation,
  readChatReceipt,
  readChatThreadPage,
} from "../src/lib/messaging";
import { MessagingRequestError, messagingWrite } from "../src/lib/messaging-client";

const peer = { id: "preview-designer", name: "Ogledna dizajnerica" };
const other = { id: "preview-developer", name: "Ogledni programer" };
function fixture() {
  let actor = { id: "preview-self", name: "Moje ime" };
  let visible = true;
  let published = true;
  let ownerId = peer.id;
  let clock = new Date("2026-11-14T12:00:00.000Z");
  const api = createMessagingPreviewApi({
    self: () => actor,
    person: (id) => (id === peer.id ? (visible ? peer : null) : id === other.id ? other : null),
    business: (id) =>
      id === "preview-business"
        ? { id, title: "Ogledni studio", ownerId, published }
        : id === "preview-own-business"
          ? { id, title: "Moja djelatnost", ownerId: actor.id, published: true }
          : null,
    now: () => clock,
  });
  return {
    api,
    actor: (value: typeof actor) => {
      actor = value;
    },
    visible: (value: boolean) => {
      visible = value;
    },
    published: (value: boolean) => {
      published = value;
    },
    owner: (value: string) => {
      ownerId = value;
    },
    advance: () => {
      clock = new Date(clock.getTime() + 61000);
    },
  };
}
const denies = (call: () => Promise<unknown> | unknown, status: number, code?: string) =>
  assert.rejects(
    async () => call(),
    (error) =>
      error instanceof MessagingRequestError &&
      error.status === status &&
      (!code || error.code === code),
  );
async function open(
  api: ReturnType<typeof createMessagingPreviewApi>,
  kind: "person" | "business" = "person",
  targetId = peer.id,
  key = crypto.randomUUID(),
) {
  return readChatReceipt(
    (await api.request("threads", messagingWrite({ kind, targetId }, key))).receipt,
  );
}

test("preview transport rejects foreign or malformed expected account before a command", async () => {
  const { api } = fixture();
  const opened = await open(api);
  const command = messagingWrite({ body: "Account-bound fixture" }, crypto.randomUUID());
  const matching = new Headers(command.headers);
  matching.set("X-AhiBizz-Account-ID", "preview-self");
  const accepted = await api.request(`threads/${opened.threadId}/messages`, {
    ...command,
    headers: matching,
  });
  for (const [expected, status, code] of [
    ["preview-other", 401, "ACCOUNT_IDENTITY_CHANGED"],
    ["bad account", 400, "INVALID_MESSAGING_INPUT"],
    ["", 400, "INVALID_MESSAGING_INPUT"],
  ] as const) {
    const headers = new Headers(command.headers);
    headers.set("X-AhiBizz-Account-ID", expected);
    await denies(
      () => api.request(`threads/${opened.threadId}/messages`, { ...command, headers }),
      status,
      code,
    );
    await denies(() => api.request(`threads/${opened.threadId}`, { headers }), status, code);
  }
  assert.deepEqual(
    await api.request(`threads/${opened.threadId}/messages`, { ...command, headers: matching }),
    accepted,
  );
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).items.length,
    1,
  );
});

test("messaging preview starts empty, does not fetch and returns detached bounded DTOs", async () => {
  const { api } = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("No network in messaging preview");
  };
  try {
    assert.deepEqual(readChatThreadPage(await api.request("threads?inbox=personal&page=1")), {
      items: [],
      page: 1,
      hasMore: false,
    });
    const receipt = await open(api);
    const empty = readChatConversation(await api.request(`threads/${receipt.threadId}`));
    assert.equal(empty.thread.title, peer.name);
    assert.equal(empty.items.length, 0);
    empty.thread.title = "Do not persist";
    assert.equal(
      readChatConversation(await api.request(`threads/${receipt.threadId}`)).thread.title,
      peer.name,
    );
    const message = readChatReceipt(
      (
        await api.request(
          `threads/${receipt.threadId}/messages`,
          messagingWrite({ body: "  Pozdrav\r\nKako ste?  " }, crypto.randomUUID()),
        )
      ).receipt,
    );
    assert.equal(message.sequence, 1);
    assert.equal(
      readChatConversation(await api.request(`threads/${receipt.threadId}`)).items[0]?.body,
      "Pozdrav\nKako ste?",
    );
  } finally {
    globalThis.fetch = original;
    api.dispose();
  }
});

test("same immutable command key replays once and changed intent cannot duplicate a message", async () => {
  const { api } = fixture(),
    key = crypto.randomUUID();
  const opened = await open(api, "person", peer.id, key);
  assert.deepEqual(await open(api, "person", peer.id, key), opened);
  await denies(() => open(api, "person", other.id, key), 409, "IDEMPOTENCY_CONFLICT");
  const path = `threads/${opened.threadId}/messages`,
    messageKey = crypto.randomUUID();
  const first = await api.request(path, messagingWrite({ body: "Poruka" }, messageKey));
  api.simulatePeerReply(opened.threadId, "Kontrolisani odgovor");
  assert.deepEqual(await api.request(path, messagingWrite({ body: "Poruka" }, messageKey)), first);
  await denies(
    () => api.request(path, messagingWrite({ body: "Druga namjera" }, messageKey)),
    409,
    "IDEMPOTENCY_CONFLICT",
  );
  const current = readChatConversation(await api.request(`threads/${opened.threadId}`));
  assert.equal(current.items.length, 2);
  assert.equal(current.thread.latestSequence, 2);
  api.dispose();
});

test("unread counts include peer messages only and read pointers cannot regress or exceed history", async () => {
  const { api } = fixture(),
    opened = await open(api);
  await api.request(
    `threads/${opened.threadId}/messages`,
    messagingWrite({ body: "Moja poruka" }, crypto.randomUUID()),
  );
  api.simulatePeerReply(opened.threadId, "Prva tuđa poruka");
  api.simulatePeerReply(opened.threadId, "Druga tuđa poruka");
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.unreadCount,
    2,
  );
  assert.deepEqual(
    await api.request(`threads/${opened.threadId}/read`, messagingWrite({ throughSequence: 2 })),
    { readSequence: 2 },
  );
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.unreadCount,
    1,
  );
  assert.deepEqual(
    await api.request(`threads/${opened.threadId}/read`, messagingWrite({ throughSequence: 1 })),
    { readSequence: 2 },
  );
  await denies(
    () => api.request(`threads/${opened.threadId}/read`, messagingWrite({ throughSequence: 4 })),
    400,
  );
  api.dispose();
});

test("older pages remain ordered with immutable sequences and latest previews are bounded", async () => {
  const { api, advance } = fixture(),
    opened = await open(api);
  for (let index = 1; index <= 112; index++) {
    if (index === 61) advance();
    api.simulatePeerReply(opened.threadId, `Poruka ${index} ${"sadržaj ".repeat(35)}`);
  }
  const latest = readChatConversation(await api.request(`threads/${opened.threadId}`));
  assert.equal(latest.items.length, 50);
  assert.equal(latest.items[0]?.sequence, 63);
  assert.equal(latest.items.at(-1)?.sequence, 112);
  assert.equal(latest.hasMore, true);
  const older = readChatConversation(await api.request(`threads/${opened.threadId}?before=63`));
  assert.equal(older.items[0]?.sequence, 13);
  assert.equal(older.items.at(-1)?.sequence, 62);
  const first = readChatConversation(await api.request(`threads/${opened.threadId}?before=13`));
  assert.equal(first.items.length, 12);
  assert.equal(first.hasMore, false);
  assert.ok((latest.thread.lastMessage?.body.length ?? 0) <= 200);
  assert.equal(
    readChatThreadPage(await api.request("threads?inbox=personal&page=1")).items[0]?.latestSequence,
    112,
  );
  api.dispose();
});

test("block and unblock require fresh state; historical receipts do not rewind a later unblock", async () => {
  const { api } = fixture(),
    opened = await open(api),
    path = `threads/${opened.threadId}/block`,
    key = crypto.randomUUID();
  const blocked = await api.request(path, messagingWrite({ blocked: true }, key));
  let state = readChatConversation(await api.request(`threads/${opened.threadId}`));
  assert.equal(state.thread.blockedByMe, true);
  assert.equal(state.thread.canSend, false);
  await denies(
    () =>
      api.request(
        `threads/${opened.threadId}/messages`,
        messagingWrite({ body: "Ne smije proći" }, crypto.randomUUID()),
      ),
    409,
    "MESSAGING_BLOCKED",
  );
  await denies(
    () => api.simulatePeerReply(opened.threadId, "Ni probni odgovor"),
    409,
    "MESSAGING_BLOCKED",
  );
  await api.request(path, messagingWrite({ blocked: false }, crypto.randomUUID()));
  assert.deepEqual(await api.request(path, messagingWrite({ blocked: true }, key)), blocked);
  state = readChatConversation(await api.request(`threads/${opened.threadId}`));
  assert.equal(state.thread.canSend, true);
  assert.equal(state.thread.blocked, false);
  api.dispose();
});

test("business inboxes remain separate and ownership transfer cannot expose old history", async () => {
  const { api, published, owner } = fixture();
  const customer = await open(api, "business", "preview-business");
  const own = api.seedBusinessInquiry("preview-own-business", peer.id, "Upit za tvoju djelatnost");
  assert.equal(api.seedBusinessInquiry("preview-own-business", peer.id, "Ne dupliciraj seed"), own);
  assert.equal(
    readChatThreadPage(await api.request("threads?inbox=personal&page=1")).items[0]?.id,
    customer.threadId,
  );
  assert.equal(
    readChatThreadPage(await api.request("threads?inbox=business&page=1")).items[0]?.id,
    own,
  );
  assert.equal(readChatConversation(await api.request(`threads/${own}`)).items[0]?.from, "peer");
  assert.equal(
    readChatConversation(await api.request(`threads/${own}`)).thread.title,
    `Moja djelatnost · ${peer.name}`,
  );
  published(false);
  assert.equal(
    readChatConversation(await api.request(`threads/${customer.threadId}`)).thread.canSend,
    false,
  );
  await denies(
    () =>
      api.request(
        `threads/${customer.threadId}/messages`,
        messagingWrite({ body: "Povučena djelatnost" }, crypto.randomUUID()),
      ),
    409,
    "CONVERSATION_UNAVAILABLE",
  );
  published(true);
  assert.equal(
    readChatConversation(await api.request(`threads/${customer.threadId}`)).thread.canSend,
    true,
  );
  owner(other.id);
  await denies(() => api.request(`threads/${customer.threadId}`), 404, "THREAD_NOT_FOUND");
  assert.equal(
    readChatThreadPage(await api.request("threads?inbox=personal&page=1")).items.length,
    0,
  );
  api.dispose();
});

test("a hidden person retains existing history, self-targets and unknown simulation remain blocked", async () => {
  const { api, visible } = fixture(),
    opened = await open(api);
  api.simulatePeerReply(opened.threadId, "Sačuvana historija");
  visible(false);
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.title,
    peer.name,
  );
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.canSend,
    true,
  );
  await denies(() => open(api, "person", "preview-self"), 400, "SELF_MESSAGE_NOT_ALLOWED");
  await denies(
    () => open(api, "business", "preview-own-business"),
    400,
    "SELF_MESSAGE_NOT_ALLOWED",
  );
  await denies(() => api.simulatePeerReply(crypto.randomUUID(), "Lažni thread"), 404);
  await denies(() => api.seedBusinessInquiry("preview-business", other.id, "Tuđi posao"), 400);
  api.dispose();
});

test("closed routes, canonical bodies, aborted requests and actor changes fail closed", async () => {
  const { api, actor } = fixture(),
    opened = await open(api);
  for (const path of [
    "https://evil.invalid/threads",
    "../threads",
    "threads?inbox=personal&inbox=business",
    "threads?returnUrl=x",
    `threads/${opened.threadId}?before=0`,
    `threads/${opened.threadId}/messages?before=1`,
  ])
    await denies(() => api.request(path), 400);
  for (const body of [" ", "bad\u0000text", "bad\u202etext", "bad\uD800text", "a".repeat(2001)])
    await denies(
      () =>
        api.request(
          `threads/${opened.threadId}/messages`,
          messagingWrite({ body }, crypto.randomUUID()),
        ),
      400,
      "INVALID_MESSAGE_BODY",
    );
  assert.equal(normalizeMessageBody("  A\r\nB\tC  "), "A\nB\tC");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.request("threads", { signal: controller.signal }), {
    name: "AbortError",
  });
  actor({ id: "changed-actor", name: "Drugi korisnik" });
  assert.deepEqual(
    readChatThreadPage(await api.request("threads?inbox=personal&page=1")).items,
    [],
  );
  await denies(() => api.request(`threads/${opened.threadId}`), 404);
  api.dispose();
  await denies(() => api.request("threads"), 503);
});

test("new-thread quota is twenty per hour and existing conversations do not consume it", async () => {
  let current = new Date("2026-11-14T12:00:00.000Z");
  const api = createMessagingPreviewApi({
    self: () => ({ id: "me", name: "Ja" }),
    person: (id) => ({ id, name: `Osoba ${id}` }),
    business: () => null,
    now: () => current,
  });
  for (let index = 0; index < 20; index++) await open(api, "person", `peer-${index}`);
  await open(api, "person", "peer-0");
  await denies(() => open(api, "person", "peer-20"), 429, "MESSAGING_RATE_LIMIT");
  current = new Date(current.getTime() + 61000);
  await denies(() => open(api, "person", "peer-20"), 429, "MESSAGING_RATE_LIMIT");
  current = new Date(current.getTime() + 3600000);
  await open(api, "person", "peer-20");
  api.dispose();
});

test("block quota counts only new commands and preserves the last confirmed state", async () => {
  const { api, advance } = fixture(),
    opened = await open(api),
    path = `threads/${opened.threadId}/block`,
    key = crypto.randomUUID();
  const first = await api.request(path, messagingWrite({ blocked: true }, key));
  for (let index = 1; index < 30; index++)
    await api.request(path, messagingWrite({ blocked: index % 2 === 0 }, crypto.randomUUID()));
  await denies(
    () => api.request(path, messagingWrite({ blocked: true }, crypto.randomUUID())),
    429,
    "MESSAGING_RATE_LIMIT",
  );
  assert.deepEqual(await api.request(path, messagingWrite({ blocked: true }, key)), first);
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.blockedByMe,
    false,
  );
  advance();
  await api.request(path, messagingWrite({ blocked: true }, crypto.randomUUID()));
  assert.equal(
    readChatConversation(await api.request(`threads/${opened.threadId}`)).thread.blockedByMe,
    true,
  );
  api.dispose();
});

test("fresh-key reopen commands are bounded separately from historic receipt replay", async () => {
  const { api, advance } = fixture(),
    key = crypto.randomUUID(),
    first = await open(api, "person", peer.id, key);
  for (let index = 1; index < 240; index++) await open(api);
  await denies(() => open(api), 429, "MESSAGING_RATE_LIMIT");
  assert.deepEqual(await open(api, "person", peer.id, key), first);
  assert.equal(
    readChatThreadPage(await api.request("threads?inbox=personal&page=1")).items.length,
    1,
  );
  advance();
  assert.equal((await open(api)).threadId, first.threadId);
  api.dispose();
});

test("preview mutation subscriptions and rate limits count new sends, not replays", async () => {
  const { api, advance } = fixture();
  let updates = 0;
  const unsubscribe = api.subscribe(() => updates++);
  const opened = await open(api),
    key = crypto.randomUUID(),
    path = `threads/${opened.threadId}/messages`;
  const first = await api.request(path, messagingWrite({ body: "Prva" }, key));
  const revision = api.snapshotVersion();
  assert.ok(updates >= 2);
  assert.deepEqual(await api.request(path, messagingWrite({ body: "Prva" }, key)), first);
  assert.equal(api.snapshotVersion(), revision);
  for (let index = 0; index < 59; index++)
    await api.request(path, messagingWrite({ body: `Poruka ${index}` }, crypto.randomUUID()));
  await denies(
    () => api.request(path, messagingWrite({ body: "Previše" }, crypto.randomUUID())),
    429,
    "MESSAGING_RATE_LIMIT",
  );
  assert.deepEqual(await api.request(path, messagingWrite({ body: "Prva" }, key)), first);
  advance();
  await api.request(path, messagingWrite({ body: "Nakon minute" }, crypto.randomUUID()));
  unsubscribe();
  const previous = updates;
  api.simulatePeerReply(opened.threadId, "Odgovor");
  assert.equal(updates, previous);
  api.dispose();
});
