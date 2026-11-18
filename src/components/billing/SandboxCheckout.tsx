"use client";

import { useEffect, useState } from "react";
import styles from "./checkout-preview.module.css";

type Purpose = "promotion" | "support";
type Result = { id: string; value: string; currency: string; purpose: Purpose };
export function SandboxCheckout() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("promotion");
  const [result, setResult] = useState<Result | null>(null);
  const [returned, setReturned] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setReturned(query.get("paypal") === "return");
    if (query.get("paypal") === "cancel")
      setError("Odustali ste na PayPalu. Test nije završen; nema aktivacije prava.");
    fetch("/api/paypal-sandbox", { cache: "no-store" })
      .then((r) => r.json())
      .then((value) => {
        setReady(value.configured === true);
        if (query.get("paypal") && (value.purpose === "support" || value.purpose === "promotion"))
          setPurpose(value.purpose);
      })
      .catch(() => setError("Sandbox trenutno nije dostupan."));
  }, []);
  async function submit(action: "create" | "capture") {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/paypal-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "create" ? { action, purpose } : { action }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          "Sandbox nije potvrdio završenu uplatu. Možete pokušati ponovo; prava nisu aktivirana.",
        );
      if (action === "create") {
        const url = new URL(value.approvalUrl);
        if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com")
          throw new Error("Neispravna testna adresa.");
        window.location.assign(url.href);
      } else if (
        value.sandbox === true &&
        value.status === "COMPLETED" &&
        value.rightsActivated === false
      ) {
        setResult(value);
        setReturned(false);
        window.history.replaceState(null, "", "/probna-naplata");
      } else throw new Error("Nema potvrde testne uplate.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test nije završen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <a href="/pregled">← AhiBizz pregled</a>
      <header>
        <span className={styles.label}>PAYPAL SANDBOX · SAMO TESTNI NOVAC</span>
        <h1>Isprobaj PayPal plaćanje</h1>
        <p>
          Prijavi se isključivo testnim PayPal računom. Ne koristi stvarnu karticu ili stvarni
          PayPal nalog. Nema stvarne naplate niti aktivacije isticanja.
        </p>
      </header>
      <section className={styles.choices} aria-label="Namjena">
        <button
          type="button"
          disabled={busy || returned}
          aria-pressed={purpose === "promotion"}
          onClick={() => {
            setPurpose("promotion");
            setResult(null);
          }}
        >
          Istakni profil
        </button>
        <button
          type="button"
          disabled={busy || returned}
          aria-pressed={purpose === "support"}
          onClick={() => {
            setPurpose("support");
            setResult(null);
          }}
        >
          Podrži razvoj AhiBizza
        </button>
      </section>
      <section className={styles.card}>
        <h2>
          {purpose === "promotion" ? "Isticanje profila u kategoriji" : "Podrži razvoj AhiBizza"}
        </h2>
        {purpose === "promotion" ? (
          <>
            <p className={styles.price}>5,11 EUR · test</p>
            <p>
              Ponuda: 10 KM za 7 dana. Testni checkout koristi 5,11 EUR (10 ÷ 1,95583, zaokruženo na
              cent). Ovo nije aktivna prodajna cijena u EUR. Bez automatske obnove.
            </p>
          </>
        ) : (
          <>
            <p className={styles.price}>1,00 EUR · test</p>
            <p>
              Probna dobrovoljna podrška. Iznos služi samo testu; nije zadan iznos stvarne podrške.
              Ne kupuje članstvo, isticanje ili druga prava. Postojeća stranica podrške ostaje
              neizmijenjena.
            </p>
          </>
        )}
        {!ready && <p role="status">Čekamo lokalnu sandbox konfiguraciju.</p>}
        {returned ? (
          <>
            <p>Vratili ste se s PayPala. Povratak nije dokaz uplate.</p>
            <button
              type="button"
              className={styles.primary}
              disabled={!ready || busy}
              onClick={() => submit("capture")}
            >
              {busy ? "Provjeravam…" : "Potvrdi i provjeri testnu uplatu"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={!ready || busy}
            onClick={() => submit("create")}
          >
            {busy ? "Otvaram…" : "Otvori PayPal sandbox"}
          </button>
        )}
        {error && (
          <p role="alert" className={styles.notice}>
            {error}
          </p>
        )}
        {result && (
          <div role="status" className={styles.notice}>
            <h3>PayPal je potvrdio testnu uplatu</h3>
            <p>
              {result.value} {result.currency} ·{" "}
              {result.purpose === "support" ? "podrška" : "isticanje"}
            </p>
            <p>Testna potvrda: {result.id}</p>
            <p>
              Stvarni novac nije naplaćen. Nije aktivirano isticanje niti evidentirana stvarna
              podrška.
            </p>
          </div>
        )}
      </section>
      <p className={styles.footer}>
        Lokalni sandbox. Nema produkcijske baze. Testna sesija traje do 30 minuta i prestaje nakon
        restarta servera.
      </p>
    </main>
  );
}
