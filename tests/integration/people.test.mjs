import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://people-ci.ahibizz.invalid";
const password = "People-only-fixture-password-883!";
const emails = [
  "owner@people-fixture.invalid",
  "member@people-fixture.invalid",
  "other@people-fixture.invalid",
  "pending@people-fixture.invalid",
];
async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname,tablename",
      [schema],
    )
  ).rows;
}
async function waiting(pool, applicationName, minimum = 2) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= minimum) return;
    await delay(10);
  }
  throw new Error("Both personal profile writes must reach the held authority lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated private personal profiles, authority, global CAS and normalized media", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex"),
      schema = `ci_people_${suffix}`,
      applicationName = `people-ci-${suffix}`;
    assert.match(schema, /^ci_people_[a-f0-9]{20}$/);
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
        max: 5,
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
          "0047_paid_business_reels.sql",
          "0048_account_activity.sql",
          "0049_reel_engagement.sql",
          "0050_reel_reports.sql",
          "0051_account_erasure.sql",
          "0052_bank_credit_topups.sql",
          "0053_production_credit_purchases.sql",
          "0054_promotions.sql",
          "0055_reel_lifetime.sql",
          "0056_business_content_erasure.sql",
          "0057_drop_paypal_archive.sql",
          "0058_account_packages.sql",
          "0059_administration_account.sql",
          "0060_view_counts.sql",
          "0061_business_menu.sql",
          "0062_privacy_and_notification_choices.sql",
          "0063_business_analytics.sql",
          "0064_attempt_limits.sql",
          "0065_review_replies.sql",
        ],
      );
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "personal_profile",
        "personal_profile_entitlement",
        "personal_profile_image",
      ])
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is forbidden in personal profile acceptance.");
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
        secret: `people-fixture-${randomBytes(32).toString("hex")}`,
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
          "user-agent": "Isolated personal profile acceptance",
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
              name: `People fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        assert.ok([200, 302].includes((await authRequest("GET", captured.get(email).url)).status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else if (index < 3) {
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
        if (index === 3) {
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
        actors.push({ headers, user: session.user });
      }
      const [owner, member, other] = actors;
      assert.equal(captured.size, 4);
      const { createPeopleService } = await import("../../src/server/people/index.ts");
      const people = createPeopleService({ accounts, auth, pool });
      async function denied(action, status, code) {
        await assert.rejects(
          action,
          (error) => error.status === status && (!code || error.code === code),
        );
      }
      const base = {
        name: "  Lični ogledni profil  ",
        birthDate: "2000-02-29",
        city: "  Tuzla  ",
        countryCode: "BA",
        bio: "Ogledna privatna biografija.\nDrugi red.",
        skills: ["  SQL ", "Dizajn"],
        workStatus: "open_to_collaboration",
      };
      const write = (expectedVersion, changes = {}) =>
        people.update(member.headers, { ...base, expectedVersion, ...changes });

      await t.test(
        "eligible reads return virtual defaults without inserting any profile or entitlement",
        async () => {
          const profile = await people.read(member.headers);
          assert.deepEqual(profile, {
            id: member.user.id,
            name: member.user.name,
            verified: false,
            platformFounder: false,
            platformAdministrator: false,
            birthDate: null,
            city: null,
            countryCode: null,
            bio: null,
            skills: [],
            workStatus: "not_specified",
            version: 0,
            photoVersion: null,
            coverVersion: null,
            canCustomizeCover: true,
          });
          assert.equal((await people.read(owner.headers)).canCustomizeCover, true);
          assert.equal(await people.readMedia(member.headers, "photo"), null);
          for (const table of [
            "personal_profile",
            "personal_profile_entitlement",
            "personal_profile_image",
          ])
            assert.equal(
              (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
              0,
            );
          const anonymous = new Headers({ "x-user-id": member.user.id, "x-role": "owner" });
          await denied(() => people.read(anonymous), 401, "AUTHENTICATION_REQUIRED");
          const pendingId = (
            await pool.query("SELECT id FROM auth_user WHERE email=$1", [emails[3]])
          ).rows[0].id;
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer AS n FROM auth_session WHERE "userId"=$1',
                [pendingId],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test(
        "only the signed account can save and read private DOB, skills and synchronized name",
        async () => {
          const profile = await write(0);
          assert.equal(profile.id, member.user.id);
          assert.equal(profile.name, base.name.trim());
          assert.equal(profile.birthDate, "2000-02-29");
          assert.equal(profile.city, "Tuzla");
          assert.deepEqual(profile.skills, ["SQL", "Dizajn"]);
          assert.equal(profile.version, 1);
          assert.equal((await accounts.read(member.headers)).name, profile.name);
          assert.deepEqual(await people.read(member.headers), profile);
          const foreign = await people.read(other.headers);
          assert.equal(foreign.id, other.user.id);
          assert.equal(foreign.birthDate, null);
          assert.equal(foreign.bio, null);
          const forged = new Headers(other.headers);
          forged.set("x-user-id", member.user.id);
          assert.equal((await people.read(forged)).id, other.user.id);
          await denied(() => write(1, { userId: other.user.id }), 400, "INVALID_PROFILE_INPUT");
        },
      );
      await t.test(
        "invalid dates, bounds, duplicate skills and client entitlements leave data unchanged",
        async () => {
          const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          for (const change of [
            { birthDate: "1900-02-29" },
            { birthDate: "2026-02-30" },
            { birthDate: tomorrow },
            { birthDate: "0000-01-01" },
            { birthDate: "2000-2-29" },
            { city: "x".repeat(101) },
            { countryCode: "ZZ" },
            { countryCode: "ba" },
            { name: "\n" },
            { name: "x".repeat(101) },
            { bio: "x".repeat(1201) },
            { skills: ["SQL", " sql "] },
            { skills: Array.from({ length: 16 }, (_, index) => `Skill ${index}`) },
            { skills: ["x".repeat(41)] },
            { workStatus: "owner" },
            { canCustomizeCover: true },
            { photoVersion: 99 },
            { role: "owner" },
          ])
            await denied(() => write(1, change), 400, "INVALID_PROFILE_INPUT");
          assert.equal((await people.read(member.headers)).version, 1);
          assert.equal((await accounts.read(member.headers)).name, base.name.trim());
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM personal_profile_entitlement"))
              .rows[0].n,
            0,
          );
          const today = new Date().toISOString().slice(0, 10);
          const saved = await write(1, {
            birthDate: today,
            bio: null,
            city: null,
            countryCode: null,
            skills: [],
            workStatus: "not_specified",
          });
          assert.equal(saved.birthDate, today, "No minimum age is invented.");
          assert.equal(saved.version, 2);
        },
      );
      await t.test(
        "two writes at the same version serialize to one success, and old account-name writes invalidate CAS",
        async () => {
          const blocker = await pool.connect();
          let writes;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [
              member.user.id,
            ]);
            writes = Promise.allSettled([
              write(2, { name: "Concurrent A" }),
              write(2, { name: "Concurrent B" }),
            ]);
            await waiting(administration, applicationName);
            await blocker.query("COMMIT");
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
          }
          const results = await writes;
          assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
          const conflict = results.find((item) => item.status === "rejected");
          assert.equal(conflict.reason.status, 409);
          assert.equal(conflict.reason.code, "VERSION_CONFLICT");
          const before = await people.read(member.headers);
          assert.equal(before.version, 3);
          await accounts.update(member.headers, { name: "Updated through account API" });
          const after = await people.read(member.headers);
          assert.equal(after.version, before.version + 1);
          assert.equal(after.name, "Updated through account API");
          await denied(() => write(before.version), 409, "VERSION_CONFLICT");
          await accounts.update(member.headers, { appearance: "dark" });
          assert.equal(
            (await people.read(member.headers)).version,
            after.version,
            "Unrelated preferences do not invalidate personal fields.",
          );
        },
      );
      const { default: sharp } = await import("sharp");
      const png = await sharp({
        create: { width: 96, height: 64, channels: 3, background: "#184c74" },
      })
        .png()
        .toBuffer();
      await t.test(
        "expected account binds every private read and write before touching equal-version foreign data",
        async () => {
          const before = await people.read(other.headers);
          const snapshot = async () => ({
            accounts: (await pool.query("SELECT id,name FROM auth_user ORDER BY id")).rows,
            profiles: (await pool.query("SELECT * FROM personal_profile ORDER BY user_id")).rows,
            images: (await pool.query("SELECT * FROM personal_profile_image ORDER BY user_id,kind"))
              .rows,
          });
          const saved = await snapshot();
          for (const [id, status, code] of [
            [member.user.id, 401, "ACCOUNT_IDENTITY_CHANGED"],
            ["invalid/actor", 400, "INVALID_PROFILE_INPUT"],
          ]) {
            const headers = new Headers(other.headers);
            headers.set("X-AhiBizz-Account-ID", id);
            for (const action of [
              () => people.read(headers),
              () => people.readMedia(headers, "photo"),
              () => people.readMedia(headers, "cover"),
              () => people.update(headers, { ...base, expectedVersion: before.version }),
              () =>
                people.saveMedia(headers, "photo", { expectedVersion: before.version, bytes: png }),
              () =>
                people.saveMedia(headers, "cover", { expectedVersion: before.version, bytes: png }),
              () => people.removeMedia(headers, "photo", { expectedVersion: before.version }),
              () => people.removeMedia(headers, "cover", { expectedVersion: before.version }),
            ])
              await denied(action, status, code);
          }
          const matching = new Headers(other.headers);
          matching.set("X-AhiBizz-Account-ID", other.user.id);
          assert.deepEqual(await people.read(matching), before);
          assert.deepEqual(await snapshot(), saved);
          const { createPeopleHttpHandler } = await import("../../src/server/people-http.ts");
          const http = createPeopleHttpHandler({ service: people, baseURL });
          const wrongImage = await http(
            new Request(`${baseURL}/api/people/me/media/photo?v=1&accountId=${member.user.id}`, {
              headers: other.headers,
            }),
          );
          assert.equal(wrongImage.status, 401);
          assert.equal((await wrongImage.json()).code, "ACCOUNT_IDENTITY_CHANGED");
        },
      );
      await t.test(
        "profile reads recheck signed-session expiry after the held current-user lock",
        async () => {
          const session = await auth.api.getSession({ headers: other.headers });
          const original = (
            await pool.query('SELECT "expiresAt" FROM auth_session WHERE id=$1', [
              session.session.id,
            ])
          ).rows[0].expiresAt;
          const blocker = await pool.connect();
          let read;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [other.user.id]);
            const headers = new Headers(other.headers);
            headers.set("X-AhiBizz-Account-ID", other.user.id);
            read = people.read(headers);
            // Keep rejection handled while the lock is intentionally held.
            read.catch(() => {});
            await waiting(administration, applicationName, 1);
            await blocker.query(
              "UPDATE auth_session SET \"expiresAt\"=clock_timestamp()-interval '1 second' WHERE id=$1",
              [session.session.id],
            );
            await blocker.query("COMMIT");
            await denied(() => read, 401, "AUTHENTICATION_REQUIRED");
          } finally {
            await blocker.query("ROLLBACK");
            blocker.release();
            await pool.query('UPDATE auth_session SET "expiresAt"=$1 WHERE id=$2', [
              original,
              session.session.id,
            ]);
          }
        },
      );
      await t.test(
        "real image normalization stores own raster bytes with the shared profile CAS",
        async () => {
          const before = await people.read(member.headers);
          await denied(
            () =>
              people.saveMedia(member.headers, "photo", {
                expectedVersion: before.version,
                bytes: Buffer.from("<svg>not raster</svg>"),
              }),
            400,
            "MEDIA_INVALID",
          );
          assert.equal((await people.read(member.headers)).version, before.version);
          const saved = await people.saveMedia(member.headers, "photo", {
            expectedVersion: before.version,
            bytes: png,
          });
          assert.equal(saved.version, before.version + 1);
          assert.equal(saved.photoVersion, saved.version);
          const image = await people.readMedia(member.headers, "photo");
          assert.equal(image.mime, "image/webp");
          assert.equal(image.version, saved.version);
          assert.equal(image.bytes.toString("ascii", 0, 4), "RIFF");
          const metadata = await sharp(image.bytes).metadata();
          assert.equal(metadata.width, 512);
          assert.equal(metadata.height, 512);
          assert.equal(metadata.exif, undefined);
          assert.equal(await people.readMedia(other.headers, "photo"), null);
          await denied(() => write(before.version), 409, "VERSION_CONFLICT");
          await denied(
            () =>
              people.saveMedia(member.headers, "photo", {
                expectedVersion: before.version,
                bytes: png,
              }),
            409,
            "VERSION_CONFLICT",
          );
          assert.equal((await people.read(member.headers)).photoVersion, saved.photoVersion);
        },
      );
      await t.test(
        "every signed account can save a cover without a grant, and removal requires the same signed owner",
        async () => {
          let profile = await people.read(member.headers);
          assert.equal(profile.canCustomizeCover, true);
          profile = await people.saveMedia(member.headers, "cover", {
            expectedVersion: profile.version,
            bytes: png,
          });
          assert.equal(profile.coverVersion, profile.version);
          assert.equal((await people.readMedia(member.headers, "cover")).width, 1600);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM personal_profile_entitlement"))
              .rows[0].n,
            0,
          );
          const removed = await people.removeMedia(member.headers, "cover", {
            expectedVersion: profile.version,
          });
          assert.equal(removed.version, profile.version + 1);
          assert.equal(removed.coverVersion, null);
          assert.ok(removed.photoVersion);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM personal_profile_image WHERE user_id=$1 AND kind='cover'",
                [member.user.id],
              )
            ).rows[0].n,
            0,
          );
          const ownerCover = await people.saveMedia(owner.headers, "cover", {
            expectedVersion: 0,
            bytes: png,
          });
          assert.equal(ownerCover.canCustomizeCover, true);
          assert.equal(ownerCover.coverVersion, ownerCover.version);
          const cleared = await people.removeMedia(member.headers, "photo", {
            expectedVersion: removed.version,
          });
          assert.equal(cleared.photoVersion, null);
        },
      );
      await t.test(
        "actual HTTP boundaries preserve private profile and binary media ownership with global If-Match",
        async () => {
          const { createPeopleHttpHandler } = await import("../../src/server/people-http.ts");
          const http = createPeopleHttpHandler({ service: people, baseURL });
          const route = (suffix) => `${baseURL}/api/people/me${suffix}`;
          const anonymous = await http(new Request(route("")));
          assert.equal(anonymous.status, 401);
          const current = await people.read(member.headers);
          const crossOrigin = new Headers(member.headers);
          crossOrigin.set("origin", "https://untrusted.invalid");
          crossOrigin.set("content-type", "application/json");
          assert.equal(
            (
              await http(
                new Request(route(""), {
                  method: "PATCH",
                  headers: crossOrigin,
                  body: JSON.stringify({ ...base, expectedVersion: current.version }),
                }),
              )
            ).status,
            403,
          );
          const read = await http(new Request(route(""), { headers: member.headers }));
          assert.equal(read.status, 200);
          assert.equal(read.headers.get("cache-control"), "no-store");
          const body = await read.json();
          assert.deepEqual(body, { profile: current });
          for (const key of ["email", "role", "approval", "token", "bytes"])
            assert.equal(Object.hasOwn(body.profile, key), false);
          const uploadHeaders = new Headers(member.headers);
          uploadHeaders.set("content-type", "image/png");
          uploadHeaders.set("if-match", `"${current.version}"`);
          const uploaded = await http(
            new Request(route("/media/photo"), {
              method: "PUT",
              headers: uploadHeaders,
              body: png,
            }),
          );
          assert.equal(uploaded.status, 200);
          const saved = (await uploaded.json()).profile;
          assert.equal(saved.version, current.version + 1);
          assert.equal(saved.photoVersion, saved.version);
          const binary = await http(
            new Request(route(`/media/photo?v=${saved.photoVersion}`), { headers: member.headers }),
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
            (await people.readMedia(member.headers, "photo")).bytes,
          );
          assert.equal(
            (await http(new Request(route("/media/photo"), { headers: other.headers }))).status,
            404,
          );
          assert.equal(
            (
              await http(
                new Request(route("/media/photo"), {
                  method: "PUT",
                  headers: uploadHeaders,
                  body: png,
                }),
              )
            ).status,
            409,
          );
          const removeHeaders = new Headers(member.headers);
          removeHeaders.set("if-match", `"${saved.version}"`);
          const removed = await http(
            new Request(route("/media/photo"), { method: "DELETE", headers: removeHeaders }),
          );
          assert.equal(removed.status, 200);
          assert.equal((await removed.json()).profile.photoVersion, null);
        },
      );
      await t.test(
        "fresh eligibility and revoked sessions prevent profile and media writes",
        async () => {
          const current = await people.read(member.headers);
          await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [
            member.user.id,
          ]);
          await denied(() => people.read(member.headers), 403, "EMAIL_NOT_VERIFIED");
          await denied(
            () =>
              people.saveMedia(member.headers, "photo", {
                expectedVersion: current.version,
                bytes: png,
              }),
            403,
            "EMAIL_NOT_VERIFIED",
          );
          await pool.query('UPDATE auth_user SET "emailVerified"=true WHERE id=$1', [
            member.user.id,
          ]);
          await accounts.decide(owner.headers, member.user.id, {
            approval: "suspended",
            expected: "approved",
          });
          await denied(() => people.read(member.headers), 401, "AUTHENTICATION_REQUIRED");
          await denied(() => write(current.version), 401, "AUTHENTICATION_REQUIRED");
          assert.equal((await people.read(other.headers)).version, 0);
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
            "Only this fixture's newly created owned namespace may be removed.",
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
