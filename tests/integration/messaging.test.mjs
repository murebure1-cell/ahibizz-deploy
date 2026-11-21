import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://messaging-ci.ahibizz.invalid";
const password = "Messaging-only-fixture-password-824!";
const emails = [
  "owner@messaging-fixture.invalid",
  "member@messaging-fixture.invalid",
  "other@messaging-fixture.invalid",
];

async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname, tablename",
      [schema],
    )
  ).rows;
}

async function waitForTwoLockWaiters(pool, applicationName, expected = 2) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= expected) return;
    await delay(20);
  }
  throw new Error("Both messaging commands must reach the held actor lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated person and business messaging, participant authority and durable commands", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex");
    const schema = `ci_messaging_${suffix}`;
    assert.match(schema, /^ci_messaging_[a-f0-9]{20}$/);
    const applicationName = `messaging-ci-${suffix}`;
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool;
    let created = false;
    const originalFetch = globalThis.fetch;
    let outboundAttempts = 0;
    try {
      assert.deepEqual(
        (await administration.query("SELECT current_database() AS db, current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      assert.equal(
        (
          await administration.query(
            "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname = $1",
            [schema],
          )
        ).rows[0].n,
        0,
      );
      const outside = await outsideTables(administration, schema);
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        options: `-c search_path=${schema}`,
        application_name: applicationName,
      });
      pool.on("error", () => {});
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      const migrations = await loadMigrations();
      assert.deepEqual(
        migrations.map((row) => row.version),
        [
          "0001_platform.sql",
          "0002_auth.sql",
          "0003_account_management.sql",
          "0004_directory.sql",
          "0005_booking.sql",
          "0006_personal_profiles.sql",
          "0007_people_connections.sql",
          "0008_business_media.sql",
          "0009_messaging.sql",
          "0010_billing.sql",
          "0011_business_details.sql",
          "0012_business_reviews.sql",
          "0013_business_favorites.sql",
          "0014_business_ownership.sql",
          "0015_profile_verification.sql",
          "0016_vehicle_rentals.sql",
          "0017_accommodation.sql",
          "0018_directory_revisions.sql",
          "0019_account_approval_email.sql",
          "0020_push_devices.sql",
          "0021_paypal_checkout.sql",
          "0022_dodo_test_checkout.sql",
          "0023_sandbox_package_contracts.sql",
          "0024_sandbox_subscription_settlement_hold.sql",
          "0025_support_requests.sql",
          "0026_community_rules.sql",
          "0027_live_package_contracts.sql",
          "0028_marketing_offers.sql",
          "0029_marketing_online_checkout.sql",
          "0030_production_orders.sql",
          "0031_directory_removal.sql",
          "0032_ahi_credit_wallet.sql",
          "0033_wallet_category_promotion.sql",
          "0034_wallet_package_periods.sql",
          "0035_marketing_campaign_briefs.sql",
          "0036_ad_delivery.sql",
          "0037_ad_rate_card.sql",
          "0038_marketing_ad_asset.sql",
          "0039_ad_audience_preferences.sql",
          "0040_ad_audience_sample.sql",
          "0041_ad_geo_schedule.sql",
          "0042_ad_sample_devices.sql",
          "0043_people_blocks.sql",
          "0044_business_reels.sql",
          "0045_content_hub.sql",
          "0046_saved_searches.sql",
        ],
      );
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "directory_business",
        "directory_moderation_audit",
        "directory_create_commands",
        "message_thread",
        "message_thread_member",
        "message_message",
        "message_command",
      ]) {
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      }
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is forbidden in messaging acceptance.");
      };
      const {
        createAuthService,
        createAccountService,
        bootstrapInitialOwner,
        readCurrentAuthUser,
      } = await import("../../src/server/auth/index.ts");
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const captured = new Map();
      const auth = createAuthService({
        pool,
        baseURL,
        production: true,
        secret: `messaging-fixture-${randomBytes(32).toString("hex")}`,
        sendEmail: async (message) => {
          assert.ok(emails.includes(message.to));
          assert.equal(message.kind, "verification");
          assert.equal(new URL(message.url).origin, baseURL);
          assert.equal(captured.has(message.to), false);
          captured.set(message.to, message);
        },
      });
      const authHttp = createAuthHttpHandler({
        auth,
        baseURL,
        readUser: (id) => readCurrentAuthUser(pool, id),
      });
      async function authRequest(method, route, body) {
        const headers = new Headers({
          origin: baseURL,
          "user-agent": "Isolated messaging acceptance",
        });
        if (body !== undefined) headers.set("content-type", "application/json");
        return authHttp(
          new Request(new URL(route, baseURL), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      }
      const actors = [];
      for (const [index, email] of emails.entries()) {
        assert.equal(
          (
            await authRequest("POST", "/api/auth/sign-up/email", {
              name: `Fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        const verify = await authRequest("GET", captured.get(email).url);
        assert.ok([200, 302].includes(verify.status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else
          assert.equal(
            (
              await pool.query("UPDATE auth_user SET approval = 'approved' WHERE email = $1", [
                email,
              ])
            ).rowCount,
            1,
          );
        const signed = await authRequest("POST", "/api/auth/sign-in/email", { email, password });
        assert.equal(signed.status, 200);
        const cookie = signed.headers
          .getSetCookie()
          .map((line) => line.split(";", 1)[0])
          .join("; ");
        assert.ok(cookie);
        const headers = new Headers({ origin: baseURL, cookie });
        const session = await auth.api.getSession({ headers });
        assert.equal(session.user.email, email);
        actors.push({ headers, user: session.user, session: session.session });
      }
      assert.equal(captured.size, 3);
      assert.equal(
        (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
        3,
      );
      const [owner, member, other] = actors;
      const { pushAcceptance } = await import("./push-cases.mjs");
      const push = pushAcceptance(auth, pool, actors);
      const { createDirectoryService } = await import("../../src/server/directory/index.ts");
      const accounts = createAccountService({ auth, pool });
      const directory = createDirectoryService({ accounts, auth, pool });
      const { createMessagingService, MessagingAccessError } = await import(
        "../../src/server/messaging/index.ts"
      );
      const { readChatConversation, readChatThreadPage } = await import(
        "../../src/lib/messaging.ts"
      );
      const messaging = createMessagingService({ accounts, auth, pool });
      const deny = (action, status, code) =>
        assert.rejects(
          action,
          (error) =>
            error instanceof MessagingAccessError &&
            error.status === status &&
            (!code || error.code === code),
        );
      const snapshot = async () => {
        const result = {};
        for (const table of [
          "message_thread",
          "message_thread_member",
          "message_message",
          "message_command",
        ])
          result[table] = (
            await pool.query(
              `SELECT row_to_json(row) AS value FROM ${table} row ORDER BY row_to_json(row)::text`,
            )
          ).rows;
        return result;
      };
      const category = await directory.createCategory(owner.headers, {
        name: "Isolated messaging category",
        slug: "isolated-messaging-category",
      });
      let personal, businessThread, business;

      await t.test(
        "empty approved inboxes stay empty and pending, unauthenticated and forged input cannot write",
        async () => {
          const before = await snapshot();
          for (const actor of actors)
            for (const inbox of ["personal", "business"])
              assert.deepEqual(await messaging.list(actor.headers, { inbox }), {
                items: [],
                page: 1,
                hasMore: false,
              });
          await deny(
            () => messaging.list(new Headers(), { inbox: "personal" }),
            401,
            "AUTHENTICATION_REQUIRED",
          );
          await deny(
            () =>
              messaging.open(
                member.headers,
                { kind: "person", targetId: member.user.id },
                randomUUID(),
              ),
            400,
            "SELF_MESSAGE_NOT_ALLOWED",
          );
          await deny(
            () =>
              messaging.open(
                member.headers,
                { kind: "person", targetId: owner.user.id },
                randomUUID(),
              ),
            404,
            "PERSON_NOT_FOUND",
          );
          for (const input of [
            { kind: "owner", targetId: owner.user.id },
            { kind: "person", targetId: "../private" },
            { kind: "person", targetId: owner.user.id, role: "owner" },
          ])
            await deny(
              () => messaging.open(member.headers, input, randomUUID()),
              400,
              "INVALID_MESSAGING_INPUT",
            );
          await pool.query("UPDATE auth_user SET approval='pending' WHERE id=$1", [member.user.id]);
          await deny(
            () => messaging.list(member.headers, { inbox: "personal" }),
            403,
            "ACCOUNT_PENDING_APPROVAL",
          );
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
            member.user.id,
          ]);
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "new personal conversation requires public recipient, deduplicates opposite directions and hides all private profile fields",
        async () => {
          await pool.query(
            "INSERT INTO personal_profile(user_id,version,is_public,birth_date,bio) VALUES($1,1,true,DATE '1990-01-01','Private fixture bio')",
            [other.user.id],
          );
          const key = randomUUID(),
            target = { kind: "person", targetId: other.user.id };
          personal = await messaging.open(member.headers, target, key);
          assert.deepEqual(personal, {
            threadId: personal.threadId,
            messageId: null,
            sequence: null,
          });
          assert.deepEqual(await messaging.open(member.headers, target, key), personal);
          await deny(
            () => messaging.open(member.headers, { kind: "person", targetId: owner.user.id }, key),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          const opposite = await messaging.open(
            other.headers,
            { kind: "person", targetId: member.user.id },
            randomUUID(),
          );
          assert.equal(
            opposite.threadId,
            personal.threadId,
            "Existing participants can reopen history without public search visibility.",
          );
          const view = readChatConversation(
            await messaging.read(member.headers, personal.threadId, {}),
          );
          assert.equal(view.thread.title, other.user.name);
          assert.equal(view.thread.inbox, "personal");
          assert.equal(view.thread.latestSequence, 0);
          assert.equal(view.thread.lastMessage, null);
          assert.deepEqual(view.items, []);
          assert.deepEqual(
            Object.keys(view.thread).sort(),
            [
              "id",
              "kind",
              "inbox",
              "title",
              "targetId",
              "canSend",
              "blockedByMe",
              "blocked",
              "latestSequence",
              "readSequence",
              "unreadCount",
              "lastMessage",
            ].sort(),
          );
          assert.equal(JSON.stringify(view).includes(other.user.email), false);
          assert.equal(JSON.stringify(view).includes("1990-01-01"), false);
          assert.equal(JSON.stringify(view).includes("Private fixture bio"), false);
          const before = await snapshot();
          for (const method of [
            () => messaging.read(owner.headers, personal.threadId, {}),
            () =>
              messaging.send(
                owner.headers,
                personal.threadId,
                { body: "Not a participant" },
                randomUUID(),
              ),
            () =>
              messaging.block(owner.headers, personal.threadId, { blocked: true }, randomUUID()),
            () => messaging.markRead(owner.headers, personal.threadId, { throughSequence: 0 }),
          ])
            await deny(method, 404, "THREAD_NOT_FOUND");
          assert.deepEqual((await messaging.list(owner.headers, { inbox: "personal" })).items, []);
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "expected account header binds commands and receipt recovery to the locked signed actor",
        async () => {
          const matching = new Headers(member.headers);
          matching.set("X-AhiBizz-Account-ID", member.user.id);
          const key = randomUUID(),
            input = { body: "Account-bound command fixture" };
          const accepted = await messaging.block(
            matching,
            personal.threadId,
            { blocked: false },
            key,
          );
          assert.deepEqual(
            await messaging.block(matching, personal.threadId, { blocked: false }, key),
            accepted,
          );
          const before = await snapshot();
          const switched = new Headers(other.headers);
          switched.set("X-AhiBizz-Account-ID", member.user.id);
          for (const action of [
            () => messaging.list(switched, { inbox: "personal" }),
            () => messaging.read(switched, personal.threadId, {}),
            () => messaging.send(switched, personal.threadId, input, key),
            () => messaging.send(switched, personal.threadId, input, randomUUID()),
            () => messaging.block(switched, personal.threadId, { blocked: true }, randomUUID()),
            () => messaging.markRead(switched, personal.threadId, { throughSequence: 1 }),
            () =>
              messaging.open(switched, { kind: "person", targetId: member.user.id }, randomUUID()),
          ])
            await deny(action, 401, "ACCOUNT_IDENTITY_CHANGED");
          for (const invalid of ["", "bad account", "../another", "x".repeat(129)]) {
            const headers = new Headers(member.headers);
            headers.set("X-AhiBizz-Account-ID", invalid);
            await deny(
              () => messaging.send(headers, personal.threadId, input, randomUUID()),
              400,
              "INVALID_MESSAGING_INPUT",
            );
          }
          assert.deepEqual(await snapshot(), before);
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).items.length,
            0,
            "An omitted header retains compatibility; rejected expectations never write.",
          );
        },
      );

      await t.test(
        "authorized device-only delayed push survives polling and signs an encrypted notification",
        push.enroll,
      );
      await t.test(
        "actual blocked concurrent opens produce one pair and duplicate sends produce one immutable message receipt",
        async () => {
          await pool.query(
            "INSERT INTO personal_profile(user_id,version,is_public) VALUES($1,1,true)",
            [owner.user.id],
          );
          const gate = await pool.connect();
          let opens;
          try {
            await gate.query("BEGIN");
            await gate.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [member.user.id]);
            opens = Promise.allSettled([
              messaging.open(
                member.headers,
                { kind: "person", targetId: owner.user.id },
                randomUUID(),
              ),
              messaging.open(
                member.headers,
                { kind: "person", targetId: owner.user.id },
                randomUUID(),
              ),
            ]);
            await waitForTwoLockWaiters(pool, applicationName);
            await gate.query("COMMIT");
          } finally {
            await gate.query("ROLLBACK").catch(() => {});
            gate.release();
          }
          const opened = await opens;
          assert.equal(opened.filter((r) => r.status === "fulfilled").length, 2);
          assert.equal(opened[0].value.threadId, opened[1].value.threadId);
          const key = randomUUID(),
            body = { body: "  Pozdrav\r\nKako ste?  " },
            blocker = await pool.connect();
          const boundHeaders = new Headers(member.headers);
          boundHeaders.set("X-AhiBizz-Account-ID", member.user.id);
          let sends;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [
              member.user.id,
            ]);
            sends = Promise.allSettled([
              messaging.send(boundHeaders, personal.threadId, body, key),
              messaging.send(member.headers, personal.threadId, body, key),
            ]);
            await waitForTwoLockWaiters(pool, applicationName);
            await blocker.query("COMMIT");
          } finally {
            await blocker.query("ROLLBACK").catch(() => {});
            blocker.release();
          }
          const sent = await sends;
          assert.equal(sent.filter((r) => r.status === "fulfilled").length, 2);
          assert.deepEqual(sent[0].value, sent[1].value);
          assert.equal(sent[0].value.sequence, 1);
          const current = await messaging.read(member.headers, personal.threadId, {});
          assert.equal(current.items.length, 1);
          assert.equal(current.items[0].body, "Pozdrav\nKako ste?");
          const before = await snapshot();
          await deny(
            () =>
              messaging.send(member.headers, personal.threadId, { body: "Different intent" }, key),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "duplicate chat submission queues one push only for the subscribed recipient",
        push.recipientOnly,
      );
      await t.test(
        "sender-relative messages, unread counts and monotonic read pointers survive new replies and reject future reads",
        async () => {
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).thread.unreadCount,
            0,
          );
          let incoming = await messaging.read(other.headers, personal.threadId, {});
          assert.equal(incoming.thread.unreadCount, 1);
          assert.equal(incoming.items[0].from, "peer");
          const own = await messaging.send(
            other.headers,
            personal.threadId,
            { body: "Možemo razgovarati." },
            randomUUID(),
          );
          incoming = readChatConversation(
            await messaging.read(member.headers, personal.threadId, {}),
          );
          assert.equal(incoming.thread.unreadCount, 1);
          assert.equal(incoming.items.at(-1).from, "peer");
          assert.deepEqual(
            await messaging.markRead(member.headers, personal.threadId, {
              throughSequence: own.sequence,
            }),
            { readSequence: own.sequence },
          );
          assert.deepEqual(
            await messaging.markRead(member.headers, personal.threadId, { throughSequence: 0 }),
            { readSequence: own.sequence },
          );
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).thread.unreadCount,
            0,
          );
          const before = await snapshot();
          await deny(
            () =>
              messaging.markRead(member.headers, personal.threadId, {
                throughSequence: own.sequence + 1,
              }),
            400,
            "INVALID_MESSAGING_INPUT",
          );
          assert.deepEqual(await snapshot(), before);
          const emoji = "😀".repeat(150);
          await messaging.send(other.headers, personal.threadId, { body: emoji }, randomUUID());
          const listed = readChatThreadPage(
            await messaging.list(member.headers, { inbox: "personal" }),
          );
          const item = listed.items.find((row) => row.id === personal.threadId);
          assert.equal(item.lastMessage.body.length, 200);
          assert.equal(Array.from(item.lastMessage.body).length, 100);
        },
      );

      await t.test(
        "blocking either participant prevents both send directions and historic replay never silently reblocks after an unblock",
        async () => {
          const key = randomUUID(),
            receipt = await messaging.block(
              member.headers,
              personal.threadId,
              { blocked: true },
              key,
            );
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).thread.blockedByMe,
            true,
          );
          assert.equal(
            (await messaging.read(other.headers, personal.threadId, {})).thread.blockedByMe,
            false,
          );
          const before = await snapshot();
          for (const actor of [member, other])
            await deny(
              () =>
                messaging.send(
                  actor.headers,
                  personal.threadId,
                  { body: "Blocked message" },
                  randomUUID(),
                ),
              409,
              "MESSAGING_BLOCKED",
            );
          assert.deepEqual(await snapshot(), before);
          await messaging.block(
            member.headers,
            personal.threadId,
            { blocked: false },
            randomUUID(),
          );
          assert.deepEqual(
            await messaging.block(member.headers, personal.threadId, { blocked: true }, key),
            receipt,
          );
          const fresh = await messaging.read(member.headers, personal.threadId, {});
          assert.equal(fresh.thread.blocked, false);
          assert.equal(fresh.thread.canSend, true);
          await deny(
            () => messaging.block(member.headers, personal.threadId, { blocked: false }, key),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        },
      );

      await t.test(
        "hiding a profile keeps participant history but cannot open a new private recipient conversation; suspension disables sending",
        async () => {
          await pool.query(
            "UPDATE personal_profile SET is_public=false,version=version+1 WHERE user_id=$1",
            [other.user.id],
          );
          const view = await messaging.read(member.headers, personal.threadId, {});
          assert.equal(view.thread.title, other.user.name);
          assert.equal(view.thread.canSend, true);
          await deny(
            () =>
              messaging.open(
                owner.headers,
                { kind: "person", targetId: other.user.id },
                randomUUID(),
              ),
            404,
            "PERSON_NOT_FOUND",
          );
          await messaging.send(
            member.headers,
            personal.threadId,
            { body: "Existing history stays accessible." },
            randomUUID(),
          );
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            other.user.id,
          ]);
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).thread.canSend,
            false,
          );
          const before = await snapshot();
          await deny(
            () =>
              messaging.send(
                member.headers,
                personal.threadId,
                { body: "Unavailable peer" },
                randomUUID(),
              ),
            409,
            "CONVERSATION_UNAVAILABLE",
          );
          await deny(
            () => messaging.list(other.headers, { inbox: "personal" }),
            403,
            "ACCOUNT_SUSPENDED",
          );
          assert.deepEqual(await snapshot(), before);
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [other.user.id]);
        },
      );

      await t.test(
        "business inbox is separate, uses the business identity and excludes unlisted targets and self messages",
        async () => {
          business = await directory.create(
            owner.headers,
            { title: "Isolated professional studio", categoryId: category.id },
            randomUUID(),
          );
          await deny(
            () =>
              messaging.open(
                member.headers,
                { kind: "business", targetId: business.id },
                randomUUID(),
              ),
            404,
            "BUSINESS_NOT_FOUND",
          );
          business = await directory.publish(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          await deny(
            () =>
              messaging.open(
                owner.headers,
                { kind: "business", targetId: business.id },
                randomUUID(),
              ),
            400,
            "SELF_MESSAGE_NOT_ALLOWED",
          );
          businessThread = await messaging.open(
            member.headers,
            { kind: "business", targetId: business.id },
            randomUUID(),
          );
          const sent = await messaging.send(
            member.headers,
            businessThread.threadId,
            { body: "Želim više informacija o usluzi." },
            randomUUID(),
          );
          const ownerInbox = readChatThreadPage(
            await messaging.list(owner.headers, { inbox: "business" }),
          );
          assert.equal(ownerInbox.items.length, 1);
          assert.equal(ownerInbox.items[0].title, `${business.title} · ${member.user.name}`);
          assert.equal(ownerInbox.items[0].unreadCount, 1);
          assert.equal(
            (await messaging.list(owner.headers, { inbox: "personal" })).items.some(
              (row) => row.id === businessThread.threadId,
            ),
            false,
          );
          const customer = readChatConversation(
            await messaging.read(member.headers, businessThread.threadId, {}),
          );
          assert.equal(customer.thread.title, business.title);
          assert.equal(customer.thread.inbox, "personal");
          assert.equal(customer.thread.targetId, business.id);
          assert.equal(customer.items[0].sequence, sent.sequence);
          await messaging.send(
            owner.headers,
            businessThread.threadId,
            { body: "Hvala na upitu." },
            randomUUID(),
          );
          await deny(
            () => messaging.read(other.headers, businessThread.threadId, {}),
            404,
            "THREAD_NOT_FOUND",
          );
        },
      );

      await t.test(
        "account blocks control contact and private search filtering across business conversations",
        async () => {
          const { createAccountBlocksService } = await import("../../src/server/account-blocks.ts");
          const { createPublicDirectoryService } = await import(
            "../../src/server/directory/index.ts"
          );
          const blocks = createAccountBlocksService(auth, pool);
          const publicDirectory = createPublicDirectoryService({ database: pool });
          const bound = new Headers(member.headers);
          bound.set("X-AhiBizz-Account-ID", member.user.id);
          assert.deepEqual(await blocks.state(bound, owner.user.id), {
            blockedByMe: false,
            canContact: true,
            version: 0,
          });
          assert.deepEqual(await blocks.set(bound, owner.user.id, true, 0), {
            blockedByMe: true,
            canContact: false,
            version: 1,
          });
          assert.deepEqual(
            (await blocks.list(bound, 1)).items.map(({ id }) => id),
            [owner.user.id],
          );
          assert.equal((await blocks.list(owner.headers, 1)).items.length, 0);
          const switched = new Headers(owner.headers);
          switched.set("X-AhiBizz-Account-ID", member.user.id);
          for (const operation of [
            () => blocks.list(switched, 1),
            () => blocks.set(switched, member.user.id, true, 0),
          ])
            await assert.rejects(
              operation,
              (error) => error.status === 401 && error.code === "ACCOUNT_IDENTITY_CHANGED",
            );
          assert.equal(await blocks.searchFilter(bound), null);
          assert.equal(
            (await messaging.read(member.headers, businessThread.threadId, {})).thread.canSend,
            false,
          );
          await deny(
            () =>
              messaging.open(
                other.headers,
                { kind: "person", targetId: "missing-fixture" },
                randomUUID(),
              ),
            404,
            "PERSON_NOT_FOUND",
          );
          for (const actor of [member, owner]) {
            await deny(
              () =>
                messaging.send(
                  actor.headers,
                  businessThread.threadId,
                  { body: "No blocked business send" },
                  randomUUID(),
                ),
              409,
              "MESSAGING_BLOCKED",
            );
          }
          await assert.rejects(
            () => blocks.set(bound, owner.user.id, false, 0),
            (error) => error.status === 409 && error.code === "BLOCK_VERSION_CONFLICT",
          );
          await blocks.changeSearchFilter(bound, true);
          const viewer = await blocks.searchFilter(bound);
          assert.equal(viewer, member.user.id);
          const input = { q: business.title, pageSize: 20 };
          assert.equal((await publicDirectory.listPublic(input, false, viewer)).items.length, 0);
          assert.equal((await publicDirectory.listPublic(input)).items[0].id, business.id);
          await blocks.set(bound, owner.user.id, false, 1);
          assert.equal((await blocks.list(bound, 1)).items.length, 0);
          assert.equal(
            (await publicDirectory.listPublic(input, false, viewer)).items[0].id,
            business.id,
          );
          assert.equal(
            (await messaging.read(member.headers, businessThread.threadId, {})).thread.canSend,
            true,
          );
        },
      );

      await t.test(
        "archiving a business retains history but disables new messages until recovery and publication",
        async () => {
          business = await directory.archive(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          const before = await snapshot();
          assert.equal(
            (await messaging.read(member.headers, businessThread.threadId, {})).thread.canSend,
            false,
          );
          for (const actor of [owner, member])
            await deny(
              () =>
                messaging.send(
                  actor.headers,
                  businessThread.threadId,
                  { body: "No archived send" },
                  randomUUID(),
                ),
              409,
              "CONVERSATION_UNAVAILABLE",
            );
          assert.deepEqual(await snapshot(), before);
          business = await directory.recover(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          business = await directory.publish(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          assert.equal(
            (await messaging.read(member.headers, businessThread.threadId, {})).thread.canSend,
            true,
          );
        },
      );

      await t.test(
        "ownership transfer during a held business-row wait cannot grant either owner access to old private history",
        async () => {
          const before = await snapshot(),
            gate = await pool.connect();
          let pending;
          try {
            await gate.query("BEGIN");
            await gate.query("SELECT id FROM directory_business WHERE id=$1 FOR UPDATE", [
              business.id,
            ]);
            pending = messaging
              .send(
                member.headers,
                businessThread.threadId,
                { body: "Must not cross owner change" },
                randomUUID(),
              )
              .then(
                (value) => ({ status: "fulfilled", value }),
                (reason) => ({ status: "rejected", reason }),
              );
            await waitForTwoLockWaiters(pool, applicationName, 1);
            await gate.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
              business.id,
              other.user.id,
            ]);
            await gate.query("COMMIT");
          } finally {
            await gate.query("ROLLBACK").catch(() => {});
            gate.release();
          }
          const result = await pending;
          assert.equal(result.status, "rejected");
          assert.equal(result.reason.status, 404);
          assert.equal(result.reason.code, "THREAD_NOT_FOUND");
          assert.deepEqual(await snapshot(), before);
          for (const actor of actors)
            await deny(
              () => messaging.read(actor.headers, businessThread.threadId, {}),
              404,
              "THREAD_NOT_FOUND",
            );
          assert.equal(
            (await messaging.list(member.headers, { inbox: "personal" })).items.some(
              (row) => row.id === businessThread.threadId,
            ),
            false,
          );
          assert.deepEqual((await messaging.list(other.headers, { inbox: "business" })).items, []);
          const replacement = await messaging.open(
            member.headers,
            { kind: "business", targetId: business.id },
            randomUUID(),
          );
          assert.notEqual(replacement.threadId, businessThread.threadId);
          assert.deepEqual(
            (await messaging.read(other.headers, replacement.threadId, {})).items,
            [],
          );
        },
      );

      await t.test(
        "raw SQL cannot forge participant receipts, change history, lower read pointers or skip message sequence",
        async () => {
          const client = await pool.connect();
          const before = await snapshot();
          try {
            await client.query("BEGIN");
            const invalid = [
              [
                "UPDATE message_message SET body=$2 WHERE thread_id=$1",
                [personal.threadId, "Forged edit"],
              ],
              ["DELETE FROM message_message WHERE thread_id=$1", [personal.threadId]],
              [
                "UPDATE message_thread SET latest_sequence=latest_sequence+2 WHERE id=$1",
                [personal.threadId],
              ],
              [
                "UPDATE message_thread SET right_user_id=$2 WHERE id=$1",
                [personal.threadId, owner.user.id],
              ],
              [
                "UPDATE message_thread_member SET read_sequence=0 WHERE thread_id=$1 AND user_id=$2",
                [personal.threadId, member.user.id],
              ],
              [
                "INSERT INTO message_thread_member(thread_id,user_id) VALUES($1,$2)",
                [personal.threadId, owner.user.id],
              ],
              [
                "INSERT INTO message_message(id,thread_id,sender_user_id,sequence,body) VALUES($1,$2,$3,999,$4)",
                [randomUUID(), personal.threadId, member.user.id, "Forged gap"],
              ],
              [
                "INSERT INTO message_command(actor_user_id,request_id,operation,fingerprint,result_thread_id) VALUES($1,$2,$3,$4,$5)",
                [owner.user.id, randomUUID(), "open", "0".repeat(64), personal.threadId],
              ],
              [
                "UPDATE message_command SET fingerprint=$2 WHERE result_thread_id=$1",
                [personal.threadId, "1".repeat(64)],
              ],
            ];
            for (const [sql, values] of invalid) {
              await client.query("SAVEPOINT invalid_write");
              await assert.rejects(client.query(sql, values), (error) => error.code === "23514");
              await client.query("ROLLBACK TO SAVEPOINT invalid_write");
            }
            await client.query("ROLLBACK");
          } finally {
            await client.query("ROLLBACK").catch(() => {});
            client.release();
          }
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "real signed session expiring during its unchanged row lock rejects writes and reads after wall-clock expiry",
        async () => {
          const actor = member,
            signed = await auth.api.getSession({
              headers: actor.headers,
              query: { disableCookieCache: true, disableRefresh: true },
            }),
            originalExpiry = signed.session.expiresAt;
          const approved = await accounts.read(actor.headers),
            guarded = createMessagingService({
              accounts: { ...accounts, read: async () => approved },
              auth,
              pool,
            });
          for (const action of [
            () =>
              guarded.send(
                actor.headers,
                personal.threadId,
                { body: "Must expire before write" },
                randomUUID(),
              ),
            () => guarded.read(actor.headers, personal.threadId, {}),
          ]) {
            const gate = await pool.connect(),
              before = await snapshot();
            let pending;
            try {
              const expiry = (
                await pool.query(
                  `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '500 milliseconds' WHERE id=$1 RETURNING "expiresAt"`,
                  [signed.session.id],
                )
              ).rows[0].expiresAt;
              await gate.query("BEGIN");
              await gate.query("SELECT id FROM auth_session WHERE id=$1 FOR UPDATE", [
                signed.session.id,
              ]);
              pending = action().then(
                (value) => ({ status: "fulfilled", value }),
                (reason) => ({ status: "rejected", reason }),
              );
              await waitForTwoLockWaiters(pool, applicationName, 1);
              const waiter = (
                await pool.query(
                  "SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
                  [applicationName],
                )
              ).rows;
              assert.equal(waiter.length, 1);
              assert.ok(new Date(expiry) > new Date(waiter[0].xact_start));
              await pool.query(
                "SELECT pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.03)",
                [expiry],
              );
              await gate.query("COMMIT");
              const result = await pending;
              assert.equal(result.status, "rejected");
              assert.equal(result.reason.status, 401);
              assert.equal(result.reason.code, "AUTHENTICATION_REQUIRED");
              assert.deepEqual(await snapshot(), before);
            } finally {
              await gate.query("ROLLBACK").catch(() => {});
              gate.release();
              await pool.query('UPDATE auth_session SET "expiresAt"=$2 WHERE id=$1', [
                signed.session.id,
                originalExpiry,
              ]);
            }
          }
          assert.equal(
            (await messaging.read(member.headers, personal.threadId, {})).thread.id,
            personal.threadId,
          );
        },
      );

      await t.test(
        "revocation between signed preflight and authority cannot leak lists or create another message",
        async () => {
          const approved = await accounts.read(other.headers),
            signed = await auth.api.getSession({
              headers: other.headers,
              query: { disableCookieCache: true, disableRefresh: true },
            }),
            before = await snapshot();
          const stale = createMessagingService({
            accounts: { ...accounts, read: async () => approved },
            auth: {
              api: {
                getSession: async () => {
                  await pool.query("DELETE FROM auth_session WHERE id=$1", [signed.session.id]);
                  return signed;
                },
              },
            },
            pool,
          });
          await deny(
            () => stale.send(other.headers, personal.threadId, { body: "Revoked" }, randomUUID()),
            401,
            "AUTHENTICATION_REQUIRED",
          );
          await deny(
            () => stale.list(other.headers, { inbox: "personal" }),
            401,
            "AUTHENTICATION_REQUIRED",
          );
          assert.deepEqual(await snapshot(), before);
          const response = await authRequest("POST", "/api/auth/sign-in/email", {
            email: other.user.email,
            password,
          });
          assert.equal(response.status, 200);
          other.headers = new Headers({
            origin: baseURL,
            cookie: response.headers
              .getSetCookie()
              .map((line) => line.split(";", 1)[0])
              .join("; "),
          });
          assert.equal(
            (await messaging.read(other.headers, personal.threadId, {})).thread.id,
            personal.threadId,
          );
        },
      );

      await t.test(
        "actual HTTP uses signed actors, exact origin, safe DTOs and the same durable send receipt",
        async () => {
          const { createMessagingHttpHandler } = await import("../../src/server/messaging-http.ts");
          const http = createMessagingHttpHandler({ service: messaging, baseURL });
          const post = async (actor, path, input, key = randomUUID(), origin = baseURL) =>
            http(
              new Request(new URL(`/api/messaging/${path}`, baseURL), {
                method: "POST",
                headers: {
                  ...Object.fromEntries(actor.headers),
                  "content-type": "application/json",
                  "idempotency-key": key,
                  origin,
                },
                body: JSON.stringify(input),
              }),
            );
          assert.equal(
            (await http(new Request(new URL("/api/messaging/threads", baseURL)))).status,
            401,
          );
          const target = { kind: "person", targetId: member.user.id },
            open = await post(owner, "threads", target);
          assert.equal(open.status, 200);
          const opened = (await open.json()).receipt;
          const key = randomUUID(),
            input = { body: "Plain text: <script>this is not executable HTML</script>" };
          const sent = await post(owner, `threads/${opened.threadId}/messages`, input, key);
          assert.equal(sent.status, 200);
          const receipt = (await sent.json()).receipt;
          const replay = await post(owner, `threads/${opened.threadId}/messages`, input, key);
          assert.equal(replay.status, 200);
          assert.deepEqual((await replay.json()).receipt, receipt);
          const read = await http(
            new Request(new URL(`/api/messaging/threads/${opened.threadId}`, baseURL), {
              headers: member.headers,
            }),
          );
          assert.equal(read.status, 200);
          assert.equal(read.headers.get("cache-control"), "no-store");
          const view = readChatConversation(await read.json());
          assert.equal(view.items.at(-1).body, input.body);
          assert.equal(view.items.at(-1).from, "peer");
          const before = await snapshot();
          assert.equal(
            (
              await post(
                owner,
                `threads/${opened.threadId}/messages`,
                { body: "Cross-origin" },
                randomUUID(),
                "https://untrusted.invalid",
              )
            ).status,
            403,
          );
          assert.equal((await post(owner, "threads", { ...target, role: "owner" })).status, 400);
          assert.equal(
            (
              await post(owner, `threads/${personal.threadId}/messages`, {
                body: "Admin cannot bypass",
              })
            ).status,
            404,
          );
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "message pagination preserves exact chronological sequence and actor rate caps never consume idempotent replays",
        async () => {
          const count = (
            await pool.query(
              "SELECT count(*)::integer AS n FROM message_message WHERE sender_user_id=$1 AND created_at>clock_timestamp()-interval '1 minute'",
              [member.user.id],
            )
          ).rows[0].n;
          const key = randomUUID(),
            body = { body: "Rate fixture — retained exact receipt" };
          const first = await messaging.send(member.headers, personal.threadId, body, key);
          for (let index = count + 1; index < 60; index++)
            await messaging.send(
              member.headers,
              personal.threadId,
              { body: `Isolated chronological fixture ${index}` },
              randomUUID(),
            );
          const before = await snapshot();
          await deny(
            () =>
              messaging.send(
                member.headers,
                personal.threadId,
                { body: "Sixty first within a minute" },
                randomUUID(),
              ),
            429,
            "MESSAGING_RATE_LIMIT",
          );
          assert.deepEqual(
            await messaging.send(member.headers, personal.threadId, body, key),
            first,
          );
          assert.deepEqual(await snapshot(), before);
          const recent = readChatConversation(
            await messaging.read(other.headers, personal.threadId, {}),
          );
          assert.equal(recent.items.length, 50);
          assert.equal(recent.hasMore, true);
          const older = readChatConversation(
            await messaging.read(other.headers, personal.threadId, {
              before: recent.items[0].sequence,
            }),
          );
          assert.equal(older.hasMore, false);
          const joined = [...older.items, ...recent.items];
          assert.equal(joined.length, recent.thread.latestSequence);
          assert.deepEqual(
            joined.map((row) => row.sequence),
            Array.from({ length: joined.length }, (_, i) => i + 1),
          );
          assert.equal(new Set(joined.map((row) => row.id)).size, joined.length);
        },
      );

      await t.test(
        "new-thread and block limits are actor-scoped while existing conversations and exact replays remain usable",
        async () => {
          const existing = (
            await pool.query(
              "SELECT count(*)::integer AS n FROM message_thread WHERE created_by_user_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",
              [member.user.id],
            )
          ).rows[0].n;
          let firstTarget, firstKey, firstReceipt;
          for (let index = existing; index < 21; index++) {
            let target = await directory.create(
              owner.headers,
              { title: `Rate-only business ${index}`, categoryId: category.id },
              randomUUID(),
            );
            target = await directory.publish(owner.headers, target.id, {
              expectedVersion: target.version,
            });
            const input = { kind: "business", targetId: target.id },
              key = randomUUID();
            if (index < 20) {
              const result = await messaging.open(member.headers, input, key);
              if (!firstTarget) {
                firstTarget = input;
                firstKey = key;
                firstReceipt = result;
              }
            } else {
              const before = await snapshot();
              await deny(
                () => messaging.open(member.headers, input, key),
                429,
                "MESSAGING_RATE_LIMIT",
              );
              assert.deepEqual(await snapshot(), before);
            }
          }
          assert.deepEqual(
            await messaging.open(member.headers, firstTarget, firstKey),
            firstReceipt,
          );
          assert.equal(
            (await messaging.open(member.headers, firstTarget, randomUUID())).threadId,
            firstReceipt.threadId,
          );
          const blocks = (
            await pool.query(
              "SELECT count(*)::integer AS n FROM message_command WHERE actor_user_id=$1 AND operation='block' AND created_at>clock_timestamp()-interval '1 minute'",
              [member.user.id],
            )
          ).rows[0].n;
          let finalKey, finalInput, finalReceipt;
          for (let index = blocks; index < 30; index++) {
            finalKey = randomUUID();
            finalInput = { blocked: index % 2 === 0 };
            finalReceipt = await messaging.block(
              member.headers,
              personal.threadId,
              finalInput,
              finalKey,
            );
          }
          const before = await snapshot();
          await deny(
            () =>
              messaging.block(member.headers, personal.threadId, { blocked: true }, randomUUID()),
            429,
            "MESSAGING_RATE_LIMIT",
          );
          assert.deepEqual(
            await messaging.block(member.headers, personal.threadId, finalInput, finalKey),
            finalReceipt,
          );
          assert.deepEqual(await snapshot(), before);
          assert.equal(
            (await messaging.read(other.headers, personal.threadId, {})).thread.id,
            personal.threadId,
          );
        },
      );
      await t.test(
        "a bounded general command log also caps repeated new-key opens without penalizing receipt recovery",
        async () => {
          const target = { kind: "person", targetId: member.user.id },
            key = randomUUID(),
            receipt = await messaging.open(owner.headers, target, key);
          const count = (
            await pool.query(
              "SELECT count(*)::integer AS n FROM message_command WHERE actor_user_id=$1 AND created_at>clock_timestamp()-interval '1 minute'",
              [owner.user.id],
            )
          ).rows[0].n;
          await pool.query(
            "INSERT INTO message_command(actor_user_id,request_id,operation,fingerprint,result_thread_id) SELECT $1,gen_random_uuid(),'open',repeat('0',64),$2 FROM generate_series(1,$3::integer)",
            [owner.user.id, receipt.threadId, 240 - count],
          );
          const before = await snapshot();
          await deny(
            () => messaging.open(owner.headers, target, randomUUID()),
            429,
            "MESSAGING_RATE_LIMIT",
          );
          assert.deepEqual(await messaging.open(owner.headers, target, key), receipt);
          assert.deepEqual(await snapshot(), before);
          assert.equal(
            (await messaging.read(owner.headers, receipt.threadId, {})).thread.id,
            receipt.threadId,
          );
        },
      );

      assert.equal(outboundAttempts, 0);
      assert.deepEqual(await outsideTables(administration, schema), outside);
    } finally {
      globalThis.fetch = originalFetch;
      try {
        if (pool) await pool.end();
        if (created) {
          assert.equal(
            (
              await administration.query(
                "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1",
                [schema],
              )
            ).rows[0]?.owner,
            "ahibizz_ci",
          );
          await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
          assert.equal(
            (
              await administration.query(
                "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1",
                [schema],
              )
            ).rows[0].n,
            0,
          );
        }
      } finally {
        await administration.end();
      }
    }
  });
}
