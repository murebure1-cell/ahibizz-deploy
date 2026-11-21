import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchNearbyPages,
  nearbyDirectoryPath,
  readNearbyBusinesses,
} from "../src/lib/home-nearby";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Fixture",
  categoryId: "category",
  subcategoryId: null,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: "Fixture city",
  countryCode: "BA",
  latitude: 0,
  longitude: 0,
  verified: false,
};
const result = (items: unknown[] = [row]) => ({ items, page: 1, pageSize: 20, hasMore: false });
test("nearby transport uses the bounded public endpoint with an approximate origin and fixed25km radius", () => {
  const url = new URL(
    nearbyDirectoryPath({ latitude: 44.538416, longitude: 18.667136 }),
    "https://fixture.invalid",
  );
  assert.equal(url.pathname, "/api/directory/businesses");
  assert.deepEqual(
    [...url.searchParams],
    [
      ["latitude", "44.538"],
      ["longitude", "18.667"],
      ["radiusKm", "25"],
    ],
  );
});

test("nearby pages preserve the fifth result and validate the requested page", () => {
  const rows = Array.from({ length: 5 }, (_, n) => ({
    ...row,
    id: `11111111-1111-4111-8111-11111111111${n}`,
  }));
  assert.equal(readNearbyBusinesses(result(rows), []).length, 5);
  const second = { ...result(rows), page: 2 };
  assert.equal(readNearbyBusinesses(second, [], 2)[4]?.id, rows[4]?.id);
  assert.throws(() => readNearbyBusinesses(result(rows), [], 2));
});
test("only the explicit local entitlement puts a nearby result in the highlighted group", () => {
  const rows = [
    { ...row, featured: true },
    { ...row, localFeatured: true },
    { ...row, localFeatured: false },
  ];
  assert.deepEqual(
    readNearbyBusinesses(result(rows), []).map((business) => business.localFeatured),
    [false, true, false],
  );
});
test("GPS and city results carry the same opening hours, amenities and rating onto their cards", () => {
  const hours = Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    windows: [{ startMinute: 540, endMinute: 1020 }],
  }));
  const details = { timezone: "Europe/Sarajevo", hours, amenities: ["wifi", "parking"] };
  const reviews = { count: 2, sum: 9 };
  const [business] = readNearbyBusinesses(result([{ ...row, details, reviews }]), []);
  assert.deepEqual(business?.details, details);
  assert.deepEqual(business?.reviews, reviews);
  const [legacy] = readNearbyBusinesses(result([row]), []);
  assert.equal(legacy?.details, null);
  assert.equal(legacy?.reviews?.count, 0);
});
test("nearby response projects actual public card fields and never accepts hidden authority or malformed geometry", () => {
  const items = readNearbyBusinesses(result(), [
    { id: "category", name: "Services", parentId: null },
  ]);
  assert.equal(items[0]?.title, "Fixture");
  assert.equal(items[0]?.categoryName, "Services");
  for (const change of [
    { ownerId: "private" },
    { version: 1 },
    { status: "draft" },
    { moderationReturn: {} },
    { latitude: null },
    { longitude: 200 },
    { latitude: "0" },
    { title: "" },
    { id: "bad" },
    { verified: "true" },
  ])
    assert.throws(() => readNearbyBusinesses(result([{ ...row, ...change }]), []));
  for (const malformed of [
    null,
    {},
    { ...result(), page: 2 },
    { ...result(), hasMore: "yes" },
    result(Array.from({ length: 21 }, () => row)),
  ])
    assert.throws(() => readNearbyBusinesses(malformed, []));
});

test("refreshing an expanded list reads the same depth at one location and stops at the last available page", async (t) => {
  const path = nearbyDirectoryPath({ latitude: 44.54, longitude: 18.67 });
  const visited: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    visited.push(url);
    assert.equal(init.credentials, "omit");
    const page = url.endsWith("page=2") ? 2 : 1;
    return Response.json({
      ...result([{ ...row, title: `Page ${page}` }]),
      page,
      hasMore: page < 2,
    });
  });

  const refreshed = await fetchNearbyPages(path, [], 1, 3, new AbortController().signal);
  assert.deepEqual(visited, [path, `${path}&page=2`]);
  assert.deepEqual(
    refreshed.items.map((item) => item.title),
    ["Page 1", "Page 2"],
  );
  assert.equal(refreshed.page, 2);
  assert.equal(refreshed.hasMore, false);
});

test("a late response from an aborted location cannot finish a fresh snapshot", async (t) => {
  const path = nearbyDirectoryPath({ latitude: 44.54, longitude: 18.67 });
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    abort.abort();
    return Response.json(result());
  });
  await assert.rejects(fetchNearbyPages(path, [], 1, 2, abort.signal), { name: "AbortError" });
});
