import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { readNextAppointment } from "../../src/server/customer-next-appointment.ts";
import { testBusinessToday } from "./business-today-cases.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";
import { testVehicleRentals } from "./rental-cases.mjs";
import { testAccommodation } from "./stay-cases.mjs";

const baseURL = "https://booking-ci.ahibizz.invalid";
const password = "Booking-fixture-only-password-294!";
const emails = [
  "operator@booking-fixture.invalid",
  "professional@booking-fixture.invalid",
  "customer@booking-fixture.invalid",
  "other@booking-fixture.invalid",
  "pagination@booking-fixture.invalid",
];
const bookingTables = [
  "booking_settings",
  "booking_service",
  "booking_entry",
  "booking_create_commands",
  "booking_completion_credit",
  "booking_entry_event",
];

async function outsideTables(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema' AND schemaname <> $1 ORDER BY schemaname, tablename",
      [schema],
    )
  ).rows;
}

async function waitForLockWaiters(pool, applicationName, minimum = 2) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const count = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )
    ).rows[0].n;
    if (count >= minimum) return;
    await delay(10);
  }
  throw new Error("Booking requests must reach the held authority lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test("real isolated booking, concurrent holds, cancellation and completion credits", {
    timeout: 120000,
  }, async (t) => {
    // No DATABASE_URL, PG* default or production host can enter this fixture.
    const configuration = integrationConfiguration(process.env);
    const suffix = randomBytes(10).toString("hex"),
      schema = `ci_booking_${suffix}`;
    const applicationName = `booking-ci-${suffix}`;
    assert.match(schema, /^ci_booking_[a-f0-9]{20}$/);
    const { Pool } = await import("pg");
    const administration = new Pool({ ...configuration, max: 1 });
    administration.on("error", () => {});
    let pool,
      created = false;
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
        ],
      );
      assert.deepEqual(await runMigrations({ pool, migrations }), {
        applied: migrations.map((row) => row.version),
      });
      assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
      for (const table of ["auth_user", "directory_business", ...bookingTables])
        assert.equal(
          (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          0,
        );
      globalThis.fetch = async () => {
        outboundAttempts++;
        throw new Error("Outbound HTTP is forbidden in booking acceptance.");
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
        secret: `booking-fixture-${randomBytes(32).toString("hex")}`,
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
          "user-agent": "Isolated booking acceptance",
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
      async function refreshSession(actor) {
        const signed = await authRequest("POST", "/api/auth/sign-in/email", {
          email: actor.user.email,
          password,
        });
        assert.equal(signed.status, 200);
        const cookie = signed.headers
          .getSetCookie()
          .map((line) => line.split(";", 1)[0])
          .join("; ");
        assert.ok(cookie);
        actor.headers = new Headers({ origin: baseURL, cookie });
        const session = await auth.api.getSession({
          headers: actor.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        assert.equal(session.user.id, actor.user.id);
      }
      const actors = [];
      for (const [index, email] of emails.entries()) {
        assert.equal(
          (
            await authRequest("POST", "/api/auth/sign-up/email", {
              name: `Booking fixture ${index}`,
              email,
              password,
            })
          ).status,
          200,
        );
        assert.ok([200, 302].includes((await authRequest("GET", captured.get(email).url)).status));
        if (index === 0) await bootstrapInitialOwner(pool, email);
        else {
          const pending = (await accounts.listPending(actors[0].headers)).accounts.find(
            (row) => row.email === email,
          );
          assert.ok(pending);
          assert.equal(
            (
              await accounts.decide(actors[0].headers, pending.id, {
                approval: "approved",
                expected: "pending",
              })
            ).approval,
            "approved",
          );
        }
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
      assert.equal(captured.size, emails.length);
      const [operator, professional, customer, other, paginationCustomer] = actors;
      assert.equal(
        professional.user.role,
        "member",
        "An ordinary business owner must not require platform-owner privileges.",
      );
      const { createDirectoryService } = await import("../../src/server/directory/index.ts");
      const directory = createDirectoryService({ accounts, auth, pool });
      const category = await directory.createCategory(operator.headers, {
        name: "Booking fixture",
        slug: "booking-fixture",
        parentId: null,
      });
      let business = await directory.create(
        professional.headers,
        {
          title: "Booking acceptance fixture",
          categoryId: category.id,
          subcategoryId: null,
          description: "Synthetic business for isolated PostgreSQL booking tests only.",
          contactEmail: "business@booking-fixture.invalid",
          contactPhone: "+38761123456",
          websiteUrl: "https://booking-fixture.invalid",
          addressLine: "Fixture Street 12",
          city: "Tuzla",
          countryCode: "BA",
          latitude: 0,
          longitude: 0,
        },
        randomUUID(),
      );
      business = await directory.publish(professional.headers, business.id, {
        expectedVersion: business.version,
      });
      assert.equal(business.status, "pending");
      business = await directory.moderate(operator.headers, business.id, {
        expectedVersion: business.version,
        status: "published",
      });
      const { createBookingService } = await import("../../src/server/booking/index.ts");
      const { createBookingHttpHandler } = await import("../../src/server/booking-http.ts");
      let clock = new Date("2030-01-06T12:00:00.000Z");
      const service = createBookingService({ accounts, auth, pool, now: () => new Date(clock) });
      const http = createBookingHttpHandler({ service, baseURL });
      async function request(
        method,
        route,
        {
          actor,
          body,
          key,
          origin = baseURL,
          contentType = "application/json",
          handler = http,
          expectedAccountId,
        } = {},
      ) {
        const headers = new Headers(actor?.headers);
        headers.set("origin", origin);
        if (body !== undefined) headers.set("content-type", contentType);
        if (key) headers.set("idempotency-key", key);
        if (expectedAccountId !== undefined) headers.set("X-AhiBizz-Account-ID", expectedAccountId);
        const response = await handler(
          new Request(new URL(`/api/booking${route}`, baseURL), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        return { status: response.status, data: await response.json() };
      }
      const publicPath = `/businesses/${business.id}`,
        ownerPath = `/mine/businesses/${business.id}`;
      const windows = Array.from({ length: 7 }, (_, index) => ({
        weekday: index + 1,
        startMinute: 540,
        endMinute: 1020,
      }));
      const settingsInput = (settings, patch = {}) => ({
        expectedVersion: settings.version,
        enabled: settings.enabled,
        timezone: settings.timezone,
        windows: settings.windows,
        services: settings.services.map((row) => ({
          id: row.id,
          name: row.name,
          durationMinutes: row.durationMinutes,
          priceMinor: row.priceMinor,
          active: row.active,
        })),
        ...patch,
      });
      const count = async (table) =>
        (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n;
      const bookingSnapshot = async () => {
        const snapshot = {};
        for (const table of bookingTables) {
          snapshot[table] = (
            await pool.query(
              `SELECT to_jsonb(item) AS value FROM ${table} item ORDER BY to_jsonb(item)::text`,
            )
          ).rows;
        }
        return snapshot;
      };
      async function invalidateAfterPreflight(actor, run, invalidation = "revoke") {
        const session = await auth.api.getSession({
          headers: actor.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        assert.equal(session.user.id, actor.user.id);
        const before = await bookingSnapshot();
        // Freeze only the approved account projection in the session-row-lock case.
        // AuthService still checks the actual signed session with refresh disabled.
        const approved =
          invalidation === "expire-session-lock" ? await accounts.read(actor.headers) : null;
        const guardedHttp = approved
          ? createBookingHttpHandler({
              service: createBookingService({
                accounts: { ...accounts, read: async () => approved },
                auth,
                pool,
                now: () => new Date(clock),
              }),
              baseURL,
            })
          : http;
        const locker = await pool.connect();
        let pending;
        try {
          await locker.query("BEGIN");
          if (invalidation === "expire-session-lock") {
            await pool.query(
              `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '500 milliseconds' WHERE id=$1`,
              [session.session.id],
            );
            await locker.query("SELECT id FROM auth_session WHERE id=$1 FOR UPDATE", [
              session.session.id,
            ]);
          } else {
            await locker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [actor.user.id]);
          }
          pending = run(guardedHttp);
          // Reaching a transaction lock proves signed-session preflight has already succeeded.
          await waitForLockWaiters(pool, applicationName, 1);
          if (invalidation === "expire-session-lock") {
            const expiry = (
              await pool.query(
                `SELECT "expiresAt", "expiresAt">(SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() AND application_name=$2 AND wait_event_type='Lock') AS after_transaction_start FROM auth_session WHERE id=$1`,
                [session.session.id, applicationName],
              )
            ).rows[0];
            assert.equal(expiry.after_transaction_start, true);
            // Keep the tuple unchanged; only actual clock expiry occurs during its row-lock wait.
            await pool.query(
              "SELECT pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.03)",
              [expiry.expiresAt],
            );
          } else if (invalidation === "expire") {
            const waiting = (
              await pool.query(
                "SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'",
                [applicationName],
              )
            ).rows;
            assert.equal(waiting.length, 1);
            const expired = await pool.query(
              'UPDATE auth_session SET "expiresAt"=clock_timestamp() WHERE id=$1 AND "userId"=$2 AND token=$3 RETURNING "expiresAt">$4::timestamptz AS after_transaction_start',
              [session.session.id, actor.user.id, session.session.token, waiting[0].xact_start],
            );
            assert.equal(expired.rowCount, 1);
            assert.equal(expired.rows[0].after_transaction_start, true);
          } else {
            const revoked = await pool.query(
              'DELETE FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3',
              [session.session.id, actor.user.id, session.session.token],
            );
            assert.equal(revoked.rowCount, 1);
          }
        } finally {
          await locker.query("ROLLBACK");
          locker.release();
        }
        const denied = await pending;
        assert.equal(denied.status, 401);
        assert.equal(denied.data.code, "AUTHENTICATION_REQUIRED");
        assert.deepEqual(
          await bookingSnapshot(),
          before,
          "A session invalidated after preflight must not change entries, settings, services, commands, audit or credits.",
        );
      }
      const events = async (id) =>
        (
          await pool.query(
            "SELECT actor_user_id,action,previous_status,next_status,previous_version,next_version FROM booking_entry_event WHERE entry_id=$1 ORDER BY next_version",
            [id],
          )
        ).rows;
      const deniedCredit = (
        entryId,
        businessId = business.id,
        recipientId = professional.user.id,
      ) =>
        assert.rejects(
          pool.query(
            "INSERT INTO booking_completion_credit (entry_id,business_id,recipient_user_id,amount) VALUES ($1,$2,$3,5)",
            [entryId, businessId, recipientId],
          ),
          (error) => error.code === "23514",
        );
      const action = (actor, entry, next, expectedVersion = entry.version) =>
        request("POST", `/entries/${entry.id}/action`, {
          actor,
          body: { action: next, expectedVersion },
        });
      let settings, serviceId, otherServiceId, winner, winnerActor, winnerKey, winnerBody;
      const quote = (serviceId, startsAt, configurationVersion = settings.version) => ({
        serviceId,
        startsAt,
        configurationVersion,
      });

      await t.test(
        "booking defaults disabled and writes enforce authority, origin, closed input and settings CAS",
        async () => {
          assert.equal((await request("GET", `${ownerPath}/settings`)).status, 401);
          assert.ok(
            [403, 404].includes(
              (await request("GET", `${ownerPath}/settings`, { actor: customer })).status,
            ),
          );
          const disabled = await request("GET", publicPath);
          assert.equal(disabled.status, 200);
          assert.equal(disabled.data.booking.enabled, false);
          settings = (await request("GET", `${ownerPath}/settings`, { actor: professional })).data
            .settings;
          assert.equal(settings.version, 0);
          assert.equal(await count("booking_settings"), 0);
          const body = {
            expectedVersion: 0,
            enabled: true,
            timezone: "Europe/Sarajevo",
            windows,
            services: [
              { name: "Fixture service", durationMinutes: 30, priceMinor: 4250, active: true },
              {
                name: "Other fixture service",
                durationMinutes: 30,
                priceMinor: 2500,
                active: true,
              },
            ],
          };
          assert.equal(
            (
              await request("PATCH", `${ownerPath}/settings`, {
                actor: professional,
                body,
                origin: "https://other.invalid",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request("PATCH", `${ownerPath}/settings`, {
                actor: professional,
                body,
                contentType: "text/plain",
              })
            ).status,
            415,
          );
          assert.equal(
            (
              await request("PATCH", `${ownerPath}/settings`, {
                actor: professional,
                body: { ...body, ownerId: customer.user.id },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("PATCH", `${ownerPath}/settings`, {
                actor: professional,
                body: { ...body, note: "x".repeat(17000) },
              })
            ).status,
            413,
          );
          assert.equal(
            (
              await request("PATCH", `${ownerPath}/settings`, {
                actor: professional,
                body: { ...body, timezone: "Not/AZone" },
              })
            ).status,
            400,
          );
          const saved = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body,
          });
          assert.equal(saved.status, 200);
          settings = saved.data.settings;
          assert.equal(settings.version, 1);
          [serviceId, otherServiceId] = settings.services.map((row) => row.id);
          assert.equal(
            (await request("PATCH", `${ownerPath}/settings`, { actor: professional, body })).status,
            409,
          );
          assert.equal(
            (
              await request(
                "GET",
                `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07&customerId=x`,
              )
            ).status,
            400,
          );
          const failedSave = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings, {
              services: [
                { ...settings.services[0], priceMinor: 1 },
                { ...settings.services[1], id: randomUUID() },
              ],
            }),
          });
          assert.ok([400, 409].includes(failedSave.status));
          assert.deepEqual(
            (await request("GET", `${ownerPath}/settings`, { actor: professional })).data.settings,
            settings,
          );
        },
      );

      await t.test(
        "two concurrent customers and different services cannot hold the same business interval",
        async () => {
          const initial = await request(
            "GET",
            `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07`,
          );
          assert.equal(initial.status, 200);
          assert.equal(initial.data.timezone, "Europe/Sarajevo");
          assert.equal(initial.data.slots[0].startsAt, "2030-01-07T08:00:00.000Z");
          assert.equal(initial.data.configurationVersion, settings.version);
          const bodies = [serviceId, otherServiceId].map((id) =>
            quote(id, initial.data.slots[0].startsAt, initial.data.configurationVersion),
          );
          const keys = [randomUUID(), randomUUID()];
          const locker = await pool.connect();
          let pending;
          try {
            await locker.query("BEGIN");
            await locker.query("SELECT id FROM directory_business WHERE id = $1 FOR UPDATE", [
              business.id,
            ]);
            pending = Promise.all(
              [customer, other].map((actor, index) =>
                request("POST", `${publicPath}/requests`, {
                  actor,
                  body: bodies[index],
                  key: keys[index],
                }),
              ),
            );
            await waitForLockWaiters(pool, applicationName);
          } finally {
            await locker.query("ROLLBACK");
            locker.release();
          }
          const results = await pending;
          assert.deepEqual(results.map((row) => row.status).sort(), [201, 409]);
          const index = results.findIndex((row) => row.status === 201);
          winner = results[index].data.entry;
          winnerActor = [customer, other][index];
          winnerKey = keys[index];
          winnerBody = bodies[index];
          assert.equal(winner.status, "requested");
          assert.equal(winner.kind, "customer");
          const nextAppointment = await readNextAppointment(
            pool,
            winnerActor.user.id,
            new Date(winner.startsAt),
          );
          assert.equal(nextAppointment.id, winner.id);
          assert.equal(nextAppointment.kind, "service");
          assert.equal(nextAppointment.status, "requested");
          assert.equal(
            await readNextAppointment(pool, professional.user.id, new Date(winner.startsAt)),
            null,
          );
          assert.equal(winner.timezone, "Europe/Sarajevo");
          assert.equal(await count("booking_entry"), 1);
          assert.equal(await count("booking_create_commands"), 1);
          assert.deepEqual(await events(winner.id), [
            {
              actor_user_id: winnerActor.user.id,
              action: "create",
              previous_status: null,
              next_status: "requested",
              previous_version: 0,
              next_version: 1,
            },
          ]);
          await deniedCredit(winner.id);
          assert.equal(await count("booking_completion_credit"), 0);
          const held = await request(
            "GET",
            `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07`,
          );
          assert.equal(
            held.data.slots.some((slot) => slot.startsAt === winner.startsAt),
            false,
            "Requested entries already occupy the slot.",
          );
          await assert.rejects(
            pool.query(
              `INSERT INTO booking_entry
          (id,business_id,business_owner_user_id,business_title,customer_user_id,created_by_user_id,kind,status,service_id,service_name,duration_minutes,price_minor,timezone,starts_at,ends_at)
          SELECT $1,business_id,business_owner_user_id,business_title,customer_user_id,created_by_user_id,kind,status,service_id,service_name,duration_minutes,price_minor,timezone,starts_at,ends_at FROM booking_entry WHERE id=$2`,
              [randomUUID(), winner.id],
            ),
            (error) => error.code === "23P01",
          );
          assert.equal(
            await count("booking_entry"),
            1,
            "The actual database guard must reject an overlapping direct insertion too.",
          );
        },
      );

      await t.test(
        "expected booking actor binds every private read, write and historical receipt to the signed account",
        async () => {
          const before = await bookingSnapshot();
          const expectedAccountId = operator.user.id;
          const commands = [
            ["GET", "/mine", { actor: winnerActor }],
            ["GET", `${ownerPath}/settings`, { actor: professional }],
            [
              "GET",
              `${ownerPath}/calendar?from=2030-01-07T00:00:00.000Z&to=2030-01-08T00:00:00.000Z`,
              { actor: professional },
            ],
            [
              "PATCH",
              `${ownerPath}/settings`,
              { actor: professional, body: settingsInput(settings) },
            ],
            [
              "POST",
              `${ownerPath}/entries`,
              {
                actor: professional,
                key: randomUUID(),
                body: {
                  kind: "block",
                  startsAt: "2030-01-20T08:00:00.000Z",
                  endsAt: "2030-01-20T09:00:00.000Z",
                  configurationVersion: settings.version,
                },
              },
            ],
            [
              "POST",
              `${publicPath}/requests`,
              {
                actor: customer,
                key: randomUUID(),
                body: quote(serviceId, "2030-01-20T10:00:00.000Z"),
              },
            ],
            [
              "POST",
              `/entries/${winner.id}/action`,
              { actor: professional, body: { action: "approve", expectedVersion: winner.version } },
            ],
            [
              "POST",
              `${publicPath}/requests`,
              { actor: winnerActor, body: winnerBody, key: winnerKey },
            ],
          ];
          for (const [method, route, options] of commands) {
            const response = await request(method, route, { ...options, expectedAccountId });
            assert.equal(response.status, 401, `${method} ${route}`);
            assert.equal(response.data.code, "ACCOUNT_IDENTITY_CHANGED");
          }
          assert.deepEqual(await bookingSnapshot(), before);
          const allowed = await request("GET", "/mine", {
            actor: winnerActor,
            expectedAccountId: winnerActor.user.id,
          });
          assert.equal(allowed.status, 200);
          assert.equal(
            allowed.data.entries.some((row) => row.id === winner.id),
            true,
          );
          assert.equal(
            (
              await request("GET", `${ownerPath}/settings`, {
                actor: professional,
                expectedAccountId: professional.user.id,
              })
            ).status,
            200,
          );
          const malformed = await request("GET", "/mine", {
            actor: customer,
            expectedAccountId: "invalid/actor",
          });
          assert.equal(malformed.status, 400);
          assert.equal(malformed.data.code, "INVALID_BOOKING_INPUT");
          assert.equal((await request("GET", publicPath)).status, 200);
        },
      );

      await t.test(
        "expected booking identity is checked inside the current authority lock",
        async () => {
          const before = await bookingSnapshot();
          const approved = await accounts.read(professional.headers);
          const guardedHttp = createBookingHttpHandler({
            service: createBookingService({
              accounts: { ...accounts, read: async () => approved },
              auth,
              pool,
              now: () => new Date(clock),
            }),
            baseURL,
          });
          const locker = await pool.connect();
          let pending;
          try {
            await locker.query("BEGIN");
            await locker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [
              professional.user.id,
            ]);
            pending = request("GET", `${ownerPath}/settings`, {
              actor: professional,
              expectedAccountId: operator.user.id,
              handler: guardedHttp,
            });
            await waitForLockWaiters(pool, applicationName, 1);
          } finally {
            await locker.query("ROLLBACK");
            locker.release();
          }
          const denied = await pending;
          assert.equal(denied.status, 401);
          assert.equal(denied.data.code, "ACCOUNT_IDENTITY_CHANGED");
          assert.deepEqual(await bookingSnapshot(), before);
        },
      );

      await t.test(
        "owner approval, private reads and stale customer actions preserve current versions",
        async () => {
          const stranger = winnerActor === customer ? other : customer;
          assert.ok([403, 404].includes((await action(stranger, winner, "approve")).status));
          assert.equal(
            (await action(winnerActor, winner, "complete")).status,
            409,
            "The customer cannot complete their own booking.",
          );
          const approved = await action(professional, winner, "approve");
          assert.equal(approved.status, 200);
          assert.equal(approved.data.entry.status, "confirmed");
          assert.equal(approved.data.entry.version, winner.version + 1);
          assert.equal((await action(winnerActor, winner, "cancel")).status, 409);
          assert.deepEqual(await events(winner.id), [
            {
              actor_user_id: winnerActor.user.id,
              action: "create",
              previous_status: null,
              next_status: "requested",
              previous_version: 0,
              next_version: 1,
            },
            {
              actor_user_id: professional.user.id,
              action: "approve",
              previous_status: "requested",
              next_status: "confirmed",
              previous_version: 1,
              next_version: 2,
            },
          ]);
          winner = approved.data.entry;
          const mine = await request("GET", "/mine", { actor: winnerActor });
          assert.equal(mine.status, 200);
          assert.deepEqual(
            mine.data.entries.map((entry) => entry.id),
            [winner.id],
          );
          assert.equal((await request("GET", "/mine", { actor: stranger })).data.entries.length, 0);
          assert.ok(
            [403, 404].includes(
              (
                await request(
                  "GET",
                  `${ownerPath}/calendar?from=2030-01-07T00:00:00Z&to=2030-01-08T00:00:00Z`,
                  { actor: stranger },
                )
              ).status,
            ),
          );
          const calendar = await request(
            "GET",
            `${ownerPath}/calendar?from=2030-01-07T00:00:00Z&to=2030-01-08T00:00:00Z`,
            { actor: professional },
          );
          assert.equal(calendar.status, 200);
          assert.equal(calendar.data.entries[0].id, winner.id);
          assert.equal(calendar.data.earnedCredits, 0);
          const publicValue = JSON.stringify((await request("GET", publicPath)).data);
          for (const actor of actors) {
            assert.equal(publicValue.includes(actor.user.id), false);
            assert.equal(publicValue.includes(actor.user.email), false);
          }
          const slotsValue = (
            await request("GET", `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07`)
          ).data;
          assert.deepEqual(Object.keys(slotsValue).sort(), [
            "configurationVersion",
            "date",
            "serviceId",
            "slots",
            "timezone",
          ]);
          for (const slot of slotsValue.slots)
            assert.deepEqual(Object.keys(slot).sort(), ["endsAt", "startsAt"]);
        },
      );

      await t.test(
        "create retries replay the current receipt while customer and owner cancellation return slots",
        async () => {
          const replay = await request("POST", `${publicPath}/requests`, {
            actor: winnerActor,
            body: winnerBody,
            key: winnerKey,
          });
          assert.equal(replay.status, 201);
          assert.equal(replay.data.entry.id, winner.id);
          assert.equal(replay.data.entry.status, "confirmed");
          assert.equal(
            (
              await request("POST", `${publicPath}/requests`, {
                actor: winnerActor,
                body: { ...winnerBody, startsAt: "2030-01-07T09:00:00.000Z" },
                key: winnerKey,
              })
            ).status,
            409,
          );
          assert.equal(await count("booking_entry"), 1);
          assert.equal(
            (await events(winner.id)).length,
            2,
            "Retries and rejected payloads do not add audit events.",
          );
          const cancelled = await action(winnerActor, winner, "cancel");
          assert.equal(cancelled.status, 200);
          assert.equal(cancelled.data.entry.status, "cancelled");
          assert.equal(
            await readNextAppointment(pool, winnerActor.user.id, new Date(winner.startsAt)),
            null,
          );
          assert.deepEqual((await events(winner.id)).at(-1), {
            actor_user_id: winnerActor.user.id,
            action: "cancel",
            previous_status: "confirmed",
            next_status: "cancelled",
            previous_version: 2,
            next_version: 3,
          });
          assert.equal(
            (
              await request("GET", `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07`)
            ).data.slots.some((slot) => slot.startsAt === winner.startsAt),
            true,
          );
          const next = await request("POST", `${publicPath}/requests`, {
            actor: customer,
            body: quote(serviceId, "2030-01-07T09:00:00.000Z"),
            key: randomUUID(),
          });
          assert.equal(next.status, 201);
          assert.equal((await action(professional, next.data.entry, "cancel")).status, 200);
          assert.equal(
            (
              await request("GET", `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-07`)
            ).data.slots.some((slot) => slot.startsAt === next.data.entry.startsAt),
            true,
          );
          const declined = await request("POST", `${publicPath}/requests`, {
            actor: customer,
            body: quote(serviceId, "2030-01-07T09:00:00.000Z"),
            key: randomUUID(),
          });
          assert.equal(declined.status, 201);
          assert.equal(
            (await action(professional, declined.data.entry, "decline")).data.entry.status,
            "declined",
          );
          assert.equal(await count("booking_completion_credit"), 0);
        },
      );

      await t.test(
        "service snapshots persist and an ended confirmed customer booking awards exactly five once",
        async () => {
          const created = await request("POST", `${publicPath}/requests`, {
            actor: customer,
            body: quote(serviceId, "2030-01-07T10:00:00.000Z"),
            key: randomUUID(),
          });
          assert.equal(created.status, 201);
          let entry = (await action(professional, created.data.entry, "approve")).data.entry;
          assert.equal(entry.status, "confirmed");
          const snapshot = {
            serviceName: entry.serviceName,
            durationMinutes: entry.durationMinutes,
            priceMinor: entry.priceMinor,
            timezone: entry.timezone,
          };
          assert.equal(snapshot.priceMinor, 4250);
          assert.equal(
            (await action(professional, entry, "complete")).status,
            409,
            "Future appointments cannot be completed early.",
          );
          const changed = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings, {
              services: settings.services.map((row) => ({
                ...row,
                name: `${row.name} updated`,
                priceMinor: 9900,
                durationMinutes: 45,
              })),
            }),
          });
          assert.equal(changed.status, 200);
          settings = changed.data.settings;
          const oldQuote = await request("POST", `${publicPath}/requests`, {
            actor: customer,
            key: randomUUID(),
            body: quote(serviceId, "2030-01-09T10:00:00.000Z", settings.version - 1),
          });
          assert.equal(oldQuote.status, 409);
          assert.equal(oldQuote.data.code, "BOOKING_CONFIGURATION_CHANGED");
          const oldReceipt = await request("POST", `${publicPath}/requests`, {
            actor: winnerActor,
            body: winnerBody,
            key: winnerKey,
          });
          assert.equal(oldReceipt.status, 201);
          assert.equal(oldReceipt.data.entry.id, winner.id);
          assert.equal(oldReceipt.data.entry.status, "cancelled");
          entry = (await request("GET", "/mine", { actor: customer })).data.entries.find(
            (row) => row.id === entry.id,
          );
          assert.deepEqual(
            {
              serviceName: entry.serviceName,
              durationMinutes: entry.durationMinutes,
              priceMinor: entry.priceMinor,
              timezone: entry.timezone,
            },
            snapshot,
          );
          clock = new Date(Date.parse(entry.endsAt) + 60_000);
          const completed = await action(professional, entry, "complete");
          assert.equal(completed.status, 200);
          assert.equal(completed.data.entry.status, "completed");
          assert.equal(
            (await action(professional, completed.data.entry, "complete")).status,
            409,
            "Repeating completion must not award again.",
          );
          const credits = (
            await pool.query(
              "SELECT entry_id, business_id, recipient_user_id, amount FROM booking_completion_credit ORDER BY entry_id",
            )
          ).rows;
          assert.deepEqual(credits, [
            {
              entry_id: entry.id,
              business_id: business.id,
              recipient_user_id: professional.user.id,
              amount: 5,
            },
          ]);
          await deniedCredit(entry.id, business.id, operator.user.id);
          await deniedCredit(entry.id, randomUUID(), professional.user.id);
          assert.equal(await count("booking_completion_credit"), 1);
          assert.equal((await events(entry.id)).length, completed.data.entry.version);
          assert.deepEqual((await events(entry.id)).at(-1), {
            actor_user_id: professional.user.id,
            action: "complete",
            previous_status: "confirmed",
            next_status: "completed",
            previous_version: 2,
            next_version: 3,
          });
          assert.equal((await request("GET", "/mine", { actor: professional })).data.credits, 5);
          assert.equal((await request("GET", "/mine", { actor: operator })).data.credits, 0);
          assert.equal((await request("GET", "/mine", { actor: customer })).data.credits, 0);
        },
      );

      await t.test(
        "manual appointments and busy blocks use real occupancy but never create completion credits",
        async () => {
          const created = await request("POST", `${ownerPath}/entries`, {
            actor: professional,
            key: randomUUID(),
            body: {
              kind: "manual",
              serviceId,
              configurationVersion: settings.version,
              startsAt: "2030-01-08T08:00:00.000Z",
              clientName: "Offline fixture",
              clientPhone: "+38761123456",
            },
          });
          assert.equal(created.status, 201);
          assert.equal(created.data.entry.status, "confirmed");
          assert.equal(created.data.entry.kind, "manual");
          assert.equal(created.data.entry.customerId, null);
          clock = new Date(Date.parse(created.data.entry.endsAt) + 60_000);
          assert.equal(
            (await action(professional, created.data.entry, "complete")).data.entry.status,
            "completed",
          );
          assert.equal(await count("booking_completion_credit"), 1);
          await deniedCredit(created.data.entry.id);
          assert.equal(
            await count("booking_completion_credit"),
            1,
            "A directly inserted credit for a completed manual booking is forbidden too.",
          );
          const block = await request("POST", `${ownerPath}/entries`, {
            actor: professional,
            key: randomUUID(),
            body: {
              kind: "block",
              configurationVersion: settings.version,
              startsAt: "2030-01-08T10:00:00.000Z",
              endsAt: "2030-01-08T11:00:00.000Z",
            },
          });
          assert.equal(block.status, 201);
          assert.equal(block.data.entry.kind, "block");
          assert.equal(
            (
              await request("POST", `${publicPath}/requests`, {
                actor: customer,
                key: randomUUID(),
                body: quote(serviceId, block.data.entry.startsAt),
              })
            ).status,
            409,
          );
          assert.ok(
            [400, 409].includes((await action(professional, block.data.entry, "complete")).status),
          );
          assert.equal(
            (await action(professional, block.data.entry, "cancel")).data.entry.status,
            "cancelled",
          );
          assert.equal(
            (
              await request("GET", `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-08`)
            ).data.slots.some((slot) => slot.startsAt === block.data.entry.startsAt),
            true,
          );
          assert.equal(await count("booking_completion_credit"), 1);
          for (const row of (
            await pool.query("SELECT id,status,version FROM booking_entry ORDER BY id")
          ).rows) {
            const history = await events(row.id);
            assert.equal(history.length, row.version);
            assert.equal(history[0].action, "create");
            assert.equal(history[0].previous_status, null);
            assert.equal(history.at(-1).next_status, row.status);
            for (const [index, event] of history.entries()) {
              assert.equal(event.previous_version, index);
              assert.equal(event.next_version, index + 1);
              if (index) assert.equal(event.previous_status, history[index - 1].next_status);
              assert.ok(actors.some((actor) => actor.user.id === event.actor_user_id));
            }
          }
        },
      );

      await t.test(
        "online disable and timezone changes use current settings while historical entries keep their snapshot",
        async () => {
          let changed = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings, { enabled: false }),
          });
          assert.equal(changed.status, 200);
          settings = changed.data.settings;
          assert.equal((await request("GET", publicPath)).data.booking.enabled, false);
          assert.equal(
            (
              await request("POST", `${publicPath}/requests`, {
                actor: customer,
                key: randomUUID(),
                body: quote(serviceId, "2030-01-09T08:00:00.000Z"),
              })
            ).status,
            409,
          );
          changed = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings, { enabled: true, timezone: "UTC" }),
          });
          assert.equal(changed.status, 200);
          settings = changed.data.settings;
          const utc = await request(
            "GET",
            `${publicPath}/slots?serviceId=${serviceId}&date=2030-01-09`,
          );
          assert.equal(utc.status, 200);
          assert.equal(utc.data.timezone, "UTC");
          assert.equal(utc.data.slots[0].startsAt, "2030-01-09T09:00:00.000Z");
          const rows = (await pool.query("SELECT DISTINCT timezone FROM booking_entry")).rows;
          assert.deepEqual(rows, [{ timezone: "Europe/Sarajevo" }]);
        },
      );

      await t.test(
        "manual appointments and blocks reject stale configuration without writes and replay reviewed receipts",
        async () => {
          const baseline = settings;
          for (const change of ["price", "duration", "timezone", "schedule", "enabled"]) {
            const previous = settings;
            const patch =
              change === "price"
                ? {
                    services: previous.services.map((row) => ({
                      ...row,
                      priceMinor: row.priceMinor + 100,
                    })),
                  }
                : change === "duration"
                  ? {
                      services: previous.services.map((row) => ({
                        ...row,
                        durationMinutes: 60,
                      })),
                    }
                  : change === "timezone"
                    ? { timezone: "Europe/Sarajevo" }
                    : change === "schedule"
                      ? {
                          windows: previous.windows.map((window) => ({
                            ...window,
                            endMinute: 960,
                          })),
                        }
                      : { enabled: false };
            const saved = await request("PATCH", `${ownerPath}/settings`, {
              actor: professional,
              body: settingsInput(previous, patch),
            });
            assert.equal(saved.status, 200, change);
            settings = saved.data.settings;
            const inputs = [
                {
                  kind: "manual",
                  serviceId,
                  startsAt: "2030-01-09T18:00:00.000Z",
                  clientName: "Reviewed offline fixture",
                },
                {
                  kind: "block",
                  startsAt: "2030-01-09T20:00:00.000Z",
                  endsAt: "2030-01-09T21:00:00.000Z",
                },
              ],
              receipts = [];
            for (const input of inputs) {
              const key = randomUUID(),
                snapshot = await bookingSnapshot(),
                stale = await request("POST", `${ownerPath}/entries`, {
                  actor: professional,
                  key,
                  body: { ...input, configurationVersion: previous.version },
                });
              assert.equal(stale.status, 409, `${change}: ${input.kind}`);
              assert.equal(stale.data.code, "BOOKING_CONFIGURATION_CHANGED");
              assert.deepEqual(
                await bookingSnapshot(),
                snapshot,
                "A stale owner quote cannot create an entry, receipt, audit event or credit.",
              );
              const body = { ...input, configurationVersion: settings.version },
                created = await request("POST", `${ownerPath}/entries`, {
                  actor: professional,
                  key,
                  body,
                });
              assert.equal(created.status, 201);
              assert.equal(created.data.entry.timezone, settings.timezone);
              if (input.kind === "manual") {
                const reviewedService = settings.services.find((row) => row.id === serviceId);
                assert.ok(reviewedService);
                assert.equal(created.data.entry.priceMinor, reviewedService.priceMinor);
                assert.equal(created.data.entry.durationMinutes, reviewedService.durationMinutes);
                assert.equal(
                  Date.parse(created.data.entry.endsAt) - Date.parse(created.data.entry.startsAt),
                  reviewedService.durationMinutes * 60_000,
                );
              }
              const cancelled = await action(professional, created.data.entry, "cancel");
              assert.equal(cancelled.status, 200);
              receipts.push({ key, body, entry: cancelled.data.entry });
            }
            const changedAgain = await request("PATCH", `${ownerPath}/settings`, {
              actor: professional,
              body: settingsInput(settings),
            });
            assert.equal(changedAgain.status, 200);
            settings = changedAgain.data.settings;
            const snapshot = await bookingSnapshot();
            for (const receipt of receipts) {
              const replay = await request("POST", `${ownerPath}/entries`, {
                actor: professional,
                key: receipt.key,
                body: receipt.body,
              });
              assert.equal(replay.status, 201);
              assert.deepEqual(replay.data.entry, receipt.entry);
              const differentIntent = await request("POST", `${ownerPath}/entries`, {
                actor: professional,
                key: receipt.key,
                body: { ...receipt.body, configurationVersion: settings.version },
              });
              assert.equal(differentIntent.status, 409);
              assert.equal(differentIntent.data.code, "IDEMPOTENCY_CONFLICT");
            }
            assert.deepEqual(await bookingSnapshot(), snapshot);
          }
          const restored = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(baseline, { expectedVersion: settings.version }),
          });
          assert.equal(restored.status, 200);
          settings = restored.data.settings;
        },
      );

      await t.test(
        "new owner commands require a configuration version while historical omitted-version receipts still replay",
        async () => {
          const body = {
              kind: "block",
              startsAt: "2030-01-09T22:00:00.000Z",
              endsAt: "2030-01-09T23:00:00.000Z",
            },
            key = randomUUID(),
            snapshot = await bookingSnapshot(),
            missing = await request("POST", `${ownerPath}/entries`, {
              actor: professional,
              key,
              body,
            });
          assert.equal(missing.status, 409);
          assert.equal(missing.data.code, "BOOKING_CONFIGURATION_CHANGED");
          assert.deepEqual(await bookingSnapshot(), snapshot);
          const created = await request("POST", `${ownerPath}/entries`, {
            actor: professional,
            key,
            body: { ...body, configurationVersion: settings.version },
          });
          assert.equal(created.status, 201);
          const cancelled = await action(professional, created.data.entry, "cancel");
          assert.equal(cancelled.status, 200);
          // Model a receipt written by the old implementation in this isolated schema only.
          // Its normalized input had these exact fields and no configurationVersion property.
          const historicalFingerprint = createHash("sha256")
            .update(
              JSON.stringify([
                "manual",
                business.id,
                {
                  kind: body.kind,
                  serviceId: null,
                  startsAt: body.startsAt,
                  endsAt: body.endsAt,
                  clientName: null,
                  clientPhone: null,
                },
              ]),
            )
            .digest("hex");
          assert.equal(
            (
              await pool.query(
                "UPDATE booking_create_commands SET fingerprint=$1 WHERE actor_user_id=$2 AND request_id=$3 AND entry_id=$4",
                [historicalFingerprint, professional.user.id, key, created.data.entry.id],
              )
            ).rowCount,
            1,
          );
          const changed = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings),
          });
          assert.equal(changed.status, 200);
          settings = changed.data.settings;
          const beforeReplay = await bookingSnapshot(),
            replay = await request("POST", `${ownerPath}/entries`, {
              actor: professional,
              key,
              body,
            });
          assert.equal(replay.status, 201);
          assert.deepEqual(replay.data.entry, cancelled.data.entry);
          assert.deepEqual(await bookingSnapshot(), beforeReplay);
        },
      );

      await t.test(
        "a business owner's exact session revoked after preflight cannot mutate booking configuration",
        async () => {
          await invalidateAfterPreflight(professional, () =>
            request("PATCH", `${ownerPath}/settings`, {
              actor: professional,
              body: settingsInput(settings),
            }),
          );
          await refreshSession(professional);
          const valid = await request("PATCH", `${ownerPath}/settings`, {
            actor: professional,
            body: settingsInput(settings),
          });
          assert.equal(valid.status, 200);
          assert.equal(valid.data.settings.version, settings.version + 1);
          settings = valid.data.settings;
        },
      );

      await t.test(
        "a request cannot be approved at its start, but the owner can still decline it",
        async () => {
          const beforeClock = clock;
          try {
            clock = new Date("2030-01-11T12:00:00.000Z");
            const created = await request("POST", `${publicPath}/requests`, {
              actor: customer,
              key: randomUUID(),
              body: quote(serviceId, "2030-01-12T09:00:00.000Z"),
            });
            assert.equal(created.status, 201);
            const entry = created.data.entry;
            clock = new Date(entry.startsAt);
            const before = await bookingSnapshot();
            const approved = await action(professional, entry, "approve");
            assert.equal(approved.status, 409);
            assert.equal(approved.data.code, "INVALID_BOOKING_TRANSITION");
            assert.deepEqual(await bookingSnapshot(), before);
            const declined = await action(professional, entry, "decline");
            assert.equal(declined.status, 200);
            assert.equal(declined.data.entry.status, "declined");
            assert.equal(declined.data.entry.version, entry.version + 1);
            assert.equal(await count("booking_completion_credit"), 1);
          } finally {
            clock = beforeClock;
          }
        },
      );

      await t.test(
        "a customer's exact session revoked after preflight cannot create an appointment or receipt",
        async () => {
          const body = quote(serviceId, "2030-01-10T09:00:00.000Z"),
            key = randomUUID();
          await invalidateAfterPreflight(customer, () =>
            request("POST", `${publicPath}/requests`, { actor: customer, body, key }),
          );
          await refreshSession(customer);
          const valid = await request("POST", `${publicPath}/requests`, {
            actor: customer,
            body,
            key,
          });
          assert.equal(valid.status, 201);
          assert.equal(valid.data.entry.status, "requested");
          const cancelled = await action(customer, valid.data.entry, "cancel");
          assert.equal(cancelled.status, 200);
          assert.equal(cancelled.data.entry.status, "cancelled");
          assert.equal(await count("booking_completion_credit"), 1);
        },
      );

      await t.test(
        "customer views paginate nearest active entries and partition history at the exact end without exposing other customers",
        async () => {
          const beforeClock = new Date(clock);
          try {
            clock = new Date("2030-01-20T12:00:00.000Z");
            // Either earlier racing customer may retain history; pagination owns a separate actor.
            for (const view of ["upcoming", "history"]) {
              const empty = await request("GET", `/mine?view=${view}`, {
                actor: paginationCustomer,
              });
              assert.equal(empty.status, 200);
              assert.deepEqual(empty.data.entries, []);
              assert.equal(empty.data.hasMore, false);
            }
            const entries = [];
            for (let index = 0; index < 30; index++) {
              const startsAt = `2030-01-${21 + Math.floor(index / 6)}T${String(9 + (index % 6)).padStart(2, "0")}:00:00.000Z`;
              const created = await request("POST", `${publicPath}/requests`, {
                actor: paginationCustomer,
                key: randomUUID(),
                body: quote(serviceId, startsAt),
              });
              assert.equal(created.status, 201);
              entries.push(created.data.entry);
            }
            for (const index of [1, 3, 4]) {
              const changed = await action(professional, entries[index], "approve");
              assert.equal(changed.status, 200);
              entries[index] = changed.data.entry;
            }
            for (const [index, command] of [
              [2, "cancel"],
              [28, "cancel"],
              [29, "decline"],
            ]) {
              const changed = await action(professional, entries[index], command);
              assert.equal(changed.status, 200);
              entries[index] = changed.data.entry;
            }
            clock = new Date("2030-01-21T12:45:00.000Z");
            const snapshot = await bookingSnapshot();
            const current = await request("GET", "/mine?view=upcoming&page=1", {
                actor: paginationCustomer,
              }),
              second = await request("GET", "/mine?view=upcoming&page=2", {
                actor: paginationCustomer,
              }),
              history = await request("GET", "/mine?view=history", { actor: paginationCustomer }),
              original = await request("GET", "/mine?page=1", { actor: paginationCustomer });
            assert.equal(current.status, 200);
            assert.equal(current.data.asOf, clock.toISOString());
            assert.equal(current.data.view, "upcoming");
            assert.equal(current.data.entries.length, 20);
            assert.equal(current.data.hasMore, true);
            assert.equal(second.data.hasMore, false);
            assert.deepEqual(
              [...current.data.entries, ...second.data.entries].map((entry) => entry.id),
              entries.slice(4, 28).map((entry) => entry.id),
            );
            assert.deepEqual(
              history.data.entries.map((entry) => entry.id),
              [entries[29], entries[28], ...entries.slice(0, 4).toReversed()].map(
                (entry) => entry.id,
              ),
            );
            assert.equal(
              new Set(
                [...current.data.entries, ...second.data.entries, ...history.data.entries].map(
                  (entry) => entry.id,
                ),
              ).size,
              30,
              "Every own entry appears in exactly one view, including the appointment ending at the cutoff.",
            );
            assert.equal(original.data.entries[0].id, entries[29].id);
            assert.equal(Object.hasOwn(original.data, "view"), false);
            assert.equal(Object.hasOwn(original.data, "asOf"), false);
            assert.equal(
              (await request("GET", "/mine?view=history", { actor: customer })).data.entries.some(
                (entry) => entry.status === "completed",
              ),
              true,
            );
            assert.equal(
              (await request("GET", "/mine?view=upcoming", { actor: professional })).data.entries
                .length,
              0,
            );
            assert.equal(
              (await request("GET", "/mine?view=history", { actor: professional })).data.entries
                .length,
              0,
            );
            for (const path of [
              "/mine?view=all",
              "/mine?view=upcoming&view=history",
              "/mine?view=history&page=501",
            ])
              assert.equal((await request("GET", path, { actor: paginationCustomer })).status, 400);
            assert.deepEqual(
              await bookingSnapshot(),
              snapshot,
              "View reads do not change bookings, events or credits.",
            );
            clock = new Date("2030-01-21T13:15:00.000Z");
            assert.equal(
              (await request("GET", "/mine?view=upcoming", { actor: paginationCustomer })).data
                .entries[0].id,
              entries[4].id,
              "An appointment in progress remains current.",
            );
            clock = new Date("2030-01-21T13:45:00.000Z");
            assert.equal(
              (
                await request("GET", "/mine?view=history", { actor: paginationCustomer })
              ).data.entries.some((entry) => entry.id === entries[4].id),
              true,
            );
            assert.equal(
              (
                await request("GET", "/mine?view=upcoming", { actor: paginationCustomer })
              ).data.entries.some((entry) => entry.id === entries[4].id),
              false,
            );
            clock = new Date("2030-01-26T00:00:00.000Z");
            const older = await request("GET", "/mine?view=history&page=1", {
                actor: paginationCustomer,
              }),
              oldest = await request("GET", "/mine?view=history&page=2", {
                actor: paginationCustomer,
              });
            assert.equal(older.data.hasMore, true);
            assert.equal(oldest.data.hasMore, false);
            assert.deepEqual(
              [...older.data.entries, ...oldest.data.entries].map((entry) => entry.id),
              entries.toReversed().map((entry) => entry.id),
            );
            assert.equal(
              (await request("GET", "/mine?view=upcoming", { actor: paginationCustomer })).data
                .entries.length,
              0,
            );
          } finally {
            clock = beforeClock;
          }
        },
      );

      await t.test(
        "private booking reads reject exact sessions revoked or expired while waiting for authority",
        async () => {
          for (const invalidation of ["revoke", "expire", "expire-session-lock"]) {
            await invalidateAfterPreflight(
              other,
              (handler) => request("GET", "/mine", { actor: other, handler }),
              invalidation,
            );
            await refreshSession(other);
            assert.equal((await request("GET", "/mine", { actor: other })).status, 200);
          }
          assert.equal((await request("GET", publicPath)).status, 200);
        },
      );

      await testBusinessToday(t, { pool, accounts, operator, customer, business, baseURL });
      await testAccommodation(t, {
        pool,
        auth,
        directory,
        baseURL,
        operator,
        owner: other,
        customer,
        other: paginationCustomer,
        unrelatedBusiness: business.id,
        waitForTwoWriters: () => waitForLockWaiters(pool, applicationName),
      });
      await testVehicleRentals(t, {
        pool,
        auth,
        directory,
        baseURL,
        operator,
        owner: paginationCustomer,
        customer,
        other,
        unrelatedBusiness: business.id,
        waitForTwoWriters: () => waitForLockWaiters(pool, applicationName),
      });
      await t.test(
        "booking activity follows the other party across all three calendars",
        async () => {
          for (const kind of ["service", "rental", "stay"]) {
            const { rows } = await pool.query(
              "SELECT action,owner_side,recipient_id FROM account_activity WHERE kind=$1",
              [kind],
            );
            assert.ok(rows.some((row) => row.action === "request" && row.owner_side));
            assert.ok(rows.some((row) => row.action === "approve" && !row.owner_side));
            assert.ok(rows.some((row) => row.action === "cancel"));
            assert.ok(rows.every((row) => row.recipient_id));
          }
          const unrelated = await pool.query(`SELECT count(*)::int AS n FROM account_activity a
          JOIN booking_entry e ON a.kind='service' AND e.id=a.subject_id WHERE e.kind<>'customer'`);
          assert.equal(unrelated.rows[0].n, 0);
        },
      );
      await t.test(
        "revoked sessions cannot read or create bookings and the isolated fixture preserves other schemas",
        async () => {
          await accounts.decide(operator.headers, customer.user.id, {
            approval: "suspended",
            expected: "approved",
          });
          assert.equal((await request("GET", "/mine", { actor: customer })).status, 401);
          for (const view of ["upcoming", "history"])
            assert.equal(
              (await request("GET", `/mine?view=${view}`, { actor: customer })).status,
              401,
            );
          assert.equal(
            (
              await request("POST", `${publicPath}/requests`, {
                actor: customer,
                key: randomUUID(),
                body: quote(serviceId, "2030-01-09T09:00:00.000Z"),
              })
            ).status,
            401,
          );
          assert.equal(await count("booking_completion_credit"), 1);
          assert.equal(outboundAttempts, 0);
          assert.deepEqual(await outsideTables(administration, schema), outside);
        },
      );
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
