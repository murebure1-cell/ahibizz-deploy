import assert from "node:assert/strict";
import test from "node:test";
import { businessInitials } from "../src/lib/google-maps-loader";

test("map pins use up to two initials of the business name", () => {
  assert.equal(businessInitials("Eden restoran i igraonica"), "ER");
  assert.equal(businessInitials('Javni transport tereta "Er-trans" Tuzla'), "JT");
  assert.equal(businessInitials("amd.ba"), "AB");
  assert.equal(businessInitials("Šeher"), "Š");
  assert.equal(businessInitials("  123 "), "A");
});
