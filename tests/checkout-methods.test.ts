import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { billingPackages } from "../src/lib/billing";
import { paypalAvailabilityText } from "../src/lib/checkout-methods";

test("checkout methods distinguish loading, unavailable, sandbox and explicitly live availability", () => {
  assert.match(paypalAvailabilityText(null), /Provjeravam/);
  assert.match(paypalAvailabilityText(null, true), /nije potvrđeno/);
  assert.match(paypalAvailabilityText({ available: false, environment: "live" }), /nije uključeno/);
  assert.match(
    paypalAvailabilityText({ available: true, environment: "sandbox" }),
    /bez stvarnog novca/,
  );
  assert.match(paypalAvailabilityText({ available: true, environment: null }), /nije dostupno/);
  assert.match(paypalAvailabilityText({ available: true, environment: "live" }), /^Dostupno/);
});
test("checkout app entry does not replace original package prices or expose Dodo test route", () => {
  assert.deepEqual(
    billingPackages.map((p) => p.monthlyMinor),
    [2900, 4900, 8900],
  );
  const selector = readFileSync("src/components/billing/CheckoutMethods.tsx", "utf8");
  assert.match(selector, /<button type="button" disabled aria-describedby="dodo-availability">/);
  assert.doesNotMatch(selector, /href=[^\n]*dodo-proba/);
  assert.match(
    readFileSync("src/components/billing/PricingCatalog.tsx", "utf8"),
    /href="\/naplata"/,
  );
  assert.match(
    readFileSync("src/components/directory/BusinessManager.tsx", "utf8"),
    /href="\/naplata"/,
  );
});
