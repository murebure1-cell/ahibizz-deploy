import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awaitingFirstSandboxPayment,
  followSandboxFirstPayment,
  type SandboxPackageContract,
} from "../src/lib/sandbox-subscriptions";

const contract: SandboxPackageContract = {
  id: "test-return",
  businessId: "test-business",
  businessTitle: "Test",
  requestId: "test-request",
  createdAt: "2026-11-19T10:00:00Z",
  startsAt: null,
  endsAt: null,
  packageId: "business",
  period: "monthly",
  status: "ACTIVE",
  amountBamMinor: 4900,
  amountEurMinor: 2505,
  totalCycles: 12,
  paidCycles: 0,
  paidEurMinor: 0,
};

test("returned package waits for verified first settlement even after PayPal finishes the annual schedule", async () => {
  assert.equal(awaitingFirstSandboxPayment(contract), true);
  assert.equal(awaitingFirstSandboxPayment({ ...contract, status: "EXPIRED" }), true);
  assert.equal(awaitingFirstSandboxPayment({ ...contract, status: "APPROVAL_PENDING" }), false);
  assert.equal(awaitingFirstSandboxPayment({ ...contract, status: "CANCELLED" }), false);
  const seen: number[] = [];
  const delays: number[] = [];
  await followSandboxFirstPayment(
    contract.id,
    new AbortController().signal,
    async () => (seen.length ? { ...contract, paidCycles: 1, paidEurMinor: 2505 } : contract),
    (update) => seen.push(update.paidEurMinor),
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.deepEqual(seen, [0, 2505]);
  assert.deepEqual(delays, [2000, 4000]);
});

test("pending reports stop after the backoff budget and never replace another account's or contract's UI", async () => {
  let reads = 0;
  await followSandboxFirstPayment(
    contract.id,
    new AbortController().signal,
    async () => contract,
    () => {
      reads++;
    },
    async () => {},
  );
  assert.equal(reads, 6);
  const controller = new AbortController();
  await followSandboxFirstPayment(
    contract.id,
    controller.signal,
    async () => {
      controller.abort();
      return contract;
    },
    () => assert.fail("late response updated an abandoned view"),
    async () => {},
  );
  await followSandboxFirstPayment(
    contract.id,
    new AbortController().signal,
    async () => ({ ...contract, id: "different" }),
    () => assert.fail("a different contract was displayed"),
    async () => {},
  );
});
