import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnPath } from "../src/lib/account-return";
import { provisionPackagePlans } from "../src/server/paypal-subscriptions/setup";

const origin = "https://fixture.example",
  product = "AHIBIZZ-BUSINESS-PACKAGES-V1";
type Item = Record<string, unknown>;
test("provisioning six finite plans is safe to resume and rejects an altered plan or webhook before activation", async () => {
  const items: Item[] = [];
  const hooks: Item[] = [];
  let productFound = false;
  const operations: string[] = [];
  const api = async (path: string, method = "GET", body?: unknown) => {
    const obj = body as Item;
    if (method === "GET") {
      if (path === `/v1/catalogs/products/${product}`)
        return productFound ? { id: product, type: "SERVICE" } : {};
      if (path.startsWith("/v1/billing/plans?")) return { plans: items, total_pages: 1 };
      if (path.startsWith("/v1/billing/plans/"))
        return items.find((p) => path.endsWith(String(p.id))) ?? {};
      if (path === "/v1/notifications/webhooks") return { webhooks: hooks };
      if (path.startsWith("/v1/notifications/webhooks/")) return hooks[0] ?? {};
    }
    operations.push(path);
    if (path === "/v1/catalogs/products") {
      productFound = true;
      return obj;
    }
    if (path === "/v1/billing/plans") {
      const row = { ...obj, id: `P-TESTPLAN0000${items.length}` };
      items.push(row);
      return row;
    }
    if (path === "/v1/notifications/webhooks") {
      const row = { ...obj, id: "TESTWEBHOOK00" };
      hooks.push(row);
      return row;
    }
    throw Error(path);
  };
  const first = await provisionPackagePlans(api, origin);
  assert.equal(Object.keys(first.plans).length, 6);
  assert.equal(operations.length, 8);
  assert.deepEqual(await provisionPackagePlans(api, origin), first);
  assert.equal(operations.length, 8);
  const annual = items.find((p) => p.id === first.plans["business:annual"]);
  assert.ok(annual);
  const cycles = (annual.billing_cycles as { total_cycles: number }[])[0];
  assert.ok(cycles);
  cycles.total_cycles = 0;
  await assert.rejects(provisionPackagePlans(api, origin));
  cycles.total_cycles = 1;
  assert.ok(hooks[0]);
  hooks[0].event_types = [];
  await assert.rejects(provisionPackagePlans(api, origin));
  assert.equal(operations.length, 8);
});
test("login returns customers to their exact plan and payment schedule", () => {
  for (const plan of ["basic", "business", "premium"])
    for (const period of ["monthly", "annual"]) {
      const path = `/paketi/placanje?paket=${plan}&period=${period}`;
      assert.equal(accountReturnPath(path), path);
      assert.equal(accountReturnPath(`${path}&next=https://other.test`), "/nalog");
    }
});
