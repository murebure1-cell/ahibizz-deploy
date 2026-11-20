import assert from "node:assert/strict";
import test from "node:test";
import {
  type AccountSection,
  accountReturnPath,
  accountSection,
  accountSectionPath,
  readAccountNavigation,
} from "../src/lib/account-return";

test("sign-in accepts only exact known administration continuations", () => {
  for (const path of [
    "/administracija",
    "/administracija/uvoz-prijava",
    "/administracija/lokacije",
    "/administracija?odjeljak=danas",
    "/administracija?odjeljak=odobrenja",
    "/administracija?odjeljak=pregled",
    "/administracija?odjeljak=obracuni",
    "/administracija?odjeljak=transakcije",
    "/administracija?odjeljak=nalozi",
    "/administracija?odjeljak=kategorije",
    "/administracija?odjeljak=djelatnosti",
    "/administracija?odjeljak=naplata",
    "/administracija?odjeljak=recenzije",
  ])
    assert.equal(accountReturnPath(path), path);
  for (const path of [
    "/administracija/",
    "/administracija/uvoz-prijava?next=/nalog",
    "/administracija/uvoz-prijava/",
    "/administracija/lokacije?next=//evil.invalid",
    "/administracija/lokacije/",
    "/administracija?odjeljak=recenzije&next=//evil.invalid",
    "/administracija?odjeljak=naplata#other",
    "/administracija?odjeljak=naplata&odjeljak=nalozi",
    "/administracija?odjeljak=constructor",
    "/administracija?odjeljak=%6eaplata",
    "/administracija?odjeljak=naplata&next=//evil.invalid",
    "/administracija?odjeljak=naplata\n",
    "//evil.invalid/administracija",
  ])
    assert.equal(accountReturnPath(path), "/nalog");
});

test("login retains only exact known messaging destinations and previous safe profile routes", () => {
  const business = "11111111-1111-4111-8111-111111111111";
  for (const value of [
    "/nalog?odjeljak=profil",
    "/nalog?odjeljak=djelatnosti",
    "/nalog?odjeljak=termini",
    "/nalog?odjeljak=prijatelji",
    "/nalog?odjeljak=poruke",
    "/nalog?odjeljak=postavke",
    "/nalog?odjeljak=oglasi&usluga=produkcija",
    "/nalog?odjeljak=paketi",
    "/nalog?odjeljak=poruke&osoba=person_1-A",
    `/nalog?odjeljak=poruke&djelatnost=${business}`,
    `/djelatnosti/${business}#business-appointments`,
    `/djelatnosti/${business}#recenzije`,
    "/ljudi/person_A-1",
    `/naplata?ponuda=${business}`,
  ])
    assert.equal(accountReturnPath(value), value);
  for (const value of [
    undefined,
    `/naplata?ponuda=${business}&iznos=1`,
    "/naplata?ponuda=//evil.invalid",
    "/nalog?odjeljak=oglasi&usluga=produkcija&nastavi=//evil.invalid",
    null,
    [],
    {},
    "https://evil.invalid/nalog?odjeljak=poruke",
    "//evil.invalid/nalog?odjeljak=poruke",
    "/nalog?dio=poruke&osoba=a",
    "/nalog?odjeljak=poruke&osoba=",
    "/nalog?odjeljak=poruke&osoba=a&osoba=b",
    "/nalog?odjeljak=poruke&osoba=a&djelatnost=b",
    "/nalog?odjeljak=poruke&osoba=../../admin",
    "/nalog?odjeljak=poruke&osoba=%2f%2fevil.invalid",
    "/nalog?odjeljak=poruke&osoba=a#other",
    "/nalog?odjeljak=poruke&osoba=a&next=https://evil.invalid",
    "/nalog?odjeljak=poruke&osoba=a\n",
    "/nalog?odjeljak=poruke&osoba=a\\b",
    "/nalog?odjeljak=termini&odjeljak=poruke",
    "/nalog?odjeljak=djelatnosti&next=https://evil.invalid",
    "/nalog?odjeljak=termini#other",
    "/nalog?odjeljak=postavke&odjeljak=profil",
    "/nalog?odjeljak=postavke&appearance=dark",
    "/nalog?odjeljak=paketi&pretplata=paid",
    "/nalog?odjeljak=constructor",
    "/nalog?odjeljak=%74ermini",
    "/nalog?odjeljak=poruke%26osoba%3Dsomeone",
    "/nalog?odjeljak=poruke&djelatnost=forma",
    `/nalog?odjeljak=poruke&osoba=${"a".repeat(129)}`,
    `/djelatnosti/${business}#recenzije?next=//evil.invalid`,
    `/djelatnosti/${business}#%72ecenzije`,
    `/djelatnosti/${business}?next=//evil.invalid#recenzije`,
  ])
    assert.equal(accountReturnPath(value), "/nalog", JSON.stringify(value));
});

