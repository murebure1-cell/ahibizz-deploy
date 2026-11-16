import assert from "node:assert/strict";
import test from "node:test";
import {
  PersonBusinessesError,
  personBusinessesRequest,
  readPersonBusinessesPage,
} from "../src/lib/person-businesses";
import { createPublicPersonBusinessesService } from "../src/server/public-person-businesses";
import { createPublicPersonBusinessesHandler } from "../src/server/public-person-businesses-http";

const business = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Owned public business",
  categoryName: "Services",
  subcategoryName: null,
  description: null,
  addressLine: null,
  city: "Tuzla",
  countryCode: "BA",
  latitude: null,
  longitude: null,
  verified: true,
  media: { logo: null, cover: null, gallery: [] },
};
test("one bounded public-person query uses actual owner FK and public eligibility without private projections", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const service = createPublicPersonBusinessesService({
    async query(sql, values = []) {
      calls.push({ sql, values });
      return {
        rows: [
          {
            ...business,
            ownerId: "private-owner",
            email: "private@example.invalid",
            moderationReturn: { reason: "private" },
          },
        ],
      };
    },
  });
  const page = await service.list("person-one", 2);
  assert.deepEqual(calls[0]?.values, ["person-one", 13, 12]);
  const sql = calls[0]?.sql ?? "";
  for (const pattern of [
    /p\.user_id = u\.id AND p\.is_public = true/,
    /u\.id = \$1/,
    /u\.approval = 'approved'/,
    /u\."emailVerified" = true/,
    /u\.role IN \('member', 'owner'\)/,
    /b\.owner_user_id = person\.id AND b\.status = 'published'/,
    /ORDER BY b\.created_at DESC, b\.id DESC LIMIT \$2 OFFSET \$3/,
  ])
    assert.match(sql, pattern);
  assert.doesNotMatch(
    sql,
    /moderation_audit|contact_email|contact_phone|u\.name|u\.email|AS "ownerId"/,
  );
  assert.equal(page.items[0]?.title, business.title);
  assert.equal(page.items[0]?.contactEmail, null);
  for (const token of ["private-owner", "private@example.invalid", "moderationReturn", "ownerId"])
    assert.equal(JSON.stringify(page).includes(token), false);
});
test("eligible empty profiles are empty while hidden profiles and database failures fail closed", async () => {
  let rows: Record<string, unknown>[] = [{ id: null }];
  let calls = 0;
  const service = createPublicPersonBusinessesService({
    async query() {
      calls++;
      return { rows };
    },
  });
  assert.deepEqual(await service.list("person-one"), { items: [], page: 1, hasMore: false });
  rows = [];
  await assert.rejects(
    service.list("person-one"),
    (error: unknown) => error instanceof PersonBusinessesError && error.status === 404,
  );
  for (const [id, page] of [
    ["../private", 1],
    ["person-one", 0],
    ["person-one", 1000],
  ] as const)
    await assert.rejects(
      service.list(id, page),
      (error: unknown) => error instanceof PersonBusinessesError && error.status === 400,
    );
  assert.equal(calls, 2);
  const failed = createPublicPersonBusinessesService({
    async query() {
      throw Error("postgres private connection");
    },
  });
  await assert.rejects(
    failed.list("person-one"),
    (error: unknown) =>
      error instanceof PersonBusinessesError &&
      error.status === 503 &&
      !error.message.includes("postgres"),
  );
});
test("public-person businesses HTTP validates only bounded paging and keeps all responses uncached", async () => {
  const calls: unknown[] = [];
  const handle = createPublicPersonBusinessesHandler(() => ({
    async list(id, page = 1) {
      calls.push([id, page]);
      return { items: [], page, hasMore: false };
    },
  }));
  const response = await handle(
    new Request("https://fixture.invalid/api/public-people/person-one/businesses?page=2"),
    "person-one",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.deepEqual(calls, [["person-one", 2]]);
  for (const query of [
    "page=0",
    "page=1000",
    "page=2&page=3",
    "ownerId=other",
    "page=1&status=draft",
  ]) {
    assert.equal(
      (await handle(new Request(`https://fixture.invalid/?${query}`), "person-one")).status,
      400,
    );
  }
  assert.equal(
    (await handle(new Request("https://fixture.invalid/", { method: "POST" }), "person-one"))
      .status,
    405,
  );
  assert.equal(calls.length, 1);
});
test("client rejects malformed card responses and requests only the same-origin public route", async () => {
  const card = { ...business, contactEmail: null, contactPhone: null, websiteUrl: null };
  const page = { items: [card], page: 1, hasMore: false };
  assert.equal(readPersonBusinessesPage(page, 1).items.length, 1);
  for (const value of [
    { ...page, page: 2 },
    { ...page, items: [card, card] },
    { ...page, items: [{ ...card, city: 42 }] },
    { ...page, items: [{ ...card, latitude: Number.NaN }] },
  ])
    assert.throws(() => readPersonBusinessesPage(value, 1));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/public-people/person-one/businesses?page=1");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.mode, "same-origin");
      return Response.json(page);
    };
    assert.equal((await personBusinessesRequest("person-one", 1)).items[0]?.id, business.id);
  } finally {
    globalThis.fetch = original;
  }
});
