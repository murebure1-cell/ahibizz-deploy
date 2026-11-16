import { type BillingCatalog, billingPackages } from "../../lib/billing";
import styles from "./billing.module.css";

export function PricingCatalog({
  embedded = false,
  catalog,
}: {
  embedded?: boolean;
  catalog?: BillingCatalog;
}) {
  const plans = catalog?.packages ?? billingPackages;
  return (
    <section className={styles.workspace} aria-label="Paketi AhiBizz">
      <header className={styles.heading}>
        <div>{embedded ? <h2>Paketi</h2> : <h1>Paketi za djelatnosti</h1>}</div>
        <span className={styles.badge} role="status">
          Naplata u pripremi
        </span>
      </header>
      <p className={styles.intro}>
        Prva djelatnost je besplatna 12 mjeseci. Dodatne se plaćaju od početka.
      </p>
      <div className={styles.plans}>
        {plans.map((plan) => (
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
          </article>
        ))}
      </div>
      <div className={styles.catalogNote}>
        <ul className={styles.features} aria-label="Postojeće funkcije AhiBizza">
          <li>Profil djelatnosti</li>
          <li>Fotografije i lokacija</li>
          <li>Booking</li>
          <li>Poruke</li>
        </ul>
        <p>Pogodnosti paketa i ugovori bit će objavljeni prije početka naplate.</p>
      </div>
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
