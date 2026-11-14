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

async function waitForTwoLockWaiters(pool, applicationName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= 2) return;
    await delay(20);
  }
  throw new Error("Both directory creates must reach the held actor lock.");
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
        ],
      );
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "directory_category",
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
      const directory = createDirectoryService({
        accounts: createAccountService({ auth, pool }),
        auth,
        pool,
      });
      const { createDirectoryHttpHandler } = await import("../../src/server/directory-http.ts");
      const directoryHttp = createDirectoryHttpHandler({ service: directory, baseURL });
      async function directoryRequest(method, route, { actor, body, key, origin = baseURL } = {}) {
        const headers = new Headers(actor?.headers);
        headers.set("origin", origin);
        if (body !== undefined) headers.set("content-type", "application/json");
        if (key) headers.set("idempotency-key", key);
        const response = await directoryHttp(
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

      await t.test("only owner creates a consistent two-level taxonomy", async () => {
        await denied(
          () => directory.createCategory(member.headers, { name: "Forbidden", slug: "forbidden" }),
          403,
          "OWNER_REQUIRED",
        );
        root = await directory.createCategory(owner.headers, {
          name: "Services",
          slug: "services",
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
        assert.equal(categories.length, 3);
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
        "member publication waits for moderation and edits remove public visibility",
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
          memberBusiness = await directory.update(member.headers, memberBusiness.id, {
            title: "Revised member profile",
            expectedVersion: version,
          });
          assert.equal(memberBusiness.status, "pending");
          await denied(
            () =>
              directory.update(member.headers, memberBusiness.id, {
                title: "Stale write",
                expectedVersion: version,
              }),
            409,
            "VERSION_CONFLICT",
          );
          await denied(() => directory.readPublic(memberBusiness.id), 404, "BUSINESS_NOT_FOUND");
          memberBusiness = await directory.moderate(owner.headers, memberBusiness.id, {
            status: "published",
            expectedVersion: memberBusiness.version,
          });
          assert.ok(
            (
              await directory.listPublic({ categoryId: root.id, subcategoryId: child.id })
            ).items.some((row) => row.id === memberBusiness.id),
          );
          const audit = (
            await pool.query(
              "SELECT previous_status, next_status, previous_version, next_version FROM directory_moderation_audit WHERE actor_user_id = $1 AND business_id = $2 AND action = 'moderate' ORDER BY created_at, id",
              [owner.user.id, memberBusiness.id],
            )
          ).rows;
          assert.equal(audit.length, 2);
          for (const row of audit) {
            assert.equal(row.previous_status, "pending");
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
            title: "Owner 50%_\\ fixture",
            expectedVersion: business.version,
          });
          for (const q of ["%", "_", "\\", "50%_\\"]) {
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
