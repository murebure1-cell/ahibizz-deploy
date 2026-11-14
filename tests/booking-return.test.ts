import assert from "node:assert/strict";
import test from "node:test";
import { bookingReturnPath } from "../src/lib/booking-return";

test("booking login return accepts only an exact same-app profile and appointment anchor", () => {
  const path = "/djelatnosti/11111111-1111-4111-8111-111111111111";
  assert.equal(bookingReturnPath(path), path);
  assert.equal(bookingReturnPath(`${path}#business-appointments`), `${path}#business-appointments`);
  for (const value of [
    undefined,
    null,
    [],
    "https://evil.invalid",
    "//evil.invalid",
    "javascript:alert(1)",
    `${path}?next=https://evil.invalid`,
    `${path}/../../prijava`,
    `${path}#other`,
    `${path}\n`,
  ])
    assert.equal(bookingReturnPath(value), "/nalog");
});

test("login return accepts an exact person ID without query, traversal or authority", () => {
  assert.equal(bookingReturnPath("/ljudi/person_ABC-123"), "/ljudi/person_ABC-123");
  for (const value of [
    "/ljudi/",
    "/ljudi/me?admin=true",
    "/ljudi/a/../b",
    "/ljudi/a#x",
    "/ljudi/%2f%2fevil.invalid",
    "/ljudi/a\n",
  ])
    assert.equal(bookingReturnPath(value), "/nalog");
});
