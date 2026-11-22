import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createFavoritesApi, FavoritesClientError } from "../src/lib/favorites";
import { displayPhone } from "../src/lib/public-business";
import { FavoritesAccessError, type FavoritesService } from "../src/server/favorites/service";
import { createFavoritesHttpHandler } from "../src/server/favorites-http";

const id = randomUUID(),
  origin = "https://favorites-fixture.invalid";

function handler(error: FavoritesAccessError) {
  const service = {
    async states() {
      throw error;
    },
  } as unknown as FavoritesService;
  return createFavoritesHttpHandler({ service, baseURL: origin });
}

test("a guest's favorite read is answered without an error status", async () => {
  const response = await handler(new FavoritesAccessError(401, "AUTHENTICATION_REQUIRED"))(
    new Request(`${origin}/api/favorites/states?ids=${id}`),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { anonymous: true });
});

test("a displayed account that lost its session still receives 401", async () => {
  const signedOut = await handler(new FavoritesAccessError(401, "AUTHENTICATION_REQUIRED"))(
    new Request(`${origin}/api/favorites/states?ids=${id}`, {
      headers: { "X-AhiBizz-Account-ID": "fixture-person" },
    }),
  );
  assert.equal(signedOut.status, 401);
  const changed = await handler(new FavoritesAccessError(401, "ACCOUNT_IDENTITY_CHANGED"))(
    new Request(`${origin}/api/favorites/states?ids=${id}`),
  );
  assert.equal(changed.status, 401);
});

test("the favorite client reports an anonymous answer as signed out", async () => {
  const api = createFavoritesApi(async () => Response.json({ anonymous: true }));
  await assert.rejects(
    () => api.states([id]),
    (error) =>
      error instanceof FavoritesClientError &&
      error.status === 401 &&
      error.code === "AUTHENTICATION_REQUIRED",
  );
  await assert.rejects(
    () => api.states([id], "fixture-person"),
    (error) =>
      error instanceof FavoritesClientError &&
      error.status === 401 &&
      error.code === "ACCOUNT_IDENTITY_CHANGED",
  );
});

test("a guest's own-review read is answered without an error status and read as signed out", async () => {
  const { createReviewsApi, ReviewsClientError } = await import("../src/lib/reviews");
  const api = createReviewsApi(async () => Response.json({ anonymous: true }));
  await assert.rejects(
    () => api.own(id),
    (error) => error instanceof ReviewsClientError && error.status === 401,
  );
});

test("checkout sign-in returns to the checkout page only for exact checkout paths", async () => {
  const { accountReturnPath } = await import("../src/lib/account-return");
  assert.equal(accountReturnPath("/naplata"), "/naplata");
  assert.equal(accountReturnPath(`/naplata?djelatnost=${id}`), `/naplata?djelatnost=${id}`);
  assert.equal(accountReturnPath("/naplata?djelatnost=x"), "/nalog");
  assert.equal(accountReturnPath(`/naplata?djelatnost=${id}&x=1`), "/nalog");
});

test("numbers and amounts use Bosnian separators regardless of runtime locale data", async () => {
  const { bosnianNumber, bosnianMoney } = await import("../src/lib/number-format");
  const { billingMoney } = await import("../src/lib/billing");
  assert.equal(bosnianNumber(2000), "2.000");
  assert.equal(bosnianNumber(1234567.5), "1.234.567,5");
  assert.equal(bosnianMoney(1500), "15,00");
  assert.equal(billingMoney(1500), "15,00 KM");
  assert.equal(billingMoney(123456), "1.234,56 KM");
});

test("Bosnian phone numbers are grouped for reading and others are left as entered", () => {
  assert.equal(displayPhone("+38761938694"), "+387 61 938 694");
  assert.equal(displayPhone("061 938 694"), "+387 61 938 694");
  assert.equal(displayPhone("00387621234567"), "+387 62 123 4567");
  assert.equal(displayPhone("+49 30 1234567"), "+49 30 1234567");
  assert.equal(displayPhone(null), "");
});
