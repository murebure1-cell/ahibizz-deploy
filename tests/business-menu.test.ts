import assert from "node:assert/strict";
import test from "node:test";
import { menuPrice, parseMenuPrice, readBusinessMenu } from "../src/lib/business-menu";

test("menu input is normalised and anything else is refused", () => {
  assert.deepEqual(
    readBusinessMenu({
      items: [
        { name: "  Begova   čorba ", priceCents: 700 },
        { name: "Sahan", priceCents: null },
      ],
      meat: [{ kind: "Piletina", supplier: "Mesnica Tabaković" }],
    }),
    {
      items: [
        { name: "Begova čorba", priceCents: 700 },
        { name: "Sahan", priceCents: null },
      ],
      meat: [{ kind: "Piletina", supplier: "Mesnica Tabaković" }],
    },
  );
  for (const wrong of [
    null,
    { items: [], meat: {} },
    { items: [{ name: "", priceCents: 1 }], meat: [] },
    { items: [{ name: "x", priceCents: -1 }], meat: [] },
    { items: [{ name: "x", priceCents: 1.5 }], meat: [] },
    { items: [], meat: [{ kind: "Piletina", supplier: "" }] },
    { items: Array.from({ length: 61 }, () => ({ name: "x", priceCents: 1 })), meat: [] },
  ])
    assert.throws(() => readBusinessMenu(wrong));
});

test("prices read and print as KM", () => {
  assert.equal(parseMenuPrice("7"), 700);
  assert.equal(parseMenuPrice("16,50 KM"), 1650);
  assert.equal(parseMenuPrice("16.5"), 1650);
  assert.equal(parseMenuPrice(""), null);
  assert.equal(parseMenuPrice("abc"), undefined);
  assert.equal(menuPrice(700), "7 KM");
  assert.equal(menuPrice(1650), "16,50 KM");
});
