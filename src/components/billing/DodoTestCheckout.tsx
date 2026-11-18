"use client";

import { useEffect, useRef, useState } from "react";
import { dodoTestReturnPath } from "../../lib/dodo-test-return";
import styles from "./checkout-preview.module.css";

type Order = {
  id: string;
  businessId: string;
  status: string;
  checkoutUrl?: string | null;
  sessionId?: string | null;
  paymentId?: string | null;
  testStartsAt?: string | null;
  testEndsAt?: string | null;
};
type Catalog = { available: boolean; environment: "test_mode"; amountMinor: 511; currency: "EUR" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const messages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Prijavi se za nastavak.",
  ACCOUNT_IDENTITY_CHANGED: "Nalog je promijenjen. Ponovo učitaj stranicu.",
  BUSINESS_NOT_ELIGIBLE: "Odabrana djelatnost nije dostupna za ovaj test.",
  ORDER_NOT_FOUND: "Probna narudžba nije dostupna na ovom nalogu.",
  DODO_TEST_DISABLED: "Dodo test trenutno nije uključen.",
  DODO_PAYMENT_NOT_VERIFIED: "Testna uplata još nije potvrđena. Ne otvaraj novu narudžbu.",
};
function safeCheckoutUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^https:\/\/test\.checkout\.dodopayments\.com\/session\/cks_[A-Za-z0-9_-]{1,100}$/.test(value)
  )
    throw new Error("Adresa probne naplate nije ispravna.");
  return value;
}
export function DodoTestCheckout({
  userId,
  initialOrderId,
}: {
  userId: string | null;
  initialOrderId?: string;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [businesses, setBusinesses] = useState<{ id: string; title: string }[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  const started = useRef(false);
  const headers = {
    "Content-Type": "application/json",
    ...(userId ? { "X-AhiBizz-Account-ID": userId } : {}),
  };
  const available =
    catalog?.available === true &&
    catalog.environment === "test_mode" &&
    catalog.amountMinor === 511 &&
    catalog.currency === "EUR";
  useEffect(() => {
    // Do not retain provider-returned email or payment fields in browser history.
    const clean = dodoTestReturnPath(initialOrderId);
    if (window.location.pathname + window.location.search + window.location.hash !== clean)
      window.history.replaceState(window.history.state, "", clean);
  }, [initialOrderId]);
  useEffect(() => {
    setCatalogLoaded(false);
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/dodo-test/catalog", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (active) setCatalog(value);
      } catch {
        if (active) setError("Probna naplata trenutno nije dostupna.");
      } finally {
        if (active) setCatalogLoaded(true);
      }
      if (!userId) return;
      try {
        const response = await fetch("/api/directory/mine?page=1&pageSize=50&status=published", {
          headers: { "X-AhiBizz-Account-ID": userId },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (active) setBusinesses(value.items ?? []);
      } catch {
        if (active) setError("Nije moguće učitati tvoje objavljene djelatnosti.");
      }
      if (!initialOrderId) return;
      try {
        const response = await fetch(`/api/dodo-test/orders/${initialOrderId}`, {
          headers: { "X-AhiBizz-Account-ID": userId },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (active && value.order?.id === initialOrderId) setOrder(value.order);
        else if (active) throw new Error();
      } catch {
        if (active)
          setError(
            "Probna narudžba nije dostupna na ovom nalogu. Ne otvaraj novu za isti pokušaj.",
          );
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, initialOrderId]);
  async function act(action: "create" | "reconcile") {
    if (lock.current || !userId || !available || (action === "reconcile" && !order)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      key.current ??= crypto.randomUUID();
      if (action === "create") started.current = true;
      const response = await fetch(
        `/api/dodo-test/${action === "create" ? "orders" : `orders/${order?.id}/reconcile`}`,
        {
          method: "POST",
          headers,
          cache: "no-store",
          body: JSON.stringify(action === "create" ? { requestId: key.current, businessId } : {}),
        },
      );
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          messages[value.code] ??
            "Zahtjev nije završen. Ponovi provjeru iste narudžbe, ne novi pokušaj naplate.",
        );
      if (!value.order || !uuid.test(value.order.id))
        throw new Error("Nije primljena valjana probna narudžba.");
      setOrder(value.order);
      window.history.replaceState(window.history.state, "", dodoTestReturnPath(value.order.id));
      if (action === "create" && value.checkoutUrl)
        window.location.assign(safeCheckoutUrl(value.checkoutUrl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Zahtjev nije završen.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const confirmed = !!order && ["verified", "succeeded"].includes(order.status);
  const reviewRequired =
    !!order && ["review", "refunded", "failed", "ambiguous"].includes(order.status);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a href="/nalog">← Moj nalog</a>
      <header>
        <span className={styles.label}>DODO TEST · BEZ STVARNOG NOVCA</span>
        <h1>Probno kartično plaćanje</h1>
        <p>
          Ovo je odvojeni test. Ne naplaćuje stvarni novac i ne ističe djelatnost u javnom imeniku.
          Na Dodo testnom ekranu koristi samo testne podatke kartice, ne stvarnu karticu.
        </p>
      </header>
      {!catalogLoaded && (
        <p role="status" className={styles.notice}>
          Učitavam stanje probne naplate…
        </p>
      )}
      {catalogLoaded && !available && (
        <p role="status" className={styles.notice}>
          Test nije uključen ili povezivanje još nije završeno. Plaćanje je onemogućeno.
        </p>
      )}
      {!userId && (
        <p>
          <a
            href={`/prijava?nastavi=${encodeURIComponent(`/dodo-proba${initialOrderId ? `?narudzba=${initialOrderId}` : ""}`)}`}
          >
            Prijavi se za nastavak
          </a>
        </p>
      )}
      {!order && !initialOrderId && (
        <section className={styles.card}>
          <h2>Proba isticanja u kategoriji · 7 dana</h2>
          <p className={styles.price}>5,11 EUR ≈ 10 KM</p>
          <p>
            Jednokratna testna uplata, bez pretplate. Test ne dodjeljuje verifikacijsku ili halal
            oznaku.
          </p>
          <label htmlFor="dodo-test-business">Tvoja objavljena djelatnost</label>
          <select
            id="dodo-test-business"
            value={businessId}
            disabled={review || busy || started.current}
            onChange={(event) => {
              setBusinessId(event.target.value);
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
          {review ? (
            <>
              <p>
                <strong>Ukupno u testu: 5,11 EUR.</strong> Pregledaj isti iznos na Dodo ekranu.
                Povratak na AhiBizz nije potvrda uplate.
              </p>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !userId || !available}
                onClick={() => void act("create")}
              >
                {busy
                  ? "Pripremam probnu narudžbu…"
                  : started.current
                    ? "Ponovi isti zahtjev"
                    : "Otvori Dodo testno plaćanje"}
              </button>
              {!started.current && (
                <button type="button" disabled={busy} onClick={() => setReview(false)}>
                  Nazad
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className={styles.primary}
              disabled={!userId || !businessId || !available}
              onClick={() => setReview(true)}
            >
              Pregledaj probnu narudžbu
            </button>
          )}
        </section>
      )}
      {!order && initialOrderId && (
        <p role="status">
          Učitavam sačuvanu probnu narudžbu. Povratak sa stranice za plaćanje nije dokaz uplate.
        </p>
      )}
      {order && (
        <section className={styles.card}>
          <h2>Sačuvana probna narudžba</h2>
          <p>Narudžba: {order.id}</p>
          <p className={styles.price}>5,11 EUR</p>
          {confirmed ? (
            <div role="status">
              <h3>Testna uplata je potvrđena na serveru</h3>
              <p>
                Nema stvarne naplate ni javnog isticanja.
                {order.testEndsAt
                  ? ` Testni period završava ${new Date(order.testEndsAt).toLocaleString("bs-BA")}.`
                  : ""}
              </p>
            </div>
          ) : reviewRequired ? (
            <p role="status">
              Narudžba zahtijeva provjeru ili je testna uplata korigovana. Ne pokreći novo plaćanje
              za isti pokušaj.
            </p>
          ) : (
            <p role="status">
              Testna uplata još nije potvrđena. Osvježi status nakon povratka s Dodo stranice.
            </p>
          )}
          {!confirmed && !reviewRequired && order.checkoutUrl && (
            <button
              type="button"
              disabled={busy || !available}
              onClick={() => {
                try {
                  window.location.assign(safeCheckoutUrl(order.checkoutUrl));
                } catch {
                  setError("Adresa probne naplate nije ispravna.");
                }
              }}
            >
              Otvori istu probnu naplatu
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !available}
            onClick={() => void act("reconcile")}
          >
            {busy ? "Provjeravam na serveru…" : "Provjeri testnu uplatu"}
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
