import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  beforeOpening,
  countdownParts,
  dayWord,
  hourWord,
  openBeforeOpening,
  openingAt,
  openingMoment,
  openingWhen,
  readOpening,
  returnPath,
} from "../src/lib/opening";
import { proxy } from "../src/proxy";

const day = "2026-12-02T12:00:00+01:00";
const moment = Date.parse(day);

test("the opening is a full instant with its offset, or nothing", () => {
  assert.equal(readOpening(day), moment);
  assert.equal(readOpening("2026-12-02T11:00:00Z"), moment);
  assert.equal(readOpening(" 2026-12-02T12:00+01:00 "), moment);
  for (const bad of [
    null,
    undefined,
    "",
    "2026-12-02",
    "2026-12-02T12:00:00",
    "2. 12. 2026. u 12:00",
    "2026-13-40T12:00:00Z",
    "sutra",
  ])
    assert.equal(readOpening(bad), null);
});

test("the server setting takes the place of the kept day, and can switch the page off", () => {
  assert.equal(openingMoment(undefined, null), null);
  assert.equal(openingMoment(undefined, day), moment);
  assert.equal(openingMoment("2026-12-05T08:00:00+01:00", day), Date.parse("2026-12-05T07:00:00Z"));
  assert.equal(openingMoment("off", day), null);
  assert.equal(openingMoment(" OFF ", day), null);
  // A setting that is not an instant is not a decision: the kept day stands.
  assert.equal(openingMoment("uskoro", day), moment);
  assert.equal(openingMoment("", null), null);
  assert.equal(beforeOpening(moment, moment - 1), true);
  assert.equal(beforeOpening(moment, moment), false);
  assert.equal(beforeOpening(null, 0), false);
});

test("the day kept in the code is either absent or a readable instant", () => {
  // A typing mistake there would silently leave the app open or closed.
  assert.ok(openingAt === null || readOpening(openingAt) !== null);
});

test("signing in, joining and the texts they link to stay reachable before the opening", () => {
  for (const path of [
    "/prijava",
    "/registracija",
    "/zaboravljena-lozinka",
    "/nova-lozinka",
    "/nalog",
    "/nalog/obavijesti",
    "/administracija",
    "/sadrzaj/clanci",
    "/privatnost",
    "/pravila-zajednice",
    "/brisanje-naloga",
    "/jezik",
    "/uskoro",
  ])
    assert.equal(openBeforeOpening(path), true, path);
  for (const path of [
    "/",
    "/pretraga",
    "/mapa",
    "/djelatnosti/89228c8a-5f41-4683-8607-8aed19eec875",
    "/reels",
    "/blog",
    "/ljudi",
    "/pomoc",
    "/o-nama",
    "/prijava-lazna",
    "/nalozi",
  ])
    assert.equal(openBeforeOpening(path), false, path);
});

test("the way on from the page is a path on this site and never the page itself", () => {
  assert.equal(returnPath("/pretraga?q=burek"), "/pretraga?q=burek");
  assert.equal(returnPath("/djelatnosti/abc"), "/djelatnosti/abc");
  // A letter outside plain ASCII arrives the way a browser writes it in an address.
  assert.equal(returnPath("/pretraga?q=%C4%87evapi"), "/pretraga?q=%C4%87evapi");
  for (const bad of [
    "/",
    "/uskoro",
    "/uskoro?od=%2F",
    "//drugi.example/put",
    "/\\drugi.example",
    "/put\\drugi.example",
    "https://drugi.example/",
    "pretraga",
    "/put s razmakom",
    // It goes into a redirect: nothing a header cannot carry, and no new line.
    "/pretraga?q=ćevapi",
    "/pretraga\r\nSet-Cookie: a=b",
    "/pretraga\u0000",
    ["/pretraga"],
    undefined,
    `/${"a".repeat(600)}`,
  ])
    assert.equal(returnPath(bad), null, String(bad));
});

