"use client";

import { type FormEvent, useEffect, useState } from "react";
import { billingPackages } from "../../lib/billing";
import { type PackageBenefitsCatalog, readPackageBenefits } from "../../lib/package-benefits";
import styles from "./billing.module.css";

export function PackageBenefitsEditor({ accountId }: { accountId: string }) {
  const [current, setCurrent] = useState<PackageBenefitsCatalog | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh retries the authoritative read after a conflicting save.
  useEffect(() => {
    const controller = new AbortController();
    setCurrent(null);
    setMessage("");
    setFailed(false);
    void fetch("/api/paketi/admin/benefits", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "X-AhiBizz-Account-ID": accountId },
    })
      .then(async (response) => {
        const value = response.ok ? readPackageBenefits(await response.json()) : null;
        if (!value) throw Error();
        if (!controller.signal.aborted) setCurrent(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage("Pogodnosti se nisu učitale.");
        }
      });
    return () => controller.abort();
  }, [accountId, refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || busy) return;
    const form = new FormData(event.currentTarget);
    const benefits = { ...current.benefits };
    for (const { id } of billingPackages) {
      benefits[id] = {
        enabled: form.has(`${id}-enabled`),
        nearbyDays: Number(form.get(`${id}-nearby`)),
        featuredDays: Number(form.get(`${id}-featured`)),
      };
    }
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const response = await fetch("/api/paketi/admin/benefits", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ version: current.version, benefits }),
      });
      const saved = response.ok ? readPackageBenefits(await response.json()) : null;
      if (!saved) {
        setFailed(true);
        setMessage(
          response.status === 409
            ? "Ponuda je u međuvremenu promijenjena. Učitaj novu verziju."
            : "Spremanje nije potvrđeno. Provjeri trenutnu verziju.",
        );
      } else {
        setCurrent(saved);
        setMessage("Pogodnosti su spremljene za nove ugovore.");
      }
    } catch {
      setFailed(true);
      setMessage("Spremanje nije potvrđeno. Provjeri trenutnu verziju.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.benefitsEditor} aria-label="Pogodnosti paketa">
      <h2>Pogodnosti paketa</h2>
      <p>Broj dana isticanja u svakom plaćenom mjesecu. Izmjene vrijede za nove ugovore.</p>
      {current && (
        <form key={current.version} onSubmit={save} method="post">
          <div className={styles.tierFields}>
            {billingPackages.map((plan) => (
              <fieldset key={plan.id} disabled={busy}>
                <legend>{plan.name}</legend>
                <label className={styles.tierSwitch}>
                  <input
                    name={`${plan.id}-enabled`}
                    type="checkbox"
                    defaultChecked={current.benefits[plan.id].enabled}
                  />{" "}
                  U ponudi
                </label>
                <label>
                  U blizini
                  <input
                    required
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={31}
                    step={1}
                    name={`${plan.id}-nearby`}
                    defaultValue={current.benefits[plan.id].nearbyDays}
                  />
                </label>
                <label>
                  Na početnoj
                  <input
                    required
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={31}
                    step={1}
                    name={`${plan.id}-featured`}
                    defaultValue={current.benefits[plan.id].featuredDays}
                  />
                </label>
              </fieldset>
            ))}
          </div>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Spremanje…" : "Sačuvaj pogodnosti"}
          </button>
        </form>
      )}
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      {failed && (
        <button
          className={styles.secondary}
          type="button"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Učitaj trenutnu verziju
        </button>
      )}
    </section>
  );
}
