import assert from "node:assert/strict";
import test from "node:test";
import { type AppMenuGroup, appMenuGroups, languagePath } from "../src/lib/app-menu";

const browser = { installed: false, playEdition: false, supportAvailable: true };
const labels = (groups: AppMenuGroup[], id: string) =>
  groups.find((group) => group.id === id)?.rows.map((row) => row.label) ?? null;
const hrefs = (groups: AppMenuGroup[]) =>
  groups.flatMap((group) => group.rows.map((row) => row.href)).filter(Boolean);

test("a guest gets the language and the public places, and nothing of an account", () => {
  const groups = appMenuGroups("guest", browser);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["app", "ahibizz", "help"],
  );
  assert.deepEqual(labels(groups, "app"), ["Jezik"]);
  assert.ok(hrefs(groups).includes(languagePath));
  assert.ok(!hrefs(groups).some((href) => href?.startsWith("/nalog")));
  assert.ok(!hrefs(groups).includes("/administracija"));
});

test("a member gets the account rows and the two ways to delete", () => {
  const groups = appMenuGroups("member", browser);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["account", "ahibizz", "help", "delete"],
  );
  assert.deepEqual(labels(groups, "account"), [
    "Postavke",
    "Jezik",
    "Obavijesti",
    "Sačuvano",
    "Bedževi",
  ]);
  assert.deepEqual(labels(groups, "delete"), ["Brisanje djelatnosti", "Brisanje profila"]);
  assert.ok(!hrefs(groups).includes("/administracija"));
});

test("only the owner sees the way into administration", () => {
  const groups = appMenuGroups("owner", browser);
  assert.deepEqual(labels(groups, "admin"), ["Upravljanje platformom", "Odvojena administracija"]);
  assert.ok(hrefs(groups).includes("/administracija"));
});

test("what is announced but not built leads nowhere", () => {
  const rows = appMenuGroups("member", browser).flatMap((group) => group.rows);
  const soon = rows.filter((row) => row.href === undefined).map((row) => row.label);
  assert.deepEqual(soon, ["Bedževi", "Ahi zajednica", "Ahi investment"]);
});

test("donating and installing follow the edition and the device", () => {
  const help = (options: typeof browser) => labels(appMenuGroups("guest", options), "help") ?? [];
  assert.ok(help(browser).includes("Doniraj"));
  assert.ok(help(browser).includes("Instaliraj aplikaciju"));
  assert.ok(!help({ ...browser, installed: true }).includes("Instaliraj aplikaciju"));
  assert.ok(!help({ ...browser, supportAvailable: false }).includes("Doniraj"));
  // The Play edition offers neither: the store installs it and payments are not part of it.
  const play = help({ ...browser, playEdition: true });
  assert.ok(!play.includes("Doniraj") && !play.includes("Instaliraj aplikaciju"));
});

test("every place is listed once", () => {
  for (const access of ["guest", "member", "owner"] as const) {
    const all = hrefs(appMenuGroups(access, browser));
    // Deleting a business starts in the list of businesses, which the profile also opens.
    assert.equal(new Set(all).size, all.length, access);
  }
});
