import assert from "node:assert/strict";
import test from "node:test";
import { type PersonalProfile, profileImageUrl, workStatusLabels } from "../src/lib/people";
import {
  ProfileRequestError,
  peopleAccountRequest,
  type peopleRequest,
  readPersonalProfile,
} from "../src/lib/people-client";

function profile(patch: Partial<PersonalProfile> = {}): PersonalProfile {
  return {
    id: "fixture-user",
    name: "Fixture name",
    birthDate: null,
    city: null,
    countryCode: null,
    bio: null,
    skills: [],
    workStatus: "not_specified",
    version: 0,
    photoVersion: null,
    coverVersion: null,
    canCustomizeCover: false,
    ...patch,
  };
}
const rejects = (value: unknown) =>
  assert.throws(() => readPersonalProfile(value), /invalid_profile_response/);

test("private profile response supports unknown optional fields and real version-zero defaults", () => {
  assert.deepEqual(readPersonalProfile(profile()), profile());
  const full = profile({
    birthDate: "2000-02-29",
    city: "Tuzla",
    countryCode: "BA",
    bio: "Supplied private bio",
    skills: ["SQL", "Dizajn"],
    workStatus: "employed",
    version: 3,
    photoVersion: 2,
    coverVersion: 3,
    canCustomizeCover: true,
  });
  assert.deepEqual(readPersonalProfile(full), full);
});

test("profile identity, numeric version and entitlement must have their real primitive shapes", () => {
  for (const value of [
    null,
    undefined,
    [],
    {},
    profile({ id: "" }),
    profile({ id: "x".repeat(129) }),
    profile({ name: " " }),
    profile({ name: "x".repeat(101) }),
  ])
    rejects(value);
  for (const version of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648, "1"])
    rejects({ ...profile(), version });
  for (const canCustomizeCover of [0, 1, "true", null, undefined])
    rejects({ ...profile(), canCustomizeCover });
});

test("nullable details require bounded strings, an uppercase country code and a real Gregorian date", () => {
  for (const city of [undefined, 0, "", "x".repeat(101)]) rejects({ ...profile(), city });
  for (const bio of [undefined, false, "", "x".repeat(1201)]) rejects({ ...profile(), bio });
  for (const countryCode of [undefined, 12, "ba", "BAA", "B1", {}])
    rejects({ ...profile(), countryCode });
  for (const birthDate of [
    undefined,
    0,
    "2001-02-29",
    "2026-99-99",
    "2026-04-31",
    "2026-1-01",
    "0000-01-01",
    ["2000-02-29"],
  ])
    rejects({ ...profile(), birthDate });
});

test("skills and work status reject malformed/coerced values rather than assigning an authority-like status", () => {
  for (const workStatus of Object.keys(workStatusLabels))
    assert.equal(readPersonalProfile({ ...profile(), workStatus }).workStatus, workStatus);
  for (const workStatus of [
    "owner",
    "approved",
    "constructor",
    "__proto__",
    ["student"],
    {},
    undefined,
  ])
    rejects({ ...profile(), workStatus });
  for (const skills of [
    null,
    "SQL",
    [null],
    [" "],
    ["x".repeat(41)],
    Array.from({ length: 16 }, (_, index) => `Skill ${index}`),
  ])
    rejects({ ...profile(), skills });
});

test("media versions are positive committed revisions inside the profile CAS and cover entitlement", () => {
  for (const photoVersion of [undefined, 0, -1, 1.5, 3, "1"])
    rejects({ ...profile({ version: 2 }), photoVersion });
  rejects(profile({ version: 2, coverVersion: 1, canCustomizeCover: false }));
  rejects(profile({ version: 0, photoVersion: 1 }));
  const current = profile({
    version: 2,
    photoVersion: 2,
    coverVersion: 1,
    canCustomizeCover: true,
  });
  assert.deepEqual(readPersonalProfile(current), current);
});

test("media URLs are fixed same-origin endpoints bound to the profile account", () => {
  assert.equal(profileImageUrl(profile(), "photo"), null);
  assert.equal(profileImageUrl(profile(), "cover"), null);
  const row = profile({ version: 4, photoVersion: 4, coverVersion: 2, canCustomizeCover: true });
  assert.equal(
    profileImageUrl(row, "photo"),
    "/api/people/me/media/photo?v=4&accountId=fixture-user",
  );
  assert.equal(
    profileImageUrl(row, "cover"),
    "/api/people/me/media/cover?v=2&accountId=fixture-user",
  );
  assert.equal(profileImageUrl({ ...row, canCustomizeCover: false }, "cover"), null);
  assert.equal(profileImageUrl(row, "photo")?.includes(row.id), true);
});

test("private profile transport binds reads and writes to a validated fixed account", async () => {
  const calls: { path: string; options: RequestInit }[] = [];
  const request: typeof peopleRequest = async (path, options = {}) => {
    calls.push({ path, options });
    return { profile: profile() };
  };
  for (const id of [undefined, "", "wrong/id", "x".repeat(129)])
    await assert.rejects(
      peopleAccountRequest(request, id, "me"),
      (error: unknown) =>
        error instanceof ProfileRequestError && error.code === "ACCOUNT_IDENTITY_CHANGED",
    );
  assert.equal(calls.length, 0);
  const body = JSON.stringify({ expectedVersion: 0, name: "Changed" });
  await peopleAccountRequest(request, "fixture-user", "me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": "other" },
    body,
  });
  assert.equal(calls[0]?.options.body, body);
  assert.equal(new Headers(calls[0]?.options.headers).get("X-AhiBizz-Account-ID"), "fixture-user");
  assert.equal(new Headers(calls[0]?.options.headers).get("Content-Type"), "application/json");
});
