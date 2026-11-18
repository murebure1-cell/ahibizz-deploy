import assert from "node:assert/strict";
import test from "node:test";
import {
  type PublicPerson,
  publicPersonImageUrl,
  readConnectionItem,
  readProfileVisibility,
  readPublicPerson,
  readRelationship,
} from "../src/lib/connections";
import {
  ConnectionRequestError,
  connectionError,
  connectionRequest,
} from "../src/lib/connections-client";

const person: PublicPerson = {
  id: "fixture-person",
  name: "Fixture person",
  verified: false,
  city: null,
  countryCode: null,
  bio: null,
  skills: ["Dizajn"],
  workStatus: "not_specified",
  photoVersion: null,
  coverVersion: null,
};
const none = { id: null, personId: person.id, status: "none", version: 0, direction: null };
const pending = {
  id: "fixture-connection",
  personId: person.id,
  status: "pending",
  version: 1,
  direction: "incoming",
};

test("public person projection removes private account data and copies mutable skills", () => {
  const input = {
    ...person,
    email: "private@fixture.invalid",
    birthDate: "1990-01-01",
    canCustomizeCover: true,
    role: "owner",
    approval: "approved",
    emailVerified: true,
    verificationNote: "private",
    skills: ["Dizajn"],
  };
  const output = readPublicPerson(input);
  assert.deepEqual(output, person);
  assert.equal(readPublicPerson({ ...input, verified: undefined }).verified, false);
  assert.deepEqual(readPublicPerson({ ...input, verified: true }), { ...person, verified: true });
  input.skills.push("Private later change");
  assert.deepEqual(output.skills, ["Dizajn"]);
  assert.deepEqual(
    readPublicPerson({ ...person, city: "Tuzla", countryCode: "BA", photoVersion: 2147483647 }),
    { ...person, city: "Tuzla", countryCode: "BA", photoVersion: 2147483647 },
  );
});

test("public person accepts only bounded primitive fields, known status and positive image versions", () => {
  for (const value of [
    null,
    [],
    {},
    { ...person, id: "" },
    { ...person, name: " " },
    { ...person, name: "x".repeat(101) },
    { ...person, verified: "true" },
    { ...person, city: "" },
    { ...person, city: "x".repeat(101) },
    { ...person, countryCode: "ba" },
    { ...person, countryCode: "ZZ" },
    { ...person, bio: "x".repeat(1201) },
    { ...person, skills: [null] },
    { ...person, skills: Array(16).fill("SQL") },
    { ...person, workStatus: ["student"] },
    { ...person, workStatus: "owner" },
    { ...person, photoVersion: 0 },
    { ...person, photoVersion: "1" },
    { ...person, coverVersion: 2147483648 },
  ])
    assert.throws(() => readPublicPerson(value), /invalid_connections_response/);
});

test("relationship response rejects coerced states and inconsistent none/version/direction combinations", () => {
  assert.deepEqual(readRelationship(none), none);
  for (const status of ["pending", "accepted", "declined", "cancelled", "removed"])
    assert.equal(readRelationship({ ...pending, status }).status, status);
  for (const input of [
    { ...none, id: "existing" },
    { ...none, version: 1 },
    { ...none, direction: "incoming" },
    { ...pending, id: null },
    { ...pending, version: 0 },
    { ...pending, version: "1" },
    { ...pending, direction: null },
    { ...pending, direction: "other" },
    { ...pending, status: ["pending"] },
    { ...pending, status: { toString: () => "pending" } },
    { ...pending, status: "approved" },
  ])
    assert.throws(() => readRelationship(input), /invalid_connections_response/);
});

test("private peers retain only relationship state while mismatched and nonexistent pair items fail closed", () => {
  assert.deepEqual(readConnectionItem({ ...pending, person: null, email: "must-not-leak" }), {
    ...pending,
    person: null,
  });
  assert.deepEqual(
    readConnectionItem({ ...pending, person: { ...person, birthDate: "must-not-leak" } }),
    { ...pending, person },
  );
  for (const input of [
    { ...none, person },
    { ...pending },
    { ...pending, person: { ...person, id: "different" } },
  ])
    assert.throws(() => readConnectionItem(input), /invalid_connections_response/);
});

