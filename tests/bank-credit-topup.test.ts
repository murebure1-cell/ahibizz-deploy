import assert from "node:assert/strict";
import test from "node:test";
import { readCreditBankConfiguration } from "../src/server/wallet/bank-config";
import { createBankTopUpHandler } from "../src/server/wallet/bank-http";
import {
  type BankTopUpService,
  parseBankTopUpApprove,
  parseBankTopUpCancel,
  parseBankTopUpCreate,
} from "../src/server/wallet/bank-topup";

const fixture = {
  enabled: true,
  commercialConfirmed: true,
  recipient: "Fixture merchant",
  bank: {
    id: "fixture",
    label: "Fixture bank",
    name: "Wise",
    currency: "EUR",
    iban: "GB82 WEST 1234 5698 7654 32",
  },
};
const id = "12c34ba5-965f-4bd2-a478-3847ff47ee4d";
test("commercial transfer config is absent by default and never falls back to donation settings", () => {
  assert.equal(readCreditBankConfiguration({}), null);
  for (const value of [
    { ...fixture, enabled: false },
    { ...fixture, commercialConfirmed: false },
    { ...fixture, extra: true },
    { ...fixture, bank: { ...fixture.bank, name: "Unconfirmed bank" } },
    { ...fixture, bank: { ...fixture.bank, currency: "BAM" } },
    { ...fixture, bank: { ...fixture.bank, iban: "invalid" } },
    { ...fixture, recipient: "bad\nreceiver" },
  ])
    assert.equal(
      readCreditBankConfiguration({ AHIBIZZ_CREDIT_BANK_TRANSFER: JSON.stringify(value) }),
      null,
    );
  const active = readCreditBankConfiguration({
    AHIBIZZ_CREDIT_BANK_TRANSFER: JSON.stringify(fixture),
  });
  assert.ok(active);
  assert.equal(active.bank.purpose, "Dopuna Ahi kredita");
  assert.equal(active.bank.currency, "EUR");
  assert.match(active.fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(
    active.fingerprint,
    readCreditBankConfiguration({
      AHIBIZZ_CREDIT_BANK_TRANSFER: JSON.stringify({ ...fixture, recipient: "Different merchant" }),
    })?.fingerprint,
  );
});
test("bank commands reject unknown fields, amounts, currencies and controls in statement IDs", () => {
  assert.deepEqual(
    parseBankTopUpCreate({ id, quantity: 60, expectedAmountMinor: 767, currency: "EUR" }),
    { id, quantity: 60, expectedAmountMinor: 767, currency: "EUR" },
  );
  for (const value of [
    { id, quantity: 60, expectedAmountMinor: 1.5, currency: "EUR" },
    { id, quantity: 60, expectedAmountMinor: 767, currency: "EUR", approved: true },
    { id: "bad", quantity: 60, expectedAmountMinor: 767, currency: "EUR" },
  ])
    assert.throws(() => parseBankTopUpCreate(value));
  const base = {
    expectedVersion: 1,
    bankTransactionReference: " statement-01 ",
    amountMinor: 767,
    currency: "EUR",
    paymentReference: `AHI-${id.replaceAll("-", "").toUpperCase()}`,
  };
  assert.equal(parseBankTopUpApprove(base).bankTransactionReference, "STATEMENT-01");
  for (const value of [
    { ...base, bankTransactionReference: "xx\nsecret" },
    { ...base, paymentReference: "wrong" },
    { ...base, currency: "USD" },
    { ...base, userId: "admin" },
  ])
    assert.throws(() => parseBankTopUpApprove(value));
  assert.deepEqual(parseBankTopUpCancel({ expectedVersion: 1 }), { expectedVersion: 1 });
  assert.throws(() => parseBankTopUpCancel({ expectedVersion: 1, status: "paid" }));
});
test("bank HTTP routes preserve identity, origin, strict query and exact action boundaries", async () => {
  const calls: unknown[] = [];
  const service = {
    async read(...args: unknown[]) {
      calls.push(["read", ...args.slice(1)]);
      return { requests: [] };
    },
    async create(_headers: Headers, body: unknown) {
      calls.push(["create", body]);
      return { request: { id } };
    },
    async approve(_headers: Headers, pathId: string, body: unknown) {
      calls.push(["approve", pathId, body]);
      return { request: { id } };
    },
    async cancel(_headers: Headers, pathId: string, body: unknown) {
      calls.push(["cancel", pathId, body]);
      return { request: { id } };
    },
  } as unknown as BankTopUpService;
  const handle = createBankTopUpHandler({
    service: () => service,
    origin: () => "https://fixture.invalid",
    disabled: () => false,
  });
  const req = (query = "", method = "GET", body?: string, origin = "https://fixture.invalid") =>
    new Request(`https://fixture.invalid/api/wallet/bank-topups${query}`, {
      method,
      headers: { "X-AhiBizz-Account-ID": "fixture", origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
  assert.equal((await handle(req("?scope=mine&page=1"))).status, 200);
  assert.deepEqual(calls[0], ["read", "mine", 1, undefined]);
  for (const query of [
    "?scope=mine&scope=admin",
    "?page=0",
    "?page=1001",
    "?unknown=1",
    "?scope=mine&status=approved",
  ])
    assert.equal((await handle(req(query))).status, 400);
  assert.equal(
    (await handle(new Request("https://fixture.invalid/api/wallet/bank-topups"))).status,
    401,
  );
  assert.equal((await handle(req("", "POST", "{}", "https://other.invalid"))).status, 403);
  assert.equal((await handle(req("", "POST", '{"id":1,"id":2}'))).status, 400);
  assert.equal((await handle(req("", "POST", "{}"), [id, "approve"])).status, 200);
  assert.equal((await handle(req("", "POST", "{}"), [id, "cancel"])).status, 200);
  assert.equal((await handle(req("", "POST", "{}"), [id, "confirm"])).status, 404);
  assert.equal((await handle(req("?page=1", "POST", "{}"))).status, 404);
  assert.equal(calls.length, 3);
});
test("disabled bank HTTP service does not invoke a configured service", async () => {
  let called = false;
  const handle = createBankTopUpHandler({
    disabled: () => true,
    service: () => {
      called = true;
      return null;
    },
  });
  assert.equal((await handle(new Request("https://fixture.invalid"))).status, 404);
  assert.equal(called, false);
});