test("known account deep links retain their section through sign-in without exposing new sections", () => {
  const sections = [
    ["profil", "profile"],
    ["djelatnosti", "businesses"],
    ["termini", "appointments"],
    ["prijatelji", "connections"],
    ["poruke", "messages"],
    ["postavke", "settings"],
    ["paketi", "membership"],
  ] as const;
  for (const [query, expected] of sections) {
    const loginReturn = accountReturnPath(`/nalog?odjeljak=${query}`);
    assert.equal(
      accountSection(
        new URL(loginReturn, "https://app.example.invalid").searchParams.get("odjeljak"),
      ),
      expected,
    );
  }
  for (const value of [
    undefined,
    null,
    [],
    ["termini", "poruke"],
    { toString: () => "djelatnosti" },
    "postavke&appearance=dark",
    "constructor",
    "__proto__",
    "TERMINI",
    "termini&next=elsewhere",
  ])
    assert.equal(accountSection(value), "profile");
});

test("account pane addresses round-trip for refresh and browser history without old message targets", () => {
  for (const section of [
    "overview",
    "profile",
    "businesses",
    "appointments",
    "connections",
    "messages",
    "settings",
    "membership",
    "advertising",
    "credits",
  ] as const) {
    const href = accountSectionPath(section);
    assert.equal(accountReturnPath(href), href);
    const navigation = readAccountNavigation(
      new URL(href, "https://app.example.invalid").searchParams,
    );
    assert.equal(navigation.section, section);
    assert.equal(navigation.messageTarget, undefined);
    assert.equal(navigation.invalidMessageTarget, false);
    assert.equal(href.includes("osoba="), false);
    assert.equal(href.includes("djelatnost="), false);
  }
  for (const value of ["constructor", "__proto__", "//evil.invalid", "appointments&osoba=other"])
    assert.equal(accountSectionPath(value as AccountSection), "/nalog?odjeljak=profil");
});

test("browser account navigation takes message intent only from the current exact message query", () => {
  const business = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(readAccountNavigation(new URLSearchParams("odjeljak=poruke&osoba=person_A-1")), {
    section: "messages",
    messageTarget: { kind: "person", targetId: "person_A-1" },
    invalidMessageTarget: false,
  });
  assert.deepEqual(
    readAccountNavigation(new URLSearchParams(`odjeljak=poruke&djelatnost=${business}`)),
    {
      section: "messages",
      messageTarget: { kind: "business", targetId: business },
      invalidMessageTarget: false,
    },
  );
  for (const query of [
    "odjeljak=profil&osoba=old",
    "odjeljak=unknown&osoba=old",
    "odjeljak=poruke&odjeljak=profil&osoba=old",
    "odjeljak=poruke&odjeljak=poruke&osoba=old",
  ]) {
    const navigation = readAccountNavigation(new URLSearchParams(query));
    assert.equal(navigation.section, "profile");
    assert.equal(navigation.messageTarget, undefined);
    assert.equal(navigation.invalidMessageTarget, false);
  }
  assert.equal(readAccountNavigation(new URLSearchParams()).section, "overview");
  assert.deepEqual(readAccountNavigation(new URLSearchParams("odjeljak=postavke&osoba=old")), {
    section: "settings",
    invalidMessageTarget: false,
  });
  for (const query of [
    "odjeljak=poruke&osoba=",
    "odjeljak=poruke&osoba=a&osoba=b",
    `odjeljak=poruke&osoba=a&djelatnost=${business}`,
    "odjeljak=poruke&djelatnost=not-a-business-id",
    "odjeljak=poruke&osoba=../../admin",
    "odjeljak=poruke&osoba=a&next=https://evil.invalid",
  ])
    assert.deepEqual(readAccountNavigation(new URLSearchParams(query)), {
      section: "messages",
      invalidMessageTarget: true,
    });
});
