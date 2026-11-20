"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./billing.module.css";
import { PackageBenefitsEditor } from "./PackageBenefitsEditor";
import { PackageSettlements } from "./PackageSettlements";

export function PackageSetup({ accountId }: { accountId: string }) {
  const [active, setActive] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const poll = new AbortController();
    void fetch("/api/paketi/catalog", { cache: "no-store", signal: poll.signal })
      .then(async (res) => {
        if (!res.ok) throw Error();
        const data = await res.json();
        if (!poll.signal.aborted) setActive(data.available === true);
      })
      .catch(() => {
        if (!poll.signal.aborted) setError("Dostupnost paketa nije moguće provjeriti.");
      });
    return () => {
      poll.abort();
      request.current?.abort();
    };
  }, []);
  async function setup() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/paketi/admin/setup", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ enablePackages: true }),
      });
      const result = await res.json();
      if (!res.ok || result.available !== true || result.plans !== 6) {
        const message =
          result.code === "PAYPAL_SUBSCRIPTIONS_PERMISSION"
            ? "PayPal nije odobrio pristup pretplatama za ovaj račun."
            : result.code === "PAYPAL_LIVE_CONFIG_UNAVAILABLE"
              ? "Poveži produkcijski PayPal račun u postavkama servera."
              : "Povezivanje nije potvrđeno. Provjeri ponovo.";
        throw Error(message);
      }
      setActive(true);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Povezivanje nije potvrđeno.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <section className={styles.production} aria-label="PayPal paketi">
        <div>
          <h2>PayPal paketi</h2>
          <p role="status">
            {active
              ? "Mjesečno i godišnje plaćanje je povezano."
              : "Tri paketa, mjesečno ili godišnje."}
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void setup()}
          >
            {busy ? "Povezivanje…" : active ? "Provjeri vezu" : "Poveži PayPal pakete"}
          </button>
        </div>
      </section>
      <PackageBenefitsEditor key={accountId} accountId={accountId} />
      <PackageSettlements key={`settlements-${accountId}`} accountId={accountId} />
    </>
  );
}
