import assert from "node:assert/strict";
import test from "node:test";
import {
  type AdminSection,
  adminReturnPath,
  adminSection,
  adminSectionPath,
  readAdminNavigation,
} from "../src/lib/admin-navigation";

const sections = [
  ["nalozi", "accounts"],
  ["kategorije", "categories"],
  ["djelatnosti", "businesses"],
  ["naplata", "billing"],
  ["recenzije", "reviews"],
] as const;

test("known administrative panes round-trip through browser and server query parsing", () => {
  for (const [query, section] of sections) {
    const path = `/administracija?odjeljak=${query}`;
    assert.equal(adminSection(query), section);
    assert.equal(adminSectionPath(section), path);
    assert.equal(
      readAdminNavigation(new URL(path, "https://fixture.invalid").searchParams),
      section,
    );
    assert.equal(adminReturnPath(path), path);
  }
  assert.equal(adminReturnPath("/administracija"), "/administracija");
  assert.equal(adminReturnPath("/administracija/uvoz-prijava"), "/administracija/uvoz-prijava");
  assert.equal(adminReturnPath("/administracija/lokacije"), "/administracija/lokacije");
});

test("unknown, duplicate and prototype query values cannot select another administrative pane", () => {
  for (const value of [
    undefined,
    null,
    [],
    ["naplata"],
    ["naplata", "kategorije"],
    {},
    "",
    "constructor",
    "__proto__",
    "toString",
    "NAPLATA",
    "naplata&next=elsewhere",
    "https://evil.invalid",
  ])
    assert.equal(adminSection(value), "accounts");
  for (const query of [
    "",
    "odjeljak=unknown",
    "odjeljak=naplata&odjeljak=naplata",
    "odjeljak=naplata&odjeljak=kategorije",
    "odjeljak=constructor",
    "odjeljak=__proto__",
    "odjeljak=naplata%26odjeljak%3Dkategorije",
  ])
    assert.equal(readAdminNavigation(new URLSearchParams(query)), "accounts");
});

test("login destinations accept only the exact closed administrative paths", () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    "https://fixture.invalid/administracija",
    "//evil.invalid/administracija",
    "/administracija/",
    "/administracija/uvoz-prijava/",
    "/administracija/uvoz-prijava?odjeljak=nalozi",
    "/administracija/uvoz-prijava#other",
    "/administracija/%75voz-prijava",
    "/administracija/uvoz-prijava\n",
    "/administracija/lokacije/",
    "/administracija/lokacije#other",
    "/administracija/lokacije?next=/nalog",
    "/administracija?odjeljak=unknown",
    "/administracija?odjeljak=constructor",
    "/administracija?odjeljak=__proto__",
    "/administracija?odjeljak=naplata&odjeljak=naplata",
    "/administracija?odjeljak=naplata&next=https://evil.invalid",
    "/administracija?odjeljak=%6eaplata",
    "/administracija?odjeljak=naplata#other",
    "/administracija#other",
    "/administracija?next=/nalog",
    "/administracija?odjeljak=naplata\n",
    "/administracija?odjeljak=naplata\r",
    "/administracija?odjeljak=naplata ",
  ])
    assert.equal(adminReturnPath(value), null, JSON.stringify(value));
});

test("a pane selection produces a canonical address without old query values or anchors", () => {
  const previous = new URL(
    "/administracija?odjeljak=kategorije&next=https://evil.invalid#stale",
    "https://fixture.invalid",
  );
  const next = adminSectionPath(readAdminNavigation(previous.searchParams));
  assert.equal(next, "/administracija?odjeljak=kategorije");
  for (const value of ["constructor", "__proto__", "//evil.invalid", "billing&role=owner"])
    assert.equal(adminSectionPath(value as AdminSection), "/administracija?odjeljak=nalozi");
});
