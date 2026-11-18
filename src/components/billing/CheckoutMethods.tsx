"use client";

import { useEffect, useState } from "react";
import { type CheckoutAvailability, paypalAvailabilityText } from "../../lib/checkout-methods";
import { Checkout } from "./Checkout";
import styles from "./checkout-preview.module.css";

export function CheckoutMethods({
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
  const [selected, setSelected] = useState<"paypal" | null>(
    returned || cancelled || initialOrderId ? "paypal" : null,
  );
  const [availability, setAvailability] = useState<CheckoutAvailability | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/checkout/catalog", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (
          typeof value.available !== "boolean" ||
          ![null, "sandbox", "live"].includes(value.environment)
        )
          throw new Error();
        if (active) setAvailability(value);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  const paypalStatus = paypalAvailabilityText(availability, unavailable);
  const selector = (
    <section className={styles.card} aria-labelledby="checkout-methods-heading">
      <h2 id="checkout-methods-heading">Odaberi način plaćanja</h2>
      <p>Izbor načina plaćanja ne pokreće naplatu.</p>
      <div className={styles.choices}>
        <button
          type="button"
          aria-pressed={selected === "paypal"}
          aria-describedby="paypal-availability"
          onClick={() => setSelected("paypal")}
        >
          {selected === "paypal" ? "PayPal i kartice · odabrano" : "Pregledaj PayPal i kartice"}
        </button>
        <button type="button" disabled aria-describedby="dodo-availability">
          Kartica (Dodo) · u provjeri
        </button>
      </div>
      <p id="paypal-availability" role="status">
        <strong>PayPal:</strong> {paypalStatus}
      </p>
      <p>
        Kartično dugme putem PayPala prikazuje se nakon pregleda narudžbe, ako je dostupno za kupca.
        PayPal nalog nije uvijek moguće izbjeći.
      </p>
      <p id="dodo-availability">
        <strong>Kartica (Dodo):</strong> račun je u provjeri. Ova opcija nije dostupna za stvarne
        uplate. Dosadašnje kartične probe rađene su samo u testnom okruženju.
      </p>
      <p className={styles.footer}>
        Dobrovoljna podrška razvoju ostaje na postojećoj stranici{" "}
        <a href="/podrzi">Podrži AhiBizz</a>.
      </p>
    </section>
  );
  return selected === "paypal" ? (
    <>
      <div className={styles.page} style={{ paddingBottom: 0 }}>
        {selector}
      </div>
      <Checkout
        userId={userId}
        initialOrderId={initialOrderId}
        returned={returned}
        cancelled={cancelled}
      />
    </>
  ) : (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a href="/nalog">← Moj nalog</a>
      <header>
        <span className={styles.label}>AHIBIZZ PLAĆANJE</span>
        <h1>Način plaćanja</h1>
      </header>
      {selector}
    </main>
  );
}
