import assert from "node:assert/strict";
import test from "node:test";
import { bookingDate } from "../src/lib/booking";
import { formatArticleDate } from "../src/lib/content-hub";
import { accountDate } from "../src/lib/display-date";
import { checkoutEuro } from "../src/lib/paypal-card-flow";

test("booking, articles and account dates share padded Sarajevo calendar dates", () => {
  const instant = "2026-12-31T23:30:00Z";
  assert.equal(accountDate(instant), "01. 01. 2027.");
  assert.equal(formatArticleDate(new Date(instant)), "01. 01. 2027.");
  assert.equal(bookingDate(instant, "Europe/Sarajevo"), "01. 01. 2027.");
  assert.equal(bookingDate(instant, "UTC"), "31. 12. 2026.");
});

test("historical euro checkout amounts retain cents and Bosnian thousands separators", () => {
  assert.equal(checkoutEuro(511), "5,11 EUR");
  assert.equal(checkoutEuro(123456), "1.234,56 EUR");
  assert.equal(checkoutEuro(0), "0,00 EUR");
});
