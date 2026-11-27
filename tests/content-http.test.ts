import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError } from "../src/server/auth/accounts";
import { createContentHttpHandler } from "../src/server/content-http";

const baseURL = "https://fixture.invalid";
const published = new Date("2026-11-20T10:00:00.000Z");
const article = {
  slug: "kako-objaviti-djelatnost",
  category: "vodici" as const,
  title: "Kako objaviti djelatnost",
  excerpt: "Korak po korak do prve objave.",
  minutes: 2,
  featured: false,
  publishedAt: published,
};

function fixture() {
  const calls: { filters?: unknown; headers?: Headers | undefined; bookmark?: [string, unknown] } =
    {};
  let signedIn = true;
  const hub = {
    async publicPage(filters: unknown, headers?: Headers) {
      calls.filters = filters;
      calls.headers = headers;
      if ((filters as { saved: boolean }).saved && !signedIn)
        throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
      return {
        articles: [{ ...article, body: "must not be listed" } as typeof article],
        more: true,
        featured: { ...article, featured: true },
      };
    },
    async publicArticle(slug: unknown) {
      return slug === article.slug
        ? { ...article, body: "Prvi pasus.\n\nDrugi pasus.", revision: 3 }
        : null;
    },
    async favorites() {
      if (!signedIn) throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
      return { actor: "account", saved: true };
    },
    async setBookmark(_headers: Headers, slug: unknown, save: unknown) {
      calls.bookmark = [slug as string, save];
    },
  };
  const http = createContentHttpHandler({
    hub: () => hub as never,
    baseURL: () => baseURL,
  });
  return { http, calls, signOut: () => (signedIn = false) };
}

const get = (path: string) => new Request(`${baseURL}${path}`, { headers: { Cookie: "s=1" } });

test("the article list is JSON without bodies and refuses unknown or repeated filters", async () => {
  const { http, calls, signOut } = fixture();
  const response = await http.list(get("/api/content/articles?q=objava&tema=vodici&strana=2"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(data.items, [{ ...article, publishedAt: published.toISOString() }]);
  assert.equal(data.featured.featured, true);
  assert.equal(data.page, 2);
  assert.equal(data.hasMore, true);
  assert.ok(!JSON.stringify(data).includes("must not be listed"));
  assert.deepEqual(calls.filters, { category: "vodici", q: "objava", page: 2, saved: false });
  assert.equal(calls.headers, undefined);
  for (const query of [
    "x=1",
    "q=a&q=b",
    "tema=nepoznata",
    "strana=0",
    "strana=abc",
    "sacuvano=0",
    `q=${"a".repeat(101)}`,
  ])
    assert.equal((await http.list(get(`/api/content/articles?${query}`))).status, 400, query);
  await http.list(get("/api/content/articles?sacuvano=1"));
  assert.ok((calls.headers as unknown) instanceof Headers);
  signOut();
  const denied = await http.list(get("/api/content/articles?sacuvano=1"));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { code: "AUTHENTICATION_REQUIRED" });
});

test("one article carries its text and the reader's bookmark only when signed in", async () => {
  const { http, signOut } = fixture();
  const response = await http.article(get(`/api/content/articles/${article.slug}`), article.slug);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.article.body, "Prvi pasus.\n\nDrugi pasus.");
  assert.equal(data.article.revision, undefined);
  assert.equal(data.saved, true);
  assert.equal((await http.article(get("/api/content/articles/nema-ga"), "nema-ga")).status, 404);
  assert.equal((await http.article(get("/api/content/articles/Los_Slug"), "Los_Slug")).status, 400);
  assert.equal(
    (await http.article(get(`/api/content/articles/${article.slug}?x=1`), article.slug)).status,
    400,
  );
  signOut();
  assert.equal(
    (await (await http.article(get(`/api/content/articles/${article.slug}`), article.slug)).json())
      .saved,
    null,
  );
});

test("a bookmark changes only from this site, as JSON with one boolean", async () => {
  const { http, calls } = fixture();
  const put = (body: string, init: { origin?: string; type?: string; method?: string } = {}) =>
    http.bookmark(
      new Request(`${baseURL}/api/content/articles/${article.slug}/bookmark`, {
        method: init.method ?? "PUT",
        headers: {
          Origin: init.origin ?? baseURL,
          "Content-Type": init.type ?? "application/json",
          Cookie: "s=1",
          "X-AhiBizz-Account-ID": "account",
        },
        body,
      }),
      article.slug,
    );
  const saved = await put('{"saved":true}');
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { saved: true });
  assert.deepEqual(calls.bookmark, [article.slug, true]);
  assert.equal((await put('{"saved":false}')).status, 200);
  assert.deepEqual(calls.bookmark, [article.slug, false]);
  calls.bookmark = undefined;
  assert.equal((await put('{"saved":true}', { origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await put('{"saved":true}', { type: "text/plain" })).status, 415);
  assert.equal((await put('{"saved":"yes"}')).status, 400);
  assert.equal((await put('{"saved":true,"x":1}')).status, 400);
  assert.equal((await put("[true]")).status, 400);
  assert.equal((await put("not json")).status, 400);
  assert.equal((await put(`{"saved":true,"pad":"${"x".repeat(300)}"}`)).status, 413);
  assert.equal((await put('{"saved":true}', { method: "POST" })).status, 405);
  assert.equal(calls.bookmark, undefined);
});
