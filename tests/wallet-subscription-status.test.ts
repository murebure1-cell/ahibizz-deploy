import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthService } from "../src/server/auth/service";
import {
  createPackageSubscriptions,
  type SandboxRecord,
} from "../src/server/paypal-subscriptions/service";

const userId = "wallet-status-owner";
const end = "2026-11-22T12:00:00.000Z";
const finalCycle: SandboxRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  userId,
  businessId: "00000000-0000-4000-8000-000000000002",
  businessTitle: "Fixture",
  requestId: "00000000-0000-4000-8000-000000000003",
  packageId: "business",
  period: "monthly",
  amountBamMinor: 4900,
  amountEurMinor: 2505,
  totalCycles: 12,
  planId: "",
  providerId: null,
  approvalUrl: null,
  status: "EXPIRED",
  providerUpdatedAt: null,
  startsAt: "2025-11-22T12:00:00.000Z",
  endsAt: end,
  paidCycles: 12,
  paidEurMinor: 0,
  paymentMethod: "credits",
  cycleCreditMinor: 4900,
  createdAt: "2025-11-22T12:00:00.000Z",
};

async function memberships(record: SandboxRecord) {
  const client = {
    async query(sql: string) {
      if (sql.includes("FROM auth_user"))
        return {
          rows: [{ id: userId, emailVerified: true, role: "member", approval: "approved" }],
          rowCount: 1,
        };
      if (sql.includes("locked_session")) return { rows: [{ id: "session" }], rowCount: 1 };
      if (sql.includes("ahi_wallet_available_minor")) return { rows: [{ minor: "0" }] };
      if (sql.includes("FROM live_package_contract")) return { rows: [record] };
      assert.match(sql, /^(BEGIN |SET LOCAL |COMMIT$|ROLLBACK$)/);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const service = createPackageSubscriptions({
    environment: "live",
    pool: { connect: async () => client } as unknown as Pool,
    auth: {
      api: {
        getSession: async () => ({
          user: { id: userId },
          session: { id: "session", userId, token: "fixture" },
        }),
      },
    } as unknown as AuthService,
    plans: {},
    provider: null,
  });
  return service.list(new Headers({ "X-AhiBizz-Account-ID": userId }));
}

test("membership API keeps a historically expired final credit month active until its paid end", async (t) => {
  t.mock.method(Date, "now", () => Date.parse(end) - 1);
  const result = await memberships(finalCycle);
  const current = result.contracts[0];
  assert.ok(current);
  assert.equal(current.status, "ACTIVE");
  assert.equal(current.endsAt, end);
  assert.equal(current.paidCycles, 12);
  const pgDate = new Date(Date.parse(end) + 321);
  t.mock.method(Date, "now", () => pgDate.getTime() - 1);
  const fromPg = await memberships({ ...finalCycle, endsAt: pgDate as unknown as string });
  assert.equal(fromPg.contracts[0]?.status, "ACTIVE");
  assert.equal(fromPg.contracts[0]?.endsAt, pgDate.toISOString());
});

test("membership API expires fully paid credit contracts at the exact paid end", async (t) => {
  t.mock.method(Date, "now", () => Date.parse(end));
  assert.equal(
    (await memberships({ ...finalCycle, status: "ACTIVE" })).contracts[0]?.status,
    "EXPIRED",
  );
  t.mock.method(Date, "now", () => Date.parse(end) + 1);
  assert.equal(
    (
      await memberships({
        ...finalCycle,
        period: "annual",
        totalCycles: 1,
        paidCycles: 1,
        status: "ACTIVE",
      })
    ).contracts[0]?.status,
    "EXPIRED",
  );
});

test("a due installment, a cancellation, and PayPal history keep their existing status", async (t) => {
  t.mock.method(Date, "now", () => Date.parse(end) + 1);
  for (const record of [
    { ...finalCycle, paidCycles: 11, status: "ACTIVE" },
    { ...finalCycle, status: "CANCELLED" },
    { ...finalCycle, paymentMethod: "paypal" as const },
  ])
    assert.equal((await memberships(record)).contracts[0]?.status, record.status);
});
