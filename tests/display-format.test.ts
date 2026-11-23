import assert from "node:assert/strict";
import test from "node:test";
import { bookingDate } from "../src/lib/booking";
import { formatArticleDate } from "../src/lib/content-hub";
import { accountDate } from "../src/lib/display-date";

test("booking, articles and account dates share padded Sarajevo calendar dates", () => {
  const instant = "2026-12-31T23:30:00Z";
  assert.equal(accountDate(instant), "01. 01. 2027.");
  assert.equal(formatArticleDate(new Date(instant)), "01. 01. 2027.");
  assert.equal(bookingDate(instant, "Europe/Sarajevo"), "01. 01. 2027.");
  assert.equal(bookingDate(instant, "UTC"), "31. 12. 2026.");
});
