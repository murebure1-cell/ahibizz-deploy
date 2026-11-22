import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalAttemptMaxAgeMs,
  staleSubscriptionApproval,
} from "../src/lib/subscription-approval";
import { AccountAccessError } from "../src/server/auth/accounts";
import type { Snapshot, SubscriptionProvider } from "../src/server/paypal-subscriptions/provider";
import {
  createPackageSubscriptions,
  type SandboxRecord,
} from "../src/server/paypal-subscriptions/service";

const ownerId = "fixture-owner";
const contractId = "c07c9457-b1de-4230-aad7-41a353c4d581";
const businessId = "c07c9457-b1de-4230-aad7-41a353c4d582";
const requestId = "c07c9457-b1de-4230-aad7-41a353c4d583";
const headers = new Headers({ "X-AhiBizz-Account-ID": ownerId });

function fixture(overrides: Partial<SandboxRecord> = {}) {
  const record: SandboxRecord = {
    id: contractId,
    userId: ownerId,
    businessId,
    businessTitle: "Fixture business",
    requestId,
    packageId: "basic",
    period: "monthly",
    amountBamMinor: 2900,
    amountEurMinor: 1483,
    totalCycles: 12,
    planId: "P-TESTMONTHLY123456",
    providerId: "I-TESTSUB123456",
    approvalUrl: "https://www.sandbox.paypal.com/agreements/approve?ba_token=OLD",
    status: "APPROVAL_PENDING",
    providerUpdatedAt: null,
    startsAt: null,
    endsAt: null,
    paidCycles: 0,
    paidEurMinor: 0,
    reportedCycles: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
  const records = new Map([[record.id, record]]);
  const states = new Map<string, Snapshot>([
    [
      record.id,
      {
        status: "APPROVAL_PENDING",
        startsAt: null,
        endsAt: null,
        updatedAt: new Date().toISOString(),
        payments: [],
      },
    ],
  ]);
  const calls = { inspected: [] as string[], cancelled: [] as string[], created: [] as string[] };
  let cancellationRace = false;
  let cancellationUnavailable = false;
  const provider: SubscriptionProvider = {
    async create(c) {
      calls.created.push(c.id);
      states.set(c.id, {
        status: "APPROVAL_PENDING",
        startsAt: null,
        endsAt: null,
        updatedAt: new Date().toISOString(),
        payments: [],
      });
      return {
        id: "I-NEWTEST123456",
        status: "APPROVAL_PENDING",
        approvalUrl: "https://www.sandbox.paypal.com/agreements/approve?ba_token=NEW",
      };
    },
    async inspect(c) {
      calls.inspected.push(c.id);
      const state = states.get(c.id);
      assert.ok(state);
      return structuredClone(state);
    },
    async cancel(c, unpaidOnly) {
      assert.equal(unpaidOnly, true, "automatic cleanup must retain unpaid-only provider checks");
      calls.cancelled.push(c.id);
      const state = states.get(c.id);
      assert.ok(state);
      if (cancellationUnavailable)
        throw new AccountAccessError(502, "PAYPAL_SUBSCRIPTIONS_UNAVAILABLE");
      if (cancellationRace) {
        state.status = "ACTIVE";
        state.reportedCycles = 1;
        state.startsAt = new Date().toISOString();
        throw new AccountAccessError(409, "SUBSCRIPTION_PENDING_CHANGED");
      }
      state.status = "CANCELLED";
      state.updatedAt = new Date().toISOString();
    },
    async verifyWebhook() {
      return false;
    },
  };
  const client = {
    release() {},
    async query(sql: string, args: unknown[] = []) {
      const empty = { rows: [], rowCount: 0 };
      if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return empty;
      if (sql.includes("FROM auth_user"))
        return {
          rows: [{ id: ownerId, role: "member", approval: "approved", emailVerified: true }],
          rowCount: 1,
        };
      if (sql.includes("locked_session")) return { rows: [{ id: "session" }], rowCount: 1 };
      if (sql.includes("FROM directory_business"))
        return {
          rows: [{ owner_user_id: ownerId, status: "published", title: "Fixture business" }],
          rowCount: 1,
        };
      if (sql.includes("FROM sandbox_package_payment"))
        return {
          rows: [{ n: 0, throughCycle: 0, observed: 0, first: null, last: null, total: 0 }],
          rowCount: 1,
        };
      if (sql.startsWith("UPDATE sandbox_package_payment")) return empty;
      if (sql.startsWith("UPDATE sandbox_package_contract")) {
        const target = records.get(String(args[0]));
        assert.ok(target);
        if (sql.includes("provider_id=$2")) {
          target.providerId = String(args[1]);
          target.status = String(args[2]);
          target.approvalUrl = args[3] as string;
        } else {
          target.status = String(args[1]);
          target.providerUpdatedAt = String(args[2]);
          target.approvalUrl = target.status === "APPROVAL_PENDING" ? target.approvalUrl : null;
          target.paidCycles = Number(args[3]);
          target.paidEurMinor = Number(args[4]);
          target.startsAt = args[5] as string | null;
          target.reportedCycles = Number(args[7]);
        }
        return { rows: [structuredClone(target)], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO sandbox_package_contract")) {
        const inserted: SandboxRecord = {
          ...record,
          id: String(args[0]),
          requestId: String(args[4]),
          status: "CREATING",
          providerId: null,
          approvalUrl: null,
          createdAt: new Date().toISOString(),
        };
        records.set(inserted.id, inserted);
        return { rows: [structuredClone(inserted)], rowCount: 1 };
      }
      if (sql.includes("FROM sandbox_package_contract")) {
        const rows = [...records.values()].filter((c) => {
          if (sql.includes("WHERE id=$1")) return c.id === args[0];
          if (sql.includes("request_id=$2")) return c.requestId === args[1];
          if (sql.includes("business_id=$1"))
            return c.businessId === args[0] && !["CANCELLED", "EXPIRED"].includes(c.status);
          return c.userId === args[0];
        });
        return { rows: structuredClone(rows), rowCount: rows.length };
      }
      assert.fail(`Unhandled fixture query: ${sql}`);
    },
  };
  const pool = { connect: async () => client };
  const auth = {
    api: {
      getSession: async () => ({
        user: { id: ownerId },
        session: { id: "session", userId: ownerId, token: "fixture-session" },
      }),
    },
  };
  return {
    service: createPackageSubscriptions({
      pool: pool as never,
      auth: auth as never,
      plans: { "basic:monthly": record.planId },
      provider,
    }),
    calls,
    records,
    state: states.get(record.id) as Snapshot,
    race: () => {
      cancellationRace = true;
    },
    refuse: () => {
      cancellationUnavailable = true;
    },
  };
}

test("refresh closes an old unpaid approval through the checked provider cancellation path", async () => {
  const f = fixture();
  const result = await f.service.refresh(headers, contractId);
  assert.equal(result.contract.status, "CANCELLED");
  assert.deepEqual(f.calls.cancelled, [contractId]);
  assert.equal(f.calls.inspected.length, 2);
  assert.equal(f.records.get(contractId)?.approvalUrl, null);
  assert.equal(result.contract.paidCycles, 0);
  assert.equal(result.contract.paidEurMinor, 0);
});

test("a fresh request does not reuse an old unapproved checkout or its expired approval link", async () => {
  const f = fixture();
  const result = await f.service.create(headers, {
    businessId,
    requestId: "c07c9457-b1de-4230-aad7-41a353c4d584",
    packageId: "basic",
    period: "monthly",
    accepted: true,
  });
  assert.notEqual(result.contract.id, contractId);
  assert.equal(f.records.get(contractId)?.status, "CANCELLED");
  assert.equal(f.calls.created.length, 1);
  assert.match(result.approvalUrl ?? "", /ba_token=NEW/);
});

test("recent approval links are preserved and local payment evidence prevents automatic closure", async () => {
  for (const override of [
    { createdAt: new Date().toISOString() },
    { paidCycles: 1 },
    { paidEurMinor: 1483 },
    { reportedCycles: 1 },
    { paymentMethod: "credits" as const },
  ]) {
    const f = fixture(override);
    await f.service.refresh(headers, contractId);
    assert.deepEqual(f.calls.cancelled, []);
  }
});

test("remote activation or reported payment never becomes an automatic cancellation", async () => {
  for (const remote of [
    { status: "ACTIVE", reportedCycles: 1 },
    { reportedCycles: 1 },
    { lastPaymentAt: new Date().toISOString() },
  ]) {
    const f = fixture();
    Object.assign(f.state, remote);
    await f.service.refresh(headers, contractId);
    assert.deepEqual(f.calls.cancelled, []);
  }
});

test("approval racing unpaid cleanup reconciles the latest status without claiming closure", async () => {
  const f = fixture();
  f.race();
  const result = await f.service.refresh(headers, contractId);
  assert.equal(result.contract.status, "ACTIVE");
  assert.deepEqual(f.calls.cancelled, [contractId]);
  assert.equal(f.calls.inspected.length, 2);
});

test("a refused provider cancellation preserves pending status and does not authorize a fresh checkout", async () => {
  const f = fixture();
  f.refuse();
  await assert.rejects(f.service.refresh(headers, contractId), {
    code: "PAYPAL_SUBSCRIPTIONS_UNAVAILABLE",
  });
  await assert.rejects(
    f.service.create(headers, {
      businessId,
      requestId: "c07c9457-b1de-4230-aad7-41a353c4d584",
      packageId: "basic",
      period: "monthly",
      accepted: true,
    }),
    { code: "PAYPAL_SUBSCRIPTIONS_UNAVAILABLE" },
  );
  assert.equal(f.records.get(contractId)?.status, "APPROVAL_PENDING");
  assert.notEqual(f.records.get(contractId)?.approvalUrl, null);
  assert.deepEqual(f.calls.created, []);
});

test("provider-confirmed expiry closes an unpaid approval even within the local age limit", async () => {
  const f = fixture({ createdAt: new Date().toISOString() });
  f.state.status = "EXPIRED";
  const result = await f.service.refresh(headers, contractId);
  assert.equal(result.contract.status, "EXPIRED");
  assert.equal(f.records.get(contractId)?.approvalUrl, null);
  assert.deepEqual(f.calls.cancelled, []);
});

test("local abandonment starts at the exact 72-hour boundary and rejects invalid timestamps", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const pending = {
    status: "APPROVAL_PENDING",
    paidCycles: 0,
    paidEurMinor: 0,
    createdAt: new Date(now - approvalAttemptMaxAgeMs).toISOString(),
  };
  assert.equal(staleSubscriptionApproval(pending, now - 1), false);
  assert.equal(staleSubscriptionApproval(pending, now), true);
  assert.equal(staleSubscriptionApproval({ ...pending, createdAt: "unknown" }, now), false);
});
