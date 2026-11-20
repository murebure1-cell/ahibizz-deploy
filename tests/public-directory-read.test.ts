import assert from "node:assert/strict";
import test from "node:test";
import { readAuthConfiguration } from "../src/server/auth/config";
import { createDatabase } from "../src/server/db";
import { getPublicDirectoryService } from "../src/server/directory";
import { createDirectoryRequestHandler } from "../src/server/directory-http";

const baseURL = "https://public-directory-fixture.invalid";
const id = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const environment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://fixture:fixture-only@127.0.0.1/ahibizz_ci?sslmode=disable",
  BETTER_AUTH_URL: baseURL,
  BETTER_AUTH_SECRET: "fixture-only-secret-with-at-least-thirty-two-characters",
};
const row = {
  id,
  ownerId: "private-owner-fixture",
  title: "Public fixture",
  categoryId,
  subcategoryId: null,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: "Fixture city",
  countryCode: null,
  latitude: null,
  longitude: null,
  status: "published",
  version: 2,
  verified: false,
  featured: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  publishedAt: new Date("2026-01-02T00:00:00Z"),
  archivedAt: null,
  media: { logo: null, cover: null, gallery: [] },
  moderationReturn: {
    reason: "Private moderation fixture must never be public",
    createdAt: "2026-01-02T00:00:00Z",
    version: 2,
  },
};

function fixture(options: { unavailable?: boolean; missing?: boolean } = {}) {
  const queries: { sql: string; values: unknown[] }[] = [];
  let pools = 0,
    configurations = 0,
    privateServices = 0;
  const database = createDatabase({
    environment: () => environment,
    createPool: () => {
      pools++;
      return {
        async connect() {
          return {
            async query(sql: string, values: unknown[] = []) {
              queries.push({ sql, values });
              if (options.unavailable)
                throw new Error("private-fixture-database-url-and-driver-detail");
              return {
                rows: sql.includes("FROM directory_category")
                  ? [{ id: categoryId, name: "Fixture", slug: "fixture", parentId: null }]
                  : options.missing
                    ? []
                    : [row],
              };
            },
            release() {},
          };
        },
        async end() {},
      };
    },
  });
  const service = getPublicDirectoryService(database);
  const handle = createDirectoryRequestHandler({
    publicService: () => service,
    configuration: () => {
      configurations++;
      return readAuthConfiguration(environment);
    },
    privateService: () => {
      privateServices++;
      return null;
    },
  });
  return {
    service,
    handle,
    queries,
    get pools() {
      return pools;
    },
    get configurations() {
      return configurations;
    },
    get privateServices() {
      return privateServices;
    },
  };
}

function request(route: string, method = "GET") {
  return new Request(new URL(route, baseURL), {
    method,
    ...(method === "GET" ? {} : { body: "private-body-must-not-be-consumed" }),
  });
}

test("public directory uses only the lazy database when SMTP and auth service are unavailable", async () => {
  assert.equal(readAuthConfiguration(environment), null);
  const f = fixture();
  assert.ok(f.service);
  assert.deepEqual(Object.keys(f.service).sort(), ["categories", "listPublic", "readPublic"]);
  assert.equal(f.pools, 0);
  for (const route of [
    "/api/directory/categories",
    "/api/directory/businesses",
    `/api/directory/businesses/${id}`,
  ]) {
    const response = await f.handle(request(route));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
  }
  assert.equal(f.pools, 1);
  assert.equal(f.queries.length, 3);
  assert.equal(f.configurations, 0);
  assert.equal(f.privateServices, 0);
  assert.ok(f.queries.every(({ sql }) => sql.startsWith("SELECT ")));
});

test("public list and detail retain eligibility predicates and the existing public DTO", async () => {
  const f = fixture();
  const list = await (await f.handle(request("/api/directory/businesses"))).json();
  const detail = await (await f.handle(request(`/api/directory/businesses/${id}`))).json();
  assert.deepEqual(list.items, [detail.business]);
  assert.equal(detail.business.id, id);
  assert.equal(detail.business.publishedAt, row.publishedAt.toISOString());
  for (const field of [
    "ownerId",
    "status",
    "version",
    "archivedAt",
    "updatedAt",
    "bytes",
    "moderationReturn",
  ])
    assert.equal(Object.hasOwn(detail.business, field), false, field);
  for (const query of f.queries) {
    assert.match(query.sql, /JOIN auth_user u ON u.id = b.owner_user_id/);
    assert.match(
      query.sql,
      /b.status = 'published' AND package_allows_listing\(b\) AND u.approval = 'approved' AND u\."emailVerified" = true/,
    );
    assert.doesNotMatch(query.sql, /\bbytes\b/);
    assert.doesNotMatch(query.sql, /directory_moderation_audit|moderationReturn/);
  }
  assert.deepEqual(f.queries[1]?.values, [id]);
});

test("public search retains prepared literal filters and page bounds", async () => {
  const f = fixture();
  const query = new URLSearchParams({ q: "50%_\\", city: "Town_%", categoryId, page: "2" });
  const response = await f.handle(request(`/api/directory/businesses?${query}`));
  assert.equal(response.status, 200);
  assert.deepEqual(f.queries[0]?.values, [categoryId, ["%50\\%\\_\\\\%"], "%Town\\_\\%%", 21, 20]);
  assert.match(
    f.queries[0]?.sql ?? "",
    /ORDER BY .*ILIKE ALL .* DESC, b.created_at DESC, b.id DESC/s,
  );
});

