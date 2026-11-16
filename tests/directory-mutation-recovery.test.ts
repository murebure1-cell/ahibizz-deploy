import assert from "node:assert/strict";
import test from "node:test";
import { DirectoryRequestError } from "../src/lib/directory-create-submission";
import {
  type DirectoryMutation,
  directoryMutationState,
  patchDirectoryBusinessCache,
  uncertainDirectoryMutation,
} from "../src/lib/directory-mutation-recovery";
import type { DirectoryBusiness } from "../src/server/directory/types";

const before: DirectoryBusiness = {
  id: "business-one",
  ownerId: "owner-A",
  title: "Old title",
  categoryId: "category-one",
  subcategoryId: null,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: null,
  countryCode: null,
  latitude: null,
  longitude: null,
  status: "published",
  version: 1,
  verified: false,
  featured: false,
  createdAt: "2026-11-16T00:00:00Z",
  updatedAt: "2026-11-16T00:00:00Z",
  publishedAt: "2026-11-16T00:00:00Z",
  archivedAt: null,
};
const edit: DirectoryMutation = {
  before,
  action: "edit",
  desiredStatus: "published",
  fields: { ...before, title: "New title" },
};

test("unknown directory writes require read-only recovery, unlike a definite rejection", () => {
  for (const failure of [
    new Error("network"),
    new DirectoryRequestError("TIMEOUT", 408),
    new DirectoryRequestError("UNAVAILABLE", 503),
  ])
    assert.equal(uncertainDirectoryMutation(failure), true);
  for (const status of [400, 401, 403, 404, 409, 422])
    assert.equal(uncertainDirectoryMutation(new DirectoryRequestError("REJECTED", status)), false);
});

test("an original-version read cannot release an unknown write; a newer snapshot is the barrier", () => {
  assert.equal(directoryMutationState(edit, before), "pending");
  assert.equal(
    directoryMutationState(edit, { ...before, version: 2, title: "New title" }),
    "matched",
  );
  assert.equal(
    directoryMutationState(edit, { ...before, version: 3, title: "Other edit" }),
    "changed",
  );
  assert.throws(() => directoryMutationState(edit, { ...before, id: "other", version: 2 }));
  assert.throws(() => directoryMutationState(edit, { ...before, version: 0 }));
});

test("member edit moderation and server-normalized fields must match before claiming success", () => {
  const intent: DirectoryMutation = {
    ...edit,
    desiredStatus: "pending",
    fields: {
      ...before,
      title: "New title",
      contactEmail: "HELLO@example.com",
      countryCode: "ba",
      websiteUrl: "https://example.com",
    },
  };
  const fresh = {
    ...before,
    version: 2,
    status: "pending" as const,
    title: "New title",
    contactEmail: "hello@example.com",
    countryCode: "BA",
    websiteUrl: "https://example.com/",
  };
  assert.equal(directoryMutationState(intent, fresh), "matched");
  assert.equal(directoryMutationState(intent, { ...fresh, status: "published" }), "changed");
});

test("confirmed cached edits replace fields and CAS immediately and archive/recover remove the old selection", () => {
  const changed = { ...before, version: 2, title: "New title" };
  assert.deepEqual(patchDirectoryBusinessCache([before], changed, false), [changed]);
  const archived = { ...changed, version: 3, status: "archived" as const };
  assert.deepEqual(patchDirectoryBusinessCache([changed], archived, false), []);
  assert.deepEqual(
    patchDirectoryBusinessCache([archived], { ...archived, version: 4, status: "draft" }, true),
    [],
  );
  assert.deepEqual(patchDirectoryBusinessCache([changed], before, false), [changed]);
  assert.equal(patchDirectoryBusinessCache(null, changed, false, true), null);
  assert.deepEqual(patchDirectoryBusinessCache([], changed, false, true), [changed]);
  assert.deepEqual(patchDirectoryBusinessCache([], changed, false), []);
});
