import assert from "node:assert/strict";
import test from "node:test";
import { homeCategories, homePlace } from "../src/lib/home";

test("home location accepts one bounded place and discards duplicate or control-character input", () => {
  assert.equal(homePlace(" Tuzla "), "Tuzla");
  assert.equal(homePlace("Živinice"), "Živinice");
  assert.equal(homePlace("a".repeat(200)).length, 100);
  for (const value of [undefined, null, [], ["Tuzla", "Sarajevo"], {}, "Tuzla\n", "\u0000Tuzla"])
    assert.equal(homePlace(value), "");
});

test("live home shortcuts retain every parent category and the live search contract", () => {
  const categories = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Zdravlje", parentId: null },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Masaža",
      parentId: "11111111-1111-4111-8111-111111111111",
    },
    { id: "33333333-3333-4333-8333-333333333333", name: "Dom i uređenje", parentId: null },
  ];
  const links = homeCategories(categories);
  assert.equal(links.length, 2);
  assert.equal(links[0]?.label, "Zdravlje");
  assert.equal(links[1]?.label, "Dom i uređenje");
  assert.equal(links[0]?.icon, "heart");
  assert.equal(links[1]?.icon, "home");
  for (const item of links) {
    const url = new URL(item.href, "https://app.example.invalid");
    assert.equal(url.pathname, "/pretraga");
    assert.deepEqual([...url.searchParams], [["categoryId", item.id]]);
    assert.ok(categories.some((category) => category.id === item.id && category.parentId === null));
  }
  assert.deepEqual(homeCategories([]), []);
  assert.equal(
    homeCategories(
      Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        name: String(index),
        parentId: null,
      })),
    ).length,
    20,
  );
});

test("home shortcuts distinguish hospitality and services without changing category destinations", () => {
  const links = homeCategories([
    { id: "food", name: "Ugostiteljski objekti", parentId: null },
    { id: "service", name: "Servisi", parentId: null },
    { id: "unknown", name: "Ostalo", parentId: null },
    { id: "stays", name: "Smještaj", parentId: null, accommodation: true },
  ]);
  assert.deepEqual(
    links.map(({ icon }) => icon),
    ["coffee", "shop", "shop", "bed"],
  );
  assert.deepEqual(
    links.map(({ href }) => href),
    [
      "/pretraga?categoryId=food",
      "/pretraga?categoryId=service",
      "/pretraga?categoryId=unknown",
      "/pretraga?categoryId=stays",
    ],
  );
});
