import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createDirectoryService } from "../../src/server/directory/service.ts";
import { adminPackageBenefits } from "../../src/server/paypal-subscriptions/benefits.ts";
import {
  createPackageSubscriptions,
  createSandboxSubscriptions,
} from "../../src/server/paypal-subscriptions/service.ts";
import { configureLivePackages } from "../../src/server/paypal-subscriptions/setup.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

test("sandbox package lifecycle reconciles processor evidence without activating live billing", async (t) => {
  const config = integrationConfiguration(process.env);
  const schema = `ci_subscription_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ ...config, max: 1 });
  let pool;
  let schemaCreated = false;
  try {
    assert.deepEqual(
      (await admin.query("SELECT current_database() AS db,current_user AS role")).rows,
      [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
    );
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool = new Pool({ ...config, max: 6, options: `-c search_path=${schema}` });
    await runMigrations({ pool, migrations: await loadMigrations() });
    const category = randomUUID();
    await pool.query(
      "INSERT INTO directory_category(id,name,slug) VALUES($1,'Tests','test-subscriptions')",
      [category],
    );
    const sessions = new Map();
    async function customer() {
      const id = randomUUID(),
        session = { id: randomUUID(), userId: id, token: randomUUID() };
      const businessId = randomUUID();
      await pool.query(
        `INSERT INTO auth_user(id,name,email,"emailVerified",role,approval) VALUES($1,'Sandbox',$2,true,'member','approved')`,
        [id, `${id}@fixture.invalid`],
      );
      await pool.query(
        `INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 day')`,
        [session.id, session.token, id],
      );
      await pool.query(
        "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at,latitude,longitude) VALUES($1,$2,'Sandbox fixture',$3,'published',now(),44.53,18.68)",
        [businessId, id, category],
      );
      sessions.set(session.token, { user: { id }, session });
      return {
        id,
        businessId,
        headers: new Headers({ cookie: session.token, "X-AhiBizz-Account-ID": id }),
      };
    }
    const buyer = await customer(),
      stranger = await customer();
    const auth = {
      api: { getSession: async ({ headers }) => sessions.get(headers.get("cookie")) ?? null },
    };
    const states = new Map();
    const starts = [];
    let cancellations = 0;
    const jan = "2025-01-01T12:00:00.000Z",
      feb = "2025-02-01T12:00:00.000Z";
    const mar = "2025-03-01T12:00:00.000Z",
      apr = "2025-04-01T12:00:00.000Z";
    const stopped = "2025-03-10T12:00:00.000Z";
    const plans = {};
    for (const pkg of ["basic", "business", "premium"])
      for (const period of ["monthly", "annual"])
        plans[`${pkg}:${period}`] = `P-${pkg.toUpperCase()}${period.toUpperCase()}`;
    const provider = {
      async create(contract) {
        starts.push({ contractId: contract.id, planId: contract.planId });
        const id = `I-${contract.id.replaceAll("-", "").slice(0, 15).toUpperCase()}`;
        states.set(contract.id, {
          id,
          snapshot: {
            status: "APPROVAL_PENDING",
            startsAt: null,
            endsAt: null,
            updatedAt: jan,
            payments: [],
          },
        });
        return {
          id,
          status: "APPROVAL_PENDING",
          approvalUrl: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}`,
        };
      },
      async inspect(contract) {
        return structuredClone(states.get(contract.id).snapshot);
      },
      async cancel(contract) {
        cancellations++;
        Object.assign(states.get(contract.id).snapshot, {
          status: "CANCELLED",
          updatedAt: stopped,
        });
      },
      async verifyWebhook(headers) {
        return headers.get("test-signature") === "verified";
      },
    };
    const service = createSandboxSubscriptions({ pool, auth, plans, provider });
    const input = {
      requestId: randomUUID(),
      businessId: buyer.businessId,
      packageId: "basic",
      period: "monthly",
      accepted: true,
    };
    const payment = (id, at, amountEurMinor = 1483) => ({
      id,
      at,
      amountEurMinor,
      status: "COMPLETED",
    });
    const sales = [
      payment("SALE000001", jan),
      payment("SALE000002", feb),
      payment("SALE000003", mar),
      payment("SALE000004", apr),
    ];
    let monthly, state;
    await t.test("owner approves package terms and creation is replay-safe", async () => {
      await assert.rejects(service.create(buyer.headers, { ...input, accepted: false }), {
        status: 400,
      });
      await assert.rejects(service.create(stranger.headers, input), { status: 403 });
      const started = await service.create(buyer.headers, input);
      monthly = started.contract;
      assert.equal(started.subscriptionId, states.get(monthly.id).id);
      assert.equal("subscriptionId" in (await service.list(buyer.headers)).contracts[0], false);
      assert.equal(monthly.amountBamMinor, 2900);
      assert.equal(monthly.amountEurMinor, 1483);
      assert.equal(monthly.totalCycles, 12);
      assert.equal(monthly.status, "APPROVAL_PENDING");
      assert.equal(monthly.paidCycles, 0);
      assert.equal((await service.create(buyer.headers, input)).contract.id, monthly.id);
      assert.deepEqual(starts, [{ contractId: monthly.id, planId: plans["basic:monthly"] }]);
      state = states.get(monthly.id);
      assert.deepEqual((await service.list(stranger.headers)).contracts, []);
      await assert.rejects(service.refresh(stranger.headers, monthly.id), { status: 404 });
      await assert.rejects(service.cancel(stranger.headers, monthly.id), { status: 404 });
      assert.equal(cancellations, 0);
    });
    const webhook = async (verified = true) => {
      const event = {
        event_type: "PAYMENT.SALE.COMPLETED",
        resource: { billing_agreement_id: state.id },
      };
      return service.webhook(
        new Headers({ "test-signature": verified ? "verified" : "invalid" }),
        event,
        JSON.stringify(event),
      );
    };
    await t.test(
      "first payment, monthly renewal and concurrent duplicate sale deliveries credit each sale once",
      async () => {
        Object.assign(state.snapshot, {
          status: "ACTIVE",
          startsAt: jan,
          updatedAt: jan,
          payments: [sales[0]],
        });
        await assert.rejects(webhook(false), { status: 403 });
        assert.equal((await service.list(buyer.headers)).contracts[0].paidCycles, 0);
        const first = (await service.refresh(buyer.headers, monthly.id)).contract;
        assert.equal(first.paidCycles, 1);
        const replay = await service.create(buyer.headers, input);
        assert.equal(replay.subscriptionId, null);
        assert.equal(replay.approvalUrl, null);
        assert.equal(first.endsAt, feb);
        Object.assign(state.snapshot, { updatedAt: feb, payments: [sales[0], sales[1], sales[1]] });
        await Promise.all([webhook(), webhook(), service.refresh(buyer.headers, monthly.id)]);
        const renewal = (await service.list(buyer.headers)).contracts[0];
        assert.equal(renewal.paidCycles, 2);
        assert.equal(renewal.paidEurMinor, 2966);
        assert.equal(renewal.endsAt, mar);
        assert.equal(
          (await pool.query("select count(*)::int count from sandbox_package_payment")).rows[0]
            .count,
          2,
        );
      },
    );
    await t.test(
      "cancellation stays terminal; delayed pre-cancel evidence counts, later charges go to review",
      async () => {
        const cancelled = (await service.cancel(buyer.headers, monthly.id)).contract;
        assert.equal(cancelled.status, "CANCELLED");
        assert.equal(cancelled.endsAt, mar);
        await service.cancel(buyer.headers, monthly.id);
        assert.equal(cancellations, 1);
        Object.assign(state.snapshot, { status: "ACTIVE", updatedAt: apr, payments: [...sales] });
        await webhook();
        const after = (await service.refresh(buyer.headers, monthly.id)).contract;
        assert.equal(after.status, "CANCELLED");
        assert.equal(after.paidCycles, 3);
        assert.equal(after.paidEurMinor, 4449);
        assert.equal(after.endsAt, apr);
        const flagged = await pool.query(
          "select id,needs_review from sandbox_package_payment where id=$1",
          [sales[3].id],
        );
        assert.deepEqual(flagged.rows, [{ id: sales[3].id, needs_review: true }]);
      },
    );
    await t.test(
      "annual installment grants one paid year, duplicate or conflicting evidence cannot double count",
      async () => {
        const annual = (
          await service.create(stranger.headers, {
            ...input,
            businessId: stranger.businessId,
            requestId: randomUUID(),
            period: "annual",
          })
        ).contract;
        assert.equal(annual.amountBamMinor, 29000);
        assert.equal(annual.amountEurMinor, 14827);
        assert.equal(annual.totalCycles, 1);
        const a = states.get(annual.id).snapshot;
        const installment = payment("ANNUAL00001", jan, 14827);
        Object.assign(a, {
          status: "EXPIRED",
          startsAt: jan,
          updatedAt: jan,
          payments: [installment, installment],
        });
        const result = (await service.refresh(stranger.headers, annual.id)).contract;
        assert.equal(result.paidCycles, 1);
        assert.equal(result.endsAt, "2026-01-01T12:00:00.000Z");
        a.payments.push(payment("ANNUAL00002", feb, 14827));
        await assert.rejects(service.refresh(stranger.headers, annual.id), { status: 409 });
        assert.equal((await service.list(stranger.headers)).contracts[0].paidCycles, 1);
        assert.equal(
          (
            await pool.query(
              "select count(*)::int count from sandbox_package_payment where contract_id=$1",
              [annual.id],
            )
          ).rows[0].count,
          1,
        );
      },
    );
    await t.test(
      "a finished annual schedule with settlement pending cannot create a duplicate contract",
      async () => {
        const person = await customer();
        const request = {
          ...input,
          businessId: person.businessId,
          requestId: randomUUID(),
          period: "annual",
        };
        const first = (await service.create(person.headers, request)).contract;
        const observed = new Date(Date.now() - 60000).toISOString();
        const snapshot = states.get(first.id).snapshot;
        Object.assign(snapshot, {
          status: "EXPIRED",
          startsAt: observed,
          updatedAt: observed,
          reportedCycles: 1,
          lastPaymentAt: observed,
          payments: [],
        });
        const unsettled = (await service.refresh(person.headers, first.id)).contract;
        assert.equal(unsettled.status, "EXPIRED");
        assert.equal(unsettled.paidCycles, 0);
        assert.equal(unsettled.paidEurMinor, 0);
        assert.equal(unsettled.endsAt, null);
        const creates = starts.length;
        await assert.rejects(
          service.create(person.headers, { ...request, requestId: randomUUID() }),
          { status: 409, code: "SUBSCRIPTION_SETTLEMENT_PENDING" },
        );
        assert.equal(starts.length, creates);
        snapshot.payments = [payment("LATEANNUAL01", observed, 14827)];
        const settled = (await service.refresh(person.headers, first.id)).contract;
        assert.equal(settled.paidCycles, 1);
        assert.equal(settled.paidEurMinor, 14827);
        assert.ok(Date.parse(settled.endsAt) > Date.now());
        await assert.rejects(
          service.create(person.headers, { ...request, requestId: randomUUID() }),
          { status: 409 },
        );
        assert.equal(starts.length, creates);
      },
    );
    await t.test(
      "an uncharged cancellation releases the business while a reported but unsettled cancelled sale holds it",
      async () => {
        for (const reported of [false, true]) {
          const person = await customer();
          const request = { ...input, businessId: person.businessId, requestId: randomUUID() };
          const first = (await service.create(person.headers, request)).contract;
          const beforeCancel = new Date(Date.now() - 60000).toISOString();
          const cancelledAt = new Date().toISOString();
          const snapshot = states.get(first.id).snapshot;
          Object.assign(snapshot, {
            status: "CANCELLED",
            startsAt: beforeCancel,
            updatedAt: cancelledAt,
            reportedCycles: reported ? 1 : 0,
            lastPaymentAt: reported ? beforeCancel : null,
            payments: [],
          });
          const cancelled = (await service.refresh(person.headers, first.id)).contract;
          assert.equal(cancelled.status, "CANCELLED");
          assert.equal(cancelled.paidCycles, 0);
          assert.equal(cancelled.endsAt, null);
          const commandsBefore = starts.length;
          const next = { ...request, requestId: randomUUID() };
          if (reported) {
            await assert.rejects(service.create(person.headers, next), {
              status: 409,
              code: "SUBSCRIPTION_SETTLEMENT_PENDING",
            });
            assert.equal(starts.length, commandsBefore);
          } else {
            assert.notEqual((await service.create(person.headers, next)).contract.id, first.id);
            assert.equal(starts.length, commandsBefore + 1);
          }
        }
      },
    );

    await t.test(
      "a member, stale account or anonymous caller cannot provision live PayPal settings",
      async () => {
        const origin = "https://fixture.example";
        const env = {
          BETTER_AUTH_URL: origin,
          PAYPAL_CHECKOUT_PUBLIC_ORIGIN: origin,
          PAYPAL_CHECKOUT_ENVIRONMENT: "live",
          PAYPAL_LIVE_CLIENT_ID: "fixture",
          PAYPAL_LIVE_CLIENT_SECRET: "fixture",
          PAYPAL_LIVE_MERCHANT_ID: "fixture",
        };
        await assert.rejects(configureLivePackages(pool, auth, buyer.headers, env), {
          status: 403,
        });
        await assert.rejects(configureLivePackages(pool, auth, new Headers(), env), {
          status: 401,
        });
        const stale = new Headers(buyer.headers);
        stale.set("X-AhiBizz-Account-ID", stranger.id);
        await assert.rejects(configureLivePackages(pool, auth, stale, env));
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM platform_settings WHERE key='billing.live_paypal_packages.v1'",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "all six live plan selections are isolated from Sandbox, settle once and bind the original buyer",
      async () => {
        const liveProvider = {
          ...provider,
          async create(contract) {
            const answer = await provider.create(contract);
            return {
              ...answer,
              approvalUrl: answer.approvalUrl.replace("www.sandbox.paypal.com", "www.paypal.com"),
            };
          },
        };
        const live = createPackageSubscriptions({
          environment: "live",
          pool,
          auth,
          plans,
          provider: liveProvider,
        });
        const accountHistoryOnly = createPackageSubscriptions({
          environment: "live",
          pool,
          auth,
          plans: {},
          provider: null,
        });
        const sandboxPaymentCount = Number(
          (await pool.query("SELECT count(*) FROM sandbox_package_payment")).rows[0].count,
        );
        for (const [index, key] of Object.keys(plans).entries()) {
          const [packageId, period] = key.split(":");
          const person = await customer();
          const input = {
            businessId: person.businessId,
            requestId: randomUUID(),
            packageId,
            period,
            benefitsVersion: 1,
            accepted: true,
          };
          await pool.query(
            "UPDATE directory_business SET package_access='subscription',status='draft',published_at=NULL WHERE id=$1",
            [person.businessId],
          );
          const { contract, approvalUrl } = await live.create(person.headers, input);
          assert.equal(new URL(approvalUrl).hostname, "www.paypal.com");
          assert.equal(contract.totalCycles, period === "monthly" ? 12 : 1);
          assert.equal(contract.paidCycles, 0);
          assert.equal((await live.create(person.headers, input)).contract.id, contract.id);
          assert.equal((await service.list(person.headers)).contracts.length, 0);
          await assert.rejects(live.refresh(stranger.headers, contract.id), { status: 404 });
          const snapshot = states.get(contract.id).snapshot;
          Object.assign(snapshot, {
            status: period === "annual" ? "EXPIRED" : "ACTIVE",
            startsAt: jan,
            updatedAt: jan,
            payments: [payment(`LIVEFIX${index}`, jan, contract.amountEurMinor)],
          });
          const settled = (await live.refresh(person.headers, contract.id)).contract;
          assert.equal(settled.paidCycles, 1);
          assert.equal(settled.contractualEndsAt, "2026-01-01T12:00:00.000Z");
          assert.equal(settled.endsAt, period === "monthly" ? feb : settled.contractualEndsAt);
          if (period === "monthly") {
            snapshot.payments.push(payment(`LIVERENEW${index}`, feb, contract.amountEurMinor));
            snapshot.updatedAt = feb;
            await Promise.all([
              live.refresh(person.headers, contract.id),
              live.refresh(person.headers, contract.id),
            ]);
            assert.equal((await live.cancel(person.headers, contract.id)).contract.paidCycles, 2);
          }
          const available = await accountHistoryOnly.list(person.headers);
          assert.equal(available.actor.id, person.id);
          assert.equal(available.contracts[0].id, contract.id);
          assert.equal(
            available.contracts[0].status,
            period === "monthly" ? "CANCELLED" : "EXPIRED",
          );
          await assert.rejects(accountHistoryOnly.create(person.headers, input), { status: 503 });
        }
        assert.equal(
          Number((await pool.query("SELECT count(*) FROM live_package_payment")).rows[0].count),
          9,
        );
        assert.equal(
          Number((await pool.query("SELECT count(*) FROM sandbox_package_payment")).rows[0].count),
          sandboxPaymentCount,
        );
      },
    );
    await t.test(
      "second listing is a private draft until verified sale and moderation; expiry and reversal hide it",
      async () => {
        const person = await customer(),
          moderator = await customer();
        await pool.query("UPDATE auth_user SET role='owner' WHERE id=$1", [moderator.id]);
        const accounts = {
          read: async (headers) => {
            const id = (await auth.api.getSession({ headers })).user.id;
            return (
              await pool.query(
                'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=$1',
                [id],
              )
            ).rows[0];
          },
        };
        const directory = createDirectoryService({ pool, accounts, auth });
        const createHeaders = new Headers(person.headers);
        createHeaders.set("X-AhiBizz-Paid-Draft", "1");
        const second = await directory.create(
          createHeaders,
          { title: "Second listing", categoryId: category },
          randomUUID(),
        );
        assert.equal(second.status, "draft");
        assert.equal(second.packagePaymentNeeded, true);
        await assert.rejects(
          directory.create(
            createHeaders,
            { title: "Third unpaid listing", categoryId: category },
            randomUUID(),
          ),
          { code: "BUSINESS_LIMIT_REACHED" },
        );
        await assert.rejects(
          directory.publish(person.headers, second.id, { expectedVersion: second.version }),
          { code: "PACKAGE_PAYMENT_REQUIRED" },
        );
        await assert.rejects(
          directory.moderate(moderator.headers, second.id, {
            status: "published",
            expectedVersion: second.version,
          }),
          { code: "PACKAGE_PAYMENT_REQUIRED" },
        );
        const gateway = {
          ...provider,
          async create(c) {
            const reply = await provider.create(c);
            return {
              ...reply,
              approvalUrl: reply.approvalUrl.replace("www.sandbox.paypal.com", "www.paypal.com"),
            };
          },
        };
        const live = createPackageSubscriptions({
          environment: "live",
          pool,
          auth,
          plans,
          provider: gateway,
        });
        await assert.rejects(
          live.create(person.headers, {
            ...input,
            benefitsVersion: 1,
            businessId: person.businessId,
            requestId: randomUUID(),
          }),
          { code: "BUSINESS_ALREADY_COVERED" },
        );
        const contract = (
          await live.create(person.headers, {
            ...input,
            benefitsVersion: 1,
            period: "annual",
            businessId: second.id,
            requestId: randomUUID(),
          })
        ).contract;
        const snapshot = states.get(contract.id).snapshot,
          now = new Date().toISOString();
        Object.assign(snapshot, {
          status: "EXPIRED",
          startsAt: now,
          updatedAt: now,
          reportedCycles: 1,
          lastPaymentAt: now,
          payments: [],
        });
        await live.refresh(person.headers, contract.id);
        assert.equal(
          (await directory.readOwn(person.headers, second.id)).packagePaymentNeeded,
          true,
        );
        snapshot.payments = [payment("ENTITLEMENTFIX01", now, contract.amountEurMinor)];
        await live.refresh(person.headers, contract.id);
        const pending = await directory.publish(person.headers, second.id, {
          expectedVersion: second.version,
        });
        const published = await directory.moderate(moderator.headers, second.id, {
          status: "published",
          expectedVersion: pending.version,
        });
        assert.equal((await directory.readPublic(second.id)).title, published.title);
        assert.equal(
          Object.hasOwn(await directory.readPublic(second.id), "packagePaymentNeeded"),
          false,
        );
        const third = await directory.create(
          createHeaders,
          { title: "Third listing", categoryId: category },
          randomUUID(),
        );
        assert.equal(third.packagePaymentNeeded, true);
        const archived = await directory.archive(person.headers, third.id, {
          expectedVersion: third.version,
        });
        assert.equal(
          (await directory.recover(person.headers, third.id, { expectedVersion: archived.version }))
            .status,
          "draft",
        );
        await pool.query(
          "UPDATE live_package_contract SET ends_at=now()-interval '1 second' WHERE id=$1",
          [contract.id],
        );
        await assert.rejects(directory.readPublic(second.id), { code: "BUSINESS_NOT_FOUND" });
        await live.refresh(person.headers, contract.id);
        assert.equal((await directory.readPublic(second.id)).id, second.id);
        snapshot.payments[0].status = "REFUNDED";
        const event = {
          event_type: "PAYMENT.SALE.REFUNDED",
          resource: { sale_id: "ENTITLEMENTFIX01" },
        };
        assert.deepEqual(
          await live.webhook(
            new Headers({ "test-signature": "verified" }),
            event,
            JSON.stringify(event),
          ),
          { processed: true },
        );
        await assert.rejects(directory.readPublic(second.id), { code: "BUSINESS_NOT_FOUND" });
        assert.equal((await directory.listPublic({ q: "Second listing" })).items.length, 0);
        assert.equal(
          (await directory.readOwn(person.headers, second.id)).packagePaymentNeeded,
          true,
        );
      },
    );
    await t.test(
      "versioned member benefits preserve signed terms, expiry windows, annual periods and exclusive admin edit",
      async () => {
        const admin = await customer(),
          person = await customer(),
          other = await customer();
        await pool.query("UPDATE auth_user SET role='owner' WHERE id=$1", [admin.id]);
        const initial = await adminPackageBenefits(pool, auth, admin.headers);
        assert.equal(initial.version, 1);
        assert.deepEqual(initial.benefits.premium, {
          enabled: true,
          nearbyDays: 15,
          featuredDays: 7,
        });
        await assert.rejects(adminPackageBenefits(pool, auth, person.headers), { status: 403 });
        await assert.rejects(
          adminPackageBenefits(pool, auth, admin.headers, {
            ...initial,
            benefits: { ...initial.benefits, basic: { ...initial.benefits.basic, nearbyDays: -1 } },
          }),
          { status: 400 },
        );
        const gateway = {
          ...provider,
          async create(c) {
            const reply = await provider.create(c);
            return {
              ...reply,
              approvalUrl: reply.approvalUrl.replace("www.sandbox.paypal.com", "www.paypal.com"),
            };
          },
        };
        const live = createPackageSubscriptions({
          environment: "live",
          pool,
          auth,
          plans,
          provider: gateway,
        });
        const inputFor = (buyer, period = "annual") => ({
          businessId: buyer.businessId,
          requestId: randomUUID(),
          packageId: "premium",
          period,
          accepted: true,
          benefitsVersion: 1,
        });
        await assert.rejects(live.settlements(person.headers, 1), { status: 403 });
        const adminLedger = await live.settlements(admin.headers, 1);
        assert.ok(
          adminLedger.items.some(
            (row) => row.id === "ENTITLEMENTFIX01" && row.status === "REFUNDED" && !row.recorded,
          ),
        );
        const original = inputFor(person),
          contract = (await live.create(person.headers, original)).contract;
        const { packageMarketingProbe } = await import("./marketing-cases.mjs");
        const marketingProbe = await packageMarketingProbe({ pool, auth, admin, person });
        const current = await adminPackageBenefits(pool, auth, admin.headers, {
          version: 1,
          benefits: {
            ...initial.benefits,
            premium: { enabled: true, nearbyDays: 3, featuredDays: 1 },
          },
        });
        assert.equal(current.version, 2);
        await assert.rejects(adminPackageBenefits(pool, auth, admin.headers, initial), {
          code: "PACKAGE_BENEFITS_CHANGED",
        });
        assert.equal((await live.create(person.headers, original)).contract.featuredDays, 7);
        const fresh = inputFor(other, "monthly");
        await assert.rejects(live.create(other.headers, fresh), {
          code: "PACKAGE_BENEFITS_CHANGED",
        });
        await pool.query("UPDATE directory_business SET latitude=NULL,longitude=NULL WHERE id=$1", [
          other.businessId,
        ]);
        await assert.rejects(live.create(other.headers, { ...fresh, benefitsVersion: 2 }), {
          code: "PACKAGE_LOCATION_REQUIRED",
        });
        await pool.query(
          "UPDATE directory_business SET latitude=44.53,longitude=18.68 WHERE id=$1",
          [other.businessId],
        );
        const next = (await live.create(other.headers, { ...fresh, benefitsVersion: 2 })).contract;
        assert.equal(next.nearbyDays, 3);
        const assertWindow = async (b, kind, active) => {
          const result = (
            await pool.query(
              "SELECT paid_package_placement(b,$2) AS active,paid_package_placement_until(b,$2)>now() AS future FROM directory_business b WHERE id=$1",
              [b, kind],
            )
          ).rows[0];
          assert.equal(result.active, active);
          if (active) assert.equal(result.future, true);
        };
        const monthAgo = (
          await pool.query(
            "SELECT ((now() AT TIME ZONE 'UTC')-interval '1 month' -interval '2 days') AT TIME ZONE 'UTC' AS x",
          )
        ).rows[0].x.toISOString();
        const now = new Date().toISOString();
        const state = states.get(contract.id).snapshot;
        Object.assign(state, {
          status: "EXPIRED",
          startsAt: monthAgo,
          updatedAt: now,
          payments: [payment("BENEFITANNUAL1", monthAgo, contract.amountEurMinor)],
        });
        await live.refresh(person.headers, contract.id);
        await assertWindow(person.businessId, "featured", true);
        await assertWindow(person.businessId, "nearby", true);
        await marketingProbe.funded();
        const monthly = states.get(next.id).snapshot;
        Object.assign(monthly, {
          status: "ACTIVE",
          startsAt: monthAgo,
          updatedAt: now,
          payments: [payment("BENEFITMONTHLY1", monthAgo, next.amountEurMinor)],
        });
        await live.refresh(other.headers, next.id);
        await assertWindow(other.businessId, "nearby", false);
        monthly.payments.push(payment("BENEFITMONTHLY2", now, next.amountEurMinor));
        await live.refresh(other.headers, next.id);
        await assertWindow(other.businessId, "nearby", true);
        await assertWindow(other.businessId, "featured", false);
        monthly.payments[0].status = "REFUNDED";
        await live.refresh(other.headers, next.id);
        await assertWindow(other.businessId, "nearby", true);
        monthly.payments[1].status = "REVERSED";
        await live.refresh(other.headers, next.id);
        await assertWindow(other.businessId, "nearby", false);
        state.payments[0].status = "PARTIALLY_REFUNDED";
        await live.refresh(person.headers, contract.id);
        await assertWindow(person.businessId, "featured", false);
        await marketingProbe.reversed();
      },
    );
    await t.test(
      "sandbox contracts and payments write no production receipts or development ledger",
      async () => {
        const counts = await pool.query(
          "select (select count(*)::int from billing_receipt) as receipts,(select count(*)::int from billing_development_ledger) as allocations",
        );
        assert.deepEqual(counts.rows, [{ receipts: 0, allocations: 0 }]);
      },
    );
  } finally {
    await pool?.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
