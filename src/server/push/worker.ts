import type { Pool } from "pg";
import { sendNotification } from "web-push";
import { getAuthDatabasePool, readAuthConfiguration } from "../auth/service";
import { readPushSubscription, signingKeys } from "./service";

type Job = { id: string; kind: "test" | "message"; device_id: string; attempts: number };
export async function dispatchDuePush(pool: Pool, contact: string, send = sendNotification) {
  // A short claim survives process death. Concurrent app replicas cannot claim the same work.
  await pool.query(`WITH expired AS (
    DELETE FROM push_delivery WHERE expires_at<=clock_timestamp() RETURNING id
  ) UPDATE push_device SET test_state='failed' FROM expired
    WHERE test_id=expired.id AND test_state='scheduled'`);
  const jobs = (
    await pool.query<Job>(`WITH batch AS (
    SELECT id FROM push_delivery WHERE due_at<=clock_timestamp() ORDER BY due_at,id LIMIT 8 FOR UPDATE SKIP LOCKED
  ) UPDATE push_delivery q SET due_at=clock_timestamp()+interval '1 minute', attempts=attempts+1
    FROM batch WHERE q.id=batch.id RETURNING q.id,q.device_id,q.kind,q.attempts`)
  ).rows;

  await Promise.all(
    jobs.map(async (job) => {
      const drop = () =>
        pool.query("DELETE FROM push_delivery WHERE id=$1 AND attempts=$2", [job.id, job.attempts]);
      const device = (
        await pool.query(
          `SELECT d.endpoint,d.auth_key,d.p256dh FROM push_delivery q
      JOIN push_device d ON d.id=q.device_id JOIN auth_user u ON u.id=d.user_id
      JOIN auth_session s ON s.id=d.session_id AND s."userId"=u.id
      WHERE q.id=$1 AND q.attempts=$2 AND s."expiresAt">clock_timestamp()
        AND u.approval='approved' AND u."emailVerified" AND
        ((q.kind='test' AND q.id=d.test_id) OR (q.kind='message' AND EXISTS (
          SELECT 1 FROM message_message m JOIN message_thread t ON t.id=m.thread_id
          JOIN message_thread_member member ON member.thread_id=t.id AND member.user_id=d.user_id
          WHERE m.id=q.message_id AND member.read_sequence<m.sequence AND
            NOT people_contact_blocked(t.left_user_id,t.right_user_id)
          AND (t.kind='person' OR NOT EXISTS (SELECT 1 FROM message_thread_member any_member WHERE any_member.thread_id=t.id AND any_member.blocked))
          AND (t.kind='person' OR EXISTS (SELECT 1 FROM directory_business b WHERE b.id=t.business_id AND b.owner_user_id=t.right_user_id AND b.status='published' AND package_allows_listing(b)))
        )))`,
          [job.id, job.attempts],
        )
      ).rows[0];
      if (!device) {
        await drop();
        return;
      }
      let outcome: "accepted" | "failed" = "failed";
      try {
        const subscription = readPushSubscription({
          endpoint: device.endpoint,
          keys: { auth: device.auth_key, p256dh: device.p256dh },
        });
        const signer = await signingKeys(pool);
        await send(subscription, JSON.stringify({ kind: job.kind, id: job.id }), {
          TTL: 300,
          urgency: "normal",
          timeout: 8000,
          contentEncoding: "aes128gcm",
          vapidDetails: { subject: `mailto:${contact}`, ...signer },
        });
        outcome = "accepted";
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await pool.query("DELETE FROM push_device WHERE id=$1", [job.device_id]);
          return;
        }
        if ((status === 429 || status === 0 || status >= 500) && job.attempts < 3) return;
      }
      if (job.kind === "test")
        await pool.query(
          "UPDATE push_device SET test_state=$2 WHERE test_id=$1 AND test_state IN ('scheduled','accepted')",
          [job.id, outcome],
        );
      await drop();
    }),
  );
  return jobs.length;
}

const runtime = globalThis as typeof globalThis & {
  __ahiPushWorker?: ReturnType<typeof setInterval>;
};
export function startPushWorker() {
  if (
    runtime.__ahiPushWorker ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    !readAuthConfiguration()
  )
    return;
  let running = false;
  runtime.__ahiPushWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const pool = getAuthDatabasePool(),
        config = readAuthConfiguration();
      if (pool && config) await dispatchDuePush(pool, config.smtp.from);
    } catch {
      console.error("Push delivery worker unavailable.");
    } finally {
      running = false;
    }
  }, 5000);
  runtime.__ahiPushWorker.unref();
}
