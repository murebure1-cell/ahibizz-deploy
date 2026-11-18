import { getAccountService } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService, readAuthConfiguration } from "../auth/service";
import { createDodoTestHttpHandler, DodoHttpError, type DodoTestHttpService } from "./http";
import {
  createDodoTestAdapter,
  type DodoTestConfig,
  type DodoTestOrder,
  dodoTestConfiguration,
} from "./test-adapter";
import { createDodoTestStore } from "./test-store";

type Store = ReturnType<typeof createDodoTestStore>;
type Order = Awaited<ReturnType<Store["read"]>>;
type Actor = Parameters<Store["create"]>[0];
type Provider = ReturnType<typeof createDodoTestAdapter>;
const catalog = (available = false) => ({
  available,
  environment: "test_mode",
  amountMinor: 511,
  currency: "EUR",
  originalBamMinor: 1000,
  days: 7,
});
function dto(o: Order) {
  return {
    id: o.id,
    businessId: o.businessId,
    status: o.status,
    sessionId: o.sessionId,
    checkoutUrl: o.checkoutUrl,
    paymentId: o.paymentId,
    testStartsAt: o.testStartsAt,
    testEndsAt: o.testEndsAt,
  };
}
function providerOrder(o: Order): DodoTestOrder {
  return {
    id: o.id,
    requestId: o.requestId,
    purpose: "promotion",
    amountMinor: 511,
    currency: "EUR",
  };
}
export function createDodoTestService(options: {
  config: DodoTestConfig;
  store: Store;
  actor: (headers: Headers, owner?: boolean) => Promise<Actor>;
  provider: (persistence: Parameters<typeof createDodoTestAdapter>[1]) => Provider;
}): DodoTestHttpService {
  const { config, store, actor, provider } = options;
  function gate() {
    if (config.enabled !== true || config.environment !== "test_mode")
      throw new DodoHttpError(503, "DODO_TEST_DISABLED");
  }
  function match(o: Order) {
    if (o.merchantId !== config.businessId || o.productId !== config.productId)
      throw new DodoHttpError(409, "DODO_ORDER_CONFIG_MISMATCH");
  }
  async function reconcile(o: Order) {
    match(o);
    if (!o.sessionId) return { order: o, resolved: false };
    const result = await provider(store.persistence).reconcileSession(
      providerOrder(o),
      o.sessionId,
    );
    if (result.status === "succeeded")
      return { order: await store.settleVerified(o.id, result), resolved: true };
    if (result.status === "review") return { order: await store.markReview(o.id), resolved: true };
    return { order: o, resolved: false };
  }
  async function processInbox(item: Awaited<ReturnType<Store["pendingInbox"]>>[number]) {
    if (item.namespace !== `dodo:test_mode:${config.businessId}`) return;
    const event = JSON.parse(item.raw) as {
      type?: string;
      data?: { payment_id?: string; metadata?: { ahibizz_order_id?: string } };
    };
    const id = event.data?.metadata?.ahibizz_order_id;
    let o: Order | null = null;
    if (typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)) {
      try {
        o = await store.readSystem(id);
      } catch {
        /* Unmatched event stays reviewable. */
      }
    }
    if (!o && event.data?.payment_id) o = await store.findPayment(event.data.payment_id);
    if (!o) {
      await store.finishInbox(item.id, "review");
      return;
    }
    match(o);
    const result = await reconcile(o);
    if (result.resolved) await store.finishInbox(item.id, "processed");
  }
  return {
    catalog: () => catalog(config.enabled && config.environment === "test_mode"),
    async create(headers, input) {
      gate();
      const a = await actor(headers);
      const o = await store.create(a, {
        ...input,
        merchantId: config.businessId,
        productId: config.productId,
      });
      match(o);
      if (o.sessionId)
        return {
          order: dto(o),
          ...(o.status === "provider_created" ? { checkoutUrl: o.checkoutUrl } : {}),
        };
      try {
        const session = await provider(store.scopedPersistence(a, o.id)).createCheckout(
          providerOrder(o),
        );
        const saved = await store.read(a, o.id);
        return { order: dto(saved), checkoutUrl: session.checkoutUrl };
      } catch {
        return { order: dto(await store.read(a, o.id)), pending: true };
      }
    },
    async read(headers, id) {
      gate();
      const o = await store.read(await actor(headers), id);
      match(o);
      return { order: dto(o) };
    },
    async reconcile(headers, id) {
      gate();
      const o = await store.read(await actor(headers), id);
      return { order: dto((await reconcile(o)).order) };
    },
    async webhook(headers, raw) {
      gate();
      const result = await provider(store.persistence).receiveWebhook(headers, raw);
      const item = await store.readInbox(`dodo:test_mode:${config.businessId}`, result.eventId);
      if (item?.status === "pending") await processInbox(item);
      return { received: true, ...result };
    },
    async batch(headers, cursors) {
      gate();
      await actor(headers, true);
      const inbox =
        cursors.inboxAfter === null ? [] : await store.pendingInbox(20, cursors.inboxAfter);
      const orders =
        cursors.ordersAfter === null ? [] : await store.listPending(20, cursors.ordersAfter);
      let processed = 0,
        failed = 0;
      for (const item of inbox) {
        try {
          await processInbox(item);
          processed++;
        } catch {
          failed++;
        }
      }
      for (const o of orders) {
        if (o.merchantId !== config.businessId || o.productId !== config.productId) continue;
        try {
          await reconcile(o);
          processed++;
        } catch {
          failed++;
        }
      }
      return {
        processed,
        failed,
        next: {
          inboxAfter: inbox.length === 20 ? (inbox.at(-1)?.id ?? null) : null,
          ordersAfter: orders.length === 20 ? (orders.at(-1)?.id ?? null) : null,
        },
      };
    },
  };
}
export async function handleDodoTestRequest(request: Request) {
  const config = dodoTestConfiguration();
  if (!config || process.env.DODO_TEST_HTTP_ENABLED !== "true")
    return Response.json(
      new URL(request.url).pathname === "/api/dodo-test/catalog"
        ? catalog(false)
        : { code: "DODO_TEST_DISABLED" },
      {
        status: new URL(request.url).pathname === "/api/dodo-test/catalog" ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  try {
    const authConfig = readAuthConfiguration(),
      accounts = getAccountService(),
      auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (
      !authConfig ||
      new URL(authConfig.baseURL).origin !== config.returnOrigin ||
      !accounts ||
      !auth ||
      !pool
    )
      throw Error("DODO_UNAVAILABLE");
    return createDodoTestHttpHandler(
      createDodoTestService({
        config,
        store: createDodoTestStore(pool),
        provider: (p) => createDodoTestAdapter(config, p),
        actor: async (headers, owner = false) => {
          const profile = await accounts.read(headers);
          if (owner && profile.role !== "owner")
            throw new DodoHttpError(403, "DODO_OWNER_REQUIRED");
          const signed = await auth.api.getSession({
            headers,
            query: { disableCookieCache: true, disableRefresh: true },
          });
          if (
            !signed?.session ||
            signed.session.userId !== profile.id ||
            signed.user.id !== profile.id
          )
            throw new DodoHttpError(401, "DODO_AUTH_REQUIRED");
          return {
            userId: profile.id,
            id: signed.session.id,
            token: signed.session.token,
            expectedAccountId: headers.get("X-AhiBizz-Account-ID"),
          };
        },
      }),
      config.returnOrigin,
    )(request);
  } catch {
    return Response.json(
      { code: "DODO_TEST_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