test("the time left is split into days, hours, minutes and seconds", () => {
  assert.deepEqual(countdownParts(6 * 86_400 + 11 * 3600 + 42 * 60 + 57), {
    days: 6,
    hours: 11,
    minutes: 42,
    seconds: 57,
  });
  assert.deepEqual(countdownParts(59), { days: 0, hours: 0, minutes: 0, seconds: 59 });
  for (const none of [0, -5, Number.NaN])
    assert.deepEqual(countdownParts(none), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test("the words under the numbers follow Bosnian counting", () => {
  const days = [1, 2, 4, 5, 11, 21, 22, 30].map((count) => dayWord(count));
  assert.deepEqual(days, [
    "{count|dan|dan}",
    "{count|dana|dana}",
    "{count|dana|dana}",
    "{count|dana|dana}",
    "{count|dana|dana}",
    "{count|dan|dan}",
    "{count|dana|dana}",
    "{count|dana|dana}",
  ]);
  const hours = [0, 1, 2, 4, 5, 11, 12, 21, 23].map((count) => hourWord(count));
  assert.deepEqual(hours, [
    "{count|sati|sati}",
    "{count|sat|sat}",
    "{count|sata|sata}",
    "{count|sata|sata}",
    "{count|sati|sati}",
    "{count|sati|sati}",
    "{count|sati|sati}",
    "{count|sat|sat}",
    "{count|sata|sata}",
  ]);
});

test("the day of opening is told on Sarajevo's clock, in Bosnian by hand", () => {
  assert.equal(openingWhen(moment), "u srijedu, 2. 12. 2026. u 12:00");
  // Late evening in UTC is already the next day in Sarajevo.
  assert.equal(openingWhen(Date.parse("2026-12-05T23:30:00Z")), "u nedjelju, 6. 12. 2026. u 00:30");
  assert.equal(
    openingWhen(Date.parse("2026-06-01T07:05:00Z")),
    "u ponedjeljak, 1. 6. 2026. u 09:05",
  );
  assert.match(openingWhen(moment, "en"), /Wednesday.*December.*2026.*12:00/);
  assert.match(openingWhen(moment, "de"), /Mittwoch.*Dezember.*2026.*12:00/);
  assert.equal(openingWhen(Number.NaN), "—");
});

test("before the opening a visitor without a session is sent to the page", () => {
  const setting = process.env.AHIBIZZ_OPENING_AT;
  const request = (path: string, cookie?: string) =>
    new NextRequest(`http://127.0.0.1:3000${path}`, cookie ? { headers: { cookie } } : undefined);
  /**
   * Where a response sends the visitor, or null when it lets the request through. Here the
   * address is still a full one; that it leaves a running server as a path, also behind the
   * ingress guard, is what scripts/smoke-routes.mjs checks.
   */
  const sent = (response: Response) => {
    // Never a page shown in place of another: see the note in src/proxy.ts.
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    const location = response.headers.get("location");
    if (location === null) return null;
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const target = new URL(location);
    assert.equal(target.pathname, "/uskoro");
    return target.searchParams;
  };
  try {
    // Ten minutes from now.
    process.env.AHIBIZZ_OPENING_AT = new Date(Date.now() + 600_000)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    const veiled = sent(proxy(request("/pretraga?q=burek")));
    assert.equal(veiled?.get("od"), "/pretraga?q=burek");
    assert.equal(veiled?.toString(), "od=%2Fpretraga%3Fq%3Dburek");
    assert.equal(sent(proxy(request("/djelatnosti/abc")))?.get("od"), "/djelatnosti/abc");
    assert.equal(sent(proxy(request("/pretraga?q=ćevapi")))?.get("od"), "/pretraga?q=%C4%87evapi");
    // The front page, and an address too long to carry, need no way on.
    assert.equal(sent(proxy(request("/")))?.toString(), "");
    assert.equal(sent(proxy(request(`/${"a".repeat(600)}`)))?.toString(), "");
    // A session, in either of the cookie's names, the open pages and the page itself pass
    // untouched.
    for (const passing of [
      proxy(request("/pretraga", "better-auth.session_token=abc")),
      proxy(request("/pretraga", "__Secure-better-auth.session_token=abc")),
      proxy(request("/prijava")),
      proxy(request("/registracija")),
      proxy(request("/nalog")),
      proxy(request("/privatnost")),
      proxy(request("/uskoro")),
      proxy(request("/uskoro?od=%2Fpretraga")),
    ]) {
      assert.equal(sent(passing), null);
      assert.equal(passing.headers.get("x-middleware-next"), "1");
    }

    // The day has come, or the page is switched off: nobody is sent anywhere.
    process.env.AHIBIZZ_OPENING_AT = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    assert.equal(sent(proxy(request("/pretraga"))), null);
    process.env.AHIBIZZ_OPENING_AT = "off";
    assert.equal(sent(proxy(request("/pretraga"))), null);
    // Without the setting, the day kept in the code decides.
    delete process.env.AHIBIZZ_OPENING_AT;
    const kept = readOpening(openingAt);
    assert.equal(sent(proxy(request("/pretraga"))) !== null, kept !== null && Date.now() < kept);
  } finally {
    if (setting === undefined) delete process.env.AHIBIZZ_OPENING_AT;
    else process.env.AHIBIZZ_OPENING_AT = setting;
  }
});
