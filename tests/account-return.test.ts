import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath, accountSection } from "../src/lib/account-return";

test("login retains only exact known messaging destinations and previous safe profile routes", () => {
  const business = "11111111-1111-4111-8111-111111111111";
  for (const value of [
    "/nalog?odjeljak=profil",
    "/nalog?odjeljak=djelatnosti",
    "/nalog?odjeljak=termini",
    "/nalog?odjeljak=prijatelji",
    "/nalog?odjeljak=poruke",
    "/nalog?odjeljak=poruke&osoba=person_1-A",
    `/nalog?odjeljak=poruke&djelatnost=${business}`,
    `/djelatnosti/${business}#business-appointments`,
    "/ljudi/person_A-1",
  ])
    assert.equal(accountReturnPath(value), value);
  for (const value of [
    undefined,
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
    "/nalog?odjeljak=postavke",
    "/nalog?odjeljak=constructor",
    "/nalog?odjeljak=%74ermini",
    "/nalog?odjeljak=poruke%26osoba%3Dsomeone",
    "/nalog?odjeljak=poruke&djelatnost=forma",
    `/nalog?odjeljak=poruke&osoba=${"a".repeat(129)}`,
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
    "postavke",
    "constructor",
    "__proto__",
    "TERMINI",
    "termini&next=elsewhere",
  ])
    assert.equal(accountSection(value), "profile");
});
