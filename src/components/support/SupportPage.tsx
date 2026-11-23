"use client";

import { useState } from "react";
import {
  bankTransferText,
  donationAmountMinor,
  donationAmountText,
  donationPayPalLink,
  type SupportConfig,
} from "../../lib/support";
import { Icon } from "../Icon";
import { CopyPaymentDetails } from "./CopyPaymentDetails";
import styles from "./support.module.css";

const amounts = ["5", "10", "20", "50"];

export function SupportPage({ config }: { config: SupportConfig }) {
  const methods = [
    ...(config.paypalUrl ? [{ id: "paypal", label: "PayPal" }] : []),
    ...config.bankAccounts.map((bank) => ({ id: `bank:${bank.id}`, label: bank.label })),
  ];
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  // A preselected common amount keeps the donate action usable on arrival.
  const [choice, setChoice] = useState("10");
  const [customAmount, setCustomAmount] = useState("");
  const bank = config.bankAccounts.find((entry) => method === `bank:${entry.id}`);
  const currency = method === "paypal" ? "EUR" : bank?.currency;
  const amountMinor = currency
    ? donationAmountMinor(choice === "custom" ? customAmount : choice)
    : null;
  const payment =
    method === "paypal" && amountMinor ? donationPayPalLink(config.paypalUrl, amountMinor) : null;
  const amountText = currency && amountMinor ? donationAmountText(amountMinor, currency) : null;
  const details = bank
    ? [
        ["Banka", bank.name],
        ...(bank.iban ? [["IBAN", bank.iban]] : []),
        ...(bank.accountNumber ? [["Broj računa", bank.accountNumber]] : []),
        ...(bank.bic ? [["SWIFT/BIC", bank.bic]] : []),
        ...(bank.address ? [["Adresa banke", bank.address]] : []),
        ...(amountText ? [["Iznos", amountText]] : []),
        ["Svrha uplate", config.purpose],
      ]
    : [];

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="heart" />
        </span>
        <h1>Doniraj za razvoj AhiBizza</h1>
        <p>Dobrovoljna uplata za razvoj platforme.</p>
      </header>

      <div className={styles.recipient}>
        <div>
          <span>Primalac</span>
          <strong>{config.recipient}</strong>
        </div>
        <span className={styles.recipientType}>Fizičko lice</span>
      </div>

      <section className={styles.card} aria-label="Donacija">
        {methods.length > 1 && (
          <fieldset className={styles.choices}>
            <legend>Način uplate</legend>
            <div className={styles.methodOptions}>
              {methods.map((option) => (
                <label
                  key={option.id}
                  className={styles.option}
                  data-selected={method === option.id}
                >
                  <input
                    type="radio"
                    name="donation-method"
                    value={option.id}
                    checked={method === option.id}
                    onChange={() => {
                      setMethod(option.id);
                      setChoice("10");
                      setCustomAmount("");
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {currency && (
          <fieldset className={styles.choices}>
            <legend>Iznos donacije</legend>
            <div className={styles.amountOptions}>
              {[...amounts, "custom"].map((option) => (
                <label key={option} className={styles.option} data-selected={choice === option}>
                  <input
                    type="radio"
                    name="donation-amount"
                    value={option}
                    checked={choice === option}
                    onChange={() => setChoice(option)}
                  />
                  {option === "custom"
                    ? "Drugi iznos"
                    : `${option} ${currency === "BAM" ? "KM" : "EUR"}`}
                </label>
              ))}
            </div>
            {choice === "custom" && (
              <label className={styles.customAmount}>
                <span>Iznos u {currency === "BAM" ? "KM" : "EUR"}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  maxLength={13}
                  autoComplete="off"
                  value={customAmount}
                  aria-invalid={Boolean(customAmount && !amountMinor)}
                  onChange={(event) => setCustomAmount(event.target.value)}
                />
                {customAmount && !amountMinor && (
                  <span role="status">Unesi iznos veći od nule, s najviše dvije decimale.</span>
                )}
              </label>
            )}
          </fieldset>
        )}
        {method === "paypal" &&
          (payment ? (
            <>
              {!payment.amountPrefilled && (
                <p className={styles.paymentNote}>
                  Odabrani iznos je {amountText}. Provjeri iznos na PayPalu prije potvrde.
                </p>
              )}
              <a
                className={styles.paypalButton}
                href={payment.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Doniraj ${amountText} putem PayPala (otvara se u novoj kartici)`}
              >
                Doniraj {amountText} putem PayPala
                <Icon name="external" />
              </a>
            </>
          ) : (
            <button type="button" disabled className={styles.paypalButton}>
              Doniraj putem PayPala
            </button>
          ))}
        {bank && (
          <section className={styles.bankDetails} aria-label={bank.label}>
            <h2>Podaci za uplatu</h2>
            <dl className={styles.details}>
              {details.map(([label, value]) => (
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
            {bank.note && <p className={styles.bankNote}>{bank.note}</p>}
            <CopyPaymentDetails
              key={`${bank.id}:${amountMinor ?? 0}`}
              text={bankTransferText(config, bank.id, amountMinor ?? undefined)}
            />
          </section>
        )}
      </section>
    </main>
  );
}
