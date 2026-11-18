import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { readPushSubscription } from "../src/server/push/service";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://fixture.invalid";
test("only TLS subscriptions at supported browser push providers with valid encryption keys are accepted", () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = {
    auth: randomBytes(16).toString("base64url"),
    p256dh: ecdh.getPublicKey().toString("base64url"),
  };
  for (const host of [
    "fcm.googleapis.com",
    "web.push.apple.com",
    "updates.push.services.mozilla.com",
    "wns2-db5p.notify.windows.com",
  ]) {
    const endpoint = `https://${host}/token`;
    assert.deepEqual(readPushSubscription({ endpoint, keys, expirationTime: null }), {
      endpoint,
      keys,
    });
  }
  assert.throws(() => readPushSubscription({ endpoint: "https://other.example/token", keys }));
  assert.throws(() =>
    readPushSubscription({
      endpoint: "https://fcm.googleapis.com/token",
      keys: { ...keys, p256dh: "x".repeat(87) },
    }),
  );
});

test("closed worker shows one generic notification, opens the intended app route, and confirms the test", async () => {
  const id = randomUUID(),
    events = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: { body: string; data: unknown } }[] = [],
    opens: string[] = [],
    receipts: { id: string; event: string }[] = [];
  runInNewContext(source, {
    URL,
    fetch: async (url: string, req: RequestInit) => {
      assert.equal(url, "/api/push/receipt");
      assert.equal(req.credentials, "omit");
      receipts.push(JSON.parse(String(req.body)));
      return new Response("{}");
    },
    self: {
      location: { origin },
      addEventListener: (name: string, cb: (event: unknown) => void) => events.set(name, cb),
      registration: {
        showNotification: async (title: string, options: { body: string; data: unknown }) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opens.push(url);
        },
      },
    },
  });
  async function fire(kind: string, data: unknown) {
    let completion: Promise<unknown> | undefined;
    events.get(kind)?.({
      ...(kind === "push"
        ? { data: { json: () => data } }
        : { notification: { data, close() {} } }),
      waitUntil: (op: Promise<unknown>) => {
        completion = op;
      },
    });
    assert.ok(completion);
    await completion;
  }
  for (const kind of ["test", "message"]) {
    await fire("push", { id, kind, body: "private text", url: "https://external.example" });
    assert.equal(notifications.at(-1)?.title, "AhiBizz");
    assert.ok(!notifications.at(-1)?.options.body.includes("private text"));
    await fire("notificationclick", notifications.at(-1)?.options.data);
  }
  assert.deepEqual(receipts, [
    { id, event: "shown" },
    { id, event: "opened" },
  ]);
  assert.deepEqual(opens, [`${origin}/nalog?odjeljak=postavke`, `${origin}/nalog?odjeljak=poruke`]);
});
