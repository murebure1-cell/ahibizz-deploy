import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";
import { testManualVerification } from "./verification-cases.mjs";

const baseURL = "https://ownership-ci.ahibizz.invalid";
const password = "Ownership-only-fixture-password-2032!";
const emails = ["admin", "previous", "target", "other", "customer"].map(
  (name) => `${name}@ownership-fixture.invalid`,
);
const outsideTables = async (pool, schema) =>
  (
    await pool.query(
      "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' AND schemaname<>$1 ORDER BY schemaname,tablename",
      [schema],
    )
  ).rows;
async function denied(action, status, code) {
  await assert.rejects(
    action,
    (error) => error.status === status && (code === undefined || error.code === code),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated ownership transfer, authority, quota, recovery and preserved business data", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env),
      suffix = randomBytes(10).toString("hex"),
      schema = `ci_ownership_${suffix}`,
      applicationName = `ownership-ci-${suffix}`;
    assert.match(schema, /^ci_ownership_[a-f0-9]{20}$/);
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool,
      created = false,
      outside;
    const originalFetch = globalThis.fetch;
    let outboundAttempts = 0;
    try {
      assert.deepEqual(
        (await administration.query("SELECT current_database() AS db,current_user AS role")).rows,
        [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
      );
      assert.equal(
        (
          await administration.query(
            "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1",
            [schema],
          )
        ).rows[0].n,
        0,
      );
      outside = await outsideTables(administration, schema);
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        options: `-c search_path=${schema}`,
        application_name: applicationName,
        max: 8,
      });
      pool.on("error", () => {});
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      const migrations = await loadMigrations();
      assert.ok(migrations.some((row) => row.version === "0014_business_ownership.sql"));
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      assert.equal(
        (await pool.query("SELECT count(*)::integer AS n FROM directory_ownership_transfer"))
          .rows[0].n,
        0,
      );
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is prohibited in ownership acceptance.");
      };
      const {
        createAuthService,
        createAccountService,
        bootstrapInitialOwner,
        readCurrentAuthUser,
      } = await import("../../src/server/auth/index.ts");
      const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
      const { createDirectoryService } = await import("../../src/server/directory/service.ts");
      const { createBusinessOwnershipService } = await import(
        "../../src/server/business-ownership/service.ts"
      );
      const { createBusinessOwnershipHttpHandler } = await import(
        "../../src/server/business-ownership-http.ts"
      );
      const { createBookingService } = await import("../../src/server/booking/service.ts");
      const { createBusinessMediaService } = await import(
        "../../src/server/business-media/service.ts"
      );
      const { createMessagingService } = await import("../../src/server/messaging/service.ts");
      const { createPublicPersonBusinessesService } = await import(
        "../../src/server/public-person-businesses.ts"
      );
      const captures = new Map();
      const auth = createAuthService({
        pool,
        baseURL,
        production: true,
        secret: `ownership-ci-${randomBytes(32).toString("hex")}`,
        sendEmail: async (message) => {
          assert.ok(emails.includes(message.to));
          assert.equal(message.kind, "verification");
          assert.equal(new URL(message.url).origin, baseURL);
          assert.equal(captures.has(message.to), false);
          captures.set(message.to, message);
        },
      });
      const authHttp = createAuthHttpHandler({
        auth,
        baseURL,
        readUser: (id) => readCurrentAuthUser(pool, id),
      });
      const authRequest = (method, route, body) =>
        authHttp(
          new Request(new URL(route, baseURL), {
            method,
            headers: { origin: baseURL, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
      const actors = [];
      for (const [index, email] of emails.entries()) {
        assert.equal(
          (
            await authRequest("POST", "/api/auth/sign-up/email", {
              name: `Ownership fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        assert.ok([200, 302].includes((await authRequest("GET", captures.get(email).url)).status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else await pool.query("UPDATE auth_user SET approval='approved' WHERE email=$1", [email]);
        const response = await authRequest("POST", "/api/auth/sign-in/email", { email, password });
        assert.equal(response.status, 200);
        const cookie = response.headers
            .getSetCookie()
            .map((line) => line.split(";", 1)[0])
            .join("; "),
          headers = new Headers({ origin: baseURL, cookie });
        const signed = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        assert.equal(signed.user.email, email);
        headers.set("X-AhiBizz-Account-ID", signed.user.id);
        actors.push({ headers, user: signed.user, session: signed.session });
      }
      const [admin, previous, target, other, customer] = actors;
      const accounts = createAccountService({ auth, pool }),
        directory = createDirectoryService({ auth, accounts, pool }),
        ownership = createBusinessOwnershipService({ auth, accounts, pool });
      const ownershipHttp = createBusinessOwnershipHttpHandler({ service: ownership, baseURL });
      const media = createBusinessMediaService({ auth, accounts, pool }),
        messaging = createMessagingService({ auth, accounts, pool }),
        peopleBusinesses = createPublicPersonBusinessesService(pool);
      let now = new Date("2032-01-05T08:00:00.000Z");
      const booking = createBookingService({ auth, accounts, pool, now: () => now });
      const category = await directory.createCategory(admin.headers, {
        name: "Ownership fixture",
        slug: `ownership-${suffix}`,
      });
      const create = (actor = admin, title = "Imported business fixture") =>
        directory.create(
          actor.headers,
          {
            title,
            categoryId: category.id,
            contactEmail: previous.user.email,
            city: "Tuzla",
            addressLine: "Fixture address 1",
            latitude: 44.53,
            longitude: 18.67,
          },
          randomUUID(),
        );
      const command = (business, person = target, key = randomUUID()) => ({
        expectedVersion: business.version,
        targetAccountId: person.user.id,
        targetEmail: person.user.email,
        idempotencyKey: key,
      });
      const archive = async (business) =>
        directory.archive(admin.headers, business.id, {
          expectedVersion: (await directory.readOwn(admin.headers, business.id)).version,
        });
      await testManualVerification(t, {
        auth,
        accounts,
        pool,
        admin,
        member: previous,
        create,
        archive,
        baseURL,
      });
      let main = await create(previous);
      main = await directory.publish(previous.headers, main.id, { expectedVersion: main.version });
      main = await directory.moderate(admin.headers, main.id, {
        expectedVersion: main.version,
        status: "published",
      });
      const sharp = (await import("sharp")).default;
      const logo = await sharp({
        create: { width: 512, height: 512, channels: 3, background: "#17364a" },
      })
        .png()
        .toBuffer();
      await media.save(
        admin.headers,
        main.id,
        "logo",
        0,
        { expectedVersion: main.version, bytes: logo },
        randomUUID(),
      );
      main = await directory.readOwn(admin.headers, main.id);
      await pool.query(
        "INSERT INTO personal_profile(user_id,is_public,version) VALUES($1,true,1),($2,true,1)",
        [previous.user.id, target.user.id],
      );
      const configurationBefore = await booking.saveSettings(previous.headers, main.id, {
        expectedVersion: 0,
        enabled: true,
        timezone: "UTC",
        windows: Array.from({ length: 7 }, (_, index) => ({
          weekday: index + 1,
          startMinute: 0,
          endMinute: 1440,
        })),
        services: [
          { name: "Fixture service", durationMinutes: 30, priceMinor: 2000, active: true },
        ],
      });
      let appointment = await booking.createRequest(
        customer.headers,
        main.id,
        {
          serviceId: configurationBefore.services[0].id,
          startsAt: "2032-01-05T09:00:00.000Z",
          configurationVersion: configurationBefore.version,
        },
        randomUUID(),
      );
      const originalThread = await messaging.open(
        customer.headers,
        { kind: "business", targetId: main.id },
        randomUUID(),
      );
      await messaging.send(
        customer.headers,
        originalThread.threadId,
        { body: "Private history for the original owner" },
        randomUUID(),
      );
      const businessRows = async () =>
        (await pool.query("SELECT * FROM directory_business ORDER BY id")).rows;
      const historyRows = async () =>
        Object.fromEntries(
          await Promise.all(
            [
              "directory_business_image",
              "directory_business_media_event",
              "booking_settings",
              "booking_service",
              "booking_entry",
              "booking_entry_event",
              "booking_completion_credit",
              "message_thread",
              "message_thread_member",
              "message_message",
              "message_command",
            ].map(async (table) => [
              table,
              (await pool.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows,
            ]),
          ),
        );
      main = await directory.update(previous.headers, main.id, {
        expectedVersion: main.version,
        title: "Unreviewed former owner title",
      });
      assert.equal(main.editorialRevision.fields.title, "Unreviewed former owner title");
      const priorHistory = await historyRows();
      const original = { ...main },
        firstCommand = command(main);
      await t.test(
        "all ownership operations are admin-only and cannot enumerate members",
        async () => {
          for (const actor of [previous, target, customer]) {
            await denied(() => ownership.read(actor.headers, main.id), 403, "OWNER_REQUIRED");
            await denied(
              () => ownership.lookup(actor.headers, main.id, { email: target.user.email }),
              403,
              "OWNER_REQUIRED",
            );
            await denied(
              () => ownership.assign(actor.headers, main.id, firstCommand),
              403,
              "OWNER_REQUIRED",
            );
          }
          await denied(() => ownership.read(new Headers(), main.id), 401);
          const wrong = new Headers(admin.headers);
          wrong.set("X-AhiBizz-Account-ID", target.user.id);
          await denied(() => ownership.read(wrong, main.id), 401, "ACCOUNT_IDENTITY_CHANGED");
        },
      );
      await t.test(
        "lookup matches only the exact normalized confirmed approved email",
        async () => {
          const result = await ownership.lookup(admin.headers, main.id, {
            email: ` ${target.user.email.toUpperCase()} `,
          });
          assert.deepEqual(result.candidate, {
            id: target.user.id,
            name: target.user.name,
            email: target.user.email,
          });
          assert.equal(result.business.version, main.version);
          await denied(
            () => ownership.lookup(admin.headers, main.id, { email: `not-${target.user.email}` }),
            404,
            "TARGET_ACCOUNT_NOT_FOUND",
          );
          for (const state of [
            { approval: "pending", verified: true },
            { approval: "suspended", verified: true },
            { approval: "approved", verified: false },
          ]) {
            await pool.query('UPDATE auth_user SET approval=$2,"emailVerified"=$3 WHERE id=$1', [
              target.user.id,
              state.approval,
              state.verified,
            ]);
            await denied(
              () => ownership.lookup(admin.headers, main.id, { email: target.user.email }),
              409,
              "TARGET_ACCOUNT_NOT_ELIGIBLE",
            );
          }
          await pool.query(
            "UPDATE auth_user SET approval='approved',\"emailVerified\"=true WHERE id=$1",
            [target.user.id],
          );
        },
      );
      await t.test(
        "mismatched ID/email and stale global versions do not mutate ownership",
        async () => {
          const before = await businessRows();
          await denied(
            () =>
              ownership.assign(admin.headers, main.id, {
                ...firstCommand,
                targetEmail: other.user.email,
              }),
            409,
            "TARGET_ACCOUNT_CHANGED",
          );
          await denied(
            () =>
              ownership.assign(admin.headers, main.id, {
                ...firstCommand,
                expectedVersion: main.version - 1,
              }),
            409,
            "VERSION_CONFLICT",
          );
          assert.deepEqual(await businessRows(), before);
        },
      );
      let firstResult;
      await t.test(
        "explicit assignment bumps global CAS once and preserves status, fields, media and business histories",
        async () => {
          firstResult = await ownership.assign(admin.headers, main.id, firstCommand);
          main = firstResult.business;
          assert.equal(main.ownerId, target.user.id);
          assert.equal(main.version, original.version + 1);
          assert.equal(main.status, "published");
          const omit = (value) => {
            const { ownerId: _owner, version: _version, updatedAt: _updated, ...rest } = value;
            return rest;
          };
          assert.equal(main.editorialRevision, null);
          assert.equal((await directory.readPublic(main.id)).title, original.title);
          assert.deepEqual(omit(main), omit({ ...original, editorialRevision: null }));
          assert.deepEqual(await historyRows(), priorHistory);
          assert.equal(firstResult.receipt.previousOwnerId, previous.user.id);
          assert.equal(firstResult.receipt.targetAccountId, target.user.id);
          assert.equal(firstResult.receipt.resultVersion, main.version);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_ownership_transfer"))
              .rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "new owner gets existing management and booking access; former ordinary owner loses it",
        async () => {
          assert.equal((await directory.readOwn(target.headers, main.id)).ownerId, target.user.id);
          await denied(() => directory.readOwn(previous.headers, main.id), 404);
          await denied(() => media.readOwn(previous.headers, main.id), 404);
          assert.deepEqual(
            await booking.readSettings(target.headers, main.id),
            configurationBefore,
          );
          await denied(() => booking.readSettings(previous.headers, main.id), 403);
          const range = { from: "2032-01-05T00:00:00.000Z", to: "2032-01-06T00:00:00.000Z" };
          assert.equal(
            (await booking.calendar(target.headers, main.id, range)).entries[0].id,
            appointment.id,
          );
          assert.equal((await directory.readOwn(admin.headers, main.id)).ownerId, target.user.id);
        },
      );
      await t.test(
        "public personal business ownership changes without leaking private account fields",
        async () => {
          assert.equal(
            (await peopleBusinesses.list(previous.user.id)).items.some((row) => row.id === main.id),
            false,
          );
          const item = (await peopleBusinesses.list(target.user.id)).items.find(
            (row) => row.id === main.id,
          );
          assert.ok(item);
          assert.equal("ownerId" in item, false);
          assert.equal("email" in item, false);
        },
      );
      await t.test(
        "transfer never exposes the old owner's immutable business conversations to the new owner",
        async () => {
          await denied(
            () => messaging.read(target.headers, originalThread.threadId, {}),
            404,
            "THREAD_NOT_FOUND",
          );
          await denied(
            () => messaging.read(previous.headers, originalThread.threadId, {}),
            404,
            "THREAD_NOT_FOUND",
          );
          const fresh = await messaging.open(
            customer.headers,
            { kind: "business", targetId: main.id },
            randomUUID(),
          );
          assert.notEqual(fresh.threadId, originalThread.threadId);
          assert.equal((await messaging.read(target.headers, fresh.threadId, {})).items.length, 0);
          assert.equal(
            (
              await pool.query("SELECT body FROM message_message WHERE thread_id=$1", [
                originalThread.threadId,
              ])
            ).rows[0].body,
            "Private history for the original owner",
          );
        },
      );
      await t.test(
        "new owner can approve existing booking; completion retains original snapshot credit recipient exactly once",
        async () => {
          appointment = await booking.transition(target.headers, appointment.id, {
            action: "approve",
            expectedVersion: appointment.version,
          });
          now = new Date("2032-01-05T10:00:00.000Z");
          appointment = await booking.transition(target.headers, appointment.id, {
            action: "complete",
            expectedVersion: appointment.version,
          });
          const credit = (
            await pool.query(
              "SELECT entry_id,recipient_user_id,amount FROM booking_completion_credit WHERE entry_id=$1",
              [appointment.id],
            )
          ).rows;
          assert.deepEqual(credit, [
            { entry_id: appointment.id, recipient_user_id: previous.user.id, amount: 5 },
          ]);
          await denied(
            () =>
              booking.transition(target.headers, appointment.id, {
                action: "complete",
                expectedVersion: appointment.version,
              }),
            409,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM booking_completion_credit WHERE entry_id=$1",
                [appointment.id],
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "original exact-key recovery is historical evidence, never a second ownership change",
        async () => {
          const second = await ownership.assign(admin.headers, main.id, command(main, admin));
          main = second.business;
          const before = await businessRows(),
            count = (
              await pool.query("SELECT count(*)::integer AS n FROM directory_ownership_transfer")
            ).rows[0].n;
          const replay = await ownership.assign(admin.headers, main.id, firstCommand);
          assert.equal(replay.business.ownerId, admin.user.id);
          assert.deepEqual(replay.receipt, firstResult.receipt);
          assert.deepEqual(
            (await ownership.read(admin.headers, main.id, firstCommand.idempotencyKey)).receipt,
            firstResult.receipt,
          );
          assert.deepEqual(await businessRows(), before);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_ownership_transfer"))
              .rows[0].n,
            count,
          );
          await denied(
            () =>
              ownership.assign(admin.headers, main.id, {
                ...firstCommand,
                targetEmail: other.user.email,
              }),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        },
      );
      await t.test(
        "two concurrent assignments cannot exceed the target member's one-business limit",
        async () => {
          const rows = [await create(admin, "Quota A"), await create(admin, "Quota B")];
          const results = await Promise.allSettled(
            rows.map((row) => ownership.assign(admin.headers, row.id, command(row))),
          );
          assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
          assert.equal(
            results.filter(
              (row) => row.status === "rejected" && row.reason.code === "BUSINESS_LIMIT_REACHED",
            ).length,
            1,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_business WHERE owner_user_id=$1 AND status<>'archived'",
                [target.user.id],
              )
            ).rows[0].n,
            1,
          );
          for (const row of rows) await archive(row);
        },
      );
      await t.test("two targets racing on one business produce only one CAS transfer", async () => {
        const business = await create(admin, "CAS race"),
          results = await Promise.allSettled([
            ownership.assign(admin.headers, business.id, command(business, target)),
            ownership.assign(admin.headers, business.id, command(business, other)),
          ]);
        assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
        assert.equal(
          results.filter(
            (row) => row.status === "rejected" && row.reason.code === "VERSION_CONFLICT",
          ).length,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer AS n FROM directory_ownership_transfer WHERE business_id=$1",
              [business.id],
            )
          ).rows[0].n,
          1,
        );
        await archive(business);
      });
      await t.test(
        "private draft correction reason survives ownership-only changes but not a later content edit",
        async () => {
          let business = await create(admin, "Draft correction"),
            row = await directory.publish(admin.headers, business.id, {
              expectedVersion: business.version,
            });
          business = await directory.moderate(admin.headers, row.id, {
            expectedVersion: row.version,
            status: "draft",
            reason: "Dopuni adresu prije objave.",
          });
          const correctedAt = business.moderationReturn.createdAt;
          const changed = await ownership.assign(admin.headers, business.id, command(business));
          assert.equal(changed.business.moderationReturn.reason, "Dopuni adresu prije objave.");
          assert.equal(changed.business.moderationReturn.createdAt, correctedAt);
          assert.equal(changed.business.moderationReturn.version, changed.business.version);
          const edited = await directory.update(target.headers, business.id, {
            expectedVersion: changed.business.version,
            description: "Dopunjeni podaci",
          });
          assert.equal(edited.moderationReturn, null);
          await archive(edited);
        },
      );
      async function cachedOwnership() {
        const account = await accounts.read(admin.headers),
          signed = await auth.api.getSession({
            headers: admin.headers,
            query: { disableCookieCache: true, disableRefresh: true },
          });
        return createBusinessOwnershipService({
          pool,
          accounts: { read: async () => account },
          auth: { api: { getSession: async () => signed } },
        });
      }
      async function waitForBlocked() {
        for (let index = 0; index < 150; index++) {
          if (
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                [applicationName],
              )
            ).rows[0].n > 0
          )
            return;
          await delay(10);
        }
        throw new Error("Ownership operation did not reach its held lock.");
      }
      await t.test(
        "target eligibility is checked after waiting for its locked account row",
        async () => {
          const business = await create(admin, "Eligibility race"),
            cached = await cachedOwnership(),
            blocker = await pool.connect();
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [
              target.user.id,
            ]);
            const waiting = cached.assign(admin.headers, business.id, command(business)),
              observed = denied(() => waiting, 409, "TARGET_ACCOUNT_NOT_ELIGIBLE");
            await waitForBlocked();
            await blocker.query("UPDATE auth_user SET approval='pending' WHERE id=$1", [
              target.user.id,
            ]);
            await blocker.query("COMMIT");
            await observed;
            assert.equal(
              (await directory.readOwn(admin.headers, business.id)).ownerId,
              admin.user.id,
            );
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
            await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
              target.user.id,
            ]);
          }
          await archive(business);
        },
      );
      await t.test(
        "expiry during the final business-row wait denies transfer despite earlier session locks",
        async () => {
          const business = await create(admin, "Expiry race"),
            cached = await cachedOwnership(),
            blocker = await pool.connect();
          const expires = (
            await pool.query('SELECT "expiresAt" FROM auth_session WHERE id=$1', [admin.session.id])
          ).rows[0].expiresAt;
          try {
            await pool.query(
              "UPDATE auth_session SET \"expiresAt\"=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
              [admin.session.id],
            );
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM directory_business WHERE id=$1 FOR UPDATE", [
              business.id,
            ]);
            const waiting = cached.assign(admin.headers, business.id, command(business)),
              observed = denied(() => waiting, 401, "AUTHENTICATION_REQUIRED");
            await waitForBlocked();
            await delay(600);
            await blocker.query("COMMIT");
            await observed;
            assert.equal(
              (
                await pool.query("SELECT owner_user_id FROM directory_business WHERE id=$1", [
                  business.id,
                ])
              ).rows[0].owner_user_id,
              admin.user.id,
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::integer AS n FROM directory_ownership_transfer WHERE business_id=$1",
                  [business.id],
                )
              ).rows[0].n,
              0,
            );
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
            await pool.query('UPDATE auth_session SET "expiresAt"=$2 WHERE id=$1', [
              admin.session.id,
              expires,
            ]);
          }
          await archive(business);
        },
      );
      await t.test("immutable receipts reject updates, deletes and fabricated state", async () => {
        await assert.rejects(
          () =>
            pool.query(
              "UPDATE directory_ownership_transfer SET note='altered' WHERE actor_user_id=$1 AND request_id=$2",
              [admin.user.id, firstCommand.idempotencyKey],
            ),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          () =>
            pool.query(
              "DELETE FROM directory_ownership_transfer WHERE actor_user_id=$1 AND request_id=$2",
              [admin.user.id, firstCommand.idempotencyKey],
            ),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          () =>
            pool.query(
              "INSERT INTO directory_ownership_transfer(actor_user_id,request_id,business_id,previous_owner_user_id,target_user_id,previous_version,result_version,fingerprint) VALUES($1,$2,$3,$4,$5,100,101,$6)",
              [
                customer.user.id,
                randomUUID(),
                main.id,
                previous.user.id,
                target.user.id,
                "a".repeat(64),
              ],
            ),
          (error) => error.code === "23514",
        );
        assert.deepEqual(
          (await ownership.read(admin.headers, main.id, firstCommand.idempotencyKey)).receipt,
          firstResult.receipt,
        );
      });
      await t.test(
        "actual HTTP keeps private queries off URLs and rejects denied malformed writes",
        async () => {
          const send = (actor, method, suffix = "", body) =>
            ownershipHttp(
              new Request(`${baseURL}/api/directory/ownership/${main.id}${suffix}`, {
                method,
                headers: {
                  ...Object.fromEntries(actor.headers),
                  "content-type": "application/json",
                },
                ...(body === undefined
                  ? {}
                  : { body: typeof body === "string" ? body : JSON.stringify(body) }),
              }),
            );
          assert.equal((await send(target, "POST", "/lookup", "malformed")).status, 403);
          const read = await send(admin, "GET", `?requestId=${firstCommand.idempotencyKey}`);
          assert.equal(read.status, 200);
          assert.equal(read.headers.get("Cache-Control"), "no-store");
          assert.equal((await read.json()).receipt.targetAccountId, target.user.id);
          assert.equal(
            (await send(admin, "GET", `?email=${encodeURIComponent(target.user.email)}`)).status,
            400,
          );
        },
      );
      await t.test("removed businesses are inaccessible in all owner workspaces", async () => {
        const item = await create(admin, "Removed workspace fixture");
        await directory.remove(admin.headers, item.id, { expectedVersion: item.version });
        await denied(ownership.read(admin.headers, item.id), 404, "BUSINESS_NOT_FOUND");
        await denied(media.readOwn(admin.headers, item.id), 404, "BUSINESS_NOT_FOUND");
        await denied(booking.readSettings(admin.headers, item.id), 404, "BUSINESS_NOT_FOUND");
        const { createRentalService } = await import("../../src/server/rentals/service.ts");
        const { createStayService } = await import("../../src/server/stays/service.ts");
        for (const service of [createRentalService, createStayService]) {
          await denied(
            service({ auth, accounts, pool }).ownerCatalog(admin.headers, item.id),
            404,
            "BUSINESS_NOT_FOUND",
          );
        }
      });
      assert.equal(outboundAttempts, 0);
      assert.equal(captures.size, 5);
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
