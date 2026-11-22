import { paypalOrderFlow } from "../../lib/paypal-order-flow";
import { getAccountService } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService, readAuthConfiguration } from "../auth/service";
import { readPlatformCreditsOnly } from "../wallet/platform-policy";
import { creditCardTopUpsAvailable, readCreditTopUpBankOnly } from "./credit-top-up-policy";
import {
  CheckoutHttpError,
  type CheckoutHttpService,
  createCheckoutHttpHandler,
  providerOrder,
} from "./http";
import {
  createLivePayPal,
  isDeclinedCaptureStatus,
  type LiveConfiguration,
  PayPalLiveError,
  providerOrderReference,
} from "./live";
import { type CheckoutActor, type CheckoutOrder, createCheckoutStore } from "./store";

export type CheckoutConfiguration = LiveConfiguration & {
  enabled: boolean;
  priceApproved: boolean;
  fulfillmentReady: boolean;
  environment: "live" | "sandbox";
};
export function checkoutConfiguration(
  env: Record<string, string | undefined> = process.env,
): CheckoutConfiguration | null {
  const environment = env.PAYPAL_CHECKOUT_ENVIRONMENT;
  if (environment !== "live" && environment !== "sandbox") return null;
  const prefix = environment === "live" ? "PAYPAL_LIVE_" : "PAYPAL_SANDBOX_";
  const clientId = env[`${prefix}CLIENT_ID`],
    clientSecret = env[`${prefix}CLIENT_SECRET`],
    merchantId = env[`${prefix}MERCHANT_ID`],
    webhookId = env[`${prefix}WEBHOOK_ID`],
    publicOrigin = env.PAYPAL_CHECKOUT_PUBLIC_ORIGIN;
  if (!clientId || !clientSecret || !merchantId || !webhookId || !publicOrigin) return null;
  try {
    if (new URL(publicOrigin).origin !== publicOrigin) return null;
  } catch {
    return null;
  }
  const enabled = env.PAYPAL_CHECKOUT_ENABLED === "true",
    priceApproved = env.PAYPAL_CHECKOUT_EUR_PRICE_APPROVED === "true",
    fulfillmentReady = env.PAYPAL_CHECKOUT_FULFILLMENT_READY === "true";
  return {
    clientId,
    clientSecret,
    merchantId,
    webhookId,
    publicOrigin,
    environment,
    enabled,
    priceApproved,
    fulfillmentReady,
    chargingApproved: enabled && priceApproved && fulfillmentReady,
    creditCardTopUps: env.PAYPAL_CREDIT_CARD_TOPUPS_ENABLED === "true",
    creditCardTopUpsPilotOwner: env.PAYPAL_CREDIT_CARD_TOPUPS_PILOT_OWNER === "true",
    creditTopUpBankOnly: readCreditTopUpBankOnly(env),
    platformCreditsOnly: readPlatformCreditsOnly(env),
    refundsApproved: env.PAYPAL_CHECKOUT_REFUNDS_ENABLED === "true",
  };
}
function refundCaptureLink(links: unknown, environment: "sandbox" | "live"): string | undefined {
  if (!Array.isArray(links)) return undefined;
  const pattern =
    environment === "sandbox"
      ? /^https:\/\/(?:api|api-m)\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Z0-9]{10,32})$/
      : /^https:\/\/(?:api|api-m)\.paypal\.com\/v2\/payments\/captures\/([A-Z0-9]{10,32})$/;
  const ids = new Set<string>();
  for (const link of links) {
    if (!link || typeof link !== "object" || link.rel !== "up" || typeof link.href !== "string")
      continue;
    const id = pattern.exec(link.href)?.[1];
    if (id) ids.add(id);
  }
  // Resolve identity only, never fetch an event-supplied URL. Ambiguous links do not resolve.
  return ids.size === 1 ? [...ids][0] : undefined;
}
const terminal = new Set([
  "captured",
  "review",
  "partially_refunded",
  "refunded",
  "reversed",
  "cancelled",
]);
const captureFailureCodes = new Set([
  "PAYMENT_NOT_APPROVED",
  "PAYPAL_PAYER_ACTION_REQUIRED",
  "PAYPAL_ORDER_VOIDED",
  "PAYPAL_CARD_DECLINED",
  "PAYPAL_CARD_EXPIRED",
  "CARD_AUTHENTICATION_NOT_APPROVED",
]);
export function checkoutCatalog(config: CheckoutConfiguration | null, role?: string) {
  const platformCreditsOnly = config?.platformCreditsOnly ?? readPlatformCreditsOnly(),
    available = Boolean(config?.chargingApproved && !platformCreditsOnly);
  return {
    available,
    platformCreditsOnly,
    creditTopUpBankOnly:
      platformCreditsOnly || (config?.creditTopUpBankOnly ?? readCreditTopUpBankOnly()),
    creditCardTopUps: Boolean(
      available && config && creditCardTopUpsAvailable(config, config.environment, role),
    ),
    environment: config?.environment ?? null,
    currency: "EUR",
    promotion: {
      originalBamMinor: 1000,
      amountMinor: 511,
      days: 7,
      version: "category-seven-days-20261118",
    },
    support: {
      available: available && config?.environment === "sandbox",
      minMinor: 100,
      maxMinor: 100000,
    },
    paypalBosnianSupported: false,
    paypalClientId: available ? (config?.clientId ?? null) : null,
  };
}
function dto(order: CheckoutOrder) {
  return {
    id: order.id,
    flow: paypalOrderFlow(order.offerVersion),
    requestId: order.requestId,
    kind: order.kind,
    businessId: order.businessId,
    ...(order.quoteId ? { quoteId: order.quoteId, quoteKind: order.quoteKind } : {}),
    businessTitle: order.businessTitle,
    amountMinor: order.amountMinor,
    currency: order.currency,
    environment: order.environment,
    status: order.status,
    refundedMinor: order.refundedMinor,
    startsAt: order.startsAt,
    endsAt: order.endsAt,
    version: order.version,
  };
}
export function createCheckoutService({
  store,
  provider,
  config,
  actor,
}: {
  store: ReturnType<typeof createCheckoutStore>;
  provider: ReturnType<typeof createLivePayPal>;
  config: CheckoutConfiguration;
  actor: (headers: Headers, owner?: boolean) => Promise<CheckoutActor>;
}): CheckoutHttpService {
  function payable() {
    if (config.platformCreditsOnly) throw new CheckoutHttpError(409, "PLATFORM_CREDITS_ONLY");
    if (!config.chargingApproved) throw new CheckoutHttpError(503, "CHECKOUT_NOT_RELEASED");
  }
  function chargePurpose(kind: "promotion" | "support" | "quote") {
    if (config.environment === "live" && kind === "support")
      throw new CheckoutHttpError(403, "LIVE_SUPPORT_NOT_RELEASED");
  }
  function matching(order: CheckoutOrder) {
    if (order.environment !== config.environment || order.merchantId !== config.merchantId)
      throw new CheckoutHttpError(409, "CHECKOUT_CONFIGURATION_MISMATCH");
  }
  async function reconcile(order: CheckoutOrder, eventId?: string, captureOnly = false) {
    matching(order);
    const payment = providerOrder(order);
    const status = await provider.inspect(payment);
    if (status.status === "COMPLETED" && status.captureId && status.completedAt) {
      const settled = await store.settleCapture(
        order.id,
        {
          providerOrderId: order.providerOrderId ?? "",
          captureId: status.captureId,
          merchantId: config.merchantId,
          amountMinor: order.amountMinor,
          currency: "EUR",
          completedAt: status.completedAt,
        },
        eventId,
      );
      return { order: settled, paymentState: "confirmed" as const };
    }
    if (status.status === "DECLINED") {
      if (captureOnly || (payment.purpose !== "promotion" && !payment.creditTopUpCard))
        return { order, paymentState: "pending" as const };
      const closed = await store.closeDeclinedPromotion(order, status, eventId);
      return {
        order: closed,
        paymentState: closed.status === "cancelled" ? ("declined" as const) : ("pending" as const),
      };
    }
    if (
      (status.status === "REFUNDED" ||
        status.status === "REVERSED" ||
        status.status === "PARTIALLY_REFUNDED") &&
      status.captureId
    ) {
      const adjusted = await store.settleRefundedCapture(
        order.id,
        {
          providerOrderId: status.providerOrderId,
          captureId: status.captureId,
          merchantId: status.merchantId,
          amountMinor: status.amountMinor,
          currency: status.currency,
          completedAt: status.completedAt,
        },
        { refundedMinor: status.refundedMinor, reversed: status.status === "REVERSED" },
        eventId,
      );
      return { order: adjusted, paymentState: "adjusted" as const };
    }
    const paymentState = {
      ACTION_REQUIRED: "action_required",
      APPROVED: "approved",
      PENDING: "pending",
      UNKNOWN: "unknown",
      UNPAID: "unpaid",
      VOIDED: "voided",
    } as const;
    return {
      order,
      paymentState: paymentState[status.status as keyof typeof paymentState] ?? "unknown",
    };
  }
  async function recordRefundResult(
    commandId: string,
    value: Awaited<ReturnType<typeof provider.readRefund>>,
    eventId?: string,
  ) {
    const order = await store.attachRefundResult(commandId, value);
    if (value.status === "FAILED" && order.status === "review") await reconcile(order, eventId);
  }
  return {
    async catalog(headers) {
      const catalog = checkoutCatalog(config);
      if (
        !catalog.available ||
        catalog.creditCardTopUps ||
        !creditCardTopUpsAvailable(config, config.environment, "owner")
      )
        return catalog;
      try {
        const identity = await actor(headers, true);
        if (identity.expectedAccountId && identity.expectedAccountId !== identity.userId)
          return catalog;
        return checkoutCatalog(config, identity.role);
      } catch {
        return catalog;
      }
    },
    async reconcileBatch(headers, cursors = {}) {
      await actor(headers, true);
      let reconciled = 0,
        pendingRefunds = 0,
        failed = 0;
      // Omitted cursor starts a sweep; null means this stream is finished.
      const refunds =
        cursors.refundsAfter === null
          ? []
          : await store.listPendingRefunds(config.environment, 20, cursors.refundsAfter);
      for (const item of refunds) {
        try {
          const order = await store.readSystem(item.orderId);
          if (
            order.environment !== config.environment ||
            !order.captureId ||
            !item.providerRefundId
          )
            continue;
          matching(order);
          const value = await provider.readRefund(providerOrder(order), {
            refundId: item.providerRefundId,
            captureId: order.captureId,
            amountMinor: item.amountMinor,
          });
          await recordRefundResult(item.id, value);
          pendingRefunds++;
        } catch {
          failed++;
        }
      }
      const orders =
        cursors.ordersAfter === null
          ? []
          : await store.listReconciliation(config.environment, 20, cursors.ordersAfter);
      for (const order of orders) {
        if (order.environment !== config.environment) continue;
        try {
          await reconcile(order);
          reconciled++;
        } catch {
          failed++;
        }
      }
      return {
        reconciled,
        pendingRefunds,
        failed,
        next: {
          ordersAfter: orders.length === 20 ? (orders.at(-1)?.id ?? null) : null,
          refundsAfter: refunds.length === 20 ? (refunds.at(-1)?.id ?? null) : null,
        },
      };
    },
    async read(headers, id) {
      const order = await store.read(await actor(headers), id);
      matching(order);
      return dto(order);
    },
    async readPendingPromotion(headers, businessId) {
      const order = await store.readPendingPromotion(
        await actor(headers),
        businessId,
        config.environment,
        config.merchantId,
      );
      return { order: order ? dto(order) : null };
    },
    async resumeCard(headers, id) {
      payable();
      const identity = await actor(headers);
      const order = await store.readPendingGuestCard(identity, id);
      matching(order);
      if (!(await provider.canResumeCard(providerOrder(order))))
        throw new CheckoutHttpError(409, "ORDER_NOT_PAYABLE");
      // Ownership, session or capture state may change while PayPal reads the order.
      const current = await store.readPendingGuestCard(identity, id);
      matching(current);
      if (current.providerOrderId !== order.providerOrderId)
        throw new CheckoutHttpError(409, "PROVIDER_ORDER_CONFLICT");
      return { order: dto(current), providerOrderId: current.providerOrderId };
    },
    async create(headers, input) {
      payable();
      chargePurpose(input.kind);
      if ((input.flow === "guest" || input.flow === "card-fields") && input.kind === "support")
        throw new CheckoutHttpError(400, "INVALID_CHECKOUT_FLOW");
      const identity = await actor(headers);
      let order = await store.create(identity, {
        ...input,
        ...(input.kind === "quote"
          ? {}
          : { amountMinor: input.kind === "promotion" ? 511 : (input.amountMinor ?? 0) }),
        environment: config.environment,
        merchantId: config.merchantId,
        offerVersion: `${input.kind === "quote" ? "marketing-quote-v1" : "category-seven-days-20261118"}${input.flow ? `:${input.flow}` : ""}`,
      });
      matching(order);
      chargePurpose(order.kind);
      if (terminal.has(order.status)) return { order: dto(order) };
      try {
        if (!order.providerOrderId)
          order = await store.attachProvider(
            order.id,
            await provider.create(
              providerOrder(order),
              paypalOrderFlow(order.offerVersion),
              identity.role,
            ),
          );
        return {
          order: dto(order),
          approvalUrl: order.approvalUrl,
          providerOrderId: order.providerOrderId,
          resumed: order.requestId !== input.requestId,
        };
      } catch {
        return { order: dto(order), pending: true, code: "PAYPAL_PENDING" };
      }
    },
    async cancel(headers, id) {
      const order = await store.cancelPromotion(await actor(headers), id, async (pending) => {
        matching(pending);
        try {
          return await provider.isUnpaidForCancellation(providerOrder(pending));
        } catch {
          throw new CheckoutHttpError(409, "ORDER_CANCELLATION_UNAVAILABLE");
        }
      });
      matching(order);
      return { order: dto(order) };
    },
    async capture(headers, id) {
      if (config.platformCreditsOnly) {
        const order = await store.read(await actor(headers), id);
        matching(order);
        if (terminal.has(order.status)) return { order: dto(order) };
        if (order.providerOrderId) {
          const result = await reconcile(order);
          if (terminal.has(result.order.status)) return { order: dto(result.order) };
        }
        throw new CheckoutHttpError(409, "PLATFORM_CREDITS_ONLY");
      }
      payable();
      const identity = await actor(headers);
      let order: CheckoutOrder;
      try {
        order = await store.prepareCapture(identity, id);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ORDER_BUSY_OR_EXPIRED"
        ) {
          order = await store.read(identity, id);
          matching(order);
          chargePurpose(order.kind);
          return { order: dto((await reconcile(order)).order), pending: true };
        }
        throw error;
      }
      matching(order);
      chargePurpose(order.kind);
      if (terminal.has(order.status)) return { order: dto(order) };
      let value: Awaited<ReturnType<typeof provider.capture>>;
      try {
        value = await provider.capture(providerOrder(order), paypalOrderFlow(order.offerVersion));
      } catch (error) {
        const code =
          error instanceof PayPalLiveError && captureFailureCodes.has(error.message)
            ? error.message
            : "PAYPAL_CAPTURE_PENDING";
        throw new CheckoutHttpError(409, code);
      }
      if (value.status !== "COMPLETED" || !value.captureId || !value.completedAt)
        throw new CheckoutHttpError(409, "PAYMENT_NOT_COMPLETED");
      return {
        order: dto(
          await store.settleCapture(id, {
            providerOrderId: order.providerOrderId ?? "",
            captureId: value.captureId,
            merchantId: config.merchantId,
            amountMinor: order.amountMinor,
            currency: "EUR",
            completedAt: value.completedAt,
          }),
        ),
      };
    },
    async reconcile(headers, id) {
      const identity = await actor(headers);
      const order = await store.read(identity, id);
      matching(order);
      if (!order.providerOrderId)
        return { order: dto(order), paymentState: "unknown", canCompleteApprovedPayment: false };
      const result = await reconcile(order);
      const canCompleteApprovedPayment =
        result.paymentState === "approved" &&
        !config.platformCreditsOnly &&
        config.chargingApproved &&
        (await store.canCompleteApprovedPayment(identity, order));
      return { ...result, order: dto(result.order), canCompleteApprovedPayment };
    },
    async refund(headers, id, input) {
      if (!config.refundsApproved) throw new CheckoutHttpError(503, "REFUNDS_NOT_RELEASED");
      const reservation = await store.reserveRefund(await actor(headers, true), id, input);
      matching(reservation.order);
      if (reservation.status === "completed" || reservation.status === "failed")
        return { status: reservation.status, orderId: id };
      if (!reservation.order.captureId) throw new CheckoutHttpError(409, "ORDER_NOT_REFUNDABLE");
      const result = await provider.refund(providerOrder(reservation.order), {
        captureId: reservation.order.captureId,
        amountMinor: reservation.amountMinor,
        requestId: reservation.providerRequestId,
      });
      await recordRefundResult(reservation.id, result);
      return { status: result.status, orderId: id };
    },
    async webhook(headers, value, rawJson) {
      if (!(await provider.verifyWebhook(headers, value, rawJson)))
        throw new CheckoutHttpError(403, "INVALID_WEBHOOK_SIGNATURE");
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        value.id.length > 128
      )
        throw new CheckoutHttpError(400, "INVALID_WEBHOOK");
      const event = value as {
        id: string;
        event_type?: string;
        resource?: {
          id?: string;
          status?: string;
          links?: unknown;
          supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
        };
      };
      const related = event.resource?.supplementary_data?.related_ids;
      if (
        event.event_type === "PAYMENT.CAPTURE.DECLINED" ||
        event.event_type === "PAYMENT.CAPTURE.DENIED"
      ) {
        const captureId = event.resource?.id;
        const providerOrderId = providerOrderReference(
          related?.order_id,
          event.resource?.links,
          config.environment,
        );
        if (
          !providerOrderId ||
          typeof captureId !== "string" ||
          !/^[A-Z0-9]{10,32}$/.test(captureId) ||
          (event.resource?.status !== undefined && !isDeclinedCaptureStatus(event.resource.status))
        )
          return { received: true, matched: false };
        const order = await store.findByProvider(config.environment, { providerOrderId });
        if (!order) return { received: true, matched: false };
        matching(order);
        const payment = providerOrder(order);
        if (payment.purpose !== "promotion" && !payment.creditTopUpCard) {
          await reconcile(order, event.id);
          return { received: true, matched: true };
        }
        if (order.status === "cancelled" || order.captureId)
          return { received: true, matched: true };
        const proof = await provider.readDeclinedCapture(payment, captureId);
        if (proof) {
          const closed = await store.closeDeclinedPromotion(order, proof, event.id);
          if (closed.status === "cancelled" || closed.captureId)
            return { received: true, matched: true };
        } else {
          // A later verified capture takes precedence over this older decline.
          const present = await reconcile(order, undefined, true);
          if (present.order.captureId) return { received: true, matched: true };
        }
        throw new CheckoutHttpError(409, "DECLINE_CONFIRMATION_PENDING");
      }
      if (
        event.event_type === "PAYMENT.REFUND.FAILED" ||
        event.event_type === "PAYMENT.REFUND.PENDING"
      ) {
        const refundId = event.resource?.id;
        if (!refundId || !/^[A-Z0-9]{10,32}$/.test(refundId))
          return { received: true, matched: false };
        const command = await store.findRefundByProvider(config.environment, refundId);
        if (!command) return { received: true, matched: false };
        const order = await store.readSystem(command.orderId);
        matching(order);
        if (
          !order.captureId ||
          (related?.capture_id && related.capture_id !== order.captureId) ||
          (related?.order_id && related.order_id !== order.providerOrderId)
        )
          throw new CheckoutHttpError(409, "REFUND_MISMATCH");
        const result = await provider.readRefund(providerOrder(order), {
          refundId,
          captureId: order.captureId,
          amountMinor: command.amountMinor,
        });
        await recordRefundResult(command.id, result, event.id);
        return { received: true, matched: true };
      }
      const captureId =
        event.event_type?.startsWith("PAYMENT.CAPTURE.") &&
        event.event_type !== "PAYMENT.CAPTURE.REFUNDED"
          ? event.resource?.id
          : (related?.capture_id ??
            (event.event_type === "PAYMENT.CAPTURE.REFUNDED"
              ? refundCaptureLink(event.resource?.links, config.environment)
              : undefined));
      if (!related?.order_id && !captureId) return { received: true, matched: false };
      const order = await store.findByProvider(config.environment, {
        ...(related?.order_id ? { providerOrderId: related.order_id } : { captureId }),
      });
      if (!order) return { received: true, matched: false };
      await reconcile(order, event.id);
      return { received: true, matched: true };
    },
  };
}
export async function handleCheckoutRequest(request: Request) {
  const config = checkoutConfiguration();
  const path = new URL(request.url).pathname;
  if (!config) {
    return Response.json(
      path === "/api/checkout/catalog" && request.method === "GET"
        ? checkoutCatalog(null)
        : { code: "CHECKOUT_NOT_CONFIGURED" },
      {
        status: path === "/api/checkout/catalog" && request.method === "GET" ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  try {
    const authConfig = readAuthConfiguration();
    if (!authConfig || new URL(authConfig.baseURL).origin !== config.publicOrigin)
      throw new Error("Checkout/auth origin mismatch");
    const accounts = getAccountService(),
      auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!accounts || !auth || !pool) throw new Error("Checkout unavailable");
    const service = createCheckoutService({
      config,
      store: createCheckoutStore(pool, config),
      provider: createLivePayPal(config),
      actor: async (headers, owner = false) => {
        const profile = await accounts.read(headers);
        if (owner && profile.role !== "owner") throw new CheckoutHttpError(403, "OWNER_REQUIRED");
        const signed = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
        if (
          !signed?.session ||
          signed.session.userId !== profile.id ||
          signed.user.id !== profile.id
        )
          throw new CheckoutHttpError(401, "AUTHENTICATION_REQUIRED");
        return {
          userId: profile.id,
          id: signed.session.id,
          token: signed.session.token,
          expectedAccountId: headers.get("X-AhiBizz-Account-ID"),
          role: profile.role,
        };
      },
    });
    return createCheckoutHttpHandler(service, config.publicOrigin)(request);
  } catch {
    return Response.json(
      { code: "CHECKOUT_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
