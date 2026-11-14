import assert from "node:assert/strict";
import test from "node:test";
import { createAccountHttpHandler } from "../src/server/account-http";
import {
  AccountAccessError,
  type AccountService,
  parseAccountListInput,
} from "../src/server/auth/accounts";

const baseURL = "https://admin-fixture.invalid";
function fixture(error?: AccountAccessError) {
  const calls: { kind: string; input?: unknown; headers: Headers }[] = [];
  const legacy = { accounts: [], truncated: false, limit: 100 };
  const service = {
    async listPending(headers: Headers) {
      calls.push({ kind: "legacy", headers });
      return legacy;
    },
    async listAccounts(headers: Headers, input: unknown) {
      calls.push({ kind: "paged", input, headers });
      if (error) throw error;
      const { approval, page } = parseAccountListInput(input);
      return { accounts: [], approval, page, hasMore: false, limit: 30 };
    },
  } as unknown as AccountService;
  const handler = createAccountHttpHandler({ service, baseURL });
  const request = (query = "") =>
    handler(
      new Request(`${baseURL}/api/admin/accounts${query}`, {
        headers: { cookie: "fixture-signed-session" },
      }),
    );
  return { calls, legacy, request };
}

test("admin accounts without query retain the legacy pending contract", async () => {
  const { request, calls, legacy } = fixture();
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), legacy);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["legacy"],
  );
});

test("filtered account requests normalize the closed approval/page/search input", async () => {
  for (const approval of ["pending", "approved", "suspended"]) {
    const { request, calls } = fixture();
    const response = await request(`?approval=${approval}&page=2&q=%20%25_%21%20`);
    assert.equal(response.status, 200);
    const call = calls[0];
    assert.ok(call);
    assert.deepEqual(call.input, { approval, page: 2, q: "%_!" });
    assert.equal(call.headers.get("cookie"), "fixture-signed-session");
    assert.equal(call.kind, "paged");
    assert.deepEqual(await response.json(), {
      accounts: [],
      approval,
      page: 2,
      hasMore: false,
      limit: 30,
    });
  }
});

test("duplicate, unknown, missing and malformed query fields never reach the account service", async () => {
  const queries = [
    "?approval=pending",
    "?page=1",
    "?approval=owner&page=1",
    "?approval=pending&page=0",
    "?approval=pending&page=01",
    "?approval=pending&page=1e2",
    "?approval=pending&page=1001",
    "?approval=pending&page=1&page=2",
    "?approval=pending&approval=approved&page=1",
    "?approval=pending&page=1&q=a&q=b",
    "?approval=pending&page=1&role=owner",
    "?approval=pending&page=1&q=%0Avalid",
    "?approval=pending&page=1&q=%C2%85",
    `?approval=pending&page=1&q=${"x".repeat(81)}`,
  ];
  for (const query of queries) {
    const { request, calls } = fixture();
    const response = await request(query);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [], query);
  }
});

test("direct paged service input is also closed and bounded", () => {
  for (const input of [
    { approval: "pending", page: "1" },
    { approval: "approved", page: Number.NaN },
    { approval: "suspended", page: 1.5 },
    { approval: "pending", page: 1, q: null },
    { approval: "pending", page: 1, q: "\tname" },
    { approval: "pending", page: 1, owner: true },
  ])
    assert.throws(() => parseAccountListInput(input), AccountAccessError);
  assert.deepEqual(parseAccountListInput({ approval: "approved", page: 1000, q: "  name  " }), {
    approval: "approved",
    page: 1000,
    q: "name",
  });
});

test("paged listing keeps authentication/authorization failures and cache policy", async () => {
  for (const [status, code] of [
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "OWNER_REQUIRED"],
    [503, "ACCOUNT_UNAVAILABLE"],
  ] as const) {
    const { request } = fixture(new AccountAccessError(status, code));
    const response = await request("?approval=approved&page=1");
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
