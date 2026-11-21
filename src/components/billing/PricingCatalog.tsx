"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { productionRequestPath } from "../../lib/account-return";
import { type BillingCatalog, type BillingPeriod, billingPackages } from "../../lib/billing";
import { type PackageBenefitsCatalog, readPackageBenefits } from "../../lib/package-benefits";
import styles from "./billing.module.css";

export function PricingCatalog({
  embedded = false,
  catalog,
  initialBenefits = null,
}: {
  embedded?: boolean;
  catalog?: BillingCatalog;
  initialBenefits?: PackageBenefitsCatalog | null;
}) {
  const plans = catalog?.packages ?? billingPackages;
  const [benefits, setBenefits] = useState<PackageBenefitsCatalog | null>(initialBenefits);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  useEffect(() => {
    if (initialBenefits && attempt === 0) return;
    const controller = new AbortController();
    setFailed(false);
    void fetch("/api/paketi/catalog", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = response.ok ? readPackageBenefits(await response.json()) : null;
        if (!data) throw Error();
        if (!controller.signal.aborted) setBenefits(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt, initialBenefits]);
  return (
    <section className={styles.workspace} aria-label="Paketi AhiBizz">
      <header className={styles.heading}>
        <div>{embedded ? <h2>Paketi</h2> : <h1>Paketi za djelatnosti</h1>}</div>
        {!embedded && (
          <Link className={styles.secondary} href="/nalog?odjeljak=paketi">
            Moje članstvo
          </Link>
        )}
      </header>
      <p className={styles.intro}>
        Prva djelatnost je besplatna 12 mjeseci. Dodatne se plaćaju od početka.
      </p>
      <fieldset className={styles.periodSwitch} aria-label="Period plaćanja">
        <button
          type="button"
          aria-pressed={period === "monthly"}
          onClick={() => setPeriod("monthly")}
        >
          Mjesečno
        </button>
        <button
          type="button"
          aria-pressed={period === "annual"}
          onClick={() => setPeriod("annual")}
        >
          Godišnje
        </button>
      </fieldset>
      <div className={styles.plans}>
        {plans.map((plan) => {
          const included = benefits?.benefits[plan.id];
          const monthly = period === "monthly";
          return (
            <article className={styles.plan} key={plan.name}>
              <h2>{plan.name}</h2>
              <p className={styles.price}>
                {(monthly ? plan.monthlyMinor : plan.annualMinor) / 100}{" "}
                <span>{monthly ? "KM / mjesec" : "KM / godina"}</span>
              </p>
              <p className={styles.term}>
                {monthly
                  ? `Ugovor na 12 mjeseci · ukupno ${(plan.monthlyMinor * 12) / 100} KM`
                  : `Jednokratno · ušteda ${(plan.monthlyMinor * 12 - plan.annualMinor) / 100} KM`}
              </p>
              {included && (
                <ul className={styles.planBenefits} aria-label="Uključeno u paket">
                  <li>Poslovni profil, poruke i booking</li>
                  {included.nearbyDays > 0 && (
                    <li>
                      <strong>
                        {included.nearbyDays} {included.nearbyDays === 1 ? "dan" : "dana"}
                      </strong>{" "}
                      isticanja u blizini mjesečno
                    </li>
                  )}
                  {included.featuredDays > 0 && (
                    <li>
                      <strong>
                        {included.featuredDays} {included.featuredDays === 1 ? "dan" : "dana"}
                      </strong>{" "}
                      isticanja na početnoj mjesečno
                    </li>
                  )}
                </ul>
              )}
              {included?.enabled ? (
                <div className={styles.planActions}>
                  <Link
                    className={styles.primary}
                    href={`/paketi/placanje?paket=${plan.id}&period=${period}`}
                    aria-label={`Odaberi ${plan.name}, ${monthly ? "mjesečno" : "godišnje"} plaćanje`}
                  >
                    Odaberi {monthly ? "mjesečno" : "godišnje"}
                  </Link>
                </div>
              ) : (
                included && <p className={styles.term}>Trenutno nije u ponudi.</p>
              )}
            </article>
          );
        })}
      </div>
      {failed && (
        <div className={styles.catalogNote} role="alert">
          Ponuda se nije učitala.{" "}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Pokušaj ponovo
          </button>
        </div>
      )}
      <section className={styles.production} aria-label="Isticanje djelatnosti i plaćanje">
        <div>
          <h2>Istakni svoju djelatnost</h2>
          <p>Isticanje u kategoriji na 7 dana · 10 KM (5,11 EUR).</p>
        </div>
        <div>
          <a className={styles.secondary} href="/naplata">
            Pregledaj plaćanje i isticanje
          </a>
        </div>
      </section>
      <section className={styles.production} aria-label="Foto i video produkcija">
        <div>
          <h2>Foto i video</h2>
          <p>Produkcija se ugovara zasebno.</p>
        </div>
        <Link className={styles.secondary} href={productionRequestPath}>
          Zatraži ponudu za produkciju
        </Link>
      </section>
    </section>
  );
}
