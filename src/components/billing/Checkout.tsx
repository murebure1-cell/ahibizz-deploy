"use client";

import { useEffect, useRef, useState } from "react";
import { readCheckoutOrder } from "../../lib/checkout-order-read";
import {
  canCancelPromotionOrder,
  cancelPromotionOrder,
  findPendingPromotion,
  promotionRestartHref,
} from "../../lib/checkout-promotion-recovery";
import { categoryPromotionPriceBamMinor } from "../../lib/marketing";
import {
  canOfferPayPalCard,
  checkoutEuro as money,
  type CardOrder as Order,
} from "../../lib/paypal-card-flow";
import { creditsForBamMinor } from "../../lib/wallet";
import { Icon } from "../Icon";
import styles from "./checkout-preview.module.css";
import { PayPalCardButton } from "./PayPalCardButton";

type Catalog = {
  paypalClientId?: string | null;
  available: boolean;
  environment: "sandbox" | "live" | null;
  promotion: { amountMinor: number; days: number };
  support: { available?: boolean; minMinor: number; maxMinor: number };
};
const messages: Record<string, string> = {
  CHECKOUT_FLOW_MISMATCH:
    "Postoji narudžba za drugi način plaćanja. Provjeri prethodnu narudžbu prije nove uplate.",
  LIVE_SUPPORT_NOT_RELEASED:
    "Podrška putem ove naplate nije uključena. Koristi postojeću stranicu Podrži AhiBizz.",
  CHECKOUT_NOT_RELEASED: "Plaćanje još nije uključeno.",
  CHECKOUT_NOT_CONFIGURED: "Plaćanje još nije povezano.",
  BUSINESS_NOT_ELIGIBLE: "Odabrana djelatnost nije dostupna za isticanje.",
  BUSINESS_CHANGED: "Djelatnost je promijenjena. Provjeri podatke prije plaćanja.",
  PROMOTION_ALREADY_RESERVED: "Za ovu djelatnost već postoji isticanje ili otvorena narudžba.",
  ORDER_BUSY_OR_EXPIRED:
    "Narudžba se obrađuje ili je istekla. Osvježi status prije novog pokušaja.",
  AUTHENTICATION_REQUIRED: "Prijavi se da nastaviš.",
  ACCOUNT_IDENTITY_CHANGED: "Nalog je promijenjen. Ponovo učitaj stranicu.",
  PAYPAL_PENDING:
    "PayPal još nije potvrdio ishod. Ne pokreći novu uplatu ni drugi način plaćanja; osvježi status sačuvane narudžbe.",
  ORDER_CANCELLATION_UNAVAILABLE:
    "Narudžba se još obrađuje ili provjerava. Osvježi njen status prije odustajanja ili drugog načina plaćanja.",
  PAYMENT_NOT_COMPLETED: "Uplata još nije potvrđena.",
  PAYMENT_NOT_APPROVED: "PayPal još nije odobrio ovu uplatu. Provjeri status narudžbe.",
  PAYPAL_PAYER_ACTION_REQUIRED: "PayPal traži potvrdu kartice prije naplate.",
  PAYPAL_ORDER_VOIDED: "PayPal je zatvorio ovaj pokušaj. Provjeri status prije nove uplate.",
  PAYPAL_CARD_DECLINED: "Kartica je odbijena. Provjeri sačuvanu narudžbu prije novog pokušaja.",
  PAYPAL_CARD_EXPIRED: "Kartica je istekla. Provjeri sačuvanu narudžbu prije novog pokušaja.",
  CARD_AUTHENTICATION_NOT_APPROVED: "Banka još nije potvrdila karticu. Provjeri status narudžbe.",
  PAYPAL_CAPTURE_PENDING: "Ishod naplate još nije potvrđen. Osvježi status ove narudžbe.",
  CHECKOUT_UNAVAILABLE: "Plaćanje trenutno nije dostupno. Pokušaj ponovo.",
  ORDER_NOT_FOUND: "Narudžba nije pronađena na ovom nalogu.",
  QUOTE_NOT_PAYABLE: "Ova ponuda više nije dostupna za plaćanje. Provjeri je u svom nalogu.",
  QUOTE_PAYMENT_PENDING: "Za ovu ponudu već postoji uplata. Provjeri njen status u svom nalogu.",
  INSUFFICIENT_CREDITS: "Nemaš dovoljno Ahi kredita za isticanje.",
  WALLET_PAYMENT_CHANGED: "Cijena se promijenila. Ponovo otvori izbor plaćanja.",
  WALLET_PRICE_UNAVAILABLE: "Plaćanje kreditima trenutno nije dostupno.",
};
const confirmationMessages: Record<string, string> = {
  approved: "PayPal je odobrio karticu. Čeka se potvrda naplate za ovu narudžbu.",
  action_required: "PayPal još čeka potvrdu kartice.",
  unpaid: "PayPal nema potvrđenu naplatu za ovu narudžbu.",
  voided: "PayPal je zatvorio ovaj pokušaj. Provjeri možeš li sigurno zatvoriti narudžbu.",
  pending: "Naplata se još obrađuje. Osvježi status prije ponovnog plaćanja.",
  unknown: "Status naplate još nije dostupan. Osvježi status prije ponovnog plaćanja.",
};
function isSavedCardPayment(order: Order | null) {
  return order?.status === "provider_created" && Boolean(order.flow && order.flow !== "redirect");
}
type PayableOffer = { id: string; title: string; amountMinor: number; originalBamMinor: number };
function cents(value: string) {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
}
export function Checkout({
  userId,
  initialOrderId,
  initialQuoteId,
  initialBusinessId,
  returned = false,
  cancelled = false,
}: {
  userId: string | null;
  initialOrderId?: string;
  initialQuoteId?: string;
  initialBusinessId?: string;
  returned?: boolean;
  cancelled?: boolean;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [businesses, setBusinesses] = useState<{ id: string; title: string }[]>([]);
  const [kind, setKind] = useState<Order["kind"]>(initialQuoteId ? "quote" : "promotion");
  const [offer, setOffer] = useState<PayableOffer | null>(null);
  const [offerError, setOfferError] = useState("");
  const [offerAttempt, setOfferAttempt] = useState(0);
  const [chosenBusinessId, setBusinessId] = useState<string>();
  const businessId =
    chosenBusinessId ?? businesses.find((b) => b.id === initialBusinessId)?.id ?? "";
  const [support, setSupport] = useState("");
  const [loadedOrder, setLoadedOrder] = useState<{ userId: string | null; order: Order } | null>(
    null,
  );
  const order =
    loadedOrder?.userId === userId && (!initialOrderId || loadedOrder.order.id === initialOrderId)
      ? loadedOrder.order
      : null;
  const setOrder = (value: Order) => setLoadedOrder({ userId, order: value });
  const [reloadOrder, setReloadOrder] = useState(0);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [review, setReview] = useState(false);
  const [method, setMethod] = useState<"card" | "paypal" | "credits">("paypal");
  const cardOpen = method === "card";
  const setCardOpen = (open: boolean) => setMethod(open ? "card" : "paypal");
  const [wallet, setWallet] = useState<{ balance: number; priceMinor: number } | null>(null);
  const [paidWithCreditsUntil, setPaidWithCreditsUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [findExisting, setFindExisting] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [cancellationUncertain, setCancellationUncertain] = useState(false);
  const [paymentCheck, setPaymentCheck] = useState<{
    orderId: string;
    state: string;
    canComplete: boolean;
  } | null>(null);
  const cardCheck = order && paymentCheck?.orderId === order.id ? paymentCheck : null;
  const canCompleteCard = isSavedCardPayment(order) && cardCheck?.canComplete === true;
  const [error, setError] = useState(
    cancelled
      ? "Odustali ste na PayPalu. Odustajanje nije dokaz naplate; provjerite status narudžbe."
      : "",
  );
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const recoveryRequest = useRef<AbortController | null>(null);
  const headers = {
    "Content-Type": "application/json",
    ...(userId ? { "X-AhiBizz-Account-ID": userId } : {}),
  };
  async function request(path: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`/api/checkout/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      cache: "no-store",
      ...(signal ? { signal } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) {
      const recoveryNeeded =
        kind === "promotion" &&
        ["CHECKOUT_FLOW_MISMATCH", "PROMOTION_ALREADY_RESERVED", "PAYPAL_PENDING"].includes(
          value.code,
        );
      if (recoveryNeeded && currentUser.current === userId && !signal?.aborted)
        setFindExisting(true);
      throw new Error(
        recoveryNeeded && value.code === "CHECKOUT_FLOW_MISMATCH"
          ? "Odaberi „Pronađi otvorenu narudžbu“ prije nove uplate."
          : (messages[value.code] ??
              "Zahtjev nije završen. Provjeri status prije ponovnog plaćanja."),
      );
    }
    return value;
  }
  useEffect(() => {
    let active = true;
    locked.current = false;
    key.current = null;
    setBusy(false);
    setReview(false);
    setMethod("paypal");
    setBusinessId(undefined);
    setBusinesses([]);
    setWallet(null);
    setPaidWithCreditsUntil(null);
    setFindExisting(false);
    setCancellingOrder(false);
    setCancellationUncertain(false);
    setPaymentCheck(null);
    fetch("/api/checkout/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch(() => {
        if (active) setError("Naplata trenutno nije dostupna.");
      });
    const controller = new AbortController();
    if (userId && !initialQuoteId && !initialOrderId) {
      void fetch("/api/marketing?mode=credits&page=0", {
        headers: { "X-AhiBizz-Account-ID": userId },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const value = await response.json();
          const priceMinor = creditsForBamMinor(
            categoryPromotionPriceBamMinor,
            value.creditUnitBamMinor,
          );
          if (active && priceMinor !== null && Number.isFinite(value.balance))
            setWallet({ balance: value.balance, priceMinor });
        })
        .catch(() => {});
    }
    async function loadBusinesses(account: string) {
      const mine: { id: string; title: string }[] = [];
      for (let page = 1; ; page++) {
        const response = await fetch(
          `/api/directory/mine?page=${page}&pageSize=50&status=published`,
          {
            headers: { "X-AhiBizz-Account-ID": account },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!Array.isArray(result.items)) throw new Error();
        if (!active) return;
        mine.push(
          ...result.items.filter(
            (item: { packagePaymentNeeded?: boolean }) => !item.packagePaymentNeeded,
          ),
        );
        setBusinesses([...mine]);
        if (!result.hasMore || !result.items.length) {
          if (initialBusinessId && !mine.some((b) => b.id === initialBusinessId))
            setError("Odabrana djelatnost nije dostupna za isticanje.");
          return;
        }
      }
    }
    if (userId && !initialQuoteId && !initialOrderId)
      void loadBusinesses(userId).catch(() => {
        if (active) setError("Nije moguće učitati tvoje djelatnosti.");
      });
    return () => {
      active = false;
      controller.abort();
      recoveryRequest.current?.abort();
      recoveryRequest.current = null;
    };
  }, [userId, initialQuoteId, initialOrderId, initialBusinessId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry refreshes the account-bound quote.
  useEffect(() => {
    if (!userId || !initialQuoteId) return;
    const account = userId,
      quoteId = initialQuoteId;
    const controller = new AbortController();
    setOffer(null);
    setOfferError("");
    async function loadOffer() {
      const response = await fetch(`/api/marketing?offer=${quoteId}`, {
        headers: { "X-AhiBizz-Account-ID": account },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Ponuda nije dostupna za plaćanje na ovom nalogu.");
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (result.orderId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.orderId)) {
        window.location.replace(`/naplata?narudzba=${encodeURIComponent(result.orderId)}`);
        return;
      }
      const next = result.offer;
      if (
        next?.id !== quoteId ||
        typeof next.title !== "string" ||
        !Number.isSafeInteger(next.amountMinor) ||
        next.amountMinor < 1 ||
        !Number.isSafeInteger(next.originalBamMinor) ||
        next.originalBamMinor < 1
      )
        throw new Error("Podaci za plaćanje ove ponude nisu dostupni.");
      setOffer(next);
      setReview(true);
      setMethod("card");
    }
    void loadOffer().catch((cause) => {
      if (!controller.signal.aborted)
        setOfferError(cause instanceof Error ? cause.message : "Ponuda se nije učitala.");
    });
    return () => controller.abort();
  }, [initialQuoteId, userId, offerAttempt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Manual reload generation deliberately restarts this read-only effect.
  useEffect(() => {
    if (!userId || !initialOrderId) return;
    const controller = new AbortController();
    setOrderLoading(true);
    setOrderError("");
    readCheckoutOrder<Order>(initialOrderId, userId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoadedOrder({ userId, order: value });
          setKind(value.kind);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setOrderError(
            cause instanceof Error ? cause.message : "Narudžbu trenutno nije moguće učitati.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrderLoading(false);
      });
    return () => controller.abort();
  }, [userId, initialOrderId, reloadOrder]);
  async function act(action: "create" | "capture" | "reconcile") {
    if (locked.current || !userId || (initialOrderId && !order) || orderLoading) return;
    if (action === "create" && order?.flow && order.flow !== "redirect") return;
    if (action === "capture" && isSavedCardPayment(order) && !canCompleteCard) return;
    if (action === "create" && (order?.kind ?? kind) === "quote" && !(order?.quoteId ?? offer?.id))
      return;
    if (order?.status === "cancelled" && action !== "reconcile") return;
    if (
      action !== "reconcile" &&
      (order?.kind ?? kind) === "support" &&
      catalog?.support.available !== true
    ) {
      setError(messages.LIVE_SUPPORT_NOT_RELEASED ?? "Podrška nije uključena.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    if (action !== "reconcile") setPaymentCheck(null);
    try {
      key.current ??= crypto.randomUUID();
      const value =
        action === "create"
          ? await request(
              "orders",
              order
                ? {
                    requestId: order.requestId,
                    kind: order.kind,
                    ...(order.flow && order.flow !== "redirect" ? { flow: order.flow } : {}),
                    ...(order.kind === "quote"
                      ? { quoteId: order.quoteId }
                      : order.kind === "promotion"
                        ? { businessId: order.businessId }
                        : { amountMinor: order.amountMinor }),
                  }
                : {
                    requestId: key.current,
                    kind,
                    ...(kind === "quote"
                      ? { quoteId: offer?.id }
                      : kind === "promotion"
                        ? { businessId }
                        : { amountMinor: cents(support) }),
                  },
            )
          : await request(`orders/${order?.id}/${action}`, {});
      if (
        action === "create" &&
        (order?.kind ?? kind) === "quote" &&
        (value.order?.kind !== "quote" ||
          value.order.quoteId !== (order?.quoteId ?? offer?.id) ||
          value.order.amountMinor !== (order?.amountMinor ?? offer?.amountMinor) ||
          value.order.currency !== "EUR")
      ) {
        setError("Podaci ponude su se promijenili. Osvježi prikaz prije plaćanja.");
        return;
      }
      if (value.order) {
        setOrder(value.order);
        if (action === "reconcile" && value.order.id === order?.id && !value.pending) {
          setCancellationUncertain(false);
          if (isSavedCardPayment(order) && typeof value.paymentState === "string") {
            setPaymentCheck({
              orderId: value.order.id,
              state: value.paymentState,
              canComplete:
                value.canCompleteApprovedPayment === true && value.paymentState === "approved",
            });
          }
        }
        window.history.replaceState(null, "", `/naplata?narudzba=${value.order.id}`);
      }
      if (value.order && action === "create" && !order && value.order.requestId !== key.current) {
        setError(
          "Pronađena je tvoja otvorena narudžba. Pregledaj je i odaberi Nastavi istu narudžbu. Nova uplata nije pokrenuta.",
        );
        return;
      }
      if (action === "create" && value.approvalUrl && value.order?.flow === "redirect") {
        const link = new URL(value.approvalUrl);
        const expected =
          value.order?.environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com";
        if (
          link.protocol !== "https:" ||
          link.hostname !== expected ||
          link.username ||
          link.password ||
          link.port
        )
          throw new Error("PayPal adresa nije ispravna.");
        window.location.assign(link.href);
      } else if (value.pending) setError(messages.PAYPAL_PENDING ?? "Odgovor se čeka.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Zahtjev nije završen.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function recoverPromotion(action: "find" | "cancel") {
    if (
      locked.current ||
      !userId ||
      orderLoading ||
      (action === "cancel" &&
        (!order || !canCancelPromotionOrder(order) || cancellationUncertain)) ||
      (action === "find" && (order || initialOrderId || kind !== "promotion" || !businessId))
    )
      return;
    const account = userId;
    const controller = new AbortController();
    recoveryRequest.current = controller;
    const current = () =>
      !controller.signal.aborted &&
      recoveryRequest.current === controller &&
      currentUser.current === account;
    locked.current = true;
    setBusy(true);
    setCancellingOrder(action === "cancel");
    setError("");
    try {
      const send = (path: string, body?: unknown) =>
        request(
          path,
          body,
          AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(action === "cancel" ? 50000 : 30000),
          ]),
        );
      const next =
        action === "find"
          ? await findPendingPromotion(businessId, send)
          : order
            ? await cancelPromotionOrder(order, send)
            : null;
      if (!current()) return;
      if (!next) {
        setError("Otvorena neplaćena narudžba nije pronađena. Provjeri isticanje u svom nalogu.");
        return;
      }
      setOrder(next);
      setKind("promotion");
      setFindExisting(false);
      setCancellationUncertain(false);
      window.history.replaceState(null, "", `/naplata?narudzba=${encodeURIComponent(next.id)}`);
    } catch (cause) {
      if (!current()) return;
      if (action === "cancel") setCancellationUncertain(true);
      setError(
        cause instanceof Error && Object.values(messages).includes(cause.message)
          ? cause.message
          : action === "cancel"
            ? "Odustajanje nije potvrđeno. Osvježi status ove narudžbe; ne biraj drugi način plaćanja."
            : "Otvorenu narudžbu trenutno nije moguće učitati. Pokušaj ponovo ili provjeri Moj nalog.",
      );
    } finally {
      if (current()) {
        recoveryRequest.current = null;
        locked.current = false;
        setBusy(false);
        setCancellingOrder(false);
      }
    }
  }
  async function payWithCredits() {
    if (!userId || !wallet || !businessId || locked.current || order || initialOrderId) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      key.current ??= crypto.randomUUID();
      const response = await fetch("/api/marketing", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          action: "promoteCategory",
          id: key.current,
          businessId,
          expectedCreditMinor: wallet.priceMinor,
        }),
      });
      const value = await response.json();
      if (!response.ok || value.id !== key.current || !Number.isFinite(Date.parse(value.endsAt)))
        throw new Error(
          messages[value.code] ?? "Plaćanje nije potvrđeno. Provjeri status isticanja u nalogu.",
        );
      setPaidWithCreditsUntil(value.endsAt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plaćanje nije potvrđeno.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const walletAvailable = kind === "promotion" && wallet !== null && !initialOrderId && !order;
  const selectedAmount =
    order?.amountMinor ??
    (kind === "quote"
      ? (offer?.amountMinor ?? 0)
      : kind === "promotion"
        ? (catalog?.promotion.amountMinor ?? 511)
        : cents(support));
  const canReview =
    kind === "quote"
      ? Boolean(offer && userId)
      : kind === "promotion"
        ? Boolean(businessId)
        : selectedAmount >= (catalog?.support.minMinor ?? 100) &&
          selectedAmount <= (catalog?.support.maxMinor ?? 100000);
  const openCardOrder =
    order &&
    !returned &&
    !["approved", "pending", "voided"].includes(cardCheck?.state ?? "") &&
    catalog?.available &&
    catalog.paypalClientId &&
    canOfferPayPalCard(order, review, kind);
  const restartHref = promotionRestartHref(order);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a className={styles.accountLink} href="/nalog">
        ← Moj nalog
      </a>
      <header>
        {catalog?.environment === "sandbox" && (
          <span className={styles.label}>PayPal · testni način</span>
        )}
        <h1>
          {kind === "quote"
            ? "Plaćanje ponude"
            : kind === "promotion"
              ? "Isticanje djelatnosti"
              : "Podrži razvoj AhiBizza"}
        </h1>
      </header>
      {catalog?.available === false && !walletAvailable && (
        <p role="status" className={styles.notice}>
          Naplata trenutno nije dostupna.
        </p>
      )}
      {!userId && (
        <p>
          <a
            href={`/prijava?nastavi=${encodeURIComponent(`/naplata${returned ? "/povratak" : cancelled ? "/odustajanje" : ""}${initialOrderId ? `?narudzba=${initialOrderId}` : initialQuoteId ? `?ponuda=${initialQuoteId}` : initialBusinessId ? `?djelatnost=${initialBusinessId}` : ""}`)}`}
          >
            Prijavi se za nastavak
          </a>
        </p>
      )}
      {initialOrderId && userId && !order && (
        <section aria-label="Sačuvana narudžba" className={styles.notice}>
          <p role="status">
            {orderLoading
              ? "Učitavam sačuvanu narudžbu…"
              : "Nastavljaš sačuvanu narudžbu. Učitavanje ne pokreće plaćanje."}
          </p>
          {orderError && <p role="alert">{orderError}</p>}
          <button
            type="button"
            disabled={orderLoading || busy}
            onClick={() => setReloadOrder((value) => value + 1)}
          >
            Ponovo učitaj sačuvanu narudžbu
          </button>
        </section>
      )}
      {initialQuoteId && !order && !offer && userId && (
        <section className={styles.notice}>
          {offerError ? (
            <>
              <p role="alert">{offerError}</p>
              <button type="button" onClick={() => setOfferAttempt((n) => n + 1)}>
                Pokušaj ponovo
              </button>
            </>
          ) : (
            <p role="status">Učitavanje ponude…</p>
          )}
        </section>
      )}
      {paidWithCreditsUntil && (
        <section className={styles.card} role="status">
          <h2>Isticanje je aktivno</h2>
          <p>
            {businesses.find((b) => b.id === businessId)?.title} · do{" "}
            {new Date(paidWithCreditsUntil).toLocaleDateString("bs-BA")}
          </p>
          <a href="/nalog?odjeljak=oglasi">Moji oglasi</a>
        </section>
      )}
      {!paidWithCreditsUntil && !order && !initialOrderId && (!initialQuoteId || offer) && (
        <>
          {!initialQuoteId && catalog?.environment === "sandbox" && (
            <section className={styles.choices} aria-label="Namjena uplate">
              <button
                type="button"
                disabled={busy}
                aria-pressed={kind === "promotion"}
                onClick={() => {
                  setKind("promotion");
                  setReview(false);
                  setCardOpen(false);
                  key.current = null;
                }}
              >
                Isticanje profila
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={kind === "support"}
                onClick={() => {
                  setKind("support");
                  setReview(false);
                  setCardOpen(false);
                  key.current = null;
                }}
              >
                Podrži razvoj AhiBizza
              </button>
            </section>
          )}
          <section className={styles.card}>
            {kind === "quote" && offer ? (
              <div className={styles.orderSummary}>
                <div>
                  <h2>{offer.title}</h2>
                  <p>Jednokratna uplata po ponudi</p>
                </div>
                <div className={styles.orderPrice}>
                  <strong>{money(offer.amountMinor)}</strong>
                  <small>{(offer.originalBamMinor / 100).toLocaleString("bs-BA")} KM</small>
                </div>
              </div>
            ) : kind === "promotion" ? (
              <>
                <div className={styles.orderSummary}>
                  <div>
                    <h2>Isticanje u kategoriji</h2>
                    <p>{catalog?.promotion.days ?? 7} dana · jednokratno</p>
                  </div>
                  <div className={styles.orderPrice}>
                    <strong>
                      {walletAvailable && wallet && (!review || method === "credits")
                        ? `${(wallet.priceMinor / 100).toLocaleString("bs-BA")} Ahi kredita`
                        : money(selectedAmount)}
                    </strong>
                    {selectedAmount === 511 && (
                      <small>
                        {walletAvailable && (!review || method === "credits") ? "10 KM" : "≈ 10 KM"}
                      </small>
                    )}
                  </div>
                </div>
                {review ? (
                  <p className={styles.businessName}>
                    <Icon name="shop" width={18} height={18} />
                    {businesses.find((business) => business.id === businessId)?.title}
                  </p>
                ) : (
                  <>
                    <label htmlFor="checkout-business">Tvoja objavljena djelatnost</label>
                    <select
                      id="checkout-business"
                      disabled={review || busy}
                      value={businessId}
                      onChange={(e) => {
                        setBusinessId(e.target.value);
                        setFindExisting(false);
                        key.current = null;
                      }}
                    >
                      <option value="">Odaberi djelatnost</option>
                      {businesses.map((business) => (
                        <option key={business.id} value={business.id}>
                          {business.title}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </>
            ) : (
              <>
                <h2>Dobrovoljna podrška</h2>
                <p>
                  Podrška nije kupovina isticanja ili članstva i ne daje pravo na povrat kapitala
                  ili dobit. Jednokratna uplata, bez obnove.
                </p>
                <label htmlFor="checkout-support">Iznos podrške u EUR</label>
                <input
                  id="checkout-support"
                  inputMode="decimal"
                  autoComplete="off"
                  value={support}
                  disabled={review || busy}
                  placeholder="Npr. 5,00"
                  onChange={(e) => {
                    setSupport(e.target.value);
                    key.current = null;
                  }}
                />
                <p>Od 1 do 1.000 EUR. Iznos biraš samostalno.</p>
              </>
            )}
            {review && kind === "support" && (
              <p>
                <strong>Ukupno za plaćanje: {money(selectedAmount)}</strong>
              </p>
            )}
            {!review && (
              <button
                type="button"
                className={styles.primary}
                disabled={!userId || !canReview || (!catalog?.available && !walletAvailable)}
                onClick={() => {
                  key.current ??= crypto.randomUUID();
                  if (walletAvailable) setMethod("credits");
                  else setCardOpen(kind !== "support" && Boolean(catalog?.paypalClientId));
                  setReview(true);
                }}
              >
                Odaberi način plaćanja
              </button>
            )}
          </section>
        </>
      )}
      {order && openCardOrder && (
        <div className={styles.savedSummary}>
          <span>{order.businessTitle ?? "Isticanje u kategoriji"}</span>
          <strong>{money(order.amountMinor)}</strong>
        </div>
      )}
      {order && !openCardOrder && (
        <section className={styles.card}>
          <h2>
            {order.kind === "quote"
              ? (order.businessTitle ?? "Plaćanje ponude")
              : order.kind === "promotion"
                ? (order.businessTitle ?? "Isticanje profila")
                : "Podrška razvoju"}
          </h2>
          <p className={styles.price}>{money(order.amountMinor)}</p>
          <p>Narudžba: {order.id}</p>
          {order.environment === "sandbox" && (
            <p>Testna narudžba: nema stvarnog novca niti javnog isticanja.</p>
          )}
          {order.status === "cancelled" ? (
            <div role="status">
              <h3>Narudžba je stornirana</h3>
              <p>Nije izvršena naplata.</p>
              <a
                href={restartHref ?? (order.kind === "quote" ? "/nalog" : "/naplata")}
                onClick={(event) => {
                  if (locked.current) {
                    event.preventDefault();
                    return;
                  }
                  key.current = null;
                }}
                aria-disabled={busy}
              >
                {restartHref
                  ? "Ponovo odaberi način plaćanja"
                  : order.kind === "quote"
                    ? "Moj nalog"
                    : "Novi pokušaj"}
              </a>
            </div>
          ) : order.status === "captured" ? (
            <div role="status">
              <h3>Uplata je potvrđena</h3>
              {order.kind === "promotion" && order.endsAt ? (
                <p>Isticanje važi do {new Date(order.endsAt).toLocaleString("bs-BA")}.</p>
              ) : order.kind === "quote" ? (
                <a href="/nalog">Vrati se u moj nalog</a>
              ) : (
                <p>Hvala na podršci razvoju AhiBizza.</p>
              )}
            </div>
          ) : ["refunded", "partially_refunded", "reversed"].includes(order.status) ? (
            <div role="status">
              <h3>Uplata je korigovana</h3>
              <p>Evidentiran povrat: {money(order.refundedMinor)}.</p>
            </div>
          ) : order.status === "review" ? (
            <p role="status">Uplata zahtijeva provjeru. Ne plaćaj ponovo za ovu narudžbu.</p>
          ) : (
            <>
              <p>
                {returned
                  ? "Vratio si se s PayPala. Povratak nije dokaz uplate."
                  : "Uplata još nije potvrđena. Ne otvaraj novu narudžbu za isti pokušaj."}
              </p>
              {isSavedCardPayment(order) && cardCheck && (
                <p role="status">{confirmationMessages[cardCheck.state]}</p>
              )}
              {canCompleteCard ? (
                <button
                  type="button"
                  disabled={busy || !catalog?.available}
                  onClick={() => act("capture")}
                >
                  Potvrdi naplatu iste narudžbe
                </button>
              ) : !order.flow || order.flow === "redirect" ? (
                <button
                  type="button"
                  disabled={
                    busy ||
                    !catalog?.available ||
                    (order.kind === "support" && catalog?.support.available !== true)
                  }
                  onClick={() => act(returned ? "capture" : "create")}
                >
                  {returned ? "Potvrdi i provjeri uplatu" : "Nastavi istu narudžbu na PayPalu"}
                </button>
              ) : null}
            </>
          )}
          <button type="button" disabled={busy} onClick={() => act("reconcile")}>
            Osvježi status uplate
          </button>
        </section>
      )}
      {(review && !order && !initialOrderId && !paidWithCreditsUntil) || openCardOrder ? (
        <section className={styles.methodPanel} aria-label="Način plaćanja">
          <div className={styles.cardMethod}>
            {!order &&
              (walletAvailable ||
                (catalog?.available && catalog.paypalClientId && kind !== "support")) && (
                <fieldset className={styles.methodPicker} aria-label="Odaberi način plaćanja">
                  {walletAvailable && (
                    <button
                      type="button"
                      aria-controls="ahi-novcanik"
                      aria-pressed={method === "credits"}
                      disabled={busy}
                      onClick={() => setMethod("credits")}
                    >
                      Ahi krediti
                    </button>
                  )}
                  {catalog?.available && catalog.paypalClientId && (
                    <button
                      type="button"
                      className={styles.payCard}
                      aria-controls="karticni-obrazac"
                      aria-pressed={cardOpen}
                      disabled={busy}
                      onClick={() => setCardOpen(true)}
                    >
                      <Icon name="card" width={20} height={20} />
                      Plati karticom
                    </button>
                  )}
                  {catalog?.available && (
                    <button
                      type="button"
                      aria-controls="paypal-novcanik"
                      aria-pressed={method === "paypal"}
                      disabled={busy}
                      onClick={() => setCardOpen(false)}
                    >
                      PayPal
                    </button>
                  )}
                </fieldset>
              )}
            {walletAvailable && method === "credits" && wallet && (
              <div id="ahi-novcanik" className={styles.walletPanel}>
                <p>
                  Stanje: <strong>{wallet.balance.toLocaleString("bs-BA")} Ahi kredita</strong>
                </p>
                {Math.round(wallet.balance * 100) >= wallet.priceMinor ? (
                  <button
                    type="button"
                    className={styles.payCard}
                    disabled={busy}
                    onClick={payWithCredits}
                  >
                    Plati {(wallet.priceMinor / 100).toLocaleString("bs-BA")} Ahi kredita
                  </button>
                ) : (
                  <>
                    <p>
                      Za isticanje je potrebno {(wallet.priceMinor / 100).toLocaleString("bs-BA")}{" "}
                      kredita.
                    </p>
                    <a href="/nalog?odjeljak=krediti">Dopuni Ahi kredite</a>
                  </>
                )}
              </div>
            )}
            {userId &&
              catalog?.available &&
              catalog.paypalClientId &&
              catalog.environment &&
              canOfferPayPalCard(order, review, kind) && (
                <div id="karticni-obrazac" hidden={!cardOpen && !order}>
                  {(cardOpen || order) && (
                    <PayPalCardButton
                      environment={catalog.environment}
                      amountMinor={selectedAmount}
                      savedOrder={order ?? undefined}
                      key={userId}
                      clientId={catalog.paypalClientId}
                      userId={userId}
                      input={() => {
                        key.current ??= crypto.randomUUID();
                        const requestId = order?.requestId ?? key.current;
                        return (order?.kind ?? kind) === "quote"
                          ? {
                              requestId,
                              quoteId: order?.quoteId ?? offer?.id ?? "",
                              amountMinor: selectedAmount,
                            }
                          : { requestId, businessId: order?.businessId ?? businessId };
                      }}
                      acquire={() => {
                        if (locked.current || orderLoading) return false;
                        locked.current = true;
                        setBusy(true);
                        setError("");
                        return true;
                      }}
                      release={() => {
                        locked.current = false;
                        setBusy(false);
                      }}
                      onOrder={(value) => {
                        setOrder(value);
                        window.history.replaceState(
                          window.history.state,
                          "",
                          `/naplata?narudzba=${value.id}`,
                        );
                      }}
                      onOrderRecoveryNeeded={
                        kind === "promotion" ? () => setFindExisting(true) : undefined
                      }
                    />
                  )}
                </div>
              )}
          </div>
          {!order && (
            <div className={styles.methodFooter}>
              {method !== "credits" && (!cardOpen || !catalog?.paypalClientId) && (
                <button
                  type="button"
                  id="paypal-novcanik"
                  className={styles.payWallet}
                  disabled={busy || !catalog?.available || !userId}
                  onClick={() => act("create")}
                >
                  Nastavi na PayPal
                </button>
              )}
              {!initialQuoteId && (
                <button
                  type="button"
                  className={styles.back}
                  disabled={busy}
                  onClick={() => {
                    setReview(false);
                    setCardOpen(false);
                  }}
                >
                  Nazad
                </button>
              )}
            </div>
          )}
        </section>
      ) : null}
      {findExisting &&
        userId &&
        kind === "promotion" &&
        businessId &&
        !order &&
        !initialOrderId && (
          <section className={styles.orderRecovery} aria-label="Otvorena narudžba">
            <p>Prvo provjeri postojeću narudžbu za ovu djelatnost. Time ne pokrećeš novu uplatu.</p>
            <button
              type="button"
              disabled={busy || orderLoading}
              onClick={() => recoverPromotion("find")}
            >
              Pronađi otvorenu narudžbu
            </button>
          </section>
        )}
      {userId &&
        canCancelPromotionOrder(order) &&
        !["approved", "pending"].includes(cardCheck?.state ?? "") && (
          <section
            className={styles.orderRecovery}
            aria-label="Odustajanje od narudžbe"
            aria-busy={cancellingOrder}
          >
            <p>
              Za drugi način plaćanja prvo zatvori ovu neplaćenu narudžbu. Nastaviti možeš tek kada
              je odustajanje potvrđeno.
            </p>
            <button
              type="button"
              disabled={busy || orderLoading || cancellationUncertain}
              onClick={() => recoverPromotion("cancel")}
            >
              {cancellingOrder ? "Zatvaram narudžbu…" : "Odustani od narudžbe"}
            </button>
          </section>
        )}
      {order && openCardOrder && (
        <details className={styles.orderDetails}>
          <summary>Detalji narudžbe</summary>
          <p>Broj narudžbe: {order.id}</p>
          <p role="status">
            {confirmationMessages[cardCheck?.state ?? ""] ?? "Uplata još nije potvrđena."}
          </p>
          <button type="button" disabled={busy} onClick={() => act("reconcile")}>
            Osvježi status uplate
          </button>
        </details>
      )}
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
      <a className={styles.supportLink} href="/podrzi">
        Podrži AhiBizz
      </a>
    </main>
  );
}
