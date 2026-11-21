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
  assert.deepEqual(
    guest.business.map((item) => item.href),
    ["/oglasavanje", "/paketi"],
  );
  for (const access of ["member", "owner"] as const) {
    const { primary, business } = headerDestinations(access, browser);
    assert.deepEqual(
      primary.map((item) => item.href),
      ["/", "/pretraga", "/ljudi", "/nalog", "/nalog?odjeljak=poruke"],
    );
    assert.deepEqual(
      business.map((item) => item.href),
      ["/oglasavanje", "/paketi"],
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
    const { primary, business, more } = headerDestinations(access, {
      ...browser,
      playEdition: true,
    });
    assert.deepEqual(business, []);
    assert.ok(more.some((item) => item.href === "/privatnost"));
    assert.ok(
      [...primary, ...business, ...more].every(
        (item) => !["/oglasavanje", "/paketi", "/podrzi", "/instaliraj"].includes(item.href),
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
    ["/nalog", "odjeljak=postavke", "/nalog?odjeljak=postavke"],
    ["/nalog", "odjeljak=paketi", "/nalog?odjeljak=paketi"],
    ["/ljudi/test", "", "/ljudi"],
    ["/djelatnosti/test", "", "/pretraga"],
    ["/administracija/uvoz-prijava", "", "/administracija"],
    ["/paketi/proba", "", "/paketi"],
    ["/naplata/povratak", "", "/oglasavanje"],
    ["/privatnost", "", "/privatnost"],
  ] as const)
    assert.equal(headerCurrentDestination(path, new URLSearchParams(search)), selected);
});
