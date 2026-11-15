import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createConnectionsPreviewApi } from "../src/components/preview/connections-preview-api";
import { createPeoplePreviewApi } from "../src/components/preview/people-preview-api";
import {
  readConnectionItem,
  readProfileVisibility,
  readPublicPerson,
  readRelationship,
} from "../src/lib/connections";
import { ConnectionRequestError, connectionAccountRequest } from "../src/lib/connections-client";

function fixture() {
  const people = createPeoplePreviewApi(),
    connections = createConnectionsPreviewApi(people);
  const write = (
    path: string,
    expectedVersion: number,
    rest: Record<string, unknown> = {},
    key = randomUUID(),
  ) =>
    connections.request(path, {
      method: path === "visibility" ? "PATCH" : "POST",
      body: JSON.stringify({ expectedVersion, ...rest, idempotencyKey: key }),
    });
  return { people, connections, write };
}

test("account-bound preview reads and writes reject another actor before state changes", async () => {
  const f = fixture();
  const expected = f.people.getProfile().id;
  const before = f.people.getProfile();
  for (const path of ["connections?view=incoming", "visibility"]) {
    const options =
      path === "visibility"
        ? {
            method: "PATCH",
            body: JSON.stringify({
              isPublic: true,
              expectedVersion: 0,
              idempotencyKey: randomUUID(),
            }),
          }
        : {};
    await assert.rejects(
      connectionAccountRequest(f.connections.request, "another_actor", path, options),
      { status: 401, code: "ACCOUNT_IDENTITY_CHANGED" },
    );
  }
  for (const expectedAccountId of ["", "bad actor", "../another", "x".repeat(129)]) {
    const headers = new Headers({ "X-AhiBizz-Account-ID": expectedAccountId });
    await assert.rejects(f.connections.request("connections", { headers }), {
      status: 400,
      code: "INVALID_CONNECTION_INPUT",
    });
  }
  assert.deepEqual(f.people.getProfile(), before);
  const incoming = await connectionAccountRequest(
    f.connections.request,
    expected,
    "connections?view=incoming",
  );
  assert.equal((incoming.items as unknown[]).length, 1);
  assert.deepEqual(await f.connections.request("connections?view=incoming"), incoming);
});

test("actor binding preserves exact command and headers and refuses malformed identities before transport", async () => {
  const calls: { path: string; options: RequestInit }[] = [];
  const request = async (path: string, options: RequestInit = {}) => {
    calls.push({ path, options });
    return {};
  };
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": "wrong_actor" },
    body: '{"expectedVersion":1,"idempotencyKey":"fixture-key"}',
  };
  await connectionAccountRequest(request, "current_actor", "connections/fixture/accept", options);
  assert.equal(calls[0]?.options.body, options.body);
  assert.equal(calls[0]?.options.method, "POST");
  const headers = new Headers(calls[0]?.options.headers);
  assert.equal(headers.get("X-AhiBizz-Account-ID"), "current_actor");
  assert.equal(headers.get("Content-Type"), "application/json");
  for (const value of [undefined, "", "bad actor", "../another", "x".repeat(129)])
    await assert.rejects(connectionAccountRequest(request, value, "connections"), {
      status: 401,
      code: "ACCOUNT_IDENTITY_CHANGED",
    });
  assert.equal(calls.length, 1);
});
test("preview starts private, exposes only safe public projection and opt-in shares one profile CAS", async () => {
  const f = fixture();
  assert.deepEqual((await f.connections.request("visibility")).visibility, {
    isPublic: false,
    profileVersion: 0,
  });
  await assert.rejects(f.connections.request("people/preview-person"), { status: 404 });
  const publicState = readProfileVisibility(
    (await f.write("visibility", 0, { isPublic: true })).visibility,
  );
  assert.equal(publicState.profileVersion, 1);
  assert.equal(f.people.getProfile().version, 1);
  const publicPerson = readPublicPerson(
    (await f.connections.request("people/preview-person")).person,
  );
  assert.ok(!Object.hasOwn(publicPerson, "birthDate"));
  assert.ok(!Object.hasOwn(publicPerson, "email"));
  await assert.rejects(f.write("visibility", 0, { isPublic: false }), { status: 409 });
  await f.write("visibility", 1, { isPublic: false });
  await assert.rejects(f.connections.request("people/preview-person"), { status: 404 });
});
test("preview request requires a public actor; request/cancel receipt replays once and never invents acceptance", async () => {
  const f = fixture(),
    target = "preview-developer";
  await assert.rejects(f.write(`people/${target}/request`, 0), { status: 403 });
  await f.write("visibility", 0, { isPublic: true });
  const key = randomUUID(),
    first = readRelationship((await f.write(`people/${target}/request`, 0, {}, key)).relationship);
  assert.equal(first.status, "pending");
  assert.deepEqual((await f.write(`people/${target}/request`, 0, {}, key)).relationship, first);
  await assert.rejects(f.write(`people/${target}/request`, 1, {}, key), { status: 409 });
  const incoming = await f.connections.request("connections?view=outgoing");
  assert.equal((incoming.items as unknown[]).length, 1);
  const cancelled = readRelationship(
    (await f.write(`connections/${first.id}/cancel`, 1)).relationship,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await f.connections.request("people/preview-developer")).viewerId,
    "preview-person",
  );
  assert.equal(
    readRelationship((await f.connections.request("people/preview-developer")).relationship).status,
    "cancelled",
  );
});
test("incoming fixture accepts only recipient, then removal preserves relationship version", async () => {
  const f = fixture();
  await f.write("visibility", 0, { isPublic: true });
  const list = await f.connections.request("connections?view=incoming"),
    item = readConnectionItem((list.items as unknown[])[0]);
  await assert.rejects(f.write(`connections/${item.id}/cancel`, item.version), { status: 409 });
  const accepted = readRelationship(
    (await f.write(`connections/${item.id}/accept`, item.version)).relationship,
  );
  assert.equal(accepted.status, "accepted");
  assert.equal((await f.connections.request("connections?view=contacts")).hasMore, false);
  const removed = readRelationship(
    (await f.write(`connections/${item.id}/remove`, accepted.version)).relationship,
  );
  assert.equal(removed.version, 3);
  assert.equal(removed.status, "removed");
  assert.deepEqual((await f.connections.request("connections?view=contacts")).items, []);
});
test("historic visibility receipt stays historic while fresh reads show later consent", async () => {
  const f = fixture();
  await f.write("visibility", 0, { isPublic: true });
  const key = randomUUID();
  await f.write("visibility", 1, { isPublic: false }, key);
  await f.write("visibility", 2, { isPublic: true });
  assert.deepEqual((await f.write("visibility", 1, { isPublic: false }, key)).visibility, {
    isPublic: false,
    profileVersion: 2,
  });
  assert.deepEqual((await f.connections.request("visibility")).visibility, {
    isPublic: true,
    profileVersion: 3,
  });
});
test("preview transport rejects foreign routes, invalid query/body, stale updates and aborted requests", async () => {
  const f = fixture();
  for (const path of [
    "https://evil.invalid/visibility",
    "../visibility",
    "connections?view=secret",
    "people?page=0",
    "people?q=a&q=b",
    "visibility?public=true",
  ])
    await assert.rejects(f.connections.request(path), ConnectionRequestError);
  await assert.rejects(
    f.connections.request("visibility", { method: "PATCH", body: '{"isPublic":true}' }),
    { status: 400 },
  );
  await assert.rejects(f.connections.request("people", { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
  assert.equal(f.people.getProfile().version, 0);
});
