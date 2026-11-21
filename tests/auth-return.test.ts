import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { authReturnLinks } from "../src/lib/auth-return";

const origin = "https://fixture.invalid";
const booking = "/djelatnosti/11111111-1111-4111-8111-111111111111#business-appointments";
const continuation = (path: string) => new URL(path, origin).searchParams.get("nastavi");

test("a booking continuation survives registration, email confirmation and sign-in", () => {
  const signIn = authReturnLinks(booking);
  const registrationDestination = continuation(signIn.registration);
  assert.equal(registrationDestination, booking);
  const registration = authReturnLinks(registrationDestination);
  const confirmation = new URL(registration.verification, origin);
  assert.equal(confirmation.pathname, "/prijava");
  assert.equal(confirmation.searchParams.get("potvrdeno"), "1");
  assert.equal(confirmation.hash, "");
  assert.equal(confirmation.searchParams.getAll("nastavi").length, 1);
  assert.equal(confirmation.searchParams.get("nastavi"), booking);
  assert.equal(accountReturnPath(continuation(registration.verification)), booking);
  assert.equal(accountReturnPath(continuation(registration.login)), booking);
});

test("existing allowed account and message destinations remain single nested values", () => {
  for (const destination of [
    "/nalog?odjeljak=djelatnosti",
    "/nalog?odjeljak=djelatnosti&novo=1",
    "/nalog?odjeljak=postavke&prikaz=obavijesti",
    "/nalog?odjeljak=poruke&osoba=person_A-1",
    "/administracija?odjeljak=djelatnosti",
    "/ljudi/person_A-1",
  ]) {
    const links = authReturnLinks(destination);
    for (const path of Object.values(links)) {
      const url = new URL(path, origin);
      assert.equal(url.origin, origin);
      assert.equal(url.hash, "");
      assert.equal(url.searchParams.get("nastavi"), destination);
      assert.equal(url.searchParams.getAll("nastavi").length, 1);
      assert.equal(url.searchParams.has("osoba"), false);
      assert.equal(url.searchParams.has("odjeljak"), false);
    }
  }
});

test("foreign, duplicate, control and encoded destinations fall back without nested injection", () => {
  for (const destination of [
    undefined,
    null,
    [],
    [booking, "/nalog?odjeljak=poruke"],
    { toString: () => booking },
    "/nalog",
    "https://evil.invalid/nalog",
    "//evil.invalid",
    "/\\evil.invalid",
    "/prijava?nastavi=//evil.invalid",
    encodeURIComponent(booking),
    encodeURIComponent(encodeURIComponent(booking)),
    `${booking}&nastavi=//evil.invalid`,
    `${booking}\n`,
    `${booking}\u0000`,
    "/nalog?odjeljak=poruke&osoba=%2f%2fevil.invalid",
    "/nalog?odjeljak=%74ermini",
    "/nalog?odjeljak=termini&odjeljak=poruke",
    "/nalog?odjeljak=termini%26nastavi%3D%2f%2fevil.invalid",
    "/nalog?odjeljak=postavke&prikaz=obavijesti&next=//evil.invalid",
  ]) {
    assert.deepEqual(authReturnLinks(destination), {
      login: "/prijava",
      registration: "/registracija",
      verification: "/prijava?potvrdeno=1",
    });
  }
});

test("checkout continuation survives login with only an internal order UUID", () => {
  for (const path of [
    "/naplata",
    "/naplata/povratak?narudzba=00000000-0000-4000-8000-000000000001",
    "/naplata/odustajanje?narudzba=00000000-0000-4000-8000-000000000001",
  ])
    assert.equal(continuation(authReturnLinks(path).login), path);
  for (const path of [
    "/naplata?narudzba=invalid",
    "/naplata?next=https://evil.invalid",
    "/naplata//evil.invalid",
    "/naplata/povratak?narudzba=00000000-0000-4000-8000-000000000001&token=not-needed",
  ])
    assert.equal(accountReturnPath(path), "/nalog");
});
