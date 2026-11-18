import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { generateRequestDetails } from "web-push";
import { createPushService } from "../../src/server/push/service.ts";
import { dispatchDuePush } from "../../src/server/push/worker.ts";

export function pushAcceptance(auth, pool, actors) {
  const push = createPushService(auth, pool);
  const devices = actors.map((actor) => {
    const dh = createECDH("prime256v1");
    dh.generateKeys();
    const subscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: {
        auth: randomBytes(16).toString("base64url"),
        p256dh: dh.getPublicKey().toString("base64url"),
      },
    };
    const headers = new Headers(actor.headers);
    headers.set("X-AhiBizz-Account-ID", actor.user.id);
    return { headers, subscription };
  });
  const call = (device, action) =>
    push(device.headers, action, { subscription: device.subscription });
  const sent = [];
  async function sender(subscription, payload, options) {
    const req = generateRequestDetails(subscription, payload, options);
    assert.equal(req.headers["Content-Encoding"], "aes128gcm");
    assert.match(req.headers.Authorization, /^vapid /);
    assert.ok(req.body.length > payload.length);
    const data = JSON.parse(payload);
    assert.deepEqual(Object.keys(data).sort(), ["id", "kind"]);
    sent.push({ endpoint: subscription.endpoint, data });
    return { statusCode: 201, headers: {}, body: "" };
  }
  return {
    async enroll() {
      const [admin, member, receiver] = devices;
      const configs = await Promise.all(devices.map((d) => push(d.headers, "config")));
      assert.equal(new Set(configs.map((c) => c.publicKey)).size, 1);
      assert.ok(configs.every((c) => !("privateKey" in c)));
      for (const d of devices) {
        assert.equal((await call(d, "status")).enabled, false);
        assert.equal((await call(d, "subscribe")).enabled, true);
      }
      assert.equal(
        (await push(admin.headers, "status", { subscription: receiver.subscription })).enabled,
        false,
      );
      await assert.rejects(
        () => push(admin.headers, "subscribe", { subscription: receiver.subscription }),
        (e) => e.code === "PUSH_REBIND",
      );
      await assert.rejects(
        () => push(admin.headers, "test", { subscription: receiver.subscription }),
        (e) => e.status === 404,
      );
      assert.equal((await call(member, "test")).test, "scheduled");
      await assert.rejects(
        () => call(member, "test"),
        (e) => e.status === 429,
      );
      assert.equal(await dispatchDuePush(pool, "no-reply@fixture.invalid", sender), 0);
      await pool.query("UPDATE push_delivery SET due_at=now() WHERE kind='test'");
      await Promise.all([
        dispatchDuePush(pool, "no-reply@fixture.invalid", sender),
        dispatchDuePush(pool, "no-reply@fixture.invalid", sender),
      ]);
      assert.deepEqual(
        sent.map((x) => [x.endpoint, x.data.kind]),
        [[member.subscription.endpoint, "test"]],
      );
      assert.equal((await call(member, "status")).test, "accepted");
      sent.length = 0;
    },
    async recipientOnly() {
      const [, , other] = devices;
      await Promise.all([
        dispatchDuePush(pool, "no-reply@fixture.invalid", sender),
        dispatchDuePush(pool, "no-reply@fixture.invalid", sender),
      ]);
      assert.deepEqual(
        sent.map((x) => [x.endpoint, x.data.kind]),
        [[other.subscription.endpoint, "message"]],
      );
      await call(devices[0], "test");
      await pool.query("UPDATE push_delivery SET expires_at=now() WHERE kind='test'");
      assert.equal(await dispatchDuePush(pool, "no-reply@fixture.invalid", sender), 0);
      assert.equal((await call(devices[0], "status")).test, "failed");
      await call(other, "test");
      await pool.query("UPDATE push_delivery SET due_at=now() WHERE kind='test'");
      await dispatchDuePush(pool, "no-reply@fixture.invalid", async () => {
        throw Object.assign(new Error("Expired device"), { statusCode: 410 });
      });
      assert.equal((await call(other, "status")).enabled, false);
      for (const d of devices) {
        await call(d, "unsubscribe");
        assert.equal((await call(d, "status")).enabled, false);
      }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM push_delivery")).rows[0].n, 0);
    },
  };
}
