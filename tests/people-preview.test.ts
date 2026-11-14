import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createPeoplePreviewApi } from "../src/components/preview/people-preview-api";
import type { PersonalProfileFields } from "../src/lib/people";
import { ProfileRequestError, readPersonalProfile } from "../src/lib/people-client";

const fields: PersonalProfileFields = {
  name: "Ogledni korisnik",
  birthDate: "1990-04-12",
  city: "Tuzla",
  countryCode: "BA",
  bio: "Opis samo za izolovani test.",
  skills: ["Dizajn", "Organizacija"],
  workStatus: "open_to_collaboration",
};
const patch = (expectedVersion: number, changes: Record<string, unknown> = {}) => ({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...fields, expectedVersion, ...changes }),
});
const rejected = (status: number, code: string) => (error: unknown) =>
  error instanceof ProfileRequestError && error.status === status && error.code === code;
function offline(t: TestContext) {
  return t.mock.method(globalThis, "fetch", () => {
    throw new Error("No network is allowed in the personal profile preview.");
  });
}

test("personal preview starts private and empty, with explicit fixture cover capability", async (t) => {
  const fetch = offline(t);
  const api = createPeoplePreviewApi();
  t.after(() => api.dispose());
  const result = await api.request("me");
  const profile = readPersonalProfile(result.profile);
  assert.equal(profile.id, "preview-person");
  assert.equal(profile.name, "Ogledni profil");
  assert.equal(profile.birthDate, null);
  assert.equal(profile.city, null);
  assert.equal(profile.countryCode, null);
  assert.equal(profile.bio, null);
  assert.deepEqual(profile.skills, []);
  assert.equal(profile.photoVersion, null);
  assert.equal(profile.coverVersion, null);
  assert.equal(
    profile.canCustomizeCover,
    true,
    "this capability belongs only to the named preview fixture",
  );
  assert.equal(api.snapshotVersion(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test("profile preview applies one versioned edit and rejects stale replacement without changing data", async (t) => {
  const fetch = offline(t);
  const api = createPeoplePreviewApi();
  t.after(() => api.dispose());
  const saved = readPersonalProfile((await api.request("me", patch(0))).profile);
  assert.equal(saved.version, 1);
  for (const [key, value] of Object.entries(fields))
    assert.deepEqual(saved[key as keyof PersonalProfileFields], value);
  await assert.rejects(
    api.request("me", patch(0, { name: "Zastarjeli unos" })),
    rejected(409, "VERSION_CONFLICT"),
  );
  assert.deepEqual(api.getProfile(), saved);
  assert.equal(api.snapshotVersion(), 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test("profile preview cannot accept authority, identity or media-version fields in text updates", async (t) => {
  const fetch = offline(t);
  const api = createPeoplePreviewApi();
  t.after(() => api.dispose());
  const original = api.getProfile();
  for (const injected of [
    { role: "owner" },
    { approval: "approved" },
    { id: "another-person" },
    { version: 10 },
    { photoVersion: 1 },
    { coverVersion: 1 },
    { canCustomizeCover: false },
  ]) {
    await assert.rejects(
      api.request("me", patch(0, injected)),
      rejected(400, "INVALID_PROFILE_INPUT"),
    );
    assert.deepEqual(api.getProfile(), original);
  }
  assert.equal(api.snapshotVersion(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test("profile preview rejects malformed and incomplete JSON without poisoning the next valid edit", async (t) => {
  const fetch = offline(t);
  const api = createPeoplePreviewApi();
  t.after(() => api.dispose());
  const valid = JSON.parse(patch(0).body) as Record<string, unknown>;
  const { birthDate: _birthDate, ...missingPrivateField } = valid;
  const invalid = [
    "{",
    "null",
    "[]",
    "true",
    JSON.stringify(missingPrivateField),
    JSON.stringify({ ...valid, city: 123 }),
    JSON.stringify({ ...valid, bio: {} }),
    JSON.stringify({ ...valid, countryCode: "ZZ" }),
    JSON.stringify({ ...valid, birthDate: "2000-02-31" }),
    JSON.stringify({ ...valid, birthDate: "9999-01-01" }),
    JSON.stringify({ ...valid, skills: ["ABC", "ＡＢＣ"] }),
  ];
  for (const body of invalid) {
    await assert.rejects(
      api.request("me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body }),
      rejected(400, "INVALID_PROFILE_INPUT"),
    );
    assert.equal(api.getProfile().version, 0);
    assert.equal(api.snapshotVersion(), 0);
  }
  const validSave = await api.request("me", patch(0));
  assert.equal(readPersonalProfile(validSave.profile).version, 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test("profile preview clones reads, announces only committed edits and cleans in-flight image work on disposal", {
  timeout: 5000,
}, async (t) => {
  const fetch = offline(t);
  const api = createPeoplePreviewApi();
  t.after(() => api.dispose());
  let notifications = 0;
  const unsubscribe = api.subscribe(() => {
    notifications++;
  });
  const first = await api.request("me");
  first.profile.name = "Changed copy";
  first.profile.skills.push("Mutable copy");
  assert.equal(api.getProfile().name, "Ogledni profil");
  assert.deepEqual(api.getProfile().skills, []);
  const selected = api.getProfile();
  selected.skills.push("Selector copy");
  assert.deepEqual((await api.request("me")).profile.skills, []);
  await api.request("me", patch(0));
  assert.equal(notifications, 1);
  assert.equal(api.snapshotVersion(), 1);
  await api.request("me");
  assert.equal(notifications, 1);
  unsubscribe();

  // Explicit bitmap/canvas fixtures verify lifecycle only; no image decoding or encoding is claimed.
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (originalBitmap) Object.defineProperty(globalThis, "createImageBitmap", originalBitmap);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  let releaseDecode: (() => void) | undefined;
  let announceDecode: (() => void) | undefined;
  const decoding = new Promise<void>((resolve) => {
    announceDecode = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseDecode = resolve;
  });
  let closed = 0;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => {
      announceDecode?.();
      await release;
      return {
        width: 2,
        height: 2,
        close() {
          closed++;
        },
      };
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return { drawImage() {} };
          },
          toBlob(done: (blob: Blob) => void) {
            done(new Blob(["fixture-webp"], { type: "image/webp" }));
          },
        };
      },
    },
  });
  const created: string[] = [],
    revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => {
    const url = `blob:fixture-${created.length}`;
    created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => {
    revoked.push(url);
  });
  const updating = api.request("me/media/photo", {
    method: "PUT",
    headers: { "If-Match": '"1"' },
    body: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }),
  });
  await decoding;
  api.dispose();
  assert.ok(releaseDecode);
  releaseDecode();
  await assert.rejects(updating);
  assert.equal(api.getProfile().version, 1);
  assert.equal(api.getProfile().photoVersion, null);
  assert.equal(closed, 1);
  assert.ok(
    created.every((url) => revoked.includes(url)),
    "any late object URL must be released",
  );
  assert.equal(fetch.mock.callCount(), 0);
});
