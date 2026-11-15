import { bankTransferText, type SupportConfig } from "../../lib/support";
import { Icon } from "../Icon";
import { CopyPaymentDetails } from "./CopyPaymentDetails";
import styles from "./support.module.css";

export function SupportPage({ config }: { config: SupportConfig }) {
  const bank = config.bank;
  const details = bank
    ? [
        ["Primalac", config.recipient],
        ["Banka", bank.name],
        ...(bank.iban ? [["IBAN", bank.iban]] : []),
        ...(bank.accountNumber ? [["Broj računa", bank.accountNumber]] : []),
        ...(bank.bic ? [["SWIFT/BIC", bank.bic]] : []),
        ["Svrha uplate", config.purpose],
      ]
    : [];
  const transferText = bankTransferText(config);
  const methods = Number(Boolean(config.paypalUrl)) + Number(Boolean(bank));

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="heart" />
        </span>
        <h1>Podrži razvoj AhiBizza</h1>
        <p>Dobrovoljna podrška razvoju platforme.</p>
      </header>

      <div className={styles.recipient}>
        <div>
          <span>Primalac</span>
          <strong>{config.recipient}</strong>
        </div>
        <span className={styles.recipientType}>Fizičko lice</span>
      </div>

      <div className={styles.methods} data-method-count={methods}>
        {config.paypalUrl && (
          <section className={styles.card} aria-labelledby="support-paypal-heading">
            <div className={styles.cardHeading}>
              <span className={styles.methodIcon} aria-hidden="true">
                <Icon name="external" />
              </span>
              <h2 id="support-paypal-heading">PayPal</h2>
            </div>
            <a
              className={styles.paypalButton}
              href={config.paypalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Doniraj putem PayPala (otvara se u novoj kartici)"
            >
              Doniraj putem PayPala
              <Icon name="external" />
            </a>
          </section>
        )}

        {bank && (
          <section className={styles.card} aria-labelledby="support-bank-heading">
            <div className={styles.cardHeading}>
              <span className={styles.methodIcon} aria-hidden="true">
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3 8 9-5 9 5M4 10h16M6 10v8m6-8v8m6-8v8M3 21h18M4 18h16" />
                </svg>
              </span>
              <h2 id="support-bank-heading">Uplata na račun</h2>
            </div>
            <dl className={styles.details}>
              {details.slice(1).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd
                    className={
                      label === "IBAN" || label === "Broj računa" ? styles.account : undefined
                    }
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <CopyPaymentDetails text={transferText} />
          </section>
        )}
      </div>
    </main>
  );
}
