import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://directory-ci.ahibizz.invalid";
const password = "Directory-only-fixture-password-713!";
const emails = [
  "owner@directory-fixture.invalid",
  "member@directory-fixture.invalid",
  "other@directory-fixture.invalid",
];

async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname, tablename",
      [schema],
    )
  ).rows;
}

async function waitForTwoLockWaiters(pool, applicationName, minimum = 2) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= minimum) return;
    await delay(20);
  }
  throw new Error("Directory requests must reach the held authority lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated directory ownership, quota and publication lifecycle", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex");
    const schema = `ci_directory_${suffix}`;
    assert.match(schema, /^ci_directory_[a-f0-9]{20}$/);
    const applicationName = `directory-ci-${suffix}`;
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
        secret: `directory-fixture-${randomBytes(32).toString("hex")}`,
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
      const { createDirectoryService, createPublicDirectoryService, DirectoryAccessError } =
        await import("../../src/server/directory/index.ts");
      const accounts = createAccountService({ auth, pool });
      const directory = createDirectoryService({
        accounts,
        auth,
        pool,
      });
      const { createDirectoryHttpHandler } = await import("../../src/server/directory-http.ts");
      const directoryHttp = createDirectoryHttpHandler({ service: directory, baseURL });
      async function directoryRequest(
        method,
        route,
        { actor, body, key, origin = baseURL, expectedAccountId, handler = directoryHttp } = {},
      ) {
        const headers = new Headers(actor?.headers);
        headers.set("origin", origin);
        if (body !== undefined) headers.set("content-type", "application/json");
        if (key) headers.set("idempotency-key", key);
        if (expectedAccountId !== undefined) headers.set("X-AhiBizz-Account-ID", expectedAccountId);
        const response = await handler(
          new Request(new URL(route, baseURL), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        return { status: response.status, data: await response.json() };
      }
      const denied = (operation, status, code) =>
        assert.rejects(
          operation,
          (error) =>
            error instanceof DirectoryAccessError &&
            error.status === status &&
            (!code || error.code === code),
        );
      let root;
      let child;
      let otherRoot;
      let memberBusiness;
      let winningRequest;
      let winningInput;
      const ownerBusinesses = [];
      const valid = () => ({
        title: "Fixture business",
        categoryId: root.id,
        subcategoryId: child.id,
        description: "This is an isolated directory acceptance profile, never a real business.",
        contactEmail: "business@directory-fixture.invalid",
        contactPhone: "+387 61 123 456",
        websiteUrl: "https://directory-fixture.invalid",
        addressLine: "Fixture Street 12",
        city: "Tuzla",
        countryCode: "BA",
        latitude: 44.5384,
        longitude: 18.6671,
      });
      const directorySnapshot = async () => {
        const snapshot = {};
        for (const table of [
          "directory_category",
          "directory_business",
          "directory_create_commands",
          "directory_moderation_audit",
        ])
          snapshot[table] = (
            await pool.query(
              `SELECT to_jsonb(item) AS value FROM ${table} item ORDER BY to_jsonb(item)::text`,
            )
          ).rows;
        return snapshot;
      };

      await t.test("only owner creates a consistent two-level taxonomy", async () => {
        await denied(
          () => directory.createCategory(member.headers, { name: "Forbidden", slug: "forbidden" }),
          403,
          "OWNER_REQUIRED",
        );
        root = await directory.createCategory(owner.headers, {
          name: "Services",
          slug: "services",
          vehicleRental: true,
        });
        child = await directory.createCategory(owner.headers, {
          name: "Repair",
          slug: "repair",
          parentId: root.id,
        });
        otherRoot = await directory.createCategory(owner.headers, { name: "Food", slug: "food" });
        await denied(
          () =>
            directory.createCategory(owner.headers, {
              name: "Too deep",
              slug: "too-deep",
              parentId: child.id,
            }),
          409,
          "CATEGORY_CONFLICT",
        );
        const categories = (await directory.categories()).categories;
        assert.equal(categories.length, 4);
        assert.ok(categories.some((row) => row.slug === "smjestaj" && row.accommodation));
        assert.equal(root.vehicleRental, true);
        assert.equal(child.vehicleRental, true);
        assert.equal(categories.find((row) => row.id === child.id).vehicleRental, true);
        assert.equal(otherRoot.vehicleRental, false);
        assert.equal(categories.find((row) => row.id === child.id).parentId, root.id);
        assert.equal(categories.find((row) => row.id === root.id).parentId, null);
      });

      await t.test(
        "unknown authority, verification, promotion and inconsistent category fields never create rows",
        async () => {
          for (const field of ["ownerId", "status", "verified", "featured"]) {
            await denied(
              () =>
                directory.create(
                  owner.headers,
                  { ...valid(), [field]: field === "status" ? "published" : true },
                  randomUUID(),
                ),
              400,
              "UNEXPECTED_FIELD",
            );
          }
          await assert.rejects(
            () =>
              directory.create(
                member.headers,
                { ...valid(), categoryId: otherRoot.id },
                randomUUID(),
              ),
            (error) => error instanceof DirectoryAccessError && [400, 409].includes(error.status),
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business")).rows[0].n,
            0,
          );
        },
      );

      await t.test(
        "two actually blocked concurrent member creates serialize to one business",
        async () => {
          const blocker = await pool.connect();
          const requests = [randomUUID(), randomUUID()];
          const inputs = requests.map((_, index) => ({
            ...valid(),
            title: `Member fixture ${index}`,
          }));
          let results;
          let attempts;
          try {
            await blocker.query("BEGIN");
            await blocker.query("SELECT id FROM auth_user WHERE id = $1 FOR UPDATE", [
              member.user.id,
            ]);
            attempts = Promise.allSettled(
              requests.map((key, index) => directory.create(member.headers, inputs[index], key)),
            );
            await waitForTwoLockWaiters(administration, applicationName);
          } finally {
            try {
              await blocker.query("ROLLBACK");
            } finally {
              blocker.release();
            }
            if (attempts) results = await attempts;
          }
          assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
          assert.equal(results.filter((row) => row.status === "rejected").length, 1);
          const rejected = results.find((row) => row.status === "rejected").reason;
          assert.ok(
            rejected instanceof DirectoryAccessError &&
              rejected.status === 409 &&
              rejected.code === "BUSINESS_LIMIT_REACHED",
          );
          const index = results.findIndex((row) => row.status === "fulfilled");
          memberBusiness = results[index].value;
          winningRequest = requests[index];
          winningInput = inputs[index];
          assert.equal(memberBusiness.status, "draft");
          assert.equal((await directory.listOwn(member.headers)).items.length, 1);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_business WHERE owner_user_id = $1 AND status <> 'archived'",
                [member.user.id],
              )
            ).rows[0].n,
            1,
          );
        },
      );

      await t.test(
        "create replay is actor-scoped and payload conflicts cannot bypass the member limit",
        async () => {
          assert.equal(
            (await directory.create(member.headers, winningInput, winningRequest)).id,
            memberBusiness.id,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_create_commands WHERE actor_user_id = $1 AND request_id = $2",
                [member.user.id, winningRequest],
              )
            ).rows[0].n,
            1,
          );
          await denied(
            () =>
              directory.create(
                member.headers,
                { ...winningInput, title: "Changed replay" },
                winningRequest,
              ),
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          const separate = await directory.create(
            other.headers,
            { ...valid(), title: "Other member fixture" },
            winningRequest,
          );
          assert.notEqual(separate.id, memberBusiness.id);
          await denied(
            () => directory.readOwn(other.headers, memberBusiness.id),
            404,
            "BUSINESS_NOT_FOUND",
          );
          await denied(
            () =>
              directory.update(other.headers, memberBusiness.id, {
                title: "Unauthorized edit",
                expectedVersion: memberBusiness.version,
              }),
            404,
            "BUSINESS_NOT_FOUND",
          );
          assert.equal(
            (await directory.readOwn(member.headers, memberBusiness.id)).title,
            memberBusiness.title,
          );
        },
      );

      await t.test(
        "owner has no member quota and concurrent same-key creates remain one object",
        async () => {
          for (let index = 0; index < 3; index++)
            ownerBusinesses.push(
              await directory.create(
                owner.headers,
                { ...valid(), title: `Owner fixture ${index}` },
                randomUUID(),
              ),
            );
          const key = randomUUID();
          const input = { ...valid(), title: "Owner replay fixture" };
          const repeated = await Promise.all([
            directory.create(owner.headers, input, key),
            directory.create(owner.headers, input, key),
          ]);
          assert.equal(repeated[0].id, repeated[1].id);
          assert.equal((await directory.listOwn(owner.headers)).items.length, 4);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_business WHERE owner_user_id = $1",
                [owner.user.id],
              )
            ).rows[0].n,
            4,
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business")).rows[0].n,
            6,
          );
        },
      );

      await t.test(
        "private directory reads, writes and create receipts reject a changed expected account",
        async () => {
          const before = await directorySnapshot();
          const version = { expectedVersion: memberBusiness.version };
          const commands = [
            ["GET", "/api/directory/mine", { actor: member }],
            ["GET", `/api/directory/mine/${memberBusiness.id}`, { actor: member }],
            ["GET", "/api/directory/admin", { actor: owner }],
            ["GET", "/api/directory/review", { actor: owner }],
            [
              "POST",
              "/api/directory/categories",
              { actor: owner, body: { name: "Forbidden identity", slug: "forbidden-identity" } },
            ],
            [
              "POST",
              "/api/directory/mine",
              { actor: member, body: winningInput, key: winningRequest },
            ],
            [
              "PATCH",
              `/api/directory/mine/${memberBusiness.id}`,
              { actor: member, body: { ...version, title: "Forbidden change" } },
            ],
            ...["publish", "archive", "recover"].map((action) => [
              "POST",
              `/api/directory/mine/${memberBusiness.id}/${action}`,
              { actor: member, body: version },
            ]),
            [
              "PATCH",
              `/api/directory/review/${memberBusiness.id}`,
              { actor: owner, body: { ...version, status: "published" } },
            ],
          ];
          for (const [method, route, options] of commands) {
            const response = await directoryRequest(method, route, {
              ...options,
              expectedAccountId: options.actor === owner ? member.user.id : owner.user.id,
            });
            assert.equal(response.status, 401, `${method} ${route}`);
            assert.equal(response.data.code, "ACCOUNT_IDENTITY_CHANGED");
          }
          assert.deepEqual(await directorySnapshot(), before);
          const own = await directoryRequest("GET", "/api/directory/mine", {
            actor: member,
            expectedAccountId: member.user.id,
          });
          assert.equal(own.status, 200);
          assert.equal(
            own.data.items.some((row) => row.id === memberBusiness.id),
            true,
          );
          for (const expectedAccountId of ["", "invalid/actor", "a".repeat(129)]) {
            const malformed = await directoryRequest("GET", "/api/directory/admin", {
              actor: owner,
              expectedAccountId,
            });
            assert.equal(malformed.status, 400);
            assert.equal(malformed.data.code, "INVALID_DIRECTORY_INPUT");
          }
          assert.equal((await directoryRequest("GET", "/api/directory/categories")).status, 200);
        },
      );

      await t.test(
        "member first publication needs approval; subsequent edits stay private until reviewed",
        async () => {
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          memberBusiness = await directory.publish(member.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "pending");
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          assert.ok(
            (await directory.pending(owner.headers)).items.some(
              (row) => row.id === memberBusiness.id,
            ),
          );
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            status: "published",
            expectedVersion: memberBusiness.version,
          });
          const publicProfile = await directory.readPublic(memberBusiness.id);
          assert.equal(publicProfile.id, memberBusiness.id);
          for (const field of ["ownerId", "status", "version", "archivedAt", "updatedAt"])
            assert.equal(Object.hasOwn(publicProfile, field), false);
          const version = memberBusiness.version;
          assert.equal(
            (
              await directory.update(member.headers, memberBusiness.id, {
                title: memberBusiness.title,
                expectedVersion: version,
              })
            ).version,
            version,
          );
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "Revised member profile",
            expectedVersion: version,
          });
          assert.equal(memberBusiness.status, "published");
          assert.equal(memberBusiness.editorialRevision.fields.title, "Revised member profile");
          const reviewQuery = "/api/directory/review?q=Revised%20member&pageSize=20";
          const reviewFound = await directoryRequest("GET", reviewQuery, { actor: owner });
          assert.equal(reviewFound.status, 200);
          assert.deepEqual(
            reviewFound.data.items.map((row) => row.id),
            [memberBusiness.id],
          );
          assert.equal(
            (await directoryRequest("GET", `${reviewQuery}&page=2`, { actor: owner })).data.items
              .length,
            0,
          );
          assert.equal(
            (
              await directoryRequest("GET", "/api/directory/review?q=does-not-exist", {
                actor: owner,
              })
            ).data.items.length,
            0,
          );
          assert.equal((await directoryRequest("GET", reviewQuery, { actor: member })).status, 403);
          assert.equal((await directoryRequest("GET", reviewQuery)).status, 401);
          assert.equal(
            (await directory.listOwn(other.headers, { q: "Revised member" })).items.length,
            0,
          );
          assert.equal(
            (await directory.listAdmin(owner.headers, { q: "Revised member" })).items[0].id,
            memberBusiness.id,
          );
          assert.equal((await directory.readPublic(memberBusiness.id)).title, publicProfile.title);
          assert.equal(
            (await directory.listPublic({ q: "Revised member profile" })).items.length,
            0,
          );
          assert.equal(
            (await directory.pending(owner.headers)).items.some(
              (row) => row.id === memberBusiness.id,
            ),
            true,
          );
          assert.equal(
            (
              await directory.update(member.headers, memberBusiness.id, {
                title: "Revised member profile",
                expectedVersion: memberBusiness.version,
              })
            ).version,
            memberBusiness.version,
          );
          await denied(
            () =>
              directory.update(member.headers, memberBusiness.id, {
                title: "Stale write",
                expectedVersion: version,
              }),
            409,
            "VERSION_CONFLICT",
          );
          await denied(
            () =>
              directory.moderate(member.headers, memberBusiness.id, {
                status: "approve-changes",
                expectedVersion: memberBusiness.version,
              }),
            403,
            "OWNER_REQUIRED",
          );
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            status: "approve-changes",
            expectedVersion: memberBusiness.version,
          });
          assert.ok(
            (
              await directory.listPublic({ categoryId: root.id, subcategoryId: child.id })
            ).items.some((row) => row.id === memberBusiness.id),
          );
          assert.equal(
            (await directory.readPublic(memberBusiness.id)).title,
            "Revised member profile",
          );
          assert.equal(memberBusiness.editorialRevision, null);
          const audit = (
            await pool.query(
              "SELECT previous_status, next_status, previous_version, next_version FROM directory_moderation_audit WHERE actor_user_id = $1 AND business_id = $2 AND action IN ('moderate','approve-changes') ORDER BY next_version",
              [owner.user.id, memberBusiness.id],
            )
          ).rows;
          assert.equal(audit.length, 2);
          assert.deepEqual(
            audit.map((row) => row.previous_status),
            ["pending", "published"],
          );
          for (const row of audit) {
            assert.equal(row.next_status, "published");
            assert.equal(Number(row.next_version), Number(row.previous_version) + 1);
          }
          await denied(
            () =>
              directory.update(owner.headers, memberBusiness.id, {
                verified: true,
                expectedVersion: memberBusiness.version,
              }),
            400,
            "UNEXPECTED_FIELD",
          );
          memberBusiness = await directory.update(owner.headers, memberBusiness.id, {
            title: "Owner corrected member profile",
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "published");
          assert.equal(
            (await directory.readPublic(memberBusiness.id)).title,
            "Owner corrected member profile",
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_moderation_audit WHERE actor_user_id = $1 AND business_id = $2 AND action = 'owner-update' AND previous_status = 'published' AND next_status = 'published'",
                [owner.user.id, memberBusiness.id],
              )
            ).rows[0].n,
            1,
          );
          const replay = await directory.create(member.headers, winningInput, winningRequest);
          assert.equal(replay.id, memberBusiness.id);
          assert.equal(replay.version, memberBusiness.version);
          assert.equal(replay.title, memberBusiness.title);
          await pool.query("UPDATE auth_user SET approval = 'suspended' WHERE id = $1", [
            member.user.id,
          ]);
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          await denied(
            () =>
              directory.publish(owner.headers, memberBusiness.id, {
                expectedVersion: memberBusiness.version,
              }),
            403,
            "ACCOUNT_SUSPENDED",
          );
          await pool.query("UPDATE auth_user SET approval = 'approved' WHERE id = $1", [
            member.user.id,
          ]);
        },
      );

      await t.test(
        "return-to-draft reasons are current, owner-private and atomically versioned",
        async () => {
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "Member profile awaiting review",
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "published");
          const publicTitle = memberBusiness.title;
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            status: "reject-changes",
            reason: "Dopuni naziv.",
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.revisionRejection, "Dopuni naziv.");
          assert.equal(memberBusiness.editorialRevision, null);
          assert.equal((await directory.readPublic(memberBusiness.id)).title, publicTitle);
          assert.equal(
            "revisionRejection" in (await directory.readPublic(memberBusiness.id)),
            false,
          );
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "Member profile awaiting review",
            expectedVersion: memberBusiness.version,
          });
          const auditCount = async () =>
            (await pool.query("SELECT count(*)::integer AS n FROM directory_moderation_audit"))
              .rows[0].n;
          const beforeEvents = await auditCount();
          const before = memberBusiness;
          for (const reason of [undefined, null, "", "x", "   ", "x".repeat(501)]) {
            const result = await directoryRequest("PATCH", `/api/directory/review/${before.id}`, {
              actor: owner,
              expectedAccountId: owner.user.id,
              body: { status: "draft", expectedVersion: before.version, reason },
            });
            assert.equal(result.status, 400);
            assert.equal(result.data.code, "INVALID_DIRECTORY_INPUT");
          }
          const foreign = await directoryRequest("PATCH", `/api/directory/review/${before.id}`, {
            actor: other,
            expectedAccountId: other.user.id,
            body: { status: "draft", expectedVersion: before.version, reason: "Forbidden" },
          });
          assert.equal(foreign.status, 404);
          const notAdmin = await directoryRequest("PATCH", `/api/directory/review/${before.id}`, {
            actor: member,
            expectedAccountId: member.user.id,
            body: { status: "draft", expectedVersion: before.version, reason: "Forbidden" },
          });
          assert.equal(notAdmin.status, 403);
          assert.equal(notAdmin.data.code, "OWNER_REQUIRED");
          assert.equal(await auditCount(), beforeEvents);
          assert.equal(
            (await directory.readOwn(member.headers, before.id)).version,
            before.version,
          );

          const reason = "Unesi tačno radno vrijeme i kontakt.";
          const returned = await directoryRequest("PATCH", `/api/directory/review/${before.id}`, {
            actor: owner,
            expectedAccountId: owner.user.id,
            body: { status: "draft", expectedVersion: before.version, reason: ` ${reason} ` },
          });
          assert.equal(returned.status, 200);
          memberBusiness = returned.data.business;
          assert.equal(memberBusiness.editorialRevision, null);
          const note = memberBusiness.moderationReturn;
          assert.equal(memberBusiness.status, "draft");
          assert.equal(memberBusiness.version, before.version + 1);
          assert.equal(note.reason, reason);
          assert.equal(note.version, memberBusiness.version);
          assert.equal(new Date(note.createdAt).toISOString(), note.createdAt);
          assert.equal(await auditCount(), beforeEvents + 1);
          for (const [actor, route] of [
            [member, `/api/directory/mine/${before.id}`],
            [owner, `/api/directory/mine/${before.id}`],
            [member, "/api/directory/mine"],
            [owner, "/api/directory/admin"],
          ]) {
            const result = await directoryRequest("GET", route, {
              actor,
              expectedAccountId: actor.user.id,
            });
            assert.equal(result.status, 200);
            const business =
              result.data.business ?? result.data.items.find((row) => row.id === before.id);
            assert.deepEqual(business.moderationReturn, note);
          }
          const hidden = await directoryRequest("GET", `/api/directory/mine/${before.id}`, {
            actor: other,
            expectedAccountId: other.user.id,
          });
          assert.equal(hidden.status, 404);
          assert.equal(JSON.stringify(hidden.data).includes(reason), false);
          assert.equal(
            (await directory.listOwn(other.headers)).items.some((row) => row.id === before.id),
            false,
          );
          await denied(() => directory.readPublic(before.id), 404, "BUSINESS_NOT_FOUND");
          assert.deepEqual((await directory.listPublic({ q: reason })).items, []);
          const stale = await directoryRequest("PATCH", `/api/directory/review/${before.id}`, {
            actor: owner,
            expectedAccountId: owner.user.id,
            body: { status: "draft", expectedVersion: before.version, reason: "Stale reason" },
          });
          assert.equal(stale.status, 409);
          assert.equal(stale.data.code, "VERSION_CONFLICT");
          assert.equal(await auditCount(), beforeEvents + 1);
          assert.deepEqual(
            (await directory.readOwn(member.headers, before.id)).moderationReturn,
            note,
          );
        },
      );

      await t.test(
        "a returned reason clears on edit, publication, archive and recovery without deleting its audit",
        async () => {
          const id = memberBusiness.id;
          memberBusiness = await directory.update(member.headers, id, {
            title: "Corrected member profile",
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "draft");
          assert.equal(memberBusiness.moderationReturn, null);
          assert.equal((await directory.readOwn(member.headers, id)).moderationReturn, null);
          memberBusiness = await directory.publish(member.headers, id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "pending");
          assert.equal(memberBusiness.moderationReturn, null);
          memberBusiness = await directory.moderate(owner.headers, id, {
            status: "published",
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.moderationReturn, null);
          for (const business of [
            await directory.readPublic(id),
            ...(await directory.listPublic()).items,
          ])
            assert.equal(Object.hasOwn(business, "moderationReturn"), false);
          const audit = await pool.query(
            "SELECT reason FROM directory_moderation_audit WHERE business_id=$1 AND next_status='draft' ORDER BY next_version",
            [id],
          );
          assert.deepEqual(
            audit.rows.map((row) => row.reason),
            ["Unesi tačno radno vrijeme i kontakt."],
          );
          memberBusiness = await directory.moderate(owner.headers, id, {
            status: "draft",
            expectedVersion: memberBusiness.version,
            reason: "Dopuni adresu.",
          });
          assert.equal(memberBusiness.moderationReturn.reason, "Dopuni adresu.");
          memberBusiness = await directory.archive(member.headers, id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.moderationReturn, null);
          assert.equal((await directory.readOwn(member.headers, id)).moderationReturn, null);
          assert.equal(
            (await directory.listOwn(member.headers, { status: "archived" })).items.find(
              (row) => row.id === id,
            ).moderationReturn,
            null,
          );
          memberBusiness = await directory.recover(member.headers, id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "draft");
          assert.equal(memberBusiness.moderationReturn, null);
          assert.equal((await directory.readOwn(member.headers, id)).moderationReturn, null);
          memberBusiness = await directory.publish(owner.headers, id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "published");
          assert.equal(memberBusiness.moderationReturn, null);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_moderation_audit WHERE business_id=$1 AND next_status='draft'",
                [id],
              )
            ).rows[0].n,
            2,
          );
        },
      );

      await t.test(
        "database-only public reads preserve publication and owner eligibility without SMTP or private auth",
        async () => {
          const publicDirectory = createPublicDirectoryService({ database: pool });
          const { createDirectoryRequestHandler } = await import(
            "../../src/server/directory-http.ts"
          );
          let authConfigurationReads = 0;
          const handle = createDirectoryRequestHandler({
            publicService: () => publicDirectory,
            configuration: () => {
              authConfigurationReads++;
              return null;
            },
            privateService: () => null,
          });
          const publicRequest = async (route) => {
            const response = await handle(new Request(new URL(route, baseURL)));
            return { status: response.status, body: await response.json() };
          };
          const profileRoute = `/api/directory/businesses/${memberBusiness.id}`;
          const beforeAudit = (
            await pool.query("SELECT count(*)::integer AS n FROM directory_moderation_audit")
          ).rows[0].n;
          assert.equal((await publicRequest("/api/directory/categories")).status, 200);
          const initial = await publicRequest(profileRoute);
          assert.equal(initial.status, 200);
          for (const field of ["ownerId", "status", "version", "archivedAt", "updatedAt", "bytes"])
            assert.equal(Object.hasOwn(initial.body.business, field), false);
          for (const state of [
            { approval: "pending", verified: true, status: "published" },
            { approval: "suspended", verified: true, status: "published" },
            { approval: "approved", verified: false, status: "published" },
            { approval: "approved", verified: true, status: "draft" },
            { approval: "approved", verified: true, status: "pending" },
            { approval: "approved", verified: true, status: "archived" },
          ]) {
            try {
              await pool.query('UPDATE auth_user SET approval=$1,"emailVerified"=$2 WHERE id=$3', [
                state.approval,
                state.verified,
                member.user.id,
              ]);
              await pool.query(
                "UPDATE directory_business SET status=$1,archived_at=CASE WHEN $1='archived' THEN now() ELSE NULL END WHERE id=$2",
                [state.status, memberBusiness.id],
              );
              const profile = await publicRequest(profileRoute);
              assert.equal(profile.status, 404, JSON.stringify(state));
              assert.deepEqual(profile.body, { code: "BUSINESS_NOT_FOUND" });
              const listing = await publicRequest("/api/directory/businesses");
              assert.equal(listing.status, 200);
              assert.equal(
                listing.body.items.some((value) => value.id === memberBusiness.id),
                false,
              );
            } finally {
              await pool.query(
                "UPDATE auth_user SET approval='approved',\"emailVerified\"=true WHERE id=$1",
                [member.user.id],
              );
              await pool.query(
                "UPDATE directory_business SET status='published',archived_at=NULL WHERE id=$1",
                [memberBusiness.id],
              );
            }
          }
          assert.equal((await publicRequest(profileRoute)).status, 200);
          assert.equal(
            (await publicRequest("/api/directory/businesses")).body.items.some(
              (value) => value.id === memberBusiness.id,
            ),
            true,
          );
          assert.equal(authConfigurationReads, 0);
          assert.equal((await publicRequest("/api/directory/mine")).status, 503);
          assert.equal(authConfigurationReads, 1);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_moderation_audit"))
              .rows[0].n,
            beforeAudit,
          );
          assert.equal(captured.size, 3);
        },
      );

      await t.test(
        "owner publication and edits stay public, while archive and recovery enforce visibility and quota",
        async () => {
          let business = ownerBusinesses[0];
          business = await directory.publish(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          assert.equal(business.status, "published");
          business = await directory.update(owner.headers, business.id, {
            title: "Owner revised fixture",
            expectedVersion: business.version,
          });
          assert.equal(business.status, "published");
          assert.equal((await directory.readPublic(business.id)).title, "Owner revised fixture");
          business = await directory.update(owner.headers, business.id, {
            title: "Restoran Đorđe Nedžad 50%_\\ fixture",
            expectedVersion: business.version,
          });
          for (const q of [
            "nedzad restoran",
            "DJORDJE",
            "NEDŽAD RESTORAN",
            "%",
            "_",
            "\\",
            "50%_\\",
          ]) {
            assert.deepEqual(
              (await directory.listPublic({ q })).items.map((row) => row.id),
              [business.id],
            );
            assert.deepEqual(
              (await directory.listOwn(owner.headers, { q })).items.map((row) => row.id),
              [business.id],
            );
          }
          assert.deepEqual((await directory.listPublic({ q: "%' OR true --" })).items, []);
          memberBusiness = await directory.archive(member.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "archived");
          assert.equal(
            (await directory.listOwn(member.headers)).items.some(
              (row) => row.id === memberBusiness.id,
            ),
            false,
          );
          assert.equal(
            (await directory.listAdmin(owner.headers)).items.some(
              (row) => row.id === memberBusiness.id,
            ),
            false,
          );
          assert.ok(
            (await directory.listOwn(member.headers, { status: "archived" })).items.some(
              (row) => row.id === memberBusiness.id,
            ),
          );
          assert.ok(
            (await directory.listAdmin(owner.headers, { status: "archived" })).items.some(
              (row) => row.id === memberBusiness.id,
            ),
          );
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          assert.equal(
            (await directory.listPublic({})).items.some((row) => row.id === memberBusiness.id),
            false,
          );
          const replacement = await directory.create(
            member.headers,
            { ...valid(), title: "Replacement member fixture" },
            randomUUID(),
          );
          await denied(
            () =>
              directory.recover(member.headers, memberBusiness.id, {
                expectedVersion: memberBusiness.version,
              }),
            409,
            "BUSINESS_LIMIT_REACHED",
          );
          await directory.archive(member.headers, replacement.id, {
            expectedVersion: replacement.version,
          });
          memberBusiness = await directory.recover(member.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "draft");
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
        },
      );

      await t.test(
        "directory HTTP routes enforce access, origins, closed queries and create keys",
        async () => {
          const before = (await pool.query("SELECT count(*)::integer AS n FROM directory_business"))
            .rows[0].n;
          assert.equal((await directoryRequest("GET", "/api/directory/mine")).status, 401);
          assert.equal(
            (
              await directoryRequest("POST", "/api/directory/categories", {
                actor: member,
                body: { name: "Not allowed", slug: "not-allowed" },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await directoryRequest("POST", "/api/directory/mine", {
                actor: owner,
                body: valid(),
                key: randomUUID(),
                origin: "https://untrusted.invalid",
              })
            ).status,
            403,
          );
          assert.equal(
            (await directoryRequest("POST", "/api/directory/mine", { actor: owner, body: valid() }))
              .status,
            400,
          );
          assert.equal(
            (await directoryRequest("GET", "/api/directory/businesses?status=draft")).status,
            400,
          );
          assert.equal(
            (await directoryRequest("GET", "/api/directory/mine?q=a&q=b", { actor: member }))
              .status,
            400,
          );
          assert.equal(
            (await directoryRequest("GET", "/api/directory/review", { actor: member })).status,
            403,
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business")).rows[0].n,
            before,
          );
          const created = await directoryRequest("POST", "/api/directory/mine", {
            actor: owner,
            body: { ...valid(), title: "HTTP fixture" },
            key: randomUUID(),
          });
          assert.equal(created.status, 201);
          let business = created.data.business;
          assert.equal(
            (await directoryRequest("GET", `/api/directory/mine/${business.id}`, { actor: owner }))
              .data.business.id,
            business.id,
          );
          const updated = await directoryRequest("PATCH", `/api/directory/mine/${business.id}`, {
            actor: owner,
            body: { title: "HTTP revised fixture", expectedVersion: business.version },
          });
          assert.equal(updated.status, 200);
          business = updated.data.business;
          assert.equal(business.title, "HTTP revised fixture");
          assert.equal(business.status, "draft");
          const published = await directoryRequest(
            "POST",
            `/api/directory/mine/${business.id}/publish`,
            { actor: owner, body: { expectedVersion: business.version } },
          );
          assert.equal(published.status, 200);
          const publicRead = await directoryRequest(
            "GET",
            `/api/directory/businesses/${business.id}`,
          );
          assert.equal(publicRead.status, 200);
          assert.equal(publicRead.data.business.title, "HTTP revised fixture");
          assert.equal(Object.hasOwn(publicRead.data.business, "ownerId"), false);
        },
      );

      await t.test(
        "GPS coordinates preserve zero values, reject incomplete pairs and replay without duplication",
        async () => {
          const before = (await pool.query("SELECT count(*)::integer AS n FROM directory_business"))
            .rows[0].n;
          const withoutLocation = { ...valid() };
          delete withoutLocation.latitude;
          delete withoutLocation.longitude;
          const invalid = [
            { ...withoutLocation, latitude: 0 },
            { ...withoutLocation, longitude: 0 },
            ...[
              [91, 0],
              [-91, 0],
              [0, 181],
              [0, -181],
            ].map(([latitude, longitude]) => ({ ...valid(), latitude, longitude })),
          ];
          for (const body of invalid) {
            assert.equal(
              (
                await directoryRequest("POST", "/api/directory/mine", {
                  actor: owner,
                  body,
                  key: randomUUID(),
                })
              ).status,
              400,
            );
          }
          // JSON turns NaN into null; call the real service to test the non-finite input guard.
          await denied(
            () =>
              directory.create(
                owner.headers,
                { ...valid(), latitude: Number.NaN, longitude: 0 },
                randomUUID(),
              ),
            400,
            "INVALID_DIRECTORY_INPUT",
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business")).rows[0].n,
            before,
          );

          const key = randomUUID();
          const body = { ...valid(), title: "Zero-coordinate fixture", latitude: 0, longitude: 0 };
          const created = await directoryRequest("POST", "/api/directory/mine", {
            actor: owner,
            body,
            key,
          });
          assert.equal(created.status, 201);
          let business = created.data.business;
          assert.deepEqual([business.latitude, business.longitude], [0, 0]);
          assert.deepEqual(
            (
              await pool.query("SELECT latitude, longitude FROM directory_business WHERE id = $1", [
                business.id,
              ])
            ).rows,
            [{ latitude: 0, longitude: 0 }],
          );
          const repeated = await directoryRequest("POST", "/api/directory/mine", {
            actor: owner,
            body,
            key,
          });
          assert.equal(repeated.status, 201);
          assert.equal(repeated.data.business.id, business.id);
          assert.deepEqual(
            [repeated.data.business.latitude, repeated.data.business.longitude],
            [0, 0],
          );
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business")).rows[0].n,
            before + 1,
          );

          const invalidUpdate = await directoryRequest(
            "PATCH",
            `/api/directory/mine/${business.id}`,
            { actor: owner, body: { latitude: null, expectedVersion: business.version } },
          );
          assert.equal(invalidUpdate.status, 400);
          assert.equal(
            (await directory.readOwn(owner.headers, business.id)).version,
            business.version,
          );
          const updated = await directoryRequest("PATCH", `/api/directory/mine/${business.id}`, {
            actor: owner,
            body: { title: "Updated zero-coordinate fixture", expectedVersion: business.version },
          });
          assert.equal(updated.status, 200);
          business = updated.data.business;
          assert.deepEqual([business.latitude, business.longitude], [0, 0]);
          const replay = await directory.create(owner.headers, body, key);
          assert.equal(replay.id, business.id);
          assert.equal(replay.version, business.version);
          assert.equal(replay.title, business.title);
          assert.deepEqual([replay.latitude, replay.longitude], [0, 0]);
          const published = await directoryRequest(
            "POST",
            `/api/directory/mine/${business.id}/publish`,
            { actor: owner, body: { expectedVersion: business.version } },
          );
          assert.equal(published.status, 200);
          const publicProfile = await directoryRequest(
            "GET",
            `/api/directory/businesses/${business.id}`,
          );
          assert.equal(publicProfile.status, 200);
          assert.deepEqual(
            [publicProfile.data.business.latitude, publicProfile.data.business.longitude],
            [0, 0],
          );
        },
      );

      await t.test(
        "public city filtering composes literal text and taxonomy without exposing hidden profiles",
        async () => {
          const city = "Fixture 50%_\\ Grad";
          async function fixture(
            title,
            location,
            categoryId = root.id,
            subcategoryId = child.id,
            publish = true,
          ) {
            let business = await directory.create(
              owner.headers,
              { ...valid(), title, city: location, categoryId, subcategoryId },
              randomUUID(),
            );
            if (publish)
              business = await directory.publish(owner.headers, business.id, {
                expectedVersion: business.version,
              });
            return business;
          }
          const target = await fixture("City-proof target", city);
          const wrongCity = await fixture("City-proof other location", "Other fixture Grad");
          const wrongCategory = await fixture(
            "City-proof other category",
            city,
            otherRoot.id,
            null,
          );
          let archived = await fixture("City-proof archived", city);
          archived = await directory.archive(owner.headers, archived.id, {
            expectedVersion: archived.version,
          });
          const draft = await fixture("City-proof draft", city, root.id, child.id, false);
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "City-proof pending",
            city,
            expectedVersion: memberBusiness.version,
          });
          memberBusiness = await directory.publish(member.headers, memberBusiness.id, {
            expectedVersion: memberBusiness.version,
          });
          assert.equal(memberBusiness.status, "pending");
          let unapproved = (await directory.listOwn(other.headers)).items[0];
          assert.ok(unapproved);
          unapproved = await directory.update(owner.headers, unapproved.id, {
            title: "City-proof unapproved",
            city,
            expectedVersion: unapproved.version,
          });
          unapproved = await directory.publish(owner.headers, unapproved.id, {
            expectedVersion: unapproved.version,
          });
          assert.equal(
            (
              await pool.query("UPDATE auth_user SET approval = 'pending' WHERE id = $1", [
                other.user.id,
              ])
            ).rowCount,
            1,
          );
          try {
            const ids = (items) => items.map((row) => row.id).sort();
            const expected = [target.id, wrongCategory.id].sort();
            for (const literal of ["%", "_", "\\", "  50%_\\ gRaD  "]) {
              assert.deepEqual(
                ids((await directory.listPublic({ city: literal })).items),
                expected,
              );
            }
            assert.deepEqual((await directory.listPublic({ city: "%' OR true --" })).items, []);
            const combined = new URLSearchParams({
              q: "City-proof",
              city: "  50%_\\ gRaD  ",
              categoryId: root.id,
              subcategoryId: child.id,
            });
            const response = await directoryRequest("GET", `/api/directory/businesses?${combined}`);
            assert.equal(response.status, 200);
            assert.deepEqual(ids(response.data.items), [target.id]);
            for (const field of [
              "ownerId",
              "status",
              "version",
              "archivedAt",
              "updatedAt",
              "approval",
              "password",
            ])
              assert.equal(Object.hasOwn(response.data.items[0], field), false);
            assert.deepEqual(
              (
                await directory.listPublic({
                  q: "other location",
                  city: "50%_\\",
                  categoryId: root.id,
                  subcategoryId: child.id,
                })
              ).items,
              [],
            );
            assert.deepEqual(
              ids(
                (
                  await directory.listPublic({
                    q: "City-proof",
                    city: "  ",
                    categoryId: root.id,
                    subcategoryId: child.id,
                  })
                ).items,
              ),
              [target.id, wrongCity.id].sort(),
            );
            for (const hidden of [archived, draft, memberBusiness, unapproved]) {
              assert.equal(
                (await directoryRequest("GET", `/api/directory/businesses/${hidden.id}`)).status,
                404,
              );
            }
            const detail = await directoryRequest("GET", `/api/directory/businesses/${target.id}`);
            assert.equal(detail.status, 200);
            assert.equal(detail.data.business.city, city);
            assert.equal(Object.hasOwn(detail.data.business, "ownerId"), false);
            await denied(
              () => directory.listPublic({ city: "x".repeat(101) }),
              400,
              "INVALID_DIRECTORY_INPUT",
            );
            await denied(
              () => directory.listPublic({ city: ["not text"] }),
              400,
              "INVALID_DIRECTORY_INPUT",
            );
            assert.equal(
              (
                await directoryRequest(
                  "GET",
                  `/api/directory/businesses?${new URLSearchParams({ city: "x".repeat(101) })}`,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await directoryRequest(
                  "GET",
                  `/api/directory/businesses?${new URLSearchParams({ city: "x".repeat(100) })}`,
                )
              ).status,
              200,
            );
            await denied(
              () => directory.listOwn(member.headers, { city: "Grad" }),
              400,
              "UNEXPECTED_FIELD",
            );
            await denied(
              () => directory.listAdmin(owner.headers, { city: "Grad" }),
              400,
              "UNEXPECTED_FIELD",
            );
            assert.equal(
              (await directoryRequest("GET", "/api/directory/mine?city=Grad", { actor: member }))
                .status,
              400,
            );
            assert.equal(
              (await directoryRequest("GET", "/api/directory/admin?city=Grad", { actor: owner }))
                .status,
              400,
            );
          } finally {
            await pool.query("UPDATE auth_user SET approval = 'approved' WHERE id = $1", [
              other.user.id,
            ]);
          }
        },
      );

      await t.test(
        "nearby public queries use real distance, stable pages, geographic boundaries and unchanged eligibility",
        async () => {
          const prefix = `geo-${suffix}`;
          const created = [];
          const degrees = (km) => (km / 6371) * (180 / Math.PI);
          async function insert(
            label,
            latitude,
            longitude,
            { ownerId = owner.user.id, status = "published", createdAt = "2020-01-01" } = {},
          ) {
            const id = randomUUID();
            await pool.query(
              `INSERT INTO directory_business(id,owner_user_id,title,category_id,latitude,longitude,status,created_at,published_at,archived_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7='published' THEN now() ELSE NULL END,CASE WHEN $7='archived' THEN now() ELSE NULL END)`,
              [id, ownerId, `${prefix} ${label}`, root.id, latitude, longitude, status, createdAt],
            );
            created.push(id);
            return id;
          }
          const publicDirectory = createPublicDirectoryService({ database: pool });
          const read = (extra = {}) =>
            publicDirectory.listPublic({
              q: prefix,
              latitude: 0,
              longitude: 0,
              radiusKm: 25,
              ...extra,
            });
          try {
            const equalA = await insert("origin-a", 0, 0, { createdAt: "2025-01-01" });
            const equalB = await insert("origin-b", 0, 0, { createdAt: "2015-01-01" });
            const inside = await insert("inside", degrees(24.99), 0);
            const outside = await insert("outside", degrees(25.01), 0);
            const draft = await insert("draft", 0, 0, { status: "draft" });
            const pending = await insert("pending", 0, 0, { status: "pending" });
            const archived = await insert("archived", 0, 0, { status: "archived" });
            const missing = await insert("missing-coordinates", null, null);
            const unapproved = await insert("unapproved", 0, 0, { ownerId: other.user.id });
            await pool.query("UPDATE auth_user SET approval='pending' WHERE id=$1", [
              other.user.id,
            ]);
            const initial = await read();
            assert.deepEqual(
              initial.items.map((row) => row.id),
              [...[equalA, equalB].sort(), inside],
            );
            for (const hidden of [outside, draft, pending, archived, missing, unapproved])
              assert.equal(
                initial.items.some((row) => row.id === hidden),
                false,
              );
            for (const row of initial.items)
              for (const privateField of [
                "ownerId",
                "status",
                "version",
                "moderationReturn",
                "approval",
                "emailVerified",
              ])
                assert.equal(Object.hasOwn(row, privateField), false);
            const pageRows = [];
            for (let i = 1; i <= 21; i++)
              pageRows.push(
                await insert(`page-${String(i).padStart(2, "0")}`, 0, degrees(i / 10), {
                  createdAt: new Date(Date.UTC(2025, 0, 30 - i)),
                }),
              );
            const pageQuery = { q: `${prefix} page-`, latitude: 0, longitude: 0, radiusKm: 25 };
            const first = await publicDirectory.listPublic(pageQuery),
              second = await publicDirectory.listPublic({ ...pageQuery, page: 2 });
            assert.deepEqual(
              first.items.map((row) => row.id),
              pageRows.slice(0, 20),
            );
            assert.equal(first.hasMore, true);
            assert.deepEqual(
              second.items.map((row) => row.id),
              pageRows.slice(20),
            );
            assert.equal(second.hasMore, false);
            const acrossDateLine = await insert("date-line", 0, -179.999);
            assert.deepEqual(
              (
                await read({
                  q: `${prefix} date-line`,
                  latitude: 0,
                  longitude: 179.999,
                  radiusKm: 1,
                })
              ).items.map((row) => row.id),
              [acrossDateLine],
            );
            const pole = await insert("pole", 89.999, -100);
            assert.deepEqual(
              (
                await read({ q: `${prefix} pole`, latitude: 89.999, longitude: 100, radiusKm: 1 })
              ).items.map((row) => row.id),
              [pole],
            );
            await denied(
              () => directory.listOwn(owner.headers, { latitude: 0, longitude: 0, radiusKm: 25 }),
              400,
              "UNEXPECTED_FIELD",
            );
          } finally {
            await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
              other.user.id,
            ]);
            if (created.length)
              await pool.query("DELETE FROM directory_business WHERE id=ANY($1::uuid[])", [
                created,
              ]);
          }
        },
      );

      await t.test(
        "private directory reads recheck exact session authority after their transaction lock wait",
        async () => {
          const routes = [
            [member, "/api/directory/mine"],
            [member, `/api/directory/mine/${memberBusiness.id}`],
            [owner, "/api/directory/admin"],
            [owner, "/api/directory/review"],
          ];
          const before = await directorySnapshot();
          for (const [actor, route] of routes) {
            for (const invalidation of ["revoke", "expire", "expire-session-lock"]) {
              const approved = await accounts.read(actor.headers);
              const signed = await auth.api.getSession({
                headers: actor.headers,
                query: { disableCookieCache: true, disableRefresh: true },
              });
              const original = (
                await pool.query("SELECT to_jsonb(s) AS value FROM auth_session s WHERE id=$1", [
                  signed.session.id,
                ])
              ).rows[0].value;
              const guardedHttp = createDirectoryHttpHandler({
                service: createDirectoryService({
                  accounts: { ...accounts, read: async () => approved },
                  auth,
                  pool,
                }),
                baseURL,
              });
              const locker = await pool.connect();
              let pending;
              try {
                try {
                  await locker.query("BEGIN");
                  if (invalidation === "expire-session-lock") {
                    await pool.query(
                      `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '500 milliseconds' WHERE id=$1`,
                      [signed.session.id],
                    );
                    await locker.query("SELECT id FROM auth_session WHERE id=$1 FOR UPDATE", [
                      signed.session.id,
                    ]);
                  } else {
                    await locker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [
                      actor.user.id,
                    ]);
                  }
                  pending = directoryRequest("GET", route, {
                    actor,
                    expectedAccountId: actor.user.id,
                    handler: guardedHttp,
                  });
                  await waitForTwoLockWaiters(pool, applicationName, 1);
                  if (invalidation === "revoke") {
                    assert.equal(
                      (
                        await pool.query('DELETE FROM auth_session WHERE id=$1 AND "userId"=$2', [
                          signed.session.id,
                          actor.user.id,
                        ])
                      ).rowCount,
                      1,
                    );
                  } else if (invalidation === "expire") {
                    assert.equal(
                      (
                        await pool.query(
                          'UPDATE auth_session SET "expiresAt"=clock_timestamp() WHERE id=$1',
                          [signed.session.id],
                        )
                      ).rowCount,
                      1,
                    );
                  } else {
                    const expiresAt = (
                      await pool.query('SELECT "expiresAt" FROM auth_session WHERE id=$1', [
                        signed.session.id,
                      ])
                    ).rows[0].expiresAt;
                    await pool.query(
                      "SELECT pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.03)",
                      [expiresAt],
                    );
                  }
                } finally {
                  await locker.query("ROLLBACK");
                  locker.release();
                }
                const response = await pending;
                assert.equal(response.status, 401, `${route}: ${invalidation}`);
                assert.equal(response.data.code, "AUTHENTICATION_REQUIRED");
                assert.deepEqual(await directorySnapshot(), before);
              } finally {
                // Restore only this isolated fixture's original signed session for the next case.
                await pool.query(
                  'INSERT INTO auth_session SELECT * FROM jsonb_populate_record(NULL::auth_session,$1::jsonb) WHERE true ON CONFLICT (id) DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt"',
                  [JSON.stringify(original)],
                );
              }
              assert.equal((await directoryRequest("GET", route, { actor })).status, 200);
            }
          }
          assert.deepEqual(await directorySnapshot(), before);
        },
      );

      await t.test(
        "admin search pages 21 pending profiles by city without exposing them publicly",
        async () => {
          const ids = Array.from({ length: 21 }, () => randomUUID());
          await pool.query(
            "INSERT INTO directory_business(id,owner_user_id,title,category_id,city,status) SELECT id,$2,'Poslovnica',$3,'Čapljina QA','pending' FROM unnest($1::uuid[]) AS fixture(id)",
            [ids, member.user.id, root.id],
          );
          const path = "/api/directory/review?q=capljina%20qa&page=";
          const first = await directoryRequest("GET", `${path}1`, { actor: owner });
          const second = await directoryRequest("GET", `${path}2`, { actor: owner });
          assert.equal(first.status, 200);
          assert.equal(second.status, 200);
          assert.equal(first.data.items.length, 20);
          assert.equal(first.data.hasMore, true);
          assert.equal(second.data.items.length, 1);
          assert.equal(second.data.hasMore, false);
          assert.deepEqual(
            [...first.data.items, ...second.data.items].map((row) => row.id).sort(),
            ids.sort(),
          );
          assert.equal((await directory.listPublic({ q: "capljina QA" })).items.length, 0);
        },
      );
      await t.test(
        "admin finds published businesses missing a live pin across pages and owners",
        async () => {
          const ids = Array.from({ length: 22 }, () => randomUUID());
          const city = "Karta QA";
          await pool.query(
            `INSERT INTO directory_business (id,owner_user_id,title,category_id,city,status,editorial_revision)
          SELECT id,CASE WHEN n % 2 = 0 THEN $2 ELSE $3 END,'Radnja '||n,$4,$5,'published',
                 CASE WHEN n = 1 THEN '{"fields":{"latitude":44.5,"longitude":18.7}}'::jsonb END
          FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id,n)`,
            [ids.slice(0, 21), member.user.id, owner.user.id, root.id, city],
          );
          await pool.query(
            `INSERT INTO directory_business (id,owner_user_id,title,category_id,city,status,latitude,longitude)
           VALUES ($1,$2,'Na mapi',$3,$4,'published',0,0)`,
            [ids[21], member.user.id, root.id, city],
          );
          await pool.query(
            `INSERT INTO directory_business (id,owner_user_id,title,category_id,city,status,archived_at)
           SELECT gen_random_uuid(),$1,'Druga stanja',$2,$3,s,CASE WHEN s='archived' THEN now() END
           FROM unnest(ARRAY['pending','draft','archived']) AS statuses(s)`,
            [member.user.id, root.id, city],
          );
          const route = "/api/directory/admin?map=missing&q=Karta+QA";
          const first = await directoryRequest("GET", route, { actor: owner });
          const second = await directoryRequest("GET", `${route}&page=2`, { actor: owner });
          assert.equal(first.status, 200);
          assert.equal(first.data.hasMore, true);
          assert.equal(first.data.items.length, 20);
          assert.equal(second.status, 200);
          assert.equal(second.data.hasMore, false);
          assert.equal(second.data.items.length, 1);
          assert.deepEqual(
            [...first.data.items, ...second.data.items].map((row) => row.id).sort(),
            ids.slice(0, 21).sort(),
          );
          assert.equal(
            (await directoryRequest("GET", `${route}&status=archived`, { actor: owner })).status,
            400,
          );
          assert.equal(
            (await directoryRequest("GET", "/api/directory/admin?map=invalid", { actor: owner }))
              .status,
            400,
          );
          assert.equal((await directoryRequest("GET", route, { actor: member })).status, 403);
          for (const area of ["businesses", "review", "mine"]) {
            assert.equal(
              (
                await directoryRequest("GET", `/api/directory/${area}?map=missing`, {
                  actor: owner,
                })
              ).status,
              400,
            );
          }
          const empty = await directoryRequest(
            "GET",
            "/api/directory/admin?map=missing&q=Na+mapi+Karta+QA",
            { actor: owner },
          );
          assert.equal(empty.status, 200);
          assert.deepEqual(empty.data.items, []);
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
