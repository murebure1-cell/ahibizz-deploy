import assert from "node:assert/strict";
import test from "node:test";
import { headerCurrentDestination, headerDestinations } from "../src/lib/header-navigation";

const browser = { installed: false, playEdition: false, supportAvailable: true };

test("guest menu contains public destinations and members can reach their inbox", () => {
  const guest = headerDestinations("guest", browser);
  assert.deepEqual(
    guest.primary.map((item) => item.href),
    ["/", "/pretraga", "/ljudi"],
  );
  assert.ok(guest.more.some((item) => item.href === "/paketi"));
  for (const access of ["member", "owner"] as const) {
    const { primary, more } = headerDestinations(access, browser);
    assert.deepEqual(
      primary.map((item) => item.href),
      ["/", "/pretraga", "/ljudi", "/nalog", "/nalog?odjeljak=poruke"],
    );
    assert.equal(
      more.some((item) => item.href === "/paketi"),
      false,
    );
  }
  const unknown = headerDestinations("unknown", browser);
  assert.ok(unknown.primary.some((item) => item.href === "/nalog"));
  assert.equal(
    unknown.primary.some((item) => item.href.includes("poruke")),
    false,
  );
});

test("Play menu hides external billing and installation while retaining privacy", () => {
  for (const access of ["unknown", "guest", "member", "owner"] as const) {
    const { primary, more } = headerDestinations(access, { ...browser, playEdition: true });
    assert.ok(more.some((item) => item.href === "/privatnost"));
    assert.ok(
      [...primary, ...more].every(
        (item) => !["/paketi", "/podrzi", "/instaliraj"].includes(item.href),
      ),
    );
  }
  assert.equal(
    headerDestinations("member", { ...browser, installed: true }).more.some(
      (item) => item.href === "/instaliraj",
    ),
    false,
  );
  assert.equal(
    headerDestinations("guest", { ...browser, supportAvailable: false }).more.some(
      (item) => item.href === "/podrzi",
    ),
    false,
  );
});

test("header selection follows profiles, account subsections and back navigation", () => {
  for (const [path, search, selected] of [
    ["/nalog", "odjeljak=poruke&osoba=test", "/nalog?odjeljak=poruke"],
    ["/nalog", "odjeljak=poruke&odjeljak=postavke", "/nalog"],
    ["/nalog", "odjeljak=postavke", "/nalog"],
    ["/ljudi/test", "", "/ljudi"],
    ["/djelatnosti/test", "", "/pretraga"],
    ["/administracija/uvoz-prijava", "", "/administracija"],
    ["/paketi/proba", "", "/paketi"],
    ["/privatnost", "", "/privatnost"],
  ] as const)
    assert.equal(headerCurrentDestination(path, new URLSearchParams(search)), selected);
});
