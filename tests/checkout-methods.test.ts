import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { billingPackages } from "../src/lib/billing";

test("checkout app entry does not replace original package prices or expose Dodo test route", () => {
  assert.deepEqual(
    billingPackages.map((p) => p.monthlyMinor),
    [2900, 4900, 8900],
  );
  const entry = readFileSync("src/components/billing/CheckoutEntry.tsx", "utf8");
  const checkout = readFileSync("src/components/billing/Checkout.tsx", "utf8");
  assert.match(entry, /<Checkout\b/);
  assert.doesNotMatch(entry + checkout, /dodo-proba|Pregledaj PayPal i kartice/);
  assert.match(checkout, /href="\/podrzi"/);
  assert.match(checkout, /catalog\?\.environment === "sandbox"/);
  assert.match(checkout, /catalog\?\.available === false/);
  assert.match(
    readFileSync("src/components/billing/PricingCatalog.tsx", "utf8"),
    /href="\/naplata"/,
  );
  assert.match(
    readFileSync("src/components/directory/BusinessManager.tsx", "utf8"),
    /\/naplata\?djelatnost=/,
  );
});
