import { ECDH } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { generateVAPIDKeys, type PushSubscription } from "web-push";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import type { AuthService } from "../auth/service";

function invalid(): never {
  throw new AccountAccessError(400, "INVALID_PUSH_INPUT");
}

export function readPushSubscription(input: unknown): PushSubscription {
  if (!input || typeof input !== "object" || !("endpoint" in input) || !("keys" in input))
    invalid();
  if (
    typeof input.endpoint !== "string" ||
    input.endpoint.length > 1600 ||
    /\s/.test(input.endpoint)
  )
    invalid();
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    return invalid();
  }
  const host = url.hostname;
  const provider =
    host === "fcm.googleapis.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".push.services.mozilla.com") ||
    host.endsWith(".notify.windows.com");
  if (
    !provider ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname === "/" ||
    url.href !== input.endpoint
  )
    invalid();
  const keys = input.keys;
  if (
    !keys ||
    typeof keys !== "object" ||
    !("auth" in keys) ||
    !("p256dh" in keys) ||
    typeof keys.auth !== "string" ||
    !/^[\w-]{22}$/.test(keys.auth) ||
    typeof keys.p256dh !== "string" ||
    !/^[\w-]{87}$/.test(keys.p256dh)
  )
    invalid();
  try {
    const key = Buffer.from(keys.p256dh, "base64url");
    if (
      key[0] !== 4 ||
      key.toString("base64url") !== keys.p256dh ||
      Buffer.from(keys.auth, "base64url").toString("base64url") !== keys.auth
    )
      invalid();
    ECDH.convertKey(key, "prime256v1");
  } catch {
    return invalid();
  }
  return { endpoint: url.href, keys: { auth: keys.auth, p256dh: keys.p256dh } };
}

export async function signingKeys(db: Pick<PoolClient, "query">) {
  const select =
    'SELECT public_key AS "publicKey",private_key AS "privateKey" FROM push_signer WHERE singleton';
  type Keys = ReturnType<typeof generateVAPIDKeys>;
  const existing = (await db.query<Keys>(select)).rows[0];
  if (existing) return existing;
  const keys = generateVAPIDKeys();
  await db.query(
    "INSERT INTO push_signer(singleton,public_key,private_key) VALUES(true,$1,$2) ON CONFLICT DO NOTHING",
    [keys.publicKey, keys.privateKey],
  );
  const confirmed = (await db.query<Keys>(select)).rows[0];
  if (!confirmed) throw new Error("Push signer unavailable");
  return confirmed;
}

export function createPushService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return async (headers: Headers, action: string, data?: unknown) => {
    const signed = await access.session(headers);
    if (action !== "config" && !signed.expectedAccountId) invalid();
    return accountTransaction(pool, async (db) => {
      const actor = await access.authority(db, signed);
      if (action === "config")
        return { accountId: actor.id, publicKey: (await signingKeys(db)).publicKey };
      if (!data || typeof data !== "object" || !("subscription" in data)) invalid();
      const sub = readPushSubscription(data.subscription);
      const values = [sub.endpoint, sub.keys.p256dh, sub.keys.auth, actor.id, signed.id];
      if (action === "subscribe") {
        // Remove expired authorizations before enforcing the per-person device cap.
        await db.query(
          'DELETE FROM push_device d USING auth_session s WHERE d.user_id=$1 AND s.id=d.session_id AND s."expiresAt"<=now()',
          [actor.id],
        );
        const present = (
          await db.query(
            "SELECT p256dh,auth_key,user_id,session_id FROM push_device WHERE endpoint=$1 FOR UPDATE",
            [sub.endpoint],
          )
        ).rows[0];
        if (present) {
          if (
            present.p256dh !== sub.keys.p256dh ||
            present.auth_key !== sub.keys.auth ||
            present.user_id !== actor.id ||
            present.session_id !== signed.id
          )
            throw new AccountAccessError(409, "PUSH_REBIND");
        } else {
          const count = (
            await db.query("SELECT count(*)::int AS n FROM push_device WHERE user_id=$1", [
              actor.id,
            ])
          ).rows[0]?.n;
          if (count >= 12) throw new AccountAccessError(409, "TOO_MANY_DEVICES");
          const inserted = await db.query(
            "INSERT INTO push_device(endpoint,p256dh,auth_key,user_id,session_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            values,
          );
          if (!inserted.rowCount) throw new AccountAccessError(409, "PUSH_REBIND");
        }
      }
      const owned = "endpoint=$1 AND p256dh=$2 AND auth_key=$3 AND user_id=$4 AND session_id=$5";
      if (action === "unsubscribe") {
        await db.query(`DELETE FROM push_device WHERE ${owned}`, values);
        return { enabled: false };
      }
      const device = (
        await db.query<{ id: string; test_state: string | null }>(
          // A provider acceptance proves handoff only. Keep the stored state so
          // a device can still confirm the test after the initial waiting period.
          `SELECT id,
           CASE WHEN test_state='accepted' AND test_requested_at<=clock_timestamp()-interval '2 minutes'
             THEN 'unconfirmed' ELSE test_state END AS test_state
           FROM push_device WHERE ${owned} FOR UPDATE`,
          values,
        )
      ).rows[0];
      if (action === "status" || action === "subscribe")
        return { enabled: !!device, test: device?.test_state ?? null };
      if (action !== "test" || !device)
        throw new AccountAccessError(404, "PUSH_DEVICE_UNAVAILABLE");
      const allowed = await db.query(
        "INSERT INTO push_test_limit(user_id,requested_at) VALUES($1,now()) ON CONFLICT(user_id) DO UPDATE SET requested_at=now() WHERE push_test_limit.requested_at < now()-interval '1 minute'",
        [actor.id],
      );
      if (!allowed.rowCount) throw new AccountAccessError(429, "PUSH_TEST_LIMIT");
      const queued = (
        await db.query<{ id: string }>(
          "INSERT INTO push_delivery(device_id,kind,due_at) VALUES($1,'test',clock_timestamp()+interval '30 seconds') RETURNING id",
          [device.id],
        )
      ).rows[0];
      if (!queued) throw new Error("Push test unavailable");
      await db.query(
        "UPDATE push_device SET test_id=$2,test_requested_at=now(),test_state='scheduled' WHERE id=$1",
        [device.id, queued.id],
      );
      return { enabled: true, test: "scheduled" };
    });
  };
}
