"use client";

import { useEffect, useRef, useState } from "react";
import { readCheckoutOrder } from "../../lib/checkout-order-read";
import {
  canOfferPayPalCard,
  checkoutEuro as money,
  type CardOrder as Order,
} from "../../lib/paypal-card-flow";
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
    "Već postoji narudžba za drugi način plaćanja. Nastavi isti kartični pokušaj ili učitaj prethodno sačuvanu narudžbu; ne otvaraj novu.",
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
  PAYPAL_PENDING: "PayPal još nije vratio odgovor. Sačuvana narudžba se može ponovo provjeriti.",
  PAYMENT_NOT_COMPLETED: "Uplata još nije potvrđena.",
  CHECKOUT_UNAVAILABLE: "Plaćanje trenutno nije dostupno. Pokušaj ponovo.",
  ORDER_NOT_FOUND: "Narudžba nije pronađena na ovom nalogu.",
  QUOTE_NOT_PAYABLE: "Ova ponuda više nije dostupna za plaćanje. Provjeri je u svom nalogu.",
  QUOTE_PAYMENT_PENDING: "Za ovu ponudu već postoji uplata. Provjeri njen status u svom nalogu.",
};
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
  const [cardOpen, setCardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    cancelled
      ? "Odustali ste na PayPalu. Odustajanje nije dokaz naplate; provjerite status narudžbe."
      : "",
  );
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  const headers = {
    "Content-Type": "application/json",
    ...(userId ? { "X-AhiBizz-Account-ID": userId } : {}),
  };
  async function request(path: string, body?: unknown) {
    const response = await fetch(`/api/checkout/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        messages[value.code] ?? "Zahtjev nije završen. Provjeri status prije ponovnog plaćanja.",
      );
    return value;
  }
  useEffect(() => {
    let active = true;
    locked.current = false;
    key.current = null;
    setBusy(false);
    setReview(false);
    setCardOpen(false);
    setBusinessId(undefined);
    setBusinesses([]);
    fetch("/api/checkout/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch(() => {
        if (active) setError("Naplata trenutno nije dostupna.");
      });
    const controller = new AbortController();
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
      setCardOpen(true);
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
    catalog?.available &&
    catalog.paypalClientId &&
    canOfferPayPalCard(order, review, kind);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a className={styles.accountLink} href="/nalog">
        ← Moj nalog
      </a>
      <header>
        {catalog?.environment === "sandbox" && (
          <span className={styles.label}>Testno plaćanje · bez stvarnog novca</span>
        )}
        <h1>
          {kind === "quote"
            ? "Plaćanje ponude"
            : kind === "promotion"
              ? "Isticanje djelatnosti"
              : "Podrži razvoj AhiBizza"}
        </h1>
      </header>
      {catalog?.available === false && (
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
      {!order && !initialOrderId && (!initialQuoteId || offer) && (
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
                    <strong>{money(selectedAmount)}</strong>
                    {selectedAmount === 511 && <small>≈ 10 KM</small>}
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
                disabled={!userId || !canReview || !catalog?.available}
                onClick={() => {
                  key.current ??= crypto.randomUUID();
                  setCardOpen(kind !== "support" && Boolean(catalog?.paypalClientId));
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
              <a href={order.kind === "quote" ? "/nalog" : "/naplata"}>
                {order.kind === "quote" ? "Moj nalog" : "Novi pokušaj"}
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
              {(returned || !order.flow || order.flow === "redirect") && (
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
              )}
            </>
          )}
          <button type="button" disabled={busy} onClick={() => act("reconcile")}>
            Osvježi status uplate
          </button>
        </section>
      )}
      {(review && !order && !initialOrderId) ||
      (order && canOfferPayPalCard(order, review, kind)) ? (
        <section className={styles.methodPanel} aria-label="Način plaćanja">
          {userId &&
            catalog?.available &&
            catalog.paypalClientId &&
            catalog.environment &&
            canOfferPayPalCard(order, review, kind) && (
              <div className={styles.cardMethod}>
                {!order && (
                  <fieldset className={styles.methodPicker} aria-label="Odaberi način plaćanja">
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
                    <button
                      type="button"
                      aria-controls="paypal-novcanik"
                      aria-pressed={!cardOpen}
                      disabled={busy}
                      onClick={() => setCardOpen(false)}
                    >
                      PayPal
                    </button>
                  </fieldset>
                )}
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
                    />
                  )}
                </div>
              </div>
            )}
          {!order && (
            <div className={styles.methodFooter}>
              {(!cardOpen || !catalog?.paypalClientId) && (
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
      {order && openCardOrder && (
        <details className={styles.orderDetails}>
          <summary>Detalji narudžbe</summary>
          <p>Broj narudžbe: {order.id}</p>
          <p>Uplata još nije potvrđena.</p>
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
