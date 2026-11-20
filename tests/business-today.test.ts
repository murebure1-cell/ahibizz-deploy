import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath, readAccountNavigation } from "../src/lib/account-return";
import { businessInquiryPath, ownerCalendarPath } from "../src/lib/business-today";

const id = "11111111-1111-4111-8111-111111111111";
test("owner quick links preserve the exact business, appointments day and existing business thread across login", () => {
  for (const target of [
    { kind: "service" as const, businessId: id, day: "2026-12-01" },
    { kind: "rental" as const, businessId: id },
    { kind: "stay" as const, businessId: id },
  ]) {
    const path = ownerCalendarPath(target);
    assert.equal(accountReturnPath(path), path);
    assert.deepEqual(
      readAccountNavigation(new URL(path, "https://fixture.invalid").searchParams).calendarTarget,
      target,
    );
  }
  const inquiry = businessInquiryPath(id);
  assert.equal(accountReturnPath(inquiry), inquiry);
  assert.equal(
    readAccountNavigation(new URL(inquiry, "https://fixture.invalid").searchParams).businessThread,
    id,
  );
  for (const invalid of [
    ownerCalendarPath({ kind: "service", businessId: id, day: "2026-02-30" }),
    `${inquiry}&osoba=other`,
    `${inquiry}&razgovor=${id}`,
    ownerCalendarPath({ kind: "stay", businessId: id, day: "2026-01-01" }),
  ])
    assert.equal(accountReturnPath(invalid), "/nalog");
});
