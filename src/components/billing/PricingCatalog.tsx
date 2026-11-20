"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type BillingCatalog, billingPackages } from "../../lib/billing";
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
      </header>
      <p className={styles.intro}>
        Prva djelatnost je besplatna 12 mjeseci. Dodatne se plaćaju od početka.
      </p>
      <div className={styles.plans}>
        {plans.map((plan) => {
          const included = benefits?.benefits[plan.id];
          return (
            <article className={styles.plan} key={plan.name}>
              <h2>{plan.name}</h2>
              <p className={styles.price}>
                {plan.monthlyMinor / 100} <span>KM / mjesec</span>
              </p>
              <p className={styles.term}>
                Ugovor na 12 mjeseci · ukupno {(plan.monthlyMinor * 12) / 100} KM
              </p>
              <div className={styles.annual}>
                <strong>{plan.annualMinor / 100} KM godišnje</strong>
                <span>
                  Jednokratno · ušteda {(plan.monthlyMinor * 12 - plan.annualMinor) / 100} KM
                </span>
              </div>
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
                    href={`/paketi/placanje?paket=${plan.id}&period=monthly`}
                    aria-label={`Odaberi ${plan.name}, mjesečno plaćanje`}
                  >
                    Odaberi mjesečno
                  </Link>
                  <Link
                    className={styles.secondary}
                    href={`/paketi/placanje?paket=${plan.id}&period=annual`}
                    aria-label={`Odaberi ${plan.name}, godišnje plaćanje`}
                  >
                    Odaberi godišnje
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
        <ul>
          <li>
            Fotografisanje <strong>Po ponudi</strong>
          </li>
          <li>
            Video <strong>Po ponudi</strong>
          </li>
          <li>
            Foto i video <strong>Po ponudi</strong>
          </li>
        </ul>
      </section>
    </section>
  );
}