test("visibility response distinguishes explicit opt-in and committed version from a missing profile default", () => {
  assert.deepEqual(
    readProfileVisibility({ isPublic: false, profileVersion: 0, private: "stripped" }),
    { isPublic: false, profileVersion: 0 },
  );
  assert.deepEqual(readProfileVisibility({ isPublic: true, profileVersion: 2147483647 }), {
    isPublic: true,
    profileVersion: 2147483647,
  });
  for (const input of [
    null,
    { isPublic: "true", profileVersion: 1 },
    { isPublic: true, profileVersion: -1 },
    { isPublic: false, profileVersion: 1.5 },
    { isPublic: false, profileVersion: "1" },
    { isPublic: false, profileVersion: 2147483648 },
  ])
    assert.throws(() => readProfileVisibility(input), /invalid_connections_response/);
});

test("public media links are versioned fixed-origin paths and missing images stay absent", () => {
  assert.equal(publicPersonImageUrl(person, "photo"), null);
  assert.equal(publicPersonImageUrl(person, "cover"), null);
  assert.equal(
    publicPersonImageUrl({ ...person, photoVersion: 2147483647 }, "photo"),
    "/api/connections/people/fixture-person/media/photo?v=2147483647",
  );
  assert.equal(
    publicPersonImageUrl({ ...person, id: "one/two", coverVersion: 1 }, "cover"),
    "/api/connections/people/one%2Ftwo/media/cover?v=1",
  );
});

test("connections transport always confines credentials/cache to its endpoint and forwards abort and write intent", async (t) => {
  const controller = new AbortController();
  const calls: { path: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => {
    calls.push({ path, options });
    return Response.json({ visibility: { isPublic: false, profileVersion: 1 } });
  });
  const body = JSON.stringify({ isPublic: false, expectedVersion: 0, idempotencyKey: "fixture" });
  assert.deepEqual(
    await connectionRequest("visibility", {
      method: "PATCH",
      body,
      credentials: "include",
      cache: "force-cache",
      signal: controller.signal,
    }),
    { visibility: { isPublic: false, profileVersion: 1 } },
  );
  assert.equal(calls[0]?.path, "/api/connections/visibility");
  assert.equal(calls[0]?.options.credentials, "same-origin");
  assert.equal(calls[0]?.options.cache, "no-store");
  assert.equal(calls[0]?.options.signal, controller.signal);
  assert.equal(calls[0]?.options.body, body);
  for (const path of [
    "https://untrusted.invalid",
    "//untrusted.invalid",
    "../auth",
    "people/../auth",
    "people/fixture#private",
    "visibility?userId=other",
    "arbitrary",
  ])
    await assert.rejects(
      connectionRequest(path),
      (error) =>
        error instanceof ConnectionRequestError && error.code === "INVALID_CONNECTION_INPUT",
    );
  assert.equal(calls.length, 1);
});

test("transport rejects missing JSON and error responses while UI errors never reproduce raw exceptions", async (t) => {
  let next = new Response("not JSON", { status: 200 });
  t.mock.method(globalThis, "fetch", async () => next);
  await assert.rejects(
    connectionRequest("people"),
    (error) =>
      error instanceof ConnectionRequestError &&
      error.status === 200 &&
      error.code === "CONNECTIONS_UNAVAILABLE",
  );
  next = Response.json({ code: "VERSION_CONFLICT" }, { status: 409 });
  await assert.rejects(
    connectionRequest("people"),
    (error) =>
      error instanceof ConnectionRequestError &&
      error.status === 409 &&
      error.code === "VERSION_CONFLICT",
  );
  next = Response.json(["not a record"]);
  await assert.rejects(connectionRequest("people"), ConnectionRequestError);
  assert.equal(
    connectionError(new ConnectionRequestError(403, "PUBLIC_PROFILE_REQUIRED")),
    "Prvo uključi javni profil u svom nalogu.",
  );
  assert.equal(
    connectionError(new ConnectionRequestError(404, "PERSON_NOT_FOUND")),
    "Profil nije javno dostupan.",
  );
  assert.equal(
    connectionError(new Error("postgresql://private:password@fixture.invalid/db")).includes(
      "password",
    ),
    false,
  );
});