test("private routes and every write remain gated without consuming bodies or querying public data", async () => {
  const f = fixture();
  const paths = [
    ["GET", "/api/directory/mine"],
    ["GET", `/api/directory/mine/${id}`],
    ["GET", "/api/directory/review"],
    ["GET", "/api/directory/admin"],
    ["GET", `/api/directory/businesses/${id}/publish`],
    ["POST", "/api/directory/categories"],
    ["POST", "/api/directory/mine"],
    ["PATCH", `/api/directory/mine/${id}`],
    ["PATCH", `/api/directory/review/${id}`],
    ["POST", `/api/directory/mine/${id}/publish`],
    ["POST", `/api/directory/mine/${id}/archive`],
    ["POST", `/api/directory/mine/${id}/recover`],
    ["POST", "/api/directory/businesses"],
  ];
  for (const [method, route] of paths) {
    assert.ok(method && route);
    const input = request(route, method);
    const response = await f.handle(input);
    assert.equal(response.status, 503, `${method} ${route}`);
    assert.deepEqual(await response.json(), { code: "DIRECTORY_UNAVAILABLE" });
    assert.equal(input.bodyUsed, false);
  }
  assert.equal(f.configurations, paths.length);
  assert.equal(f.privateServices, paths.length);
  assert.equal(f.pools, 0);
  assert.equal(f.queries.length, 0);
});

test("public UUID, query and URL validation rejects malformed requests before SQL", async () => {
  const f = fixture();
  for (const route of [
    "/api/directory/categories?unknown=1",
    "/api/directory/businesses?status=draft",
    "/api/directory/businesses?page=1&page=2",
    "/api/directory/businesses?page=0",
    "/api/directory/businesses?page=501",
    "/api/directory/businesses?categoryId=not-a-uuid",
    "/api/directory/businesses/not-a-uuid",
    `/api/directory/businesses/${id}?unknown=1`,
    `/api/directory/businesses?q=${"x".repeat(8200)}`,
  ]) {
    const response = await f.handle(request(route));
    assert.equal(response.status, 400, route);
  }
  assert.equal(f.queries.length, 0);
  assert.equal(f.configurations, 0);
  assert.equal(f.privateServices, 0);
});

test("missing public profiles and database failures remain distinct redacted results", async () => {
  const missing = await fixture({ missing: true }).handle(
    request(`/api/directory/businesses/${id}`),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: "BUSINESS_NOT_FOUND" });
  const unavailable = await fixture({ unavailable: true }).handle(
    request("/api/directory/businesses"),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code: "DIRECTORY_UNAVAILABLE" });
  const missingDatabase = createDatabase({
    environment: () => ({}),
    createPool: () => {
      throw new Error("Unconfigured database must not open a pool.");
    },
  });
  assert.equal(getPublicDirectoryService(missingDatabase), null);
  const malformedDatabase = createDatabase({
    environment: () => ({ DATABASE_URL: "not-a-database-url" }),
  });
  const handle = createDirectoryRequestHandler({
    publicService: () => getPublicDirectoryService(malformedDatabase),
    privateService: () => {
      throw new Error("Public reads must not access the private service.");
    },
  });
  assert.deepEqual(await (await handle(request("/api/directory/businesses"))).json(), {
    code: "DIRECTORY_UNAVAILABLE",
  });
});

test("public nearby filters are prepared numbers and retain eligibility and public projection", async () => {
  const f = fixture();
  const response = await f.handle(
    request("/api/directory/businesses?latitude=0&longitude=0&radiusKm=25"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.queries[0]?.values, [0, 0, 25, 21, 0]);
  assert.match(f.queries[0]?.sql ?? "", /ASIN\(SQRT\(LEAST\(1\.0/);
  assert.match(f.queries[0]?.sql ?? "", /b.latitude IS NOT NULL AND b.longitude IS NOT NULL/);
  assert.match(f.queries[0]?.sql ?? "", /ORDER BY .* ASC, b.id ASC LIMIT/s);
  assert.match(f.queries[0]?.sql ?? "", /u\.approval = 'approved' AND u\."emailVerified" = true/);
  const body = await response.json();
  assert.equal(Object.hasOwn(body.items[0], "ownerId"), false);
  assert.equal(f.privateServices, 0);
});

test("partial, duplicated, out-of-range and injected nearby arguments are rejected before SQL", async () => {
  const f = fixture();
  for (const query of [
    "latitude=0",
    "latitude=0&longitude=0",
    "radiusKm=25",
    "latitude=0&longitude=0&radiusKm=0",
    "latitude=0&longitude=0&radiusKm=51",
    "latitude=91&longitude=0&radiusKm=25",
    "latitude=0&longitude=-181&radiusKm=25",
    "latitude=NaN&longitude=0&radiusKm=25",
    "latitude=0%20OR%201=1&longitude=0&radiusKm=25",
    "latitude=1e1&longitude=0&radiusKm=25",
    "latitude=0&latitude=1&longitude=0&radiusKm=25",
    "latitude=0&longitude=0&radiusKm=25&status=draft",
  ])
    assert.equal(
      (await f.handle(request(`/api/directory/businesses?${query}`))).status,
      400,
      query,
    );
  assert.equal(f.queries.length, 0);
  for (const input of [
    { latitude: "0", longitude: 0, radiusKm: 25 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY, radiusKm: 25 },
    { latitude: 0, longitude: 0, radiusKm: Number.NaN },
  ])
    await assert.rejects(
      () => f.service?.listPublic(input) ?? Promise.reject(),
      (error: unknown) =>
        !!error && typeof error === "object" && "status" in error && error.status === 400,
    );
  assert.equal(f.queries.length, 0);
});
