import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://business-details-ci.ahibizz.invalid";
const password = "Directory-only-fixture-password-713!";
const emails = [
  "owner@business-details-fixture.invalid",
  "member@business-details-fixture.invalid",
  "other@business-details-fixture.invalid",
];

async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname, tablename",
      [schema],
    )
  ).rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated business details, visibility, CAS, authority and rollback", {
    timeout: 120000,
  }, async (t) => {
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex");
    const schema = `ci_business_details_${suffix}`;
    assert.match(schema, /^ci_business_details_[a-f0-9]{20}$/);
    const applicationName = `business-details-ci-${suffix}`;
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
      assert.ok(migrations.some((row) => row.version === "0011_business_details.sql"));
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of [
        "auth_user",
        "directory_business",
        "directory_moderation_audit",
        "directory_create_commands",
        "directory_business_details",
      ]) {
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      }
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("External HTTP is forbidden in business-details acceptance.");
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
        secret: `business-details-fixture-${randomBytes(32).toString("hex")}`,
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
          "user-agent": "Isolated business-details acceptance",
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
      const denied = (operation, status, code) =>
        assert.rejects(
          operation,
          (error) =>
            error instanceof DirectoryAccessError &&
            error.status === status &&
            (!code || error.code === code),
        );
      const category = await directory.createCategory(owner.headers, {
        name: "Izolirana usluga",
        slug: "isolated-service",
      });
      const fields = {
        title: "Izolirana djelatnost",
        categoryId: category.id,
        subcategoryId: null,
        description: null,
        contactEmail: null,
        contactPhone: null,
        websiteUrl: null,
        addressLine: null,
        city: null,
        countryCode: null,
        latitude: null,
        longitude: null,
      };
      let business = await directory.create(member.headers, fields, randomUUID());
      const publicDirectory = createPublicDirectoryService({ database: pool });
      const value = () => ({
        timezone: "Europe/Sarajevo",
        amenities: ["wifi", "parking"],
        hours: Array.from({ length: 7 }, (_, index) => ({
          weekday: index + 1,
          windows:
            index < 5
              ? [
                  { startMinute: 540, endMinute: 720 },
                  { startMinute: 780, endMinute: 1020 },
                ]
              : [],
        })),
      });
      const snapshot = async () => ({
        business: (
          await pool.query("SELECT to_jsonb(b) AS value FROM directory_business b WHERE id=$1", [
            business.id,
          ])
        ).rows[0].value,
        details: (
          await pool.query(
            "SELECT to_jsonb(d) AS value FROM directory_business_details d WHERE business_id=$1",
            [business.id],
          )
        ).rows,
      });

      await t.test(
        "first-time timezone checks use the exact PostgreSQL catalogue within the interactive deadline",
        async () => {
          const differences = await pool.query(
            `WITH valid AS MATERIALIZED (SELECT DISTINCT name FROM pg_catalog.pg_timezone_names)
           SELECT name FROM ((SELECT name FROM valid EXCEPT SELECT name FROM directory_timezone_names)
               UNION ALL (SELECT name FROM directory_timezone_names EXCEPT SELECT name FROM valid)) missing`,
          );
          assert.deepEqual(differences.rows, []);
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SET LOCAL statement_timeout='200ms'");
            await client.query("UPDATE directory_business SET version=version+1 WHERE id=$1", [
              business.id,
            ]);
            await client.query(
              "INSERT INTO directory_business_details (business_id,timezone,hours,business_version) VALUES($1,'Pacific/Chatham',$2::jsonb,$3)",
              [business.id, JSON.stringify(value().hours), business.version + 1],
            );
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        },
      );
      await t.test(
        "new business has unknown hours, no amenities or seeded operational rows",
        async () => {
          assert.equal(business.details, null);
          assert.equal(
            (await pool.query("SELECT count(*)::integer AS n FROM directory_business_details"))
              .rows[0].n,
            0,
          );
          business = await directory.publish(member.headers, business.id, {
            expectedVersion: business.version,
          });
          assert.equal(business.status, "pending");
          business = await directory.moderate(owner.headers, business.id, {
            expectedVersion: business.version,
            status: "published",
          });
          assert.equal((await publicDirectory.readPublic(business.id)).details, null);
        },
      );
      await t.test(
        "member detail edits retain the approved public hours and amenities until review",
        async () => {
          const before = business;
          business = await directory.updateDetails(member.headers, business.id, {
            expectedVersion: business.version,
            details: value(),
          });
          assert.equal(business.version, before.version + 1);
          assert.equal(business.status, "published");
          assert.deepEqual(business.editorialRevision.details, value());
          assert.equal((await publicDirectory.readPublic(business.id)).details, null);
          assert.equal((await publicDirectory.listPublic()).items.length, 1);
          assert.equal(
            (
              await directory.updateDetails(member.headers, business.id, {
                expectedVersion: business.version,
                details: value(),
              })
            ).version,
            business.version,
          );
          business = await directory.moderate(owner.headers, business.id, {
            expectedVersion: business.version,
            status: "approve-changes",
          });
          const publicRow = await publicDirectory.readPublic(business.id);
          assert.deepEqual(publicRow.details, value());
          for (const field of [
            "ownerId",
            "status",
            "version",
            "moderationReturn",
            "editorialRevision",
            "pendingMedia",
            "revisionDecision",
            "revisionRejection",
          ])
            assert.equal(field in publicRow, false);
          assert.deepEqual((await publicDirectory.listPublic()).items[0].details, value());
        },
      );
      await t.test(
        "admin details stay live and audit the same global business version",
        async () => {
          const before = business;
          const details = { ...value(), amenities: ["accessible", "card-payment"] };
          business = await directory.updateDetails(owner.headers, business.id, {
            expectedVersion: business.version,
            details,
          });
          assert.equal(business.status, "published");
          assert.equal(business.version, before.version + 1);
          assert.deepEqual((await publicDirectory.readPublic(business.id)).details, details);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::integer AS n FROM directory_moderation_audit WHERE business_id=$1 AND action='owner-update' AND next_version=$2",
                [business.id, business.version],
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "unrelated user, changed actor, suspended owner and revoked session cannot access details",
        async () => {
          await denied(() => directory.readDetails(other.headers, business.id), 404);
          await denied(
            () =>
              directory.updateDetails(other.headers, business.id, {
                expectedVersion: business.version,
                details: value(),
              }),
            404,
          );
          const mismatched = new Headers(member.headers);
          mismatched.set("X-AhiBizz-Account-ID", other.user.id);
          await denied(
            () => directory.readDetails(mismatched, business.id),
            401,
            "ACCOUNT_IDENTITY_CHANGED",
          );
          await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            member.user.id,
          ]);
          await denied(() => directory.readDetails(member.headers, business.id), 403);
          await denied(() => publicDirectory.readPublic(business.id), 404);
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
            member.user.id,
          ]);
        },
      );
      await t.test(
        "two concurrent writes have one CAS winner and base edit cannot overwrite it",
        async () => {
          const before = business;
          const results = await Promise.allSettled(
            [value(), { ...value(), amenities: [] }].map((details) =>
              directory.updateDetails(owner.headers, business.id, {
                expectedVersion: before.version,
                details,
              }),
            ),
          );
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          const failure = results.find((result) => result.status === "rejected");
          assert.equal(failure.reason.code, "VERSION_CONFLICT");
          business = results.find((result) => result.status === "fulfilled").value;
          await denied(
            () =>
              directory.update(owner.headers, business.id, {
                expectedVersion: before.version,
                title: "Stale base update",
              }),
            409,
            "VERSION_CONFLICT",
          );
          assert.equal(
            (await directory.readDetails(owner.headers, business.id)).title,
            fields.title,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT business_version FROM directory_business_details WHERE business_id=$1",
                [business.id],
              )
            ).rows[0].business_version,
            business.version,
          );
        },
      );
      await t.test("invalid details leave both core and sidecar unchanged", async () => {
        const before = await snapshot();
        for (const details of [
          { ...value(), amenities: ["fake"] },
          { ...value(), timezone: "Wrong/Zone" },
          { ...value(), hours: [] },
        ])
          await denied(
            () =>
              directory.updateDetails(owner.headers, business.id, {
                expectedVersion: business.version,
                details,
              }),
            400,
            "INVALID_BUSINESS_DETAILS",
          );
        assert.deepEqual(await snapshot(), before);
      });
      await t.test("sidecar database failure rolls the core status and version back", async () => {
        const before = await snapshot();
        await pool.query(
          "CREATE FUNCTION reject_details_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_rejected'; END; $$",
        );
        await pool.query(
          "CREATE TRIGGER reject_details_fixture BEFORE INSERT OR UPDATE ON directory_business_details FOR EACH ROW EXECUTE FUNCTION reject_details_fixture()",
        );
        try {
          await denied(
            () =>
              directory.updateDetails(owner.headers, business.id, {
                expectedVersion: business.version,
                details: { ...value(), amenities: ["wifi", "family"] },
              }),
            503,
          );
          assert.deepEqual(await snapshot(), before);
        } finally {
          await pool.query("DROP TRIGGER reject_details_fixture ON directory_business_details");
          await pool.query("DROP FUNCTION reject_details_fixture()");
        }
      });
      await t.test(
        "database independently rejects invalid hours, amenities, timezone and stale sidecar version",
        async () => {
          const direct = async (timezone, hours, amenities, increment = true) => {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              if (increment)
                await client.query("UPDATE directory_business SET version=version+1 WHERE id=$1", [
                  business.id,
                ]);
              await client.query(
                "UPDATE directory_business_details SET timezone=$2,hours=$3::jsonb,amenities=$4,business_version=$5 WHERE business_id=$1",
                [
                  business.id,
                  timezone,
                  JSON.stringify(hours),
                  amenities,
                  increment ? business.version + 1 : business.version,
                ],
              );
            } finally {
              await client.query("ROLLBACK");
              client.release();
            }
          };
          const before = await snapshot();
          for (const args of [
            ["Europe/Sarajevo", [], []],
            ["Wrong/Zone", value().hours, []],
            ["Europe/Sarajevo", value().hours, ["fake"]],
            ["Europe/Sarajevo", value().hours, ["wifi", "wifi"]],
            [null, value().hours, []],
            ["Europe/Sarajevo", value().hours, [], false],
          ])
            await assert.rejects(
              () => direct(...args),
              (error) => error.code === "23514",
            );
          const overlap = value();
          overlap.hours[0].windows = [
            { startMinute: 600, endMinute: 800 },
            { startMinute: 700, endMinute: 900 },
          ];
          await assert.rejects(
            () => direct(overlap.timezone, overlap.hours, []),
            (error) => error.code === "23514",
          );
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        "HTTP requires same-origin actor and hides unrelated business existence",
        async () => {
          const { createBusinessDetailsHttpHandler } = await import(
            "../../src/server/business-details-http.ts"
          );
          const handler = createBusinessDetailsHttpHandler({ service: directory, baseURL });
          const send = (actor, expected, origin = baseURL) =>
            handler(
              new Request(`${baseURL}/api/business-details/mine/${business.id}`, {
                headers: {
                  cookie: actor.headers.get("cookie"),
                  origin,
                  "X-AhiBizz-Account-ID": expected,
                },
              }),
            );
          assert.equal((await send(member, member.user.id)).status, 200);
          assert.equal((await send(member, other.user.id)).status, 401);
          assert.equal((await send(other, other.user.id)).status, 404);
          assert.equal((await send(member, member.user.id, "https://foreign.invalid")).status, 403);
        },
      );
      await t.test("authority is rechecked after waiting on the actor row lock", async () => {
        const before = await snapshot(),
          blocker = await pool.connect();
        let waiting;
        try {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [member.user.id]);
          waiting = directory.updateDetails(member.headers, business.id, {
            expectedVersion: business.version,
            details: value(),
          });
          const observed = waiting.catch(() => {});
          let blocked = false;
          for (let i = 0; i < 80; i++) {
            if (
              (
                await pool.query(
                  "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                  [applicationName],
                )
              ).rows[0].n > 0
            ) {
              blocked = true;
              break;
            }
            await delay(10);
          }
          assert.equal(blocked, true);
          await blocker.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
            member.user.id,
          ]);
          await blocker.query("COMMIT");
          await denied(() => waiting, 403, "ACCOUNT_SUSPENDED");
          await observed;
          assert.deepEqual(await snapshot(), before);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [
            member.user.id,
          ]);
        }
      });
      await t.test(
        "clearing hours restores unknown; archive prevents edits and public access",
        async () => {
          business = await directory.updateDetails(owner.headers, business.id, {
            expectedVersion: business.version,
            details: { timezone: null, hours: null, amenities: ["family"] },
          });
          assert.deepEqual((await publicDirectory.readPublic(business.id)).details, {
            timezone: null,
            hours: null,
            amenities: ["family"],
          });
          business = await directory.archive(owner.headers, business.id, {
            expectedVersion: business.version,
          });
          await denied(
            () =>
              directory.updateDetails(owner.headers, business.id, {
                expectedVersion: business.version,
                details: value(),
              }),
            409,
            "BUSINESS_ARCHIVED",
          );
          await denied(() => publicDirectory.readPublic(business.id), 404);
          const signed = await auth.api.getSession({ headers: member.headers });
          await pool.query("DELETE FROM auth_session WHERE id=$1", [signed.session.id]);
          await denied(() => directory.readDetails(member.headers, business.id), 401);
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
