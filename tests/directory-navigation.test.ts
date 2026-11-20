import assert from "node:assert/strict";
import test from "node:test";
import { directorySearchSuffix } from "../src/lib/directory-navigation";

test("a public profile can return to the same results, city, placement and page", () => {
  const values = {
    q: "masaža & njega",
    mjesto: "Živinice",
    categoryId: "zdravlje",
    subcategoryId: "terapija",
    istaknute: "kategorija",
    page: "2",
  };
  const url = new URL(`/pretraga${directorySearchSuffix(values)}`, "https://ahibizz.example");
  assert.deepEqual(Object.fromEntries(url.searchParams), values);
});

test("an unfiltered profile returns to the directory; unrelated URL data is discarded", () => {
  assert.equal(directorySearchSuffix({}), "");
  const values = { q: ["two", "values"], page: "777", istaknute: "x", next: "//example.org" };
  assert.equal(directorySearchSuffix(values), "");
});
