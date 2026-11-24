import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://business-media-ci.ahibizz.invalid";
const password = "BusinessMedia-only-fixture-password-824!";
const emails = [
  "owner@business-media-fixture.invalid",
  "member@business-media-fixture.invalid",
  "other@business-media-fixture.invalid",
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
  throw new Error("Both directory creates must reach the held actor lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated business images, shared CAS, moderation, authority and HTTP", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex");
    const schema = `ci_business_media_${suffix}`;
    assert.match(schema, /^ci_business_media_[a-f0-9]{20}$/);
    const applicationName = `business-media-ci-${suffix}`;
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
      ]) {
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      }
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is forbidden in directory acceptance.");
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
        secret: `business-media-fixture-${randomBytes(32).toString("hex")}`,
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
          "user-agent": "Isolated directory acceptance",
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
        actors.push({ headers, user: session.user });
      }
      assert.equal(captured.size, 3);
      assert.equal(
        (await pool.query("SELECT count(*)::integer AS n FROM auth_session")).rows[0].n,
        3,
      );
      const [owner, member, other] = actors;
      const { createDirectoryService } = await import("../../src/server/directory/index.ts");
      const accounts = createAccountService({ auth, pool });
      const directory = createDirectoryService({ accounts, auth, pool });
      const { createBusinessMediaService, BusinessMediaAccessError } = await import(
        "../../src/server/business-media/index.ts"
      );
      const media = createBusinessMediaService({ accounts, auth, pool });
      const sharp = (await import("sharp")).default;
      const image = await sharp({
        create: {
          width: 80,
          height: 120,
          channels: 4,
          background: { r: 18, g: 42, b: 61, alpha: 0.8 },
        },
      })
        .png()
        .toBuffer();
      const replacement = await sharp({
        create: { width: 120, height: 80, channels: 3, background: "#ba9440" },
      })
        .jpeg()
        .toBuffer();
      const deny = (action, status, code) =>
        assert.rejects(
          action,
          (error) =>
            (error instanceof BusinessMediaAccessError || error.name === "Error") &&
            error.status === status &&
            (!code || error.code === code),
        );
      const category = await directory.createCategory(owner.headers, {
        name: "Isolated media category",
        slug: "isolated-media-category",
      });
      let memberBusiness = await directory.create(
        member.headers,
        { title: "Isolated member media business", categoryId: category.id },
        randomUUID(),
      );
      let ownerBusiness = await directory.create(
        owner.headers,
        { title: "Isolated owner media business", categoryId: category.id },
        randomUUID(),
      );
      const logoKey = randomUUID();
      let logoReceipt;
      const readMember = () => directory.readOwn(member.headers, memberBusiness.id);
      const counts = async () =>
        (
          await pool.query(
            "SELECT (SELECT count(*)::integer FROM directory_business_media_command) AS commands,(SELECT count(*)::integer FROM directory_business_media_event) AS events",
          )
        ).rows[0];
      await t.test(
        "empty manifests do not write; only current owner or administrator can read private media",
        async () => {
          const before = await counts();
          assert.deepEqual(await media.readOwn(member.headers, memberBusiness.id), {
            businessId: memberBusiness.id,
            businessVersion: 1,
            status: "draft",
            logo: null,
            cover: null,
            gallery: [],
          });
          assert.deepEqual((await readMember()).media, { logo: null, cover: null, gallery: [] });
          await deny(
            () => media.readOwn(other.headers, memberBusiness.id),
            404,
            "BUSINESS_NOT_FOUND",
          );
          await deny(() => media.readOwn(new Headers(), memberBusiness.id), 401);
          await deny(() => media.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          assert.equal(await media.readPublicImage(memberBusiness.id, "logo", 0, 1), null);
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        "expected actor binds private manifests, pixels and mutations before administrator access",
        async () => {
          const before = await counts();
          const matched = new Headers(owner.headers);
          matched.set("X-AhiBizz-Account-ID", owner.user.id);
          const changed = new Headers(owner.headers);
          changed.set("X-AhiBizz-Account-ID", member.user.id);
          const invalid = new Headers(owner.headers);
          invalid.set("X-AhiBizz-Account-ID", "invalid actor");
          assert.deepEqual(
            await media.readOwn(matched, memberBusiness.id),
            await media.readOwn(owner.headers, memberBusiness.id),
          );
          await deny(
            () => media.readOwn(changed, memberBusiness.id),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await deny(
            () => media.readOwnImage(changed, memberBusiness.id, "logo", 0, 1),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await deny(
            () =>
              media.save(
                changed,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                randomUUID(),
              ),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await deny(
            () =>
              media.remove(
                changed,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: 1 },
                randomUUID(),
              ),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await deny(
            () => media.readOwn(invalid, memberBusiness.id),
            400,
            "INVALID_BUSINESS_MEDIA_INPUT",
          );
          assert.deepEqual(await counts(), before);
          assert.equal((await readMember()).version, 1);
        },
      );
      await t.test(
        "actual logo bytes normalize, increment the shared business version and stay private before publication",
        async () => {
          logoReceipt = await media.save(
            member.headers,
            memberBusiness.id,
            "logo",
            0,
            { expectedVersion: 1, bytes: image },
            logoKey,
          );
          assert.deepEqual(logoReceipt, {
            businessId: memberBusiness.id,
            businessVersion: 2,
            status: "draft",
            kind: "logo",
            slot: 0,
            mediaVersion: 2,
          });
          const current = await media.readOwn(member.headers, memberBusiness.id);
          assert.deepEqual(current.logo, {
            kind: "logo",
            slot: 0,
            version: 2,
            width: 512,
            height: 512,
          });
          assert.deepEqual((await readMember()).media.logo, current.logo);
          const saved = await media.readOwnImage(member.headers, memberBusiness.id, "logo", 0, 2),
            meta = await sharp(saved.bytes).metadata();
          assert.equal(saved.mime, "image/webp");
          assert.equal(meta.format, "webp");
          assert.equal(meta.width, 512);
          assert.equal(meta.height, 512);
          assert.equal(meta.exif, undefined);
          assert.ok(saved.bytes.length <= 1048576);
          assert.equal(
            await media.readOwnImage(member.headers, memberBusiness.id, "logo", 0, 1),
            null,
          );
          assert.equal(await media.readPublicImage(memberBusiness.id, "logo", 0, 2), null);
        },
      );
      await t.test(
        "same-actor image receipt replay succeeds while another expected actor cannot recover it",
        async () => {
          const before = await counts();
          const matched = new Headers(member.headers);
          matched.set("X-AhiBizz-Account-ID", member.user.id);
          const changed = new Headers(member.headers);
          changed.set("X-AhiBizz-Account-ID", other.user.id);
          await deny(
            () =>
              media.save(
                changed,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                logoKey,
              ),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          assert.deepEqual(
            await media.save(
              matched,
              memberBusiness.id,
              "logo",
              0,
              { expectedVersion: 1, bytes: image },
              logoKey,
            ),
            logoReceipt,
          );
          assert.deepEqual(await counts(), before);
          assert.equal((await readMember()).version, 2);
        },
      );
      await t.test(
        "original bytes and command key replay once across later field edits, without resurrecting historical state",
        async () => {
          const before = await counts();
          assert.deepEqual(
            await media.save(
              member.headers,
              memberBusiness.id,
              "logo",
              0,
              { expectedVersion: 1, bytes: image },
              logoKey,
            ),
            logoReceipt,
          );
          assert.deepEqual(await counts(), before);
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "Edited through existing directory API",
            expectedVersion: 2,
          });
          assert.equal(memberBusiness.version, 3);
          assert.deepEqual(
            await media.save(
              member.headers,
              memberBusiness.id,
              "logo",
              0,
              { expectedVersion: 1, bytes: image },
              logoKey,
            ),
            logoReceipt,
          );
          assert.equal((await media.readOwn(member.headers, memberBusiness.id)).businessVersion, 3);
          await deny(
            () =>
              media.save(
                member.headers,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: replacement },
                logoKey,
              ),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          await deny(
            () =>
              media.save(
                member.headers,
                memberBusiness.id,
                "cover",
                0,
                { expectedVersion: 1, bytes: image },
                logoKey,
              ),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          await deny(
            () =>
              media.save(
                member.headers,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                randomUUID(),
              ),
            409,
            "VERSION_CONFLICT",
          );
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        "published projection includes safe image metadata without bytes, global version or owner fields",
        async () => {
          memberBusiness = await directory.publish(member.headers, memberBusiness.id, {
            expectedVersion: 3,
          });
          assert.equal(memberBusiness.status, "pending");
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
            status: "published",
          });
          const publicMedia = await media.readPublic(memberBusiness.id);
          assert.deepEqual(Object.keys(publicMedia).sort(), [
            "businessId",
            "cover",
            "gallery",
            "logo",
          ]);
          assert.equal(publicMedia.logo.version, 2);
          assert.ok(await media.readPublicImage(memberBusiness.id, "logo", 0, 2));
          const publicBusiness = await directory.readPublic(memberBusiness.id);
          assert.deepEqual(publicBusiness.media, {
            logo: publicMedia.logo,
            cover: null,
            gallery: [],
          });
          const list = await directory.listPublic();
          assert.deepEqual(
            list.items.find((row) => row.id === memberBusiness.id).media,
            publicBusiness.media,
          );
          for (const field of ["bytes", "ownerId", "businessVersion", "status", "input_sha256"])
            assert.equal(Object.hasOwn(publicMedia, field), false);
        },
      );
      await t.test(
        "member photos stay private until reviewed while approved photos remain visible",
        async () => {
          const saved = await media.save(
            member.headers,
            memberBusiness.id,
            "gallery",
            1,
            { expectedVersion: memberBusiness.version, bytes: image },
            randomUUID(),
          );
          assert.equal(saved.status, "published");
          assert.ok(await media.readPublicImage(memberBusiness.id, "logo", 0, 2));
          assert.equal((await media.readPublic(memberBusiness.id)).gallery.length, 0);
          for (const reviewer of [member, owner]) {
            const privateImages = await media.readOwn(reviewer.headers, memberBusiness.id);
            assert.equal(privateImages.pendingMedia, true);
            assert.equal(privateImages.gallery[0].version, saved.mediaVersion);
            assert.deepEqual(privateImages.approvedMedia.gallery, []);
            assert.equal(privateImages.approvedMedia.logo.version, 2);
            assert.ok(
              await media.readOwnImage(
                reviewer.headers,
                memberBusiness.id,
                "gallery",
                1,
                saved.mediaVersion,
              ),
            );
          }
          assert.equal(
            await media.readPublicImage(memberBusiness.id, "gallery", 1, saved.mediaVersion),
            null,
          );
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            expectedVersion: saved.businessVersion,
            status: "approve-changes",
          });
          const approved = await media.readPublic(memberBusiness.id);
          assert.equal(approved.gallery[0].version, memberBusiness.version);
          assert.ok(
            await media.readPublicImage(memberBusiness.id, "gallery", 1, memberBusiness.version),
          );
          const removed = await media.remove(
            member.headers,
            memberBusiness.id,
            "gallery",
            1,
            { expectedVersion: memberBusiness.version },
            randomUUID(),
          );
          assert.equal((await media.readOwn(member.headers, memberBusiness.id)).gallery.length, 0);
          assert.deepEqual(
            (await media.readOwn(member.headers, memberBusiness.id)).approvedMedia.gallery,
            approved.gallery,
          );
          assert.equal((await media.readPublic(memberBusiness.id)).gallery.length, 1);
          assert.ok(
            await media.readOwnImage(
              member.headers,
              memberBusiness.id,
              "gallery",
              1,
              approved.gallery[0].version,
            ),
          );
          await deny(
            () =>
              media.readOwnImage(
                other.headers,
                memberBusiness.id,
                "gallery",
                1,
                approved.gallery[0].version,
              ),
            404,
          );
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            expectedVersion: removed.businessVersion,
            status: "reject-changes",
            reason: "Zadržati fotografiju",
          });
          assert.equal((await media.readOwn(member.headers, memberBusiness.id)).gallery.length, 1);
          const admin = await media.save(
            owner.headers,
            memberBusiness.id,
            "cover",
            0,
            { expectedVersion: memberBusiness.version, bytes: replacement },
            randomUUID(),
          );
          assert.equal(admin.status, "published");
          assert.ok(await media.readPublicImage(memberBusiness.id, "cover", 0, admin.mediaVersion));
          memberBusiness = await readMember();
          const draft = await media.save(
            owner.headers,
            ownerBusiness.id,
            "logo",
            0,
            { expectedVersion: 1, bytes: image },
            randomUUID(),
          );
          assert.equal(draft.status, "draft");
          ownerBusiness = await directory.readOwn(owner.headers, ownerBusiness.id);
        },
      );
      await t.test(
        "eight fixed gallery slots preserve aspect ratio and reject slot/kind overflow without mutation",
        async () => {
          for (let slot = 2; slot <= 8; slot++) {
            const saved = await media.save(
              owner.headers,
              memberBusiness.id,
              "gallery",
              slot,
              { expectedVersion: memberBusiness.version, bytes: image },
              randomUUID(),
            );
            memberBusiness = await readMember();
            assert.equal(memberBusiness.version, saved.businessVersion);
          }
          const manifest = await media.readOwn(member.headers, memberBusiness.id);
          assert.equal(manifest.gallery.length, 8);
          assert.deepEqual(
            manifest.gallery.map((row) => row.slot),
            [1, 2, 3, 4, 5, 6, 7, 8],
          );
          assert.ok(manifest.gallery.every((row) => row.width === 80 && row.height === 120));
          const before = await counts();
          for (const [kind, slot] of [
            ["gallery", 0],
            ["gallery", 9],
            ["logo", 1],
            ["cover", 1],
            ["unknown", 0],
          ])
            await deny(
              () =>
                media.save(
                  owner.headers,
                  memberBusiness.id,
                  kind,
                  slot,
                  { expectedVersion: memberBusiness.version, bytes: image },
                  randomUUID(),
                ),
              400,
              "INVALID_BUSINESS_MEDIA_INPUT",
            );
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        "deletion and replay release only the chosen slot, while stale public URLs immediately stop returning bytes",
        async () => {
          const key = randomUUID(),
            beforeVersion = memberBusiness.version;
          const result = await media.remove(
            owner.headers,
            memberBusiness.id,
            "logo",
            0,
            { expectedVersion: beforeVersion },
            key,
          );
          assert.equal(result.mediaVersion, null);
          assert.equal(result.businessVersion, beforeVersion + 1);
          assert.equal(await media.readPublicImage(memberBusiness.id, "logo", 0, 2), null);
          assert.equal((await media.readPublic(memberBusiness.id)).logo, null);
          const before = await counts();
          assert.deepEqual(
            await media.remove(
              owner.headers,
              memberBusiness.id,
              "logo",
              0,
              { expectedVersion: beforeVersion },
              key,
            ),
            result,
          );
          assert.deepEqual(await counts(), before);
          await deny(
            () =>
              media.remove(
                owner.headers,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: result.businessVersion },
                randomUUID(),
              ),
            404,
            "MEDIA_NOT_FOUND",
          );
          assert.deepEqual(
            await media.save(
              member.headers,
              memberBusiness.id,
              "logo",
              0,
              { expectedVersion: 1, bytes: image },
              logoKey,
            ),
            logoReceipt,
          );
          assert.equal((await media.readPublic(memberBusiness.id)).logo, null);
          memberBusiness = await readMember();
        },
      );
      await t.test(
        "existing field mutation and media mutation share one version under concurrent writes",
        async () => {
          const before = await directory.readOwn(owner.headers, ownerBusiness.id),
            gate = await pool.connect();
          let outcomes;
          try {
            await gate.query("BEGIN");
            await gate.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [owner.user.id]);
            const running = Promise.allSettled([
              directory.update(owner.headers, before.id, {
                title: "One race winner",
                expectedVersion: before.version,
              }),
              media.save(
                owner.headers,
                before.id,
                "gallery",
                1,
                { expectedVersion: before.version, bytes: image },
                randomUUID(),
              ),
            ]);
            await waitForTwoLockWaiters(pool, applicationName);
            await gate.query("COMMIT");
            outcomes = await running;
          } finally {
            await gate.query("ROLLBACK").catch(() => {});
            gate.release();
          }
          assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
          assert.equal(
            outcomes.filter(
              (row) =>
                row.status === "rejected" &&
                row.reason.status === 409 &&
                row.reason.code === "VERSION_CONFLICT",
            ).length,
            1,
          );
          ownerBusiness = await directory.readOwn(owner.headers, before.id);
          assert.equal(ownerBusiness.version, before.version + 1);
        },
      );
      await t.test(
        "concurrent identical upload keys commit one version and one append-only event",
        async () => {
          const before = await directory.readOwn(owner.headers, ownerBusiness.id),
            key = randomUUID(),
            eventsBefore = await counts();
          const results = await Promise.all(
            [0, 1].map(() =>
              media.save(
                owner.headers,
                before.id,
                "cover",
                0,
                { expectedVersion: before.version, bytes: image },
                key,
              ),
            ),
          );
          assert.deepEqual(results[0], results[1]);
          assert.equal(results[0].businessVersion, before.version + 1);
          const after = await counts();
          assert.equal(after.commands, eventsBefore.commands + 1);
          assert.equal(after.events, eventsBefore.events + 1);
          ownerBusiness = await directory.readOwn(owner.headers, before.id);
        },
      );
      await t.test(
        "eligibility changes revoke public pixels and preserve administrator private review",
        async () => {
          const cover = (await media.readPublic(memberBusiness.id)).cover;
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            member.user.id,
          ]);
          try {
            await deny(() => media.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
            assert.equal(
              await media.readPublicImage(memberBusiness.id, "cover", 0, cover.version),
              null,
            );
            await deny(() => media.readOwn(member.headers, memberBusiness.id), 403);
            assert.equal(
              (await media.readOwn(owner.headers, memberBusiness.id)).businessId,
              memberBusiness.id,
            );
          } finally {
            await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
              member.user.id,
            ]);
          }
        },
      );
      await t.test(
        "sessions expiring while both mutation paths wait on authority cannot write",
        async () => {
          const business = await directory.create(
            other.headers,
            { title: "Expiry-only fixture", categoryId: category.id },
            randomUUID(),
          );
          const sessions = (
            await pool.query('SELECT id,"expiresAt" FROM auth_session WHERE "userId"=$1', [
              other.user.id,
            ])
          ).rows;
          const before = await counts(),
            gate = await pool.connect();
          let outcomes;
          try {
            await gate.query("BEGIN");
            await gate.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [other.user.id]);
            const running = Promise.allSettled([
              directory.update(other.headers, business.id, {
                title: "Must not be written after expiry",
                expectedVersion: 1,
              }),
              media.save(
                other.headers,
                business.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                randomUUID(),
              ),
            ]);
            await waitForTwoLockWaiters(pool, applicationName);
            await gate.query(
              'UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval \'100 milliseconds\' WHERE "userId"=$1',
              [other.user.id],
            );
            await delay(175);
            await gate.query("COMMIT");
            outcomes = await running;
            assert.equal(
              outcomes.filter(
                (row) =>
                  row.status === "rejected" &&
                  row.reason.status === 401 &&
                  row.reason.code === "AUTHENTICATION_REQUIRED",
              ).length,
              2,
            );
            assert.equal((await directory.readOwn(owner.headers, business.id)).version, 1);
            assert.equal((await media.readOwn(owner.headers, business.id)).logo, null);
            assert.deepEqual(await counts(), before);
          } finally {
            await gate.query("ROLLBACK").catch(() => {});
            gate.release();
            for (const session of sessions)
              await pool.query('UPDATE auth_session SET "expiresAt"=$2 WHERE id=$1', [
                session.id,
                session.expiresAt,
              ]);
          }
          // Release this member's one active listing before the separate revocation fixture.
          await directory.archive(owner.headers, business.id, { expectedVersion: 1 });
        },
      );
      await t.test(
        "media and directory reject a session that expires while its unchanged row is locked",
        async () => {
          const business = await directory.create(
            owner.headers,
            { title: "Session-lock expiry fixture", categoryId: category.id },
            randomUUID(),
          );
          const signed = await auth.api.getSession({
            headers: owner.headers,
            query: { disableCookieCache: true, disableRefresh: true },
          });
          const originalExpiry = signed.session.expiresAt;
          // Freeze only the approved account projection. Real signed-session preflight still
          // runs without refresh writes, so session maintenance cannot mask this row-lock race.
          const approved = await accounts.read(owner.headers);
          const snapshotAccounts = { ...accounts, read: async () => approved };
          const guardedDirectory = createDirectoryService({
            accounts: snapshotAccounts,
            auth,
            pool,
          });
          const guardedMedia = createBusinessMediaService({
            accounts: snapshotAccounts,
            auth,
            pool,
          });
          for (const run of [
            () =>
              guardedDirectory.update(owner.headers, business.id, {
                title: "Must never replace the fixture title",
                expectedVersion: 1,
              }),
            () =>
              guardedMedia.save(
                owner.headers,
                business.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                randomUUID(),
              ),
          ]) {
            const before = await counts(),
              gate = await pool.connect();
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
              const pending = run().then(
                (value) => ({ status: "fulfilled", value }),
                (reason) => ({ status: "rejected", reason }),
              );
              await waitForTwoLockWaiters(pool, applicationName, 1);
              const waiting = (
                await pool.query(
                  "SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
                  [applicationName],
                )
              ).rows;
              assert.equal(waiting.length, 1);
              assert.ok(new Date(expiry) > new Date(waiting[0].xact_start));
              // No row is changed while blocked: only wall-clock expiry can invalidate it.
              await pool.query(
                "SELECT pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.03)",
                [expiry],
              );
              await gate.query("COMMIT");
              const result = await pending;
              assert.equal(result.status, "rejected");
              assert.equal(result.reason.status, 401);
              assert.equal(result.reason.code, "AUTHENTICATION_REQUIRED");
              assert.deepEqual(await counts(), before);
            } finally {
              await gate.query("ROLLBACK").catch(() => {});
              gate.release();
              await pool.query('UPDATE auth_session SET "expiresAt"=$2 WHERE id=$1', [
                signed.session.id,
                originalExpiry,
              ]);
            }
          }
          assert.equal((await directory.readOwn(owner.headers, business.id)).version, 1);
          assert.equal((await media.readOwn(owner.headers, business.id)).logo, null);
        },
      );
      await t.test(
        "revoked sessions cannot write through either media or the older directory mutation after waiting on authority",
        async () => {
          const business = await directory.create(
            other.headers,
            { title: "Revocation-only fixture", categoryId: category.id },
            randomUUID(),
          );
          const before = await counts(),
            gate = await pool.connect();
          let outcomes;
          try {
            await gate.query("BEGIN");
            await gate.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [other.user.id]);
            const running = Promise.allSettled([
              directory.update(other.headers, business.id, {
                title: "Must not be written",
                expectedVersion: 1,
              }),
              media.save(
                other.headers,
                business.id,
                "logo",
                0,
                { expectedVersion: 1, bytes: image },
                randomUUID(),
              ),
            ]);
            await waitForTwoLockWaiters(pool, applicationName);
            await gate.query('DELETE FROM auth_session WHERE "userId"=$1', [other.user.id]);
            await gate.query("COMMIT");
            outcomes = await running;
          } finally {
            await gate.query("ROLLBACK").catch(() => {});
            gate.release();
          }
          assert.equal(
            outcomes.filter(
              (row) =>
                row.status === "rejected" &&
                row.reason.status === 401 &&
                row.reason.code === "AUTHENTICATION_REQUIRED",
            ).length,
            2,
          );
          assert.equal((await directory.readOwn(owner.headers, business.id)).version, 1);
          assert.equal((await media.readOwn(owner.headers, business.id)).logo, null);
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        "archived businesses are immutable and hidden; recovering preserves private normalized images",
        async () => {
          memberBusiness = await directory.archive(owner.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal((await media.readOwn(owner.headers, memberBusiness.id)).status, "archived");
          await deny(
            () =>
              media.save(
                owner.headers,
                memberBusiness.id,
                "logo",
                0,
                { expectedVersion: memberBusiness.version, bytes: image },
                randomUUID(),
              ),
            409,
            "BUSINESS_ARCHIVED",
          );
          await deny(
            () =>
              media.remove(
                owner.headers,
                memberBusiness.id,
                "cover",
                0,
                { expectedVersion: memberBusiness.version },
                randomUUID(),
              ),
            409,
            "BUSINESS_ARCHIVED",
          );
          await deny(() => media.readPublic(memberBusiness.id), 404);
          memberBusiness = await directory.recover(owner.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "draft");
          assert.equal((await media.readOwn(owner.headers, memberBusiness.id)).gallery.length, 8);
        },
      );
      await t.test(
        "database slot, version and append-only history constraints reject bypass attempts",
        async () => {
          const current = await directory.readOwn(owner.headers, ownerBusiness.id);
          await assert.rejects(
            pool.query(
              "INSERT INTO directory_business_image(business_id,kind,slot,bytes,mime,width,height,version) VALUES($1,'gallery',9,$2,'image/webp',80,120,$3)",
              [current.id, image, current.version],
            ),
            { code: "23514" },
          );
          await assert.rejects(
            pool.query(
              "UPDATE directory_business_image SET version=version+1 WHERE business_id=$1 AND kind='cover'",
              [current.id],
            ),
            { code: "23514" },
          );
          await assert.rejects(
            pool.query(
              "UPDATE directory_business_media_command SET result_business_version=result_business_version+1",
            ),
            { code: "23514" },
          );
          await assert.rejects(pool.query("DELETE FROM directory_business_media_event"), {
            code: "23514",
          });
        },
      );
      await t.test(
        "actual HTTP upload, anonymous versioned pixels and archive revocation share the real PostgreSQL service",
        async () => {
          const { createBusinessMediaHttpHandler } = await import(
            "../../src/server/business-media-http.ts"
          );
          const http = createBusinessMediaHttpHandler({ service: media, baseURL });
          let business = await directory.create(
            owner.headers,
            { title: "HTTP media fixture", categoryId: category.id },
            randomUUID(),
          );
          business = await directory.publish(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          const headers = new Headers(owner.headers);
          headers.set("content-type", "image/png");
          headers.set("if-match", `"${business.version}"`);
          headers.set("idempotency-key", randomUUID());
          const uploaded = await http(
            new Request(`${baseURL}/api/business-media/mine/${business.id}/logo/0`, {
              method: "PUT",
              headers,
              body: image,
            }),
          );
          assert.equal(uploaded.status, 200);
          const response = await uploaded.json();
          assert.equal(response.receipt.businessVersion, business.version + 1);
          const manifest = await http(
            new Request(`${baseURL}/api/business-media/public/${business.id}`),
          );
          assert.equal(manifest.status, 200);
          const dto = await manifest.json();
          assert.equal(Object.hasOwn(dto.manifest, "businessVersion"), false);
          assert.equal(dto.manifest.logo.version, response.receipt.mediaVersion);
          const url = `${baseURL}/api/business-media/public/${business.id}/logo/0?v=${response.receipt.mediaVersion}`;
          const visible = await http(new Request(url));
          assert.equal(visible.status, 200);
          assert.equal(visible.headers.get("cache-control"), "no-store");
          assert.equal(visible.headers.get("x-content-type-options"), "nosniff");
          assert.equal(
            (await sharp(Buffer.from(await visible.arrayBuffer())).metadata()).width,
            512,
          );
          await directory.archive(owner.headers, business.id, {
            expectedVersion: response.receipt.businessVersion,
          });
          assert.equal((await http(new Request(url))).status, 404);
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
                "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1",
                [schema],
              )
            ).rows[0]?.owner,
            "ahibizz_ci",
          );
          await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
          assert.equal(
            (
              await administration.query(
                "SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname = $1",
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
