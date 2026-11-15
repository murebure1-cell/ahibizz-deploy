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
  id: "fixture-ba",
  label: "Domaći račun",
  name: "Fixture banka",
  iban: "BA39 1290 0794 0102 8494",
  accountNumber: "",
  bic: "",
};
const recipient = "Probni primalac";
// Public IBAN format example; the remaining fields are synthetic test instructions.
const internationalBank = {
  id: "fixture-international",
  label: "Međunarodni račun",
  name: "International fixture bank",
  iban: "GB82 WEST 1234 5698 7654 32",
  accountNumber: "000-000-00000000-01",
  bic: "WESTGB2L",
  address: "Fixture Street 12, Example City",
  note: "Probna napomena međunarodnog računa",
};

test("support stays closed until explicitly enabled with a recipient and a usable method", () => {
  for (const input of [
    null,
    {},
    { enabled: false, recipient, bankAccounts: [bank] },
    { enabled: true, bankAccounts: [bank] },
    { enabled: true, recipient },
    { enabled: true, recipient, bankAccounts: [] },
    { enabled: true, recipient, bankAccounts: bank },
    { enabled: true, recipient: "\u202Eime", bankAccounts: [bank] },
  ])
    assert.equal(readSupportConfig(input), null);
  const config = readSupportConfig({ enabled: true, recipient, bankAccounts: [bank] });
  assert.ok(config);
  assert.equal(config.bankAccounts.length, 1);
  assert.equal(config.paypalUrl, null);
  assert.equal(config.recipient, recipient);
});

test("a valid PayPal receiving link can enable support without bank accounts", () => {
  const paypalUrl = "https://paypal.me/ahi-fixture";
  const config = readSupportConfig({ enabled: true, recipient, paypalUrl });
  assert.ok(config);
  assert.deepEqual(config.bankAccounts, []);
  assert.equal(config.paypalUrl, paypalUrl);
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
  assert.equal(supportIban("BE68 5390 0754 7034"), "BE68539007547034");
  for (const value of [
    "BA401290079401028494",
    "BA391290079401028493",
    "BA39 1290 0794 0102 8494 extra",
    "BA39\u202E1290079401028494",
    "BA3912900794010284940",
    "BE685390075470340",
  ])
    assert.equal(supportIban(value), null);
});

test("incomplete or mistyped bank instructions are hidden instead of falling back silently", () => {
  const paypalUrl = "https://paypal.me/ahi-fixture";
  for (const invalidBank of [
    { ...bank, id: "" },
    { ...bank, id: "Invalid account id" },
    { ...bank, label: "" },
    { ...bank, name: "" },
    { ...bank, iban: "BA00", accountNumber: "0000000000000001" },
    { ...bank, accountNumber: "invalid-account" },
    { ...bank, bic: "bad-bic" },
    { ...bank, address: "Fixture Street\nInjected instructions" },
    { ...bank, note: "\u202EProbna napomena" },
    { ...bank, iban: 123 },
    { ...bank, accountNumber: 123 },
    { ...bank, bic: 123 },
    { ...bank, address: {} },
    { ...bank, note: [] },
  ]) {
    const config = readSupportConfig({
      enabled: true,
      recipient,
      paypalUrl,
      bankAccounts: [invalidBank],
    });
    assert.ok(config);
    assert.deepEqual(config.bankAccounts, []);
    assert.equal(config.paypalUrl, paypalUrl);
    assert.equal(
      readSupportConfig({ enabled: true, recipient, bankAccounts: [invalidBank] }),
      null,
    );
  }
  const domestic = readSupportConfig({
    enabled: true,
    recipient,
    bankAccounts: [{ ...bank, iban: "", accountNumber: "000-000-00000000-01" }],
  });
  assert.ok(domestic);
  assert.equal(domestic.bankAccounts.length, 1);
  assert.ok(domestic.bankAccounts[0]);
  assert.equal(domestic.bankAccounts[0].iban, null);
  assert.equal(domestic.bankAccounts[0].accountNumber, "000-000-00000000-01");
  assert.equal(
    readSupportConfig({
      enabled: true,
      recipient,
      bankAccounts: [{ ...bank, iban: "", accountNumber: "1      2" }],
    }),
    null,
  );
});

test("an invalid account is hidden independently while valid banks remain available", () => {
  const config = readSupportConfig({
    enabled: true,
    recipient,
    bankAccounts: [bank, { ...bank, id: "fixture-invalid", iban: "BA00" }, internationalBank],
  });
  assert.ok(config);
  assert.deepEqual(
    config.bankAccounts.map((account) => account.id),
    [bank.id, internationalBank.id],
  );
  assert.equal(config.paypalUrl, null);
  assert.equal(bankTransferText(config, "fixture-invalid"), "");
});

test("duplicate account identifiers cannot select ambiguous receiving instructions", () => {
  const config = readSupportConfig({
    enabled: true,
    recipient,
    bankAccounts: [bank, { ...internationalBank, id: bank.id }, internationalBank],
  });
  assert.ok(config);
  assert.deepEqual(
    config.bankAccounts.map((account) => account.id),
    [internationalBank.id],
  );
  assert.equal(bankTransferText(config, bank.id), "");
  assert.equal(
    readSupportConfig({
      enabled: true,
      recipient,
      bankAccounts: [bank, { ...internationalBank, id: bank.id }],
    }),
    null,
  );
});

test("multiple accounts retain their own identifiers, labels and optional receiving details", () => {
  const config = readSupportConfig({
    enabled: true,
    recipient,
    bankAccounts: [bank, { ...internationalBank, bic: "westgb2l" }],
  });
  assert.ok(config);
  assert.deepEqual(config.bankAccounts, [
    {
      ...bank,
      iban: "BA391290079401028494",
      accountNumber: null,
      bic: null,
      address: null,
      note: null,
    },
    { ...internationalBank, iban: "GB82WEST12345698765432" },
  ]);
});

test("copied bank instructions identify only the selected bank and the shared recipient and purpose", () => {
  const config = readSupportConfig({
    enabled: true,
    recipient,
    bankAccounts: [bank, internationalBank],
  });
  assert.ok(config);
  assert.equal(
    bankTransferText(config, bank.id),
    [
      "Primalac: Probni primalac",
      "Banka: Fixture banka",
      "IBAN: BA391290079401028494",
      "Svrha uplate: Podrška razvoju AhiBizza",
    ].join("\n"),
  );
  assert.equal(
    bankTransferText({ ...config, purpose: "Probna svrha uplate" }, internationalBank.id),
    [
      "Primalac: Probni primalac",
      "Banka: International fixture bank",
      "IBAN: GB82WEST12345698765432",
      "Broj računa: 000-000-00000000-01",
      "SWIFT/BIC: WESTGB2L",
      "Adresa banke: Fixture Street 12, Example City",
      "Napomena: Probna napomena međunarodnog računa",
      "Svrha uplate: Probna svrha uplate",
    ].join("\n"),
  );
  assert.equal(bankTransferText(config, "unknown-account"), "");
  assert.equal(bankTransferText(config, ""), "");
  assert.equal(bankTransferText({ ...config, bankAccounts: [] }, bank.id), "");
});
