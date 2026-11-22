import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError } from "../src/server/auth/accounts";
import { resolveSupportRequest } from "../src/server/support-resolution";

const requestId = "e7a7b4a4-9bb4-4a8f-9696-8a631221b890";

test("support resolution binds the rendered operator without changing request headers", async () => {
  const source = new Headers({
    cookie: "fixture-session",
    "X-AhiBizz-Account-ID": "other-operator",
  });
  let calls = 0;
  await resolveSupportRequest(
    {
      async resolve(headers, id) {
        calls++;
        assert.equal(id, requestId);
        assert.equal(headers.get("X-AhiBizz-Account-ID"), "rendered-operator");
        assert.equal(headers.get("cookie"), "fixture-session");
      },
    },
    source,
    "rendered-operator",
    requestId,
  );
  assert.equal(calls, 1);
  assert.equal(source.get("X-AhiBizz-Account-ID"), "other-operator");
});

test("missing or malformed support form identity cannot dispatch a close", async () => {
  let calls = 0;
  const service = {
    async resolve() {
      calls++;
    },
  };
  for (const actor of [null, undefined, "", "bad/actor", "a".repeat(129)])
    await assert.rejects(
      resolveSupportRequest(service, new Headers(), actor, requestId),
      (error) => error instanceof AccountAccessError && error.status === 401,
    );
  for (const id of [null, "", "not-a-request"])
    await assert.rejects(
      resolveSupportRequest(service, new Headers(), "operator", id),
      (error) => error instanceof AccountAccessError && error.status === 400,
    );
  assert.equal(calls, 0);
});

test("unavailable support and denied stale operator remain failures", async () => {
  await assert.rejects(
    resolveSupportRequest(null, new Headers(), "operator", requestId),
    (error) => error instanceof AccountAccessError && error.status === 503,
  );
  await assert.rejects(
    resolveSupportRequest(
      {
        async resolve(headers) {
          assert.equal(headers.get("X-AhiBizz-Account-ID"), "rendered-operator");
          throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
        },
      },
      new Headers(),
      "rendered-operator",
      requestId,
    ),
    (error) => error instanceof AccountAccessError && error.code === "ACCOUNT_IDENTITY_CHANGED",
  );
});
