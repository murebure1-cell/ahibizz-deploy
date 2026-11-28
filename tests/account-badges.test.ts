import assert from "node:assert/strict";
import test from "node:test";
import { type BadgeCounts, badgesFrom } from "../src/lib/badges";
import { createAccountBadgesHandler } from "../src/server/account-badges-http";
import type { AuthService } from "../src/server/auth/service";

const baseURL = "https://fixture.invalid";
const fresh: BadgeCounts = {
  rank: 1500,
  joinedAt: "2026-11-14T10:00:00.000Z",
  profileComplete: false,
  reviews: 0,
  reviewedCategories: 0,
  saves: 0,
  topRated: false,
  visits: 0,
};

test("a badge is earned by what was done, and counted ones show how far along", () => {
  const now = new Date("2026-11-28T10:00:00.000Z");
  assert.deepEqual(
    badgesFrom(fresh, now).filter((badge) => badge.earned),
    [],
  );
  const some = badgesFrom(
    {
      ...fresh,
      rank: 1000,
      profileComplete: true,
      reviews: 7,
      reviewedCategories: 9,
      saves: 50,
      visits: 20,
    },
    now,
  );
  assert.deepEqual(
    some.map((badge) => [badge.id, badge.earned, badge.progress ?? null, badge.goal ?? null]),
    [
      ["early", true, null, null],
      ["profile", true, null, null],
      ["reviewer", false, 7, 10],
      ["guide", true, 5, 5],
      ["favourite", true, 50, 50],
      ["year", false, null, null],
      ["top", false, null, null],
      ["punctual", true, 20, 20],
    ],
  );
  const later = badgesFrom(
    { ...fresh, rank: 0, topRated: true },
    new Date("2027-11-14T10:00:00.000Z"),
  );
  assert.equal(later.find((badge) => badge.id === "year")?.earned, true);
  assert.equal(later.find((badge) => badge.id === "top")?.earned, true);
  assert.equal(later.find((badge) => badge.id === "early")?.earned, false);
});

test("the badges are read for the signed-in account only, and nothing sets them", async () => {
  const asked: string[] = [];
  const api = {
    getSession: async () => ({
      user: { id: "u1" },
      session: { id: "s1", userId: "u1", token: "secret" },
    }),
  };
  const http = createAccountBadgesHandler({
    auth: () => ({ api }) as unknown as AuthService,
    baseURL: () => baseURL,
    counts: () => async (userId) => {
      asked.push(userId);
      return { ...fresh, rank: 3 };
    },
  });
  const call = (method: string, account = "u1") =>
    http(
      new Request(`${baseURL}/api/account/badges`, {
        method,
        headers: {
          Cookie: "session=fixture",
          "X-AhiBizz-Account-ID": account,
          Origin: baseURL,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
    );
  const response = await call("GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = (await response.json()) as { badges: { id: string; earned: boolean }[] };
  assert.equal(body.badges.length, 8);
  assert.equal(body.badges[0]?.id, "early");
  assert.equal(body.badges[0]?.earned, true);
  assert.deepEqual(asked, ["u1"]);
  assert.equal((await call("POST")).status, 405);
  assert.equal((await call("GET", "u2")).status, 401);
  assert.deepEqual(asked, ["u1"]);
});
