import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";

const baseURL = "https://billing-ci.ahibizz.invalid";
const password = "Billing-isolated-fixture-only-728!";
async function outside(pool, schema) {
  return (
    await pool.query(
      "SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' AND schemaname<>$1 ORDER BY schemaname,tablename",
      [schema],
    )
  ).rows;
}
async function waiter(pool, applicationName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      (
        await pool.query(
          "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [applicationName],
        )
      ).rows[0].n >= 1
    )
      return;
    await delay(20);
  }
  throw Error("Billing request did not reach the held authority lock.");
}

test("real isolated confirmed-receipt ledger, accounting corrections and current owner authority", {
  timeout: 120000,
}, async (t) => {
  const configuration = integrationConfiguration(process.env);
  const suffix = randomBytes(10).toString("hex"),
    schema = `ci_billing_${suffix}`,
    applicationName = `billing-ci-${suffix}`;
  assert.match(schema, /^ci_billing_[a-f0-9]{20}$/);
  const { Pool } = await import("pg");
  const administration = new Pool({ ...configuration, max: 1 });
  administration.on("error", () => {});
  const oldFetch = globalThis.fetch;
  let pool,
    created = false,
    outbound = 0;
  try {
    assert.deepEqual(
      (await administration.query("SELECT current_database() AS db,current_user AS role")).rows,
      [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
    );
    const untouched = await outside(administration, schema);
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
    assert.equal(migrations.at(-1).version, "0034_wallet_package_periods.sql");
    assert.equal((await runMigrations({ pool, migrations })).applied.length, migrations.length);
    assert.deepEqual(await runMigrations({ pool, migrations }), { applied: [] });
    globalThis.fetch = async () => {
      outbound++;
      throw Error("External HTTP forbidden in billing acceptance.");
    };
    const { createAuthService, createAccountService, bootstrapInitialOwner, readCurrentAuthUser } =
      await import("../../src/server/auth/index.ts");
    const { createAuthHttpHandler } = await import("../../src/server/auth-http.ts");
    const capture = new Map();
    const auth = createAuthService({
      pool,
      baseURL,
      production: true,
      secret: `billing-fixture-${randomBytes(32).toString("hex")}`,
      sendEmail: async (message) => {
        assert.equal(message.kind, "verification");
        assert.ok(message.to.endsWith("@billing-fixture.invalid"));
        capture.set(message.to, message.url);
      },
    });
    const authHttp = createAuthHttpHandler({
      auth,
      baseURL,
      readUser: (id) => readCurrentAuthUser(pool, id),
    });
    async function authCall(method, path, body) {
      return authHttp(
        new Request(new URL(path, baseURL), {
          method,
          headers: {
            origin: baseURL,
            "user-agent": "Isolated billing acceptance",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    }
    const actors = [];
    for (let index = 0; index < 3; index++) {
      const email = `actor-${index}@billing-fixture.invalid`;
      assert.equal(
        (
          await authCall("POST", "/api/auth/sign-up/email", {
            name: `Billing fixture ${index}`,
            email,
            password,
          })
        ).status,
        200,
      );
      assert.ok([200, 302].includes((await authCall("GET", capture.get(email))).status));
      if (index === 0) await bootstrapInitialOwner(pool, email);
      else
        await pool.query("UPDATE auth_user SET role=$1,approval='approved' WHERE email=$2", [
          index === 1 ? "owner" : "member",
          email,
        ]);
      const signed = await authCall("POST", "/api/auth/sign-in/email", { email, password });
      assert.equal(signed.status, 200);
      const headers = new Headers({
        origin: baseURL,
        cookie: signed.headers
          .getSetCookie()
          .map((line) => line.split(";", 1)[0])
          .join("; "),
      });
      const session = await auth.api.getSession({ headers });
      headers.set("X-AhiBizz-Account-ID", session.user.id);
      actors.push({ headers, user: session.user, session: session.session });
    }
    const [owner, second, member] = actors,
      accounts = createAccountService({ auth, pool });
    await t.test(
      "account deletion requests and content reports use an owner-only inbox",
      async () => {
        const { verifySupportRequests } = await import("./support-cases.mjs");
        await verifySupportRequests({ auth, pool, owner, member });
      },
    );
    await t.test(
      "appearance drafts are owner-only, survive reload and publish atomically",
      async () => {
        const { verifyDesignStore } = await import("./design-cases.mjs");
        await verifyDesignStore({ auth, pool, owner, second, member });
      },
    );
    await t.test(
      "community rules require explicit consent from the account contributing content",
      async () => {
        const { verifyCommunityRules } = await import("./community-cases.mjs");
        await verifyCommunityRules({ auth, pool, member, owner, baseURL });
      },
    );
    const { createDirectoryService } = await import("../../src/server/directory/index.ts");
    const directory = createDirectoryService({ accounts, auth, pool });
    const category = await directory.createCategory(owner.headers, {
      name: "Billing services",
      slug: "billing-services",
    });
    await t.test(
      "marketing offers, receipt claims, credit spend and paid banner visibility",
      async () => {
        const { verifyMarketing } = await import("./marketing-cases.mjs");
        await verifyMarketing({ auth, pool, member, owner, second, category });
      },
    );
    const business = await directory.create(
      member.headers,
      { title: "Receipt business", categoryId: category.id },
      randomUUID(),
    );
    const { createBillingService, BillingAccessError } = await import(
      "../../src/server/billing/index.ts"
    );
    const { createBillingHttpHandler } = await import("../../src/server/billing-http.ts");
    const now = () => new Date("2030-01-02T12:00:00Z");
    const billing = createBillingService({ accounts, auth, pool, now }),
      handle = createBillingHttpHandler({ service: billing, baseURL });
    async function call(
      method,
      path,
      {
        actor = owner,
        body,
        key,
        origin = baseURL,
        expectedAccountId,
        contentType = "application/json",
      } = {},
    ) {
      const headers = new Headers(actor?.headers);
      headers.set("origin", origin);
      if (expectedAccountId !== undefined) headers.set("X-AhiBizz-Account-ID", expectedAccountId);
      if (body !== undefined) headers.set("content-type", contentType);
      if (key) headers.set("Idempotency-Key", key);
      const response = await handle(
        new Request(new URL(`/api/billing/${path}`, baseURL), {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      return { status: response.status, data: await response.json() };
    }
    const denied = (action, status, code) =>
      assert.rejects(
        action,
        (error) =>
          error instanceof BillingAccessError &&
          error.status === status &&
          (!code || error.code === code),
      );
    const rowCounts = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            "billing_receipt",
            "billing_create_command",
            "billing_receipt_event",
            "billing_development_ledger",
          ].map(async (table) => [
            table,
            (await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n,
          ]),
        ),
      );
    const protectedSnapshot = async () => ({
      users: (
        await pool.query('SELECT id,role,approval,"emailVerified" FROM auth_user ORDER BY id')
      ).rows,
      quota: (await directory.listOwn(member.headers)).items.map((row) => row.id),
      credits: (await pool.query("SELECT count(*)::integer AS n FROM booking_completion_credit"))
        .rows[0].n,
      entitlements: (
        await pool.query("SELECT count(*)::integer AS n FROM personal_profile_entitlement")
      ).rows[0].n,
    });
    const protectedBefore = await protectedSnapshot();
    const annual = {
      kind: "subscription",
      packageId: "basic",
      period: "annual",
      businessId: business.id,
      source: "bank",
      externalReference: "BANK-ANNUAL-001",
      receivedAt: "2030-01-01T12:00:00Z",
      grossMinor: 10000,
      taxMinor: null,
      feeMinor: null,
      serviceStartsOn: "2030-01-01",
      serviceEndsOn: "2031-01-01",
    };
    let receipt;
    const command = randomUUID();

    await t.test(
      "catalog is public while all ledger actions require the current owner and expected actor",
      async () => {
        const catalog = await call("GET", "catalog", { actor: null });
        assert.equal(catalog.status, 200);
        assert.equal(catalog.data.catalog.packages[0].annualMinor, 29000);
        assert.equal(catalog.data.catalog.monthlyCommitmentMonths, 12);
        assert.equal(catalog.data.actor, undefined);
        for (const path of [
          "admin",
          "admin/development",
          "admin/businesses",
          "admin/receipts/11111111-1111-4111-8111-111111111111",
          `admin/commands/${command}`,
        ])
          assert.equal((await call("GET", path, { actor: member })).status, 403);
        assert.equal(
          (await call("POST", "admin/receipts", { actor: member, body: annual, key: command }))
            .status,
          403,
        );
        assert.equal(
          (await call("GET", "admin", { expectedAccountId: second.user.id })).data.code,
          "ACCOUNT_IDENTITY_CHANGED",
        );
        assert.equal((await call("GET", "admin", { expectedAccountId: "invalid/id" })).status, 400);
        assert.equal(
          (
            await call("POST", "admin/receipts", {
              body: annual,
              key: command,
              origin: "https://foreign.invalid",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await call("POST", "admin/receipts", {
              body: annual,
              key: command,
              contentType: "text/plain",
            })
          ).status,
          415,
        );
        assert.equal((await call("GET", "admin?unexpected=1")).status, 400);
        assert.equal((await call("GET", "admin?page=1&page=2")).status, 400);
        assert.deepEqual(await rowCounts(), {
          billing_receipt: 0,
          billing_create_command: 0,
          billing_receipt_event: 0,
          billing_development_ledger: 0,
        });
      },
    );
    await t.test(
      "concurrent exact commands create once and snapshot price separately from actual cash",
      async () => {
        const results = await Promise.all([
          call("POST", "admin/receipts", { body: annual, key: command }),
          call("POST", "admin/receipts", { body: annual, key: command }),
        ]);
        assert.deepEqual(
          results.map((row) => row.status),
          [201, 201],
        );
        assert.equal(results[0].data.receipt.id, results[1].data.receipt.id);
        receipt = results[0].data.receipt;
        assert.equal(receipt.grossMinor, 10000);
        assert.equal(receipt.quotedPriceMinor, 29000);
        assert.equal(receipt.commitmentMonths, 12);
        assert.equal(receipt.commitmentTotalMinor, 29000);
        assert.equal(receipt.catalogVersion, 1);
        assert.equal(receipt.serviceStartsOn, "2030-01-01");
        assert.equal(receipt.serviceEndsOn, "2031-01-01");
        assert.equal(receipt.developmentRateBps, 2000);
        assert.equal(receipt.netBaseMinor, null);
        assert.equal(receipt.developmentMinor, null);
        assert.equal(receipt.allocationStatus, "pending");
        assert.equal((await call("GET", `admin/commands/${command}`)).data.receipt.id, receipt.id);
        assert.equal(
          (await call("GET", `admin/commands/${command}`, { actor: second })).data.receipt,
          null,
        );
        assert.equal(
          (await call("GET", `admin/receipts/${receipt.id}`, { actor: second })).data.receipt.id,
          receipt.id,
        );
        assert.equal(
          (
            await call("POST", "admin/receipts", {
              body: { ...annual, grossMinor: 11000 },
              key: command,
            })
          ).data.code,
          "IDEMPOTENCY_CONFLICT",
        );
        assert.equal(
          (await call("POST", "admin/receipts", { actor: second, body: annual, key: randomUUID() }))
            .data.code,
          "BILLING_REFERENCE_CONFLICT",
        );
        assert.deepEqual(await rowCounts(), {
          billing_receipt: 1,
          billing_create_command: 1,
          billing_receipt_event: 1,
          billing_development_ledger: 0,
        });
      },
    );
    await t.test(
      "known zeros post an earmark and refunds/unknown deductions append exact reversals",
      async () => {
        async function adjust(refundedMinor, taxMinor, feeMinor) {
          const result = await call("PATCH", `admin/receipts/${receipt.id}`, {
            body: {
              expectedVersion: receipt.version,
              refundedMinor,
              taxMinor,
              feeMinor,
              reason: "Potvrđeni računovodstveni podaci",
            },
          });
          assert.equal(result.status, 200);
          receipt = result.data.receipt;
        }
        await adjust(0, 0, 0);
        assert.equal(receipt.netBaseMinor, 10000);
        assert.equal(receipt.developmentMinor, 2000);
        await adjust(2500, 700, 100);
        assert.equal(receipt.netBaseMinor, 6700);
        assert.equal(receipt.developmentMinor, 1340);
        await adjust(2500, 700, null);
        assert.equal(receipt.netBaseMinor, null);
        assert.equal(receipt.developmentMinor, null);
        assert.equal(receipt.allocationStatus, "pending");
        await adjust(2500, 0, 0);
        assert.equal(receipt.developmentMinor, 1500);
        await adjust(10000, 0, 0);
        assert.equal(receipt.netBaseMinor, 0);
        assert.equal(receipt.developmentMinor, 0);
        assert.equal(receipt.grossMinor, 10000);
        const ledger = await billing.listDevelopment(owner.headers);
        assert.ok(
          ledger.developmentEntries.every(
            (entry) => entry.externalReference === annual.externalReference,
          ),
        );
        assert.deepEqual(
          ledger.developmentEntries.map((row) => row.deltaMinor).sort((a, b) => a - b),
          [-1500, -1340, -660, 1500, 2000],
        );
        assert.equal(
          ledger.developmentEntries.reduce((sum, row) => sum + row.deltaMinor, 0),
          0,
        );
        assert.equal(
          (await call("GET", `admin/commands/${command}`)).data.receipt.version,
          receipt.version,
        );
        assert.equal(
          (await call("POST", "admin/receipts", { body: annual, key: command })).data.receipt
            .version,
          receipt.version,
        );
      },
    );
    await t.test(
      "stale, decreasing or malformed corrections do not alter financial facts or audit",
      async () => {
        const before = await rowCounts();
        const values = {
          expectedVersion: receipt.version,
          refundedMinor: receipt.refundedMinor,
          taxMinor: 0,
          feeMinor: 0,
          reason: "Correction",
        };
        for (const body of [
          { ...values, expectedVersion: 1 },
          { ...values, refundedMinor: 0 },
          { ...values, refundedMinor: 10001 },
          { ...values, taxMinor: -1 },
          { ...values, reason: "x" },
          { ...values, grossMinor: 1 },
          { ...values, serviceStartsOn: null, serviceEndsOn: null },
        ]) {
          const result = await call("PATCH", `admin/receipts/${receipt.id}`, { body });
          assert.ok([400, 409].includes(result.status));
        }
        assert.equal(
          (await call("PATCH", `admin/receipts/${receipt.id}`, { actor: member, body: values }))
            .status,
          403,
        );
        assert.deepEqual(await rowCounts(), before);
        assert.deepEqual((await billing.readReceipt(owner.headers, receipt.id)).receipt, receipt);
      },
    );
    await t.test(
      "photo/video records are separate and never create development entries",
      async () => {
        const before = await rowCounts();
        const result = await call("POST", "admin/receipts", {
          body: {
            ...annual,
            kind: "photo_video",
            packageId: null,
            period: null,
            businessId: null,
            serviceStartsOn: null,
            serviceEndsOn: null,
            externalReference: "PHOTO-001",
            grossMinor: 12345,
            taxMinor: 0,
            feeMinor: 0,
          },
          key: randomUUID(),
        });
        assert.equal(result.status, 201);
        const photo = result.data.receipt;
        assert.equal(photo.netBaseMinor, 12345);
        assert.equal(photo.developmentMinor, null);
        assert.equal(photo.developmentRateBps, null);
        assert.equal(photo.allocationStatus, "not_applicable");
        assert.equal(photo.catalogVersion, null);
        assert.equal(
          (
            await call("PATCH", `admin/receipts/${photo.id}`, {
              body: {
                expectedVersion: photo.version,
                refundedMinor: 345,
                taxMinor: 0,
                feeMinor: 0,
                reason: "Stvarna korekcija primitka",
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (await rowCounts()).billing_development_ledger,
          before.billing_development_ledger,
        );
      },
    );
    await t.test(
      "paginated summary includes all receipts and distinguishes unknown net from known zero",
      async () => {
        for (let index = 0; index < 31; index++)
          await billing.createReceipt(
            owner.headers,
            {
              ...annual,
              kind: "photo_video",
              packageId: null,
              period: null,
              businessId: null,
              serviceStartsOn: null,
              serviceEndsOn: null,
              externalReference: `PAGE-${index}`,
              grossMinor: 100,
              taxMinor: null,
              feeMinor: null,
            },
            randomUUID(),
          );
        const first = await billing.listAdmin(owner.headers, { page: 1 }),
          secondPage = await billing.listAdmin(owner.headers, { page: 2 });
        const reviewPage = await billing.listAdmin(owner.headers, { page: 1 }, true);
        const expectedRows = [...first.receipts, ...secondPage.receipts].filter(
          (r) => r.allocationStatus === "pending",
        );
        assert.deepEqual(
          reviewPage.receipts.map((r) => r.id),
          expectedRows.slice(0, 30).map((r) => r.id),
        );
        assert.deepEqual(reviewPage.summary, first.summary);
        assert.equal(first.receipts.length, 30);
        assert.equal(first.hasMore, true);
        assert.equal(secondPage.receipts.length, 3);
        assert.equal(secondPage.hasMore, false);
        assert.equal(
          new Set([...first.receipts, ...secondPage.receipts].map((row) => row.id)).size,
          33,
        );
        assert.deepEqual(first.summary, {
          receiptCount: 33,
          grossMinor: 25445,
          refundedMinor: 10345,
          knownNetBaseMinor: 12000,
          unknownNetCount: 31,
          unknownNetCashMinor: 3100,
          allocationPendingCount: 0,
          photoVideoGrossMinor: 15445,
          developmentPostedMinor: 0,
        });
        assert.deepEqual(secondPage.summary, first.summary);
        assert.deepEqual(await protectedSnapshot(), protectedBefore);
        await assert.rejects(
          directory.create(
            member.headers,
            { title: "No paid quota activation", categoryId: category.id },
            randomUUID(),
          ),
          (error) => error.code === "BUSINESS_LIMIT_REACHED",
        );
      },
    );
    await t.test(
      "business selection is bounded, literal and includes archived historical targets only as id/title",
      async () => {
        let item = await directory.create(
          owner.headers,
          { title: "Invoice 50%_\\ fixture", categoryId: category.id },
          randomUUID(),
        );
        item = await directory.archive(owner.headers, item.id, { expectedVersion: item.version });
        for (const q of ["%", "_", "\\", item.id]) {
          const result = await billing.listBusinesses(owner.headers, { q });
          assert.deepEqual(result.businesses, [{ id: item.id, title: item.title }]);
        }
        assert.equal(
          (await call("GET", `admin/businesses?q=${encodeURIComponent("50%_\\")}&page=1`)).data
            .businesses[0].id,
          item.id,
        );
        assert.equal((await call("GET", "admin/businesses?page=1&q=x&q=y")).status, 400);
        await directory.remove(owner.headers, item.id, { expectedVersion: item.version });
        assert.deepEqual(
          (await billing.listBusinesses(owner.headers, { q: item.id })).businesses,
          [],
        );
      },
    );
    await t.test(
      "database constraints reject missing snapshots/null posted amount and immutable history changes",
      async () => {
        for (const patch of [
          { catalog_version: null },
          { quoted_price_minor: null },
          { commitment_months: null },
          { commitment_total_minor: null },
          { development_minor: null },
        ]) {
          await assert.rejects(
            pool.query(
              "INSERT INTO billing_receipt SELECT (jsonb_populate_record(NULL::billing_receipt,to_jsonb(r)||$2::jsonb)).* FROM billing_receipt r WHERE id=$1",
              [
                receipt.id,
                JSON.stringify({ ...patch, id: randomUUID(), external_reference: randomUUID() }),
              ],
            ),
            (error) => error.code === "23514",
          );
        }
        await assert.rejects(
          pool.query(
            "INSERT INTO billing_receipt_event(id,receipt_id,actor_user_id,action,previous_version,next_version,previous_facts,next_facts,development_delta_minor,reason) VALUES($1,$2,$3,'adjust',$4,$5,NULL,'{}',0,'Missing previous facts')",
            [randomUUID(), receipt.id, owner.user.id, receipt.version, receipt.version + 1],
          ),
          (error) => error.code === "23514",
        );
        const photo = (
          await pool.query(
            "SELECT id,version FROM billing_receipt WHERE external_reference='PHOTO-001' AND kind='photo_video'",
          )
        ).rows[0];
        for (const [target, nextFacts] of [
          [receipt, {}],
          [photo, { kind: "subscription" }],
        ]) {
          const guardClient = await pool.connect();
          try {
            await guardClient.query("BEGIN");
            const eventId = randomUUID();
            await guardClient.query(
              "INSERT INTO billing_receipt_event(id,receipt_id,actor_user_id,action,previous_version,next_version,previous_facts,next_facts,development_delta_minor,reason) VALUES($1,$2,$3,'adjust',$4,$5,'{}',$6,0,'Invalid ledger source')",
              [
                eventId,
                target.id,
                owner.user.id,
                target.version,
                target.version + 1,
                JSON.stringify(nextFacts),
              ],
            );
            await assert.rejects(
              guardClient.query(
                "INSERT INTO billing_development_ledger(id,event_id,receipt_id,receipt_version,delta_minor,reason) VALUES($1,$2,$3,$4,0,'Invalid ledger source')",
                [randomUUID(), eventId, target.id, target.version + 1],
              ),
              (error) => error.code === "23514",
            );
          } finally {
            await guardClient.query("ROLLBACK");
            guardClient.release();
          }
        }
        for (const [table, where] of [
          ["billing_receipt", `id='${receipt.id}'`],
          ["billing_create_command", `request_id='${command}'`],
          ["billing_receipt_event", `receipt_id='${receipt.id}'`],
          ["billing_development_ledger", `receipt_id='${receipt.id}'`],
        ])
          await assert.rejects(
            pool.query(`DELETE FROM ${table} WHERE ${where}`),
            (error) => error.code === "23514",
          );
        await assert.rejects(
          pool.query(
            "UPDATE billing_receipt SET gross_minor=gross_minor+1,version=version+1 WHERE id=$1",
            [receipt.id],
          ),
          (error) => error.code === "23514",
        );
      },
    );
    await t.test(
      "a failed development posting rolls back receipt, command and audit atomically",
      async () => {
        const before = await rowCounts(),
          key = randomUUID();
        await pool.query(
          "CREATE FUNCTION billing_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated_failure'; END; $$",
        );
        await pool.query(
          "CREATE TRIGGER billing_fixture_failure BEFORE INSERT ON billing_development_ledger FOR EACH ROW EXECUTE FUNCTION billing_fixture_fail()",
        );
        const body = { ...annual, externalReference: "ATOMIC-001", taxMinor: 0, feeMinor: 0 };
        try {
          await denied(
            () => billing.createReceipt(owner.headers, body, key),
            503,
            "BILLING_UNAVAILABLE",
          );
          assert.deepEqual(await rowCounts(), before);
          assert.equal((await billing.readCommand(owner.headers, key)).receipt, null);
        } finally {
          await pool.query("DROP TRIGGER billing_fixture_failure ON billing_development_ledger");
          await pool.query("DROP FUNCTION billing_fixture_fail()");
        }
        assert.equal(
          (await billing.createReceipt(owner.headers, body, key)).receipt.developmentMinor,
          2000,
        );
        assert.equal((await rowCounts()).billing_receipt, before.billing_receipt + 1);
      },
    );
    await t.test("current owner role is rechecked after an actual row-lock wait", async () => {
      const snapshot = await accounts.read(owner.headers);
      const cached = createBillingService({
        accounts: { ...accounts, read: async () => snapshot },
        auth,
        pool,
        now,
      });
      const blocker = await pool.connect();
      let attempt;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE", [owner.user.id]);
        attempt = cached.listAdmin(owner.headers);
        const rejection = denied(() => attempt, 403, "OWNER_REQUIRED");
        await waiter(administration, applicationName);
        await blocker.query("UPDATE auth_user SET role='member' WHERE id=$1", [owner.user.id]);
        await blocker.query("COMMIT");
        await rejection;
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pool.query("UPDATE auth_user SET role='owner' WHERE id=$1", [owner.user.id]);
      }
    });
    await t.test(
      "session expiry is checked after the signed session lock becomes available",
      async () => {
        const snapshot = await accounts.read(owner.headers),
          original = (
            await pool.query('SELECT "expiresAt" FROM auth_session WHERE id=$1', [owner.session.id])
          ).rows[0].expiresAt;
        const cached = createBillingService({
          accounts: { ...accounts, read: async () => snapshot },
          auth,
          pool,
          now,
        });
        const blocker = await pool.connect();
        let attempt;
        try {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM auth_session WHERE id=$1 FOR UPDATE", [
            owner.session.id,
          ]);
          attempt = cached.listDevelopment(owner.headers);
          const rejection = denied(() => attempt, 401, "AUTHENTICATION_REQUIRED");
          await waiter(administration, applicationName);
          await blocker.query(
            "UPDATE auth_session SET \"expiresAt\"=clock_timestamp()-interval '1 second' WHERE id=$1",
            [owner.session.id],
          );
          await blocker.query("COMMIT");
          await rejection;
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await pool.query('UPDATE auth_session SET "expiresAt"=$1 WHERE id=$2', [
            original,
            owner.session.id,
          ]);
        }
      },
    );
    assert.equal(outbound, 0);
    assert.equal(capture.size, 3);
    assert.deepEqual(await outside(administration, schema), untouched);
  } finally {
    globalThis.fetch = oldFetch;
    if (pool) await pool.end();
    if (created) await administration.query(`DROP SCHEMA "${schema}" CASCADE`);
    await administration.end();
  }
});
