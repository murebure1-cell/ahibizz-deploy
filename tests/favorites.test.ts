import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  accountReturnPath,
  accountSectionPath,
  readAccountNavigation,
} from "../src/lib/account-return";
import { createFavoritesApi, FavoritesClientError, readFavoriteStates } from "../src/lib/favorites";
import {
  type FavoritesService,
  favoriteCommand,
  favoriteIds,
} from "../src/server/favorites/service";
import { createFavoritesHttpHandler } from "../src/server/favorites-http";

const id = randomUUID(),
  actor = "fixture-person",
  origin = "https://favorites-fixture.invalid";
test("favorite inputs reject unbounded targets, duplicate aliases, actor injection and invalid versions", () => {
  assert.deepEqual(favoriteIds([id.toUpperCase()]), [id]);
  for (const invalid of [
    [],
    [id, id.toUpperCase()],
    ["private"],
    Array.from({ length: 51 }, () => randomUUID()),
    null,
  ])
    assert.throws(() => favoriteIds(invalid));
  for (const invalid of [
    { saved: 1, expectedVersion: 0, idempotencyKey: randomUUID() },
    { saved: true, expectedVersion: -1, idempotencyKey: randomUUID() },
    { saved: true, expectedVersion: 2147483647, idempotencyKey: randomUUID() },
    { saved: true, expectedVersion: 0, idempotencyKey: randomUUID(), userId: "other" },
  ])
    assert.throws(() => favoriteCommand(invalid));
});
test("favorite response reader rejects contradictory, duplicated and malformed private state", () => {
  const valid = { accountId: actor, items: [{ businessId: id, saved: false, version: 0 }] };
  assert.deepEqual(readFavoriteStates(valid), valid);
  for (const value of [
    { ...valid, accountId: "" },
    { ...valid, items: [{ businessId: id, saved: true, version: 0 }] },
    { ...valid, items: [...valid.items, ...valid.items] },
    { ...valid, items: [{ businessId: id, saved: false, version: -1 }] },
  ])
    assert.throws(() => readFavoriteStates(value));
});
test("private favorite transport binds every mutation and list to its displayed actor and never retries", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createFavoritesApi(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (init?.method === "PUT") throw new TypeError("lost after commit");
    return Response.json({
      accountId: actor,
      items: [{ businessId: id, saved: false, version: 0 }],
    });
  });
  assert.equal((await api.states([id], actor)).accountId, actor);
  await assert.rejects(() =>
    api.set(id, { saved: true, expectedVersion: 0, idempotencyKey: randomUUID() }, actor),
  );
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[1]?.init.headers).get("X-AhiBizz-Account-ID"), actor);
  assert.equal(calls[1]?.init.cache, "no-store");
  assert.equal(calls[1]?.init.credentials, "same-origin");
  assert.equal(calls[1]?.init.mode, "same-origin");
  assert.equal(calls[1]?.init.redirect, "error");
});
test("favorite client refuses another actor's list even on a successful HTTP response", async () => {
  const api = createFavoritesApi(async () =>
    Response.json({ accountId: "someone-else", items: [], page: 1, hasMore: false }),
  );
  await assert.rejects(() => api.list(1, actor));
  const denied = createFavoritesApi(async () =>
    Response.json({ code: "ACCOUNT_IDENTITY_CHANGED" }, { status: 401 }),
  );
  await assert.rejects(
    () => denied.states([id], actor),
    (error) => error instanceof FavoritesClientError && error.status === 401,
  );
});
test("favorites stays inside the account navigation and closed authentication continuation", () => {
  assert.equal(accountSectionPath("saved"), "/nalog?odjeljak=sacuvani");
  assert.equal(readAccountNavigation(new URLSearchParams("odjeljak=sacuvani")).section, "saved");
  assert.equal(accountReturnPath("/nalog?odjeljak=sacuvani"), "/nalog?odjeljak=sacuvani");
  assert.equal(accountReturnPath("/nalog?odjeljak=sacuvani&userId=someone"), "/nalog");
  assert.equal(accountReturnPath(`/djelatnosti/${id}#sacuvaj`), `/djelatnosti/${id}#sacuvaj`);
  for (const unsafe of [
    `https://foreign.invalid/djelatnosti/${id}#sacuvaj`,
    `//foreign.invalid/djelatnosti/${id}#sacuvaj`,
    `/djelatnosti/${id}?owner=other#sacuvaj`,
    `/djelatnosti/${id}/../prijava#sacuvaj`,
    `/djelatnosti/${id}#sacuvaj/evil`,
    `/djelatnosti/${id}#sacuvaj%0a`,
    `/djelatnosti/${id}%23sacuvaj`,
  ])
    assert.equal(accountReturnPath(unsafe), "/nalog");
});
test("favorites HTTP rejects CSRF, malformed JSON, duplicate escaped keys, oversized bodies and unknown parameters before mutation", async () => {
  let writes = 0,
    reads = 0;
  const service = {
    async states() {
      reads++;
      return { accountId: actor, items: [] };
    },
    async list() {
      reads++;
      return { accountId: actor, items: [], page: 1, hasMore: false };
    },
    async set() {
      writes++;
      return { accountId: actor, items: [{ businessId: id, saved: true, version: 1 }] };
    },
  } as unknown as FavoritesService;
  const http = createFavoritesHttpHandler({ service, baseURL: origin });
  const command = JSON.stringify({ saved: true, expectedVersion: 0, idempotencyKey: randomUUID() });
  const put = (body: string, headers: Record<string, string> = {}) =>
    http(
      new Request(`${origin}/api/favorites/businesses/${id}`, {
        method: "PUT",
        headers: { origin, "content-type": "application/json", ...headers },
        body,
      }),
    );
  assert.equal((await put(command, { origin: "https://foreign.invalid" })).status, 403);
  assert.equal((await put(command, { "content-type": "text/plain" })).status, 415);
  assert.equal((await put("{")).status, 400);
  assert.equal(
    (
      await put(
        `{"saved":true,"saved":false,"expectedVersion":0,"idempotencyKey":"${randomUUID()}"}`,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await put(
        '{"saved":true,"\\u0073aved":false,"expectedVersion":0,"idempotencyKey":"' +
          randomUUID() +
          '"}',
      )
    ).status,
    400,
  );
  assert.equal((await put(" ".repeat(2049))).status, 413);
  assert.equal((await http(new Request(`${origin}/api/favorites?userId=other`))).status, 400);
  assert.equal(
    (await http(new Request(`${origin}/api/favorites/states?ids=${id}&ids=${id}`))).status,
    400,
  );
  assert.equal(writes, 0);
  assert.equal(reads, 0);
  const accepted = await put(command);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.equal(writes, 1);
});
