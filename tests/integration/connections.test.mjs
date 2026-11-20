import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://connections-ci.ahibizz.invalid";
const password = "Connections-only-fixture-password-994!";
const emails = ["owner", "alice", "bob", "carol", "pending"].map(
  (name) => `${name}@connections-fixture.invalid`,
);
async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname,tablename",
      [schema],
    )
  ).rows;
}
async function waiting(pool, applicationName) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= 2) return;
    await delay(10);
  }
  throw new Error("Both connection writes must reach a held authority lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated public-profile privacy and signed connection lifecycle", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex"),
      schema = `ci_connections_${suffix}`,
      applicationName = `connections-ci-${suffix}`;
    assert.match(schema, /^ci_connections_[a-f0-9]{20}$/);
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool,
      created = false;
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
      const outside = await outsideTables(administration, schema);
      await administration.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      pool = new Pool({
        ...configuration,
        max: 6,
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
        ],
      );
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "personal_profile",
        "people_connection",
        "people_connection_event",
        "people_connection_command",
        "personal_profile_visibility_event",
        "personal_profile_visibility_command",
      ])
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is forbidden in connections acceptance.");
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
        secret: `connections-fixture-${randomBytes(32).toString("hex")}`,
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
      const accounts = createAccountService({ auth, pool });
      async function authRequest(method, route, body) {
        const headers = new Headers({
          origin: baseURL,
          "user-agent": "Isolated connections acceptance",
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
              name: `Connection fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        assert.ok([200, 302].includes((await authRequest("GET", captured.get(email).url)).status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else if (index < 4) {
          const pending = (await accounts.listPending(actors[0].headers)).accounts.find(
            (row) => row.email === email,
          );
          assert.ok(pending);
          await accounts.decide(actors[0].headers, pending.id, {
            approval: "approved",
            expected: "pending",
          });
        }
        const signed = await authRequest("POST", "/api/auth/sign-in/email", { email, password });
        if (index === 4) {
          assert.equal(signed.status, 403);
          continue;
        }
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
      const [owner, alice, bob, carol] = actors;
      assert.equal(captured.size, 5);
      const { createPeopleService } = await import("../../src/server/people/index.ts");
      const { createConnectionsService } = await import("../../src/server/connections/index.ts");
      const people = createPeopleService({ accounts, auth, pool });
      const connections = createConnectionsService({ accounts, auth, pool });
      async function denied(action, status, code) {
        await assert.rejects(
          action,
          (error) => error.status === status && (!code || error.code === code),
        );
      }
      const profileFields = (name) => ({
        name,
        birthDate: "2000-02-29",
        city: "Tuzla",
        countryCode: "BA",
        bio: "Javna biografija.",
        skills: ["Dizajn", "SQL"],
        workStatus: "open_to_collaboration",
      });
      async function show(actor, isPublic) {
        const current = await connections.readVisibility(actor.headers);
        return connections.setVisibility(
          actor.headers,
          { isPublic, expectedVersion: current.profileVersion },
          randomUUID(),
        );
      }
      async function state(actor, target) {
        return connections.relationship(actor.headers, target.user.id);
      }
      async function request(actor, target, key = randomUUID()) {
        const current = await state(actor, target);
        return connections.request(
          actor.headers,
          target.user.id,
          { expectedVersion: current.version },
          key,
        );
      }
      async function action(actor, connection, verb, key = randomUUID()) {
        return connections.transition(
          actor.headers,
          connection.id,
          { action: verb, expectedVersion: connection.version },
          key,
        );
      }
      let publicPhoto, publicCover;

      await t.test(
        "default privacy, anonymous identity, forged headers and non-inserting reads",
        async () => {
          assert.deepEqual(await connections.searchPublic({}), {
            items: [],
            page: 1,
            hasMore: false,
          });
          assert.deepEqual(await connections.readVisibility(alice.headers), {
            isPublic: false,
            profileVersion: 0,
          });
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM personal_profile")).rows[0].n,
            0,
          );
          const forged = new Headers({ "x-user-id": alice.user.id, "x-role": "owner" });
          assert.equal(await connections.readViewer(forged), null);
          await denied(() => connections.readVisibility(forged), 401, "AUTHENTICATION_REQUIRED");
          await denied(() => connections.readPublic(alice.user.id), 404, "PERSON_NOT_FOUND");
          assert.deepEqual(await connections.readViewer(alice.headers), { id: alice.user.id });
          await denied(
            () =>
              connections.request(
                alice.headers,
                alice.user.id,
                { expectedVersion: 0 },
                randomUUID(),
              ),
            400,
            "SELF_CONNECTION",
          );
        },
      );
      await t.test(
        "explicit opt-in shares global text/media CAS and idempotent visibility receipts",
        async () => {
          const profile = await people.update(alice.headers, {
            ...profileFields("Alice javni profil"),
            expectedVersion: 0,
          });
          const key = randomUUID(),
            input = { isPublic: true, expectedVersion: profile.version };
          const published = await connections.setVisibility(alice.headers, input, key);
          assert.deepEqual(published, { isPublic: true, profileVersion: 2 });
          assert.deepEqual(await connections.setVisibility(alice.headers, input, key), published);
          await denied(
            () => connections.setVisibility(alice.headers, { ...input, isPublic: false }, key),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          await denied(
            () => connections.setVisibility(alice.headers, input, randomUUID()),
            409,
            "VERSION_CONFLICT",
          );
          await denied(
            () =>
              people.update(alice.headers, {
                ...profileFields("Stale write"),
                expectedVersion: profile.version,
              }),
            409,
            "VERSION_CONFLICT",
          );
          await denied(
            () =>
              connections.setVisibility(
                alice.headers,
                { isPublic: true, expectedVersion: 2, userId: bob.user.id },
                randomUUID(),
              ),
            400,
            "INVALID_CONNECTION_INPUT",
          );
          assert.equal((await people.read(alice.headers)).birthDate, "2000-02-29");
          await show(alice, false);
          assert.deepEqual(
            await connections.setVisibility(alice.headers, input, key),
            published,
            "Historical receipts never change current visibility.",
          );
          await denied(() => connections.readPublic(alice.user.id), 404);
          await show(alice, true);
          await people.update(bob.headers, {
            ...profileFields("Bob javni profil"),
            expectedVersion: 0,
          });
          await show(bob, true);
          await show(carol, true);
        },
      );
      await t.test(
        "public DTO is a strict whitelist, public search is bounded and literal",
        async () => {
          const profile = await connections.readPublic(alice.user.id);
          assert.deepEqual(
            Object.keys(profile).sort(),
            [
              "id",
              "name",
              "city",
              "countryCode",
              "bio",
              "skills",
              "workStatus",
              "photoVersion",
              "coverVersion",
              "verified",
              "platformFounder",
              "platformAdministrator",
            ].sort(),
          );
          assert.equal(profile.name, "Alice javni profil");
          assert.equal(profile.verified, false);
          assert.equal(JSON.stringify(profile).includes("2000-02-29"), false);
          for (const secret of [
            "email",
            "role",
            "approval",
            "birthDate",
            "version",
            "isPublic",
            "canCustomizeCover",
            "token",
          ])
            assert.equal(Object.hasOwn(profile, secret), false);
          assert.equal((await connections.searchPublic({ q: "Alice" })).items.length, 1);
          assert.equal((await connections.searchPublic({ q: "%" })).items.length, 0);
          assert.deepEqual(await connections.searchPublic({ page: 2 }), {
            items: [],
            page: 2,
            hasMore: false,
          });
          for (const input of [
            { page: 0 },
            { page: "1" },
            { page: 1001 },
            { q: "x".repeat(101) },
            { q: "\u202e" },
            { role: "owner" },
          ])
            await denied(() => connections.searchPublic(input), 400, "INVALID_CONNECTION_INPUT");
          await denied(
            () =>
              connections.request(
                owner.headers,
                alice.user.id,
                { expectedVersion: 0 },
                randomUUID(),
              ),
            403,
            "PUBLIC_PROFILE_REQUIRED",
          );
          await denied(
            () =>
              connections.request(
                alice.headers,
                owner.user.id,
                { expectedVersion: 0 },
                randomUUID(),
              ),
            404,
            "PERSON_NOT_FOUND",
          );
          await denied(
            () => connections.readPublic("../../auth_user"),
            400,
            "INVALID_CONNECTION_INPUT",
          );
        },
      );
      await t.test(
        "normalized public image versions, immediate opt-out and current cover entitlement",
        async () => {
          const { default: sharp } = await import("sharp");
          const png = await sharp({
            create: { width: 64, height: 64, channels: 3, background: "#153d5c" },
          })
            .png()
            .toBuffer();
          let profile = await people.read(alice.headers);
          profile = await people.saveMedia(alice.headers, "photo", {
            expectedVersion: profile.version,
            bytes: png,
          });
          publicPhoto = profile.photoVersion;
          await pool.query(
            "INSERT INTO personal_profile_entitlement(user_id,can_customize_cover) VALUES($1,true)",
            [alice.user.id],
          );
          profile = await people.saveMedia(alice.headers, "cover", {
            expectedVersion: profile.version,
            bytes: png,
          });
          publicCover = profile.coverVersion;
          const image = await connections.readPublicMedia(alice.user.id, "photo", publicPhoto);
          assert.equal(image.mime, "image/webp");
          assert.equal(image.width, 512);
          assert.equal((await sharp(image.bytes).metadata()).exif, undefined);
          assert.equal(
            (await connections.readPublicMedia(alice.user.id, "cover", publicCover)).width,
            1600,
          );
          assert.equal(
            await connections.readPublicMedia(alice.user.id, "photo", publicPhoto + 1),
            null,
          );
          await show(alice, false);
          assert.equal(
            await connections.readPublicMedia(alice.user.id, "photo", publicPhoto),
            null,
          );
          assert.equal(
            await connections.readPublicMedia(alice.user.id, "cover", publicCover),
            null,
          );
          assert.equal((await connections.searchPublic({ q: "Alice" })).items.length, 0);
          await show(alice, true);
          await pool.query(
            "UPDATE personal_profile_entitlement SET can_customize_cover=false WHERE user_id=$1",
            [alice.user.id],
          );
          assert.equal((await connections.readPublic(alice.user.id)).coverVersion, null);
          assert.equal(
            await connections.readPublicMedia(alice.user.id, "cover", publicCover),
            null,
          );
          assert.ok(await connections.readPublicMedia(alice.user.id, "photo", publicPhoto));
        },
      );
      await t.test(
        "request, recipient-only approval, no reciprocal autoaccept and exact unknown-retry replay",
        async () => {
          const key = randomUUID(),
            initial = await request(alice, bob, key);
          assert.equal(initial.status, "pending");
          assert.equal(initial.direction, "outgoing");
          assert.equal((await state(bob, alice)).direction, "incoming");
          const outgoing = await connections.list(alice.headers, { view: "outgoing" });
          assert.equal(outgoing.items.length, 1);
          assert.equal(outgoing.items[0].person.id, bob.user.id);
          assert.equal((await connections.list(bob.headers, { view: "incoming" })).items.length, 1);
          await denied(() => request(bob, alice), 409, "CONNECTION_ALREADY_EXISTS");
          await denied(
            () => action(alice, initial, "accept"),
            409,
            "CONNECTION_ACTION_NOT_ALLOWED",
          );
          await denied(() => action(carol, initial, "accept"), 404, "CONNECTION_NOT_FOUND");
          await denied(
            () => connections.request(alice.headers, carol.user.id, { expectedVersion: 0 }, key),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          const accepted = await action(bob, initial, "accept");
          assert.equal(accepted.status, "accepted");
          assert.equal(accepted.version, 2);
          assert.deepEqual(
            await connections.request(alice.headers, bob.user.id, { expectedVersion: 0 }, key),
            initial,
          );
          assert.equal(
            (await connections.list(alice.headers, { view: "contacts" })).items.length,
            1,
          );
          assert.equal((await connections.list(bob.headers, { view: "incoming" })).items.length, 0);
          await denied(() => action(alice, initial, "cancel"), 409, "VERSION_CONFLICT");
          await denied(
            () => action(bob, accepted, "decline"),
            409,
            "CONNECTION_ACTION_NOT_ALLOWED",
          );
        },
      );
      await t.test(
        "expected account header binds reads, transitions and receipts to the locked actor",
        async () => {
          async function snapshot() {
            const result = {};
            for (const table of [
              "personal_profile",
              "people_connection",
              "people_connection_command",
              "people_connection_event",
              "personal_profile_visibility_command",
              "personal_profile_visibility_event",
            ])
              result[table] = (
                await pool.query(
                  `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
                )
              ).rows;
            return result;
          }
          const pair = await state(alice, bob);
          const prior = (
            await pool.query(
              "SELECT request_id FROM people_connection_command WHERE actor_user_id=$1 AND person_id=$2 AND result_version=1",
              [alice.user.id, bob.user.id],
            )
          ).rows[0];
          assert.ok(prior);
          const matching = new Headers(alice.headers);
          matching.set("X-AhiBizz-Account-ID", alice.user.id);
          const before = await snapshot();
          assert.deepEqual(
            await connections.list(matching, { view: "contacts" }),
            await connections.list(alice.headers, { view: "contacts" }),
          );
          assert.equal(
            (
              await connections.request(
                matching,
                bob.user.id,
                { expectedVersion: 0 },
                prior.request_id,
              )
            ).version,
            1,
          );
          const switched = new Headers(bob.headers);
          switched.set("X-AhiBizz-Account-ID", alice.user.id);
          for (const operation of [
            () => connections.list(switched, { view: "contacts" }),
            () => connections.readVisibility(switched),
            () => connections.relationship(switched, alice.user.id),
            () =>
              connections.setVisibility(
                switched,
                { isPublic: false, expectedVersion: 1 },
                randomUUID(),
              ),
            () =>
              connections.request(switched, carol.user.id, { expectedVersion: 0 }, randomUUID()),
            () =>
              connections.request(
                switched,
                carol.user.id,
                { expectedVersion: 0 },
                prior.request_id,
              ),
            () =>
              connections.transition(
                switched,
                pair.id,
                { action: "remove", expectedVersion: pair.version },
                randomUUID(),
              ),
          ])
            await denied(operation, 401, "ACCOUNT_IDENTITY_CHANGED");
          for (const value of ["", "bad actor", "../another", "x".repeat(129)]) {
            const malformed = new Headers(alice.headers);
            malformed.set("X-AhiBizz-Account-ID", value);
            await denied(
              () => connections.list(malformed, { view: "contacts" }),
              400,
              "INVALID_CONNECTION_INPUT",
            );
          }
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        "private contacts keep manageable opaque relationship without profile or media disclosure",
        async () => {
          await show(bob, false);
          const listed = await connections.list(alice.headers, { view: "contacts" });
          assert.equal(listed.items.length, 1);
          assert.equal(listed.items[0].person, null);
          assert.equal(listed.items[0].personId, bob.user.id);
          assert.equal(JSON.stringify(listed).includes("Bob javni profil"), false);
          await denied(() => connections.readPublic(bob.user.id), 404);
          const removed = await action(alice, listed.items[0], "remove");
          assert.equal(removed.status, "removed");
          assert.equal(removed.version, 3);
          assert.equal(
            (await connections.list(alice.headers, { view: "contacts" })).items.length,
            0,
          );
          await denied(() => request(alice, bob), 404);
          await show(bob, true);
        },
      );
      await t.test(
        "decline, cancel and reopening preserve one pair, version CAS and actor audit",
        async () => {
          let row = await request(bob, alice);
          assert.equal(row.version, 4);
          assert.equal(row.direction, "outgoing");
          await denied(() => action(alice, row, "cancel"), 409, "CONNECTION_ACTION_NOT_ALLOWED");
          row = await action(alice, row, "decline");
          assert.equal(row.status, "declined");
          row = await request(alice, bob);
          row = await action(alice, row, "cancel");
          assert.equal(row.status, "cancelled");
          assert.equal(row.version, 7);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM people_connection")).rows[0].n,
            1,
          );
          const events = (
            await pool.query(
              "SELECT action,previous_version,next_version FROM people_connection_event WHERE connection_id=$1 ORDER BY next_version",
              [row.id],
            )
          ).rows;
          assert.deepEqual(
            events.map((event) => event.action),
            ["request", "accept", "remove", "request", "decline", "request", "cancel"],
          );
          assert.deepEqual(
            events.map((event) => event.next_version),
            [1, 2, 3, 4, 5, 6, 7],
          );
          assert.ok(events.every((event) => event.previous_version + 1 === event.next_version));
        },
      );
      await t.test(
        "reciprocal concurrent creation and same-intent retry serialize without duplicate pairs",
        async () => {
          const blocker = await pool.connect();
          let writes;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [carol.user.id]);
            writes = Promise.allSettled([
              connections.request(
                alice.headers,
                carol.user.id,
                { expectedVersion: 0 },
                randomUUID(),
              ),
              connections.request(
                carol.headers,
                alice.user.id,
                { expectedVersion: 0 },
                randomUUID(),
              ),
            ]);
            await waiting(administration, applicationName);
            await blocker.query("COMMIT");
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
          }
          const results = await writes;
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          const conflict = results.find((result) => result.status === "rejected");
          assert.equal(conflict.reason.status, 409);
          const row = await state(alice, carol);
          assert.equal(row.status, "pending");
          const requester = row.direction === "outgoing" ? alice : carol;
          await action(requester, row, "cancel");
          const key = randomUUID(),
            current = await state(alice, carol),
            input = { expectedVersion: current.version };
          const replayed = await Promise.all([
            connections.request(alice.headers, carol.user.id, input, key),
            connections.request(alice.headers, carol.user.id, input, key),
          ]);
          assert.deepEqual(replayed[0], replayed[1]);
          assert.equal(replayed[0].status, "pending");
          assert.equal(
            (
              await pool.query("SELECT count(*)::integer AS n FROM people_connection WHERE id=$1", [
                row.id,
              ])
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM people_connection_event WHERE connection_id=$1",
                [row.id],
              )
            ).rows[0].n,
            3,
          );
        },
      );
      await t.test(
        "competing recipient decisions commit one transition and stale versions cannot overwrite it",
        async () => {
          const current = await state(carol, alice),
            blocker = await pool.connect();
          assert.equal(current.direction, "incoming");
          let writes;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [carol.user.id]);
            writes = Promise.allSettled([
              action(carol, current, "accept"),
              action(carol, current, "decline"),
            ]);
            await waiting(administration, applicationName);
            await blocker.query("COMMIT");
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
          }
          const results = await writes;
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          assert.equal(
            results.find((result) => result.status === "rejected").reason.code,
            "VERSION_CONFLICT",
          );
          const after = await state(carol, alice);
          assert.equal(after.version, current.version + 1);
          assert.ok(["accepted", "declined"].includes(after.status));
        },
      );
      await t.test(
        "database pair and transition constraints reject self, reversed, duplicates and skipped states",
        async () => {
          const [left, right] = [bob.user.id, carol.user.id].sort();
          await assert.rejects(
            () =>
              pool.query(
                "INSERT INTO people_connection(id,left_user_id,right_user_id,requester_user_id,status,version) VALUES($1,$2,$2,$2,'pending',1)",
                [randomUUID(), left],
              ),
            (error) => error.code === "23514",
          );
          await assert.rejects(
            () =>
              pool.query(
                "INSERT INTO people_connection(id,left_user_id,right_user_id,requester_user_id,status,version) VALUES($1,$2,$3,$2,'pending',1)",
                [randomUUID(), right, left],
              ),
            (error) => error.code === "23514",
          );
          await assert.rejects(
            () =>
              pool.query(
                "INSERT INTO people_connection(id,left_user_id,right_user_id,requester_user_id,status,version) VALUES($1,$2,$3,$2,'accepted',1)",
                [randomUUID(), left, right],
              ),
            (error) => error.code === "23514",
          );
          const existing = await state(alice, bob);
          await assert.rejects(
            () =>
              pool.query(
                "UPDATE people_connection SET status='accepted',version=version+1 WHERE id=$1",
                [existing.id],
              ),
            (error) => error.code === "23514",
          );
          const pair = (
            await pool.query("SELECT * FROM people_connection WHERE id=$1", [existing.id])
          ).rows[0];
          await assert.rejects(
            () =>
              pool.query(
                "INSERT INTO people_connection(id,left_user_id,right_user_id,requester_user_id,status,version) VALUES($1,$2,$3,$2,'pending',1)",
                [randomUUID(), pair.left_user_id, pair.right_user_id],
              ),
            (error) => error.code === "23505",
          );
        },
      );
      await t.test(
        "actual HTTP preserves public privacy, origin checks, typed media and idempotent request actions",
        async () => {
          const { createConnectionsHttpHandler } = await import(
            "../../src/server/connections-http.ts"
          );
          const http = createConnectionsHttpHandler({ service: connections, baseURL });
          const route = (suffix) => `${baseURL}/api/connections${suffix}`;
          async function write(actor, suffix, method, body, origin = baseURL) {
            const headers = new Headers(actor.headers);
            headers.set("origin", origin);
            headers.set("content-type", "application/json");
            return http(
              new Request(route(suffix), { method, headers, body: JSON.stringify(body) }),
            );
          }
          const detail = await http(new Request(route(`/people/${alice.user.id}`)));
          assert.equal(detail.status, 200);
          assert.equal(detail.headers.get("cache-control"), "no-store");
          const body = await detail.json();
          assert.equal(body.viewerId, null);
          assert.equal(body.relationship.status, "none");
          assert.deepEqual(body.person, await connections.readPublic(alice.user.id));
          assert.equal(Object.hasOwn(body.person, "birthDate"), false);
          const binary = await http(
            new Request(route(`/people/${alice.user.id}/media/photo?v=${publicPhoto}`)),
          );
          assert.equal(binary.status, 200);
          assert.equal(binary.headers.get("content-type"), "image/webp");
          assert.equal(binary.headers.get("cache-control"), "no-store");
          assert.equal(binary.headers.get("x-content-type-options"), "nosniff");
          assert.equal(binary.headers.get("cross-origin-resource-policy"), "same-origin");
          assert.equal(
            binary.headers.get("content-security-policy"),
            "default-src 'none'; sandbox",
          );
          assert.deepEqual(
            Buffer.from(await binary.arrayBuffer()),
            (await connections.readPublicMedia(alice.user.id, "photo", publicPhoto)).bytes,
          );
          const visibility = await connections.readVisibility(alice.headers);
          const input = {
            isPublic: false,
            expectedVersion: visibility.profileVersion,
            idempotencyKey: randomUUID(),
          };
          assert.equal(
            (await write(alice, "/visibility", "PATCH", input, "https://untrusted.invalid")).status,
            403,
          );
          assert.equal((await http(new Request(route("/visibility")))).status, 401);
          const hidden = await write(alice, "/visibility", "PATCH", input);
          assert.equal(hidden.status, 200);
          assert.equal((await hidden.json()).visibility.isPublic, false);
          assert.equal((await http(new Request(route(`/people/${alice.user.id}`)))).status, 404);
          assert.equal(
            (
              await http(
                new Request(route(`/people/${alice.user.id}/media/photo?v=${publicPhoto}`)),
              )
            ).status,
            404,
          );
          await show(alice, true);
          const current = await state(alice, bob);
          const requestBody = { expectedVersion: current.version, idempotencyKey: randomUUID() };
          const sent = await write(alice, `/people/${bob.user.id}/request`, "POST", requestBody);
          assert.equal(sent.status, 200);
          const pending = (await sent.json()).relationship;
          assert.equal(pending.status, "pending");
          assert.deepEqual(
            await (
              await write(alice, `/people/${bob.user.id}/request`, "POST", requestBody)
            ).json(),
            { relationship: pending },
          );
          assert.equal(
            (
              await write(alice, `/connections/${pending.id}/accept`, "POST", {
                expectedVersion: pending.version,
                idempotencyKey: randomUUID(),
              })
            ).status,
            409,
          );
          const accepted = await write(bob, `/connections/${pending.id}/accept`, "POST", {
            expectedVersion: pending.version,
            idempotencyKey: randomUUID(),
          });
          assert.equal(accepted.status, 200);
          assert.equal((await accepted.json()).relationship.status, "accepted");
          const contacts = await http(
            new Request(route("/connections?view=contacts"), { headers: alice.headers }),
          );
          assert.equal(contacts.status, 200);
          assert.equal(
            (await contacts.json()).items.some((item) => item.personId === bob.user.id),
            true,
          );
        },
      );
      await t.test(
        "fresh eligibility and signed-session locks reject stale auth and hide public projections",
        async () => {
          await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [bob.user.id]);
          await denied(() => connections.readPublic(bob.user.id), 404);
          assert.equal(await connections.readViewer(bob.headers), null);
          await denied(
            () => connections.list(bob.headers, { view: "contacts" }),
            403,
            "EMAIL_NOT_VERIFIED",
          );
          await pool.query('UPDATE auth_user SET "emailVerified"=true WHERE id=$1', [bob.user.id]);
          const staleAuth = {
            api: {
              getSession: async (input) => {
                const result = await auth.api.getSession(input);
                await pool.query("DELETE FROM auth_session WHERE id=$1", [bob.session.id]);
                return result;
              },
            },
          };
          const stale = createConnectionsService({ accounts, auth: staleAuth, pool });
          const before = await connections.readVisibility(bob.headers);
          await denied(
            () =>
              stale.setVisibility(
                bob.headers,
                { isPublic: false, expectedVersion: before.profileVersion },
                randomUUID(),
              ),
            401,
            "AUTHENTICATION_REQUIRED",
          );
          assert.equal((await connections.readPublic(bob.user.id)).id, bob.user.id);
          await accounts.decide(owner.headers, carol.user.id, {
            approval: "suspended",
            expected: "approved",
          });
          await denied(() => connections.readPublic(carol.user.id), 404);
          assert.equal(await connections.readViewer(carol.headers), null);
          await denied(
            () => connections.readVisibility(carol.headers),
            401,
            "AUTHENTICATION_REQUIRED",
          );
        },
      );
      const { createPublicPersonBusinessesService } = await import(
        "../../src/server/public-person-businesses.ts"
      );
      const publicBusinesses = createPublicPersonBusinessesService(pool);
      const businessPerson = "public-business-person";
      const sameNamePerson = "other-public-business-person";
      const emptyPerson = "empty-public-business-person";
      const businessCategory = randomUUID();
      await t.test(
        "public person businesses use owner FK, published-only paging and an explicit public card projection",
        async () => {
          for (const id of [businessPerson, sameNamePerson, emptyPerson]) {
            await pool.query(
              "INSERT INTO auth_user(id,name,email,\"emailVerified\",role,approval) VALUES($1,$2,$3,true,'member','approved')",
              [id, "Same public name", `${id}@person-businesses.invalid`],
            );
            await pool.query(
              "INSERT INTO personal_profile(user_id,is_public,version) VALUES($1,true,1)",
              [id],
            );
          }
          await pool.query(
            "INSERT INTO directory_category(id,name,slug) VALUES($1,'Public services','public-person-businesses-fixture')",
            [businessCategory],
          );
          for (let index = 0; index < 16; index++) {
            const status = index < 13 ? "published" : ["draft", "pending", "archived"][index - 13];
            await pool.query(
              "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at,archived_at,contact_email,city) VALUES($1,$2,$3,$4,$5,CASE WHEN $5='published' THEN now() ELSE NULL END,CASE WHEN $5='archived' THEN now() ELSE NULL END,'business-only@example.invalid','Tuzla')",
              [randomUUID(), businessPerson, `Owned ${index}`, businessCategory, status],
            );
          }
          await pool.query(
            "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Wrong owner same name',$3,'published',now())",
            [randomUUID(), sameNamePerson, businessCategory],
          );
          const first = await publicBusinesses.list(businessPerson, 1);
          const second = await publicBusinesses.list(businessPerson, 2);
          assert.equal(first.items.length, 12);
          assert.equal(first.hasMore, true);
          assert.equal(second.items.length, 1);
          assert.equal(second.hasMore, false);
          assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 13);
          assert.ok(
            [...first.items, ...second.items].every((row) => row.title.startsWith("Owned ")),
          );
          for (const row of [...first.items, ...second.items]) {
            assert.equal(row.contactEmail, null);
            for (const key of [
              "ownerId",
              "status",
              "version",
              "moderationReturn",
              "email",
              "birthDate",
            ])
              assert.equal(Object.hasOwn(row, key), false);
          }
          assert.deepEqual(await publicBusinesses.list(emptyPerson), {
            items: [],
            page: 1,
            hasMore: false,
          });
        },
      );
      await t.test(
        "opting out hides public person businesses immediately, including previously paged results",
        async () => {
          await pool.query("UPDATE personal_profile SET is_public=false WHERE user_id=$1", [
            businessPerson,
          ]);
          await denied(() => publicBusinesses.list(businessPerson, 1), 404);
          await denied(() => publicBusinesses.list(businessPerson, 2), 404);
          await pool.query("UPDATE personal_profile SET is_public=true WHERE user_id=$1", [
            businessPerson,
          ]);
          assert.equal((await publicBusinesses.list(businessPerson)).items.length, 12);
        },
      );
      await t.test(
        "unverified, pending and suspended owners cannot expose person business associations",
        async () => {
          await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [
            businessPerson,
          ]);
          await denied(() => publicBusinesses.list(businessPerson), 404);
          await pool.query(
            "UPDATE auth_user SET \"emailVerified\"=true,approval='pending' WHERE id=$1",
            [businessPerson],
          );
          await denied(() => publicBusinesses.list(businessPerson), 404);
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            businessPerson,
          ]);
          await denied(() => publicBusinesses.list(businessPerson), 404);
          await pool.query("UPDATE auth_user SET approval='approved',role='owner' WHERE id=$1", [
            businessPerson,
          ]);
          assert.equal((await publicBusinesses.list(businessPerson)).items.length, 12);
          assert.equal(
            (await publicBusinesses.list(sameNamePerson)).items[0].title,
            "Wrong owner same name",
          );
        },
      );
      await t.test(
        "founder insignia belong only to the verified initial owner, on their public and private profile",
        async () => {
          const founderId = owner.user.id;
          const badges = ({ verified, platformFounder, platformAdministrator }) => ({
            verified,
            platformFounder,
            platformAdministrator,
          });
          const none = { verified: false, platformFounder: false, platformAdministrator: false };
          const founder = { verified: true, platformFounder: true, platformAdministrator: true };
          const verifiedOnly = { ...none, verified: true };
          await show(owner, true);
          assert.deepEqual(badges(await people.read(owner.headers)), none);
          await pool.query("UPDATE auth_user SET name=$2 WHERE id=$1", [
            businessPerson,
            owner.user.name,
          ]);
          await pool.query("UPDATE auth_user SET profile_verified=true WHERE id=ANY($1::text[])", [
            [founderId, businessPerson],
          ]);
          await pool.query(
            `INSERT INTO auth_account_audit
             (id,actor_user_id,target_user_id,action,previous_approval,next_approval,previous_role,next_role)
             VALUES ($1,$2,$2,'bootstrap-owner','approved','approved','member','owner')`,
            [randomUUID(), businessPerson],
          );
          assert.deepEqual(badges(await people.read(owner.headers)), founder);
          assert.deepEqual(badges(await connections.readPublic(founderId)), founder);
          assert.deepEqual(badges(await connections.readPublic(businessPerson)), verifiedOnly);
          const matching = (await connections.searchPublic({ q: owner.user.name })).items;
          assert.deepEqual(
            matching.filter((p) => p.platformFounder).map((p) => p.id),
            [founderId],
          );
          assert.deepEqual(
            matching.filter((p) => p.platformAdministrator).map((p) => p.id),
            [founderId],
          );

          await pool.query("UPDATE auth_user SET role='member' WHERE id=$1", [founderId]);
          assert.deepEqual(badges(await connections.readPublic(founderId)), {
            ...founder,
            platformAdministrator: false,
          });
          assert.deepEqual(badges(await connections.readPublic(businessPerson)), verifiedOnly);
          await pool.query("UPDATE auth_user SET profile_verified=false WHERE id=$1", [founderId]);
          assert.deepEqual(badges(await people.read(owner.headers)), none);
          assert.deepEqual(badges(await connections.readPublic(founderId)), none);
          await show(owner, false);
          await denied(() => connections.readPublic(founderId), 404);
        },
      );
      assert.equal(outboundAttempts, 0);
      assert.deepEqual(await outsideTables(administration, schema), outside);
    } finally {
      globalThis.fetch = originalFetch;
      try {
        if (pool) await pool.end();
        if (created) {
          const owner = (
            await administration.query(
              "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1",
              [schema],
            )
          ).rows[0]?.owner;
          assert.equal(
            owner,
            "ahibizz_ci",
            "Only this newly created owned fixture namespace may be removed.",
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
