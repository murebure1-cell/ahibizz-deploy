"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./checkout-preview.module.css";

type Order = {
  id: string;
  requestId: string;
  kind: "promotion" | "support";
  businessId: string | null;
  businessTitle: string | null;
  amountMinor: number;
  currency: "EUR";
  environment: "sandbox" | "live";
  status: string;
  refundedMinor: number;
  endsAt: string | null;
};
type Catalog = {
  available: boolean;
  environment: "sandbox" | "live" | null;
  promotion: { amountMinor: number; days: number };
  support: { available?: boolean; minMinor: number; maxMinor: number };
};
const messages: Record<string, string> = {
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
};
const money = (minor: number) =>
  new Intl.NumberFormat("bs-BA", { style: "currency", currency: "EUR" }).format(minor / 100);
function cents(value: string) {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
}
export function Checkout({
  userId,
  initialOrderId,
  returned = false,
  cancelled = false,
}: {
  userId: string | null;
  initialOrderId?: string;
  returned?: boolean;
  cancelled?: boolean;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [businesses, setBusinesses] = useState<{ id: string; title: string }[]>([]);
  const [kind, setKind] = useState<"promotion" | "support">("promotion");
  const [businessId, setBusinessId] = useState("");
  const [support, setSupport] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [review, setReview] = useState(false);
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
    fetch("/api/checkout/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch(() => {
        if (active) setError("Naplata trenutno nije dostupna.");
      });
    if (userId) {
      fetch("/api/directory/mine?page=1&pageSize=50&status=published", {
        headers: { "X-AhiBizz-Account-ID": userId },
        cache: "no-store",
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((value) => {
          if (active) setBusinesses(value.items ?? []);
        })
        .catch(() => {
          if (active) setError("Nije moguće učitati tvoje djelatnosti.");
        });
      if (initialOrderId)
        fetch(`/api/checkout/orders/${initialOrderId}`, {
          headers: { "X-AhiBizz-Account-ID": userId },
          cache: "no-store",
        })
          .then((r) => {
            if (!r.ok) throw new Error();
            return r.json();
          })
          .then((value) => {
            if (active) {
              setOrder(value.order);
              setKind(value.order.kind);
            }
          })
          .catch(() => {
            if (active) setError("Narudžba nije dostupna na ovom nalogu.");
          });
    }
    return () => {
      active = false;
    };
  }, [userId, initialOrderId]);
  async function act(action: "create" | "capture" | "reconcile") {
    if (locked.current || !userId) return;
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
                    ...(order.kind === "promotion"
                      ? { businessId: order.businessId }
                      : { amountMinor: order.amountMinor }),
                  }
                : {
                    requestId: key.current,
                    kind,
                    ...(kind === "promotion" ? { businessId } : { amountMinor: cents(support) }),
                  },
            )
          : await request(`orders/${order?.id}/${action}`, {});
      if (value.order) {
        setOrder(value.order);
        window.history.replaceState(null, "", `/naplata?narudzba=${value.order.id}`);
      }
      if (value.approvalUrl) {
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
    (kind === "promotion" ? (catalog?.promotion.amountMinor ?? 511) : cents(support));
  const canReview =
    kind === "promotion"
      ? Boolean(businessId)
      : selectedAmount >= (catalog?.support.minMinor ?? 100) &&
        selectedAmount <= (catalog?.support.maxMinor ?? 100000);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a href="/nalog">← Moj nalog</a>
      <header>
        <span className={styles.label}>
          {catalog?.environment === "sandbox"
            ? "TESTNO PLAĆANJE · BEZ STVARNOG NOVCA"
            : "SIGURNO PLAĆANJE"}
        </span>
        <h1>{kind === "promotion" ? "Istakni svoju djelatnost" : "Podrži razvoj AhiBizza"}</h1>
        <p>
          AhiBizz vodi pregled na bosanskom. PayPalov ekran trenutno nema bosanski jezik i može se
          otvoriti na engleskom.
        </p>
      </header>
      {!catalog?.available && (
        <p role="status" className={styles.notice}>
          Naplata još nije uključena. Neće biti slanja na stvarno plaćanje dok povezivanje i
          provjere ne budu završeni.
        </p>
      )}
      {!userId && (
        <p>
          <a
            href={`/prijava?nastavi=${encodeURIComponent(`/naplata${returned ? "/povratak" : cancelled ? "/odustajanje" : ""}${initialOrderId ? `?narudzba=${initialOrderId}` : ""}`)}`}
          >
            Prijavi se za nastavak
          </a>
        </p>
      )}
      {!order && (
        <>
          <section className={styles.choices} aria-label="Namjena uplate">
            <button
              type="button"
              disabled={busy}
              aria-pressed={kind === "promotion"}
              onClick={() => {
                setKind("promotion");
                setReview(false);
                key.current = null;
              }}
            >
              Isticanje profila
            </button>
            {catalog?.environment === "sandbox" ? (
              <button
                type="button"
                disabled={busy}
                aria-pressed={kind === "support"}
                onClick={() => {
                  setKind("support");
                  setReview(false);
                  key.current = null;
                }}
              >
                Podrži razvoj AhiBizza
              </button>
            ) : (
              <a href="/podrzi">Podrži razvoj AhiBizza · postojeće opcije</a>
            )}
          </section>
          <section className={styles.card}>
            {kind === "promotion" ? (
              <>
                <h2>Isticanje u kategoriji · 7 dana</h2>
                <p className={styles.price}>10 KM ≈ {money(511)}</p>
                <p>
                  Naplaćuje se {money(511)}, jednokratno, bez automatske obnove. Isticanje počinje
                  tek nakon potvrđene uplate. Ne dodjeljuje verifikacijsku ili halal oznaku.
                </p>
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
            {review ? (
              <>
                <p>
                  <strong>Ukupno za plaćanje: {money(selectedAmount)}</strong>
                </p>
                <p>
                  PayPal može prikazati vlastitu konverziju ako tvoj izvor sredstava koristi drugu
                  valutu. Pregledaj konačan iznos na PayPalu.
                </p>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !catalog?.available || !userId}
                  onClick={() => act("create")}
                >
                  {busy ? "Pripremam narudžbu…" : "Nastavi na PayPal"}
                </button>
                <button type="button" disabled={busy} onClick={() => setReview(false)}>
                  Nazad
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.primary}
                disabled={!userId || !canReview || !catalog?.available}
                onClick={() => setReview(true)}
              >
                Pregledaj prije plaćanja
              </button>
            )}
          </section>
        </>
      )}
      {order && (
        <section className={styles.card}>
          <h2>
            {order.kind === "promotion"
              ? (order.businessTitle ?? "Isticanje profila")
              : "Podrška razvoju"}
          </h2>
          <p className={styles.price}>{money(order.amountMinor)}</p>
          <p>Narudžba: {order.id}</p>
          {order.environment === "sandbox" && (
            <p>Testna narudžba: nema stvarnog novca niti javnog isticanja.</p>
          )}
          {order.status === "captured" ? (
            <div role="status">
              <h3>Uplata je potvrđena</h3>
              {order.kind === "promotion" && order.endsAt ? (
                <p>Isticanje važi do {new Date(order.endsAt).toLocaleString("bs-BA")}.</p>
              ) : (
                <p>Hvala na podršci razvoju AhiBizza.</p>
              )}
            </div>
          ) : ["refunded", "partially_refunded", "reversed"].includes(order.status) ? (
            <div role="status">
              <h3>Uplata je korigovana</h3>
              <p>Evidentiran povrat: {money(order.refundedMinor)}. Isticanje više nije aktivno.</p>
            </div>
          ) : order.status === "review" ? (
            <p role="status">
              Uplata zahtijeva provjeru. Isticanje nije aktivirano. Ne plaćaj ponovo za ovu
              narudžbu.
            </p>
          ) : (
            <>
              <p>
                {returned
                  ? "Vratio si se s PayPala. Povratak nije dokaz uplate."
                  : "Uplata još nije potvrđena. Ne otvaraj novu narudžbu za isti pokušaj."}
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  !catalog?.available ||
                  (order.kind === "support" && catalog?.support.available !== true)
                }
                onClick={() => act(returned ? "capture" : "create")}
              >
                {returned ? "Potvrdi i provjeri uplatu" : "Nastavi istu narudžbu"}
              </button>
            </>
          )}
          <button type="button" disabled={busy} onClick={() => act("reconcile")}>
            {busy ? "Provjeravam…" : "Osvježi status uplate"}
          </button>
        </section>
      )}
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
    </main>
  );
}
