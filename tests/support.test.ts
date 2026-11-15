import assert from "node:assert/strict";
import test from "node:test";
import {
  bankTransferText,
  readSupportConfig,
  supportIban,
  supportPayPalUrl,
} from "../src/lib/support";

// Public format example from SWIFT's IBAN Registry; never production receiving instructions.
const bank = {
  name: "Fixture banka",
  iban: "BA39 1290 0794 0102 8494",
  accountNumber: "",
  bic: "",
};
const recipient = "Probni primalac";

test("support stays closed until explicitly enabled with a recipient and a usable method", () => {
  for (const input of [
    null,
    {},
    { enabled: false, recipient, bank },
    { enabled: true, bank },
    { enabled: true, recipient },
    { enabled: true, recipient: "\u202Eime", bank },
  ])
    assert.equal(readSupportConfig(input), null);
  const config = readSupportConfig({ enabled: true, recipient, bank });
  assert.ok(config?.bank);
  assert.equal(config.paypalUrl, null);
  assert.equal(config.recipient, recipient);
});

test("PayPal receiving links reject lookalikes, unsafe schemes, credentials and empty routes", () => {
  assert.equal(supportPayPalUrl("https://paypal.me/ahi-fixture"), "https://paypal.me/ahi-fixture");
  assert.equal(
    supportPayPalUrl("https://www.paypal.com/donate?hosted_button_id=FIXTURE"),
    "https://www.paypal.com/donate?hosted_button_id=FIXTURE",
  );
  for (const url of [
    "https://paypal.me/",
    "https://www.paypal.com/donate",
    "https://www.paypal.com/donate/?hosted_button_id=",
    "https://www.paypal.com/paypalme/",
    "https://www.paypal.com/ncp/payment/",
    "https://paypal.com/",
    "https://paypal.com.evil.invalid/donate?business=x",
    "https://paypal.me@evil.invalid/test",
    "https://user:password@paypal.me/test",
    "http://paypal.me/test",
    "javascript:alert(1)",
    "https://paypal.me:444/test",
    "https://paypal.me/test#hidden",
    "https://paypal.me/test/50",
    "https://paypal.me/test\n",
  ])
    assert.equal(supportPayPalUrl(url), null, url);
});

test("IBAN instructions preserve the canonical account and reject altered check digits", () => {
  assert.equal(supportIban(bank.iban), "BA391290079401028494");
  assert.equal(supportIban("ba39 1290 0794 0102 8494"), "BA391290079401028494");
  for (const value of [
    "BA401290079401028494",
    "BA391290079401028493",
    "BA39 1290 0794 0102 8494 extra",
    "BA39\u202E1290079401028494",
    "BA3912900794010284940",
  ])
    assert.equal(supportIban(value), null);
});

test("incomplete or mistyped bank instructions are hidden instead of falling back silently", () => {
  const paypalUrl = "https://paypal.me/ahi-fixture";
  for (const invalidBank of [
    { ...bank, name: "" },
    { ...bank, iban: "BA00", accountNumber: "1990440001200279" },
    { ...bank, bic: "bad-bic" },
  ]) {
    const config = readSupportConfig({ enabled: true, recipient, paypalUrl, bank: invalidBank });
    assert.ok(config);
    assert.equal(config.bank, null);
    assert.equal(config.paypalUrl, paypalUrl);
  }
  const domestic = readSupportConfig({
    enabled: true,
    recipient,
    bank: { name: "Fixture banka", accountNumber: "199-044-00012002-79" },
  });
  assert.ok(domestic?.bank);
  assert.equal(domestic.bank.iban, null);
  assert.equal(domestic.bank.accountNumber, "199-044-00012002-79");
  assert.equal(
    readSupportConfig({
      enabled: true,
      recipient,
      bank: { name: "Fixture banka", accountNumber: "1      2" },
    }),
    null,
  );
});

test("copied bank instructions identify the recipient and never invent a completed payment", () => {
  const config = readSupportConfig({ enabled: true, recipient, bank });
  assert.ok(config);
  assert.equal(
    bankTransferText(config),
    [
      "Primalac: Probni primalac",
      "Banka: Fixture banka",
      "IBAN: BA391290079401028494",
      "Svrha uplate: Podrška razvoju AhiBizza",
    ].join("\n"),
  );
  assert.equal(bankTransferText({ ...config, bank: null }), "");
});
