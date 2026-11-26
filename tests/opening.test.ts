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

test("the way back after signing in is a path on this site and never the page itself", () => {
  assert.equal(returnPath("/pretraga?q=burek"), "/pretraga?q=burek");
  assert.equal(returnPath("/djelatnosti/abc"), "/djelatnosti/abc");
  for (const bad of [
    "/",
    "/uskoro",
    "/uskoro?od=%2F",
    "//drugi.example/put",
    "/\\drugi.example",
    "https://drugi.example/",
    "pretraga",
    "/put s razmakom",
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

test("before the opening a visitor without a session is shown the page, at the same address", () => {
  const setting = process.env.AHIBIZZ_OPENING_AT;
  const request = (path: string, cookie?: string) =>
    new NextRequest(`http://127.0.0.1:3000${path}`, cookie ? { headers: { cookie } } : undefined);
  const shown = (response: Response) => response.headers.get("x-middleware-rewrite");
  try {
    // Ten minutes from now.
    process.env.AHIBIZZ_OPENING_AT = new Date(Date.now() + 600_000)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    const veiled = proxy(request("/pretraga?q=burek"));
    const target = new URL(shown(veiled) ?? "http://missing");
    assert.equal(target.pathname, "/uskoro");
    assert.equal(target.searchParams.get("od"), "/pretraga?q=burek");
    assert.equal(veiled.headers.get("cache-control"), "private, no-store");
    assert.equal(new URL(shown(proxy(request("/"))) ?? "http://missing").pathname, "/uskoro");
    // A session, in either of the cookie's names, and the open pages pass untouched.
    for (const passing of [
      proxy(request("/pretraga", "better-auth.session_token=abc")),
      proxy(request("/pretraga", "__Secure-better-auth.session_token=abc")),
      proxy(request("/prijava")),
      proxy(request("/registracija")),
      proxy(request("/nalog")),
      proxy(request("/privatnost")),
    ]) {
      assert.equal(shown(passing), null);
      assert.equal(passing.headers.get("x-middleware-next"), "1");
    }

    // The day has come, or none is set: nothing is shown in place of anything.
    process.env.AHIBIZZ_OPENING_AT = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    assert.equal(shown(proxy(request("/pretraga"))), null);
    process.env.AHIBIZZ_OPENING_AT = "off";
    assert.equal(shown(proxy(request("/pretraga"))), null);
    delete process.env.AHIBIZZ_OPENING_AT;
    assert.equal(shown(proxy(request("/pretraga"))), openingAt ? shown(proxy(request("/"))) : null);
  } finally {
    if (setting === undefined) delete process.env.AHIBIZZ_OPENING_AT;
    else process.env.AHIBIZZ_OPENING_AT = setting;
  }
});
