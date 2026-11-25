import assert from "node:assert/strict";
import test from "node:test";
import { createNextConfig } from "../next.config";
import { GET, HEAD, POST } from "../src/app/store-unavailable/route";
import { reelResubmissionNotice } from "../src/lib/reels";

test("Play build closes every purchase route while the web build keeps its routes", async () => {
  const play = createNextConfig("google-play");
  assert.equal(play.env?.NEXT_PUBLIC_AHIBIZZ_DISTRIBUTION, "google-play");
  const routes = await play.rewrites?.();
  assert.ok(routes && !Array.isArray(routes));
  assert.ok(routes.beforeFiles);
  assert.deepEqual(
    routes.beforeFiles.map((route) => route.source).sort(),
    ["/naplata", "/podrzi", "/api/checkout"].map((path) => `${path}/:path*`).sort(),
  );
  assert.ok(routes.beforeFiles.every((route) => route.destination === "/store-unavailable"));
  assert.deepEqual(await createNextConfig("web").rewrites?.(), {
    beforeFiles: [],
    afterFiles: [],
    fallback: [],
  });
  assert.throws(() => createNextConfig("unknown"));
});

test("opening an unavailable Play page shows a useful document and never exposes a purchase", async () => {
  const response = GET(
    new Request("https://app.example/naplata", { headers: { Accept: "text/html" } }),
  );
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  assert.match(text, /Stranica nije dostupna/);
  assert.match(text, /href="\/"/);
  assert.match(text, /href="\/pomoc"/);
  assert.doesNotMatch(text, /NOT_FOUND|<form|paypal|banka|kupi/i);
  const head = HEAD(
    new Request("https://app.example/naplata", {
      method: "HEAD",
      headers: { Accept: "text/html" },
    }),
  );
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
});

test("Play API, writes and React navigation errors remain non-cacheable JSON", async () => {
  const requests = [
    new Request("https://app.example/api/checkout/orders"),
    new Request("https://app.example/api/checkout/orders", { headers: { Accept: "text/html" } }),
    new Request("https://app.example/naplata", { headers: { Accept: "text/html", RSC: "1" } }),
    new Request("https://app.example/naplata?_rsc=fixture", { headers: { Accept: "text/html" } }),
    new Request("https://app.example/naplata", {
      method: "POST",
      headers: { Accept: "text/html" },
    }),
  ];
  for (const request of requests) {
    const response = request.method === "POST" ? POST(request) : GET(request);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  }
});

test("Reels can be resubmitted from the web and the Play edition alike", () => {
  assert.match(reelResubmissionNotice(false), /pošalji ga ponovo/);
  assert.doesNotMatch(reelResubmissionNotice(false), /cijene|kupi|plati/);
  assert.match(reelResubmissionNotice(true), /Vlasnik treba ponovo/);
});
