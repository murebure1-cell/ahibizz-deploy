import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCheckoutOrder } from "../src/lib/checkout-order-read";

const id = "saved-order";
const success = () => Response.json({ order: { id } });
for (const status of [429, 502, 503, 504]) {
  test(`order GET retries transient ${status} and keeps account and identity`, async () => {
    const calls: RequestInit[] = [];
    const result = await readCheckoutOrder(
      id,
      "owner",
      new AbortController().signal,
      (async (url, init) => {
        assert.equal(url, `/api/checkout/orders/${id}`);
        calls.push(init ?? {});
        return calls.length < 3 ? new Response("upstream", { status }) : success();
      }) as typeof fetch,
      async () => {},
    );
    assert.deepEqual(result, { id });
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.deepEqual(call.headers, { "X-AhiBizz-Account-ID": "owner" });
      assert.equal(call.body, undefined);
    }
  });
}
test("network failures stop after three reads, without claiming lack of access", async () => {
  let calls = 0;
  await assert.rejects(
    readCheckoutOrder(
      id,
      "owner",
      new AbortController().signal,
      (async () => {
        calls++;
        throw new TypeError("network");
      }) as typeof fetch,
      async () => {},
    ),
    /trenutno nije moguće/,
  );
  assert.equal(calls, 3);
});
test("auth, ownership and missing order errors are specific and are not retried", async () => {
  for (const [status, message] of [
    [401, /Prijavi/],
    [403, /Nalog je promijenjen/],
    [404, /nije pronađena/],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      readCheckoutOrder(
        id,
        "owner",
        new AbortController().signal,
        (async () => {
          calls++;
          return new Response("", { status });
        }) as typeof fetch,
        async () => {},
      ),
      message,
    );
    assert.equal(calls, 1);
  }
});
test("cancelled identity read never retries and wrong order response fails closed", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    readCheckoutOrder(
      id,
      "owner",
      controller.signal,
      (async () => {
        calls++;
        controller.abort();
        throw new TypeError("interrupted");
      }) as typeof fetch,
      async () => {},
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    readCheckoutOrder(
      id,
      "owner",
      new AbortController().signal,
      (async () => Response.json({ order: { id: "different" } })) as typeof fetch,
      async () => {},
    ),
    /trenutno nije moguće/,
  );
});
test("saved-order UI blocks new purchase until loaded and offers manual GET retry and explicit resume", () => {
  const source = readFileSync("src/components/billing/Checkout.tsx", "utf8");
  assert.match(source, /!order && !initialOrderId/);
  assert.match(source, /Ponovo učitaj sačuvanu narudžbu/);
  assert.match(source, /controller.abort\(\)/);
  assert.match(source, /value.order.requestId !== key.current/);
  assert.match(source, /Pronađena je tvoja otvorena narudžba/);
});

test("cancelled order is clearly closed and cannot resume payment", () => {
  const source = readFileSync("src/components/billing/Checkout.tsx", "utf8");
  assert.match(source, /order.status === "cancelled"/);
  assert.match(source, /Narudžba je stornirana/);
  assert.match(source, /Novi pokušaj/);
  assert.match(source, /order\?\.status === "cancelled" && action !== "reconcile"/);
});
