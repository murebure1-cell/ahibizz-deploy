"use client";

import { type FormEvent, useId, useState } from "react";
import {
  type BillingAdjustmentInput,
  type BillingPackageId,
  type BillingPeriod,
  type BillingReceipt,
  type BillingReceiptInput,
  type BillingReceiptKind,
  type BillingSource,
  billingMoney,
  billingPackages,
} from "../../lib/billing";
import styles from "./billing.module.css";
import { billingInputValue, billingMoneyInput } from "./model";

export type BillingBusinessChoice = { id: string; title: string };
type Props = {
  receipt?: BillingReceipt;
  disabled: boolean;
  businesses: BillingBusinessChoice[];
  businessLoading: boolean;
  businessPage: number;
  businessHasMore: boolean;
  businessQuery: string;
  onFindBusiness: (query: string, page: number) => void;
  onCreate: (input: BillingReceiptInput) => void;
  onAdjust: (input: BillingAdjustmentInput) => void;
  onCancel: () => void;
};
export function ReceiptForm({
  receipt,
  disabled,
  businesses,
  businessLoading,
  businessPage,
  businessHasMore,
  businessQuery,
  onFindBusiness,
  onCreate,
  onAdjust,
  onCancel,
}: Props) {
  const prefix = useId();
  const [kind, setKind] = useState<BillingReceiptKind>(receipt?.kind ?? "subscription");
  const [packageId, setPackageId] = useState<BillingPackageId>(receipt?.packageId ?? "basic");
  const [period, setPeriod] = useState<BillingPeriod>(receipt?.period ?? "monthly");
  const [selected, setSelected] = useState<BillingBusinessChoice | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const chosenPackage = billingPackages.find(
    (plan) => plan.id === packageId,
  ) as (typeof billingPackages)[number];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError("");
    const data = new FormData(event.currentTarget),
      read = (name: string) => String(data.get(name) ?? "").trim();
    try {
      const taxMinor = billingMoneyInput(read("tax"), true),
        feeMinor = billingMoneyInput(read("fee"), true);
      const serviceStartsOn = kind === "subscription" ? read("serviceStartsOn") : null;
      const serviceEndsOn = kind === "subscription" ? read("serviceEndsOn") : null;
      if (
        kind === "subscription" &&
        (!serviceStartsOn || !serviceEndsOn || serviceEndsOn <= serviceStartsOn)
      )
        throw new Error("Provjeri period usluge.");
      if (receipt) {
        const refundedMinor = billingMoneyInput(read("refunded")) as number,
          reason = read("reason");
        if (refundedMinor > receipt.grossMinor)
          throw new Error("Povrat ne može biti veći od primljene uplate.");
        if (reason.length < 2 || reason.length > 500)
          throw new Error("Upiši razlog ispravke od 2 do 500 znakova.");
        onAdjust({
          expectedVersion: receipt.version,
          refundedMinor,
          taxMinor,
          feeMinor,
          reason,
          ...(kind === "subscription" ? { serviceStartsOn, serviceEndsOn } : {}),
        });
      } else {
        const grossMinor = billingMoneyInput(read("gross")) as number;
        if (grossMinor <= 0) throw new Error("Upiši stvarno primljen iznos.");
        if (kind === "subscription" && !selected) throw new Error("Izaberi djelatnost.");
        const received = new Date(read("receivedAt"));
        if (!Number.isFinite(received.getTime())) throw new Error("Upiši datum i vrijeme uplate.");
        onCreate({
          kind,
          packageId: kind === "subscription" ? packageId : null,
          period: kind === "subscription" ? period : null,
          businessId: kind === "subscription" ? (selected?.id ?? null) : null,
          serviceStartsOn,
          serviceEndsOn,
          source: read("source") as BillingSource,
          externalReference: read("reference"),
          receivedAt: received.toISOString(),
          grossMinor,
          taxMinor,
          feeMinor,
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Provjeri unesene podatke.");
    }
  }
  return (
    <form
      className={styles.form}
      aria-label={receipt ? "Ispravka evidencije uplate" : "Nova evidencija uplate"}
      onSubmit={submit}
    >
      <fieldset disabled={disabled}>
        <h2>{receipt ? "Ispravka evidencije" : "Evidentiraj primljenu uplatu"}</h2>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.fields}>
          {!receipt && (
            <>
              <label htmlFor={`${prefix}-kind`}>
                Vrsta usluge
                <select
                  id={`${prefix}-kind`}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as BillingReceiptKind)}
                >
                  <option value="subscription">Pretplata</option>
                  <option value="photo_video">Foto i video</option>
                </select>
              </label>
              <label htmlFor={`${prefix}-source`}>
                Način primitka
                <select id={`${prefix}-source`} name="source" defaultValue="bank">
                  <option value="bank">Bankovna uplata</option>
                  <option value="paypal">PayPal</option>
                  <option value="cash">Gotovina</option>
                  <option value="other">Drugo</option>
                </select>
              </label>
            </>
          )}
          {kind === "subscription" && (
            <>
              {!receipt && (
                <>
                  <label htmlFor={`${prefix}-package`}>
                    Paket
                    <select
                      id={`${prefix}-package`}
                      value={packageId}
                      onChange={(event) => setPackageId(event.target.value as BillingPackageId)}
                    >
                      {billingPackages.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor={`${prefix}-period`}>
                    Način plaćanja
                    <select
                      id={`${prefix}-period`}
                      value={period}
                      onChange={(event) => setPeriod(event.target.value as BillingPeriod)}
                    >
                      <option value="monthly">Mjesečne uplate · ugovor 12 mjeseci</option>
                      <option value="annual">Jednokratna godišnja uplata</option>
                    </select>
                    <small>
                      {period === "annual"
                        ? billingMoney(chosenPackage.annualMinor)
                        : `${billingMoney(chosenPackage.monthlyMinor)} mjesečno · ukupno ${billingMoney(chosenPackage.monthlyMinor * 12)}`}
                    </small>
                  </label>
                  <div className={styles.businessSearch}>
                    <label htmlFor={`${prefix}-search`}>
                      Pronađi djelatnost
                      <input
                        id={`${prefix}-search`}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        maxLength={80}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={businessLoading}
                      onClick={() => onFindBusiness(search.trim(), 1)}
                    >
                      Traži djelatnost
                    </button>
                  </div>
                  <div className={styles.businessSearch}>
                    <label htmlFor={`${prefix}-business`}>
                      Djelatnost
                      <select
                        id={`${prefix}-business`}
                        value={selected?.id ?? ""}
                        required
                        onChange={(event) =>
                          setSelected(
                            businesses.find((item) => item.id === event.target.value) ?? null,
                          )
                        }
                      >
                        <option value="">Izaberi djelatnost</option>
                        {selected && !businesses.some((item) => item.id === selected.id) && (
                          <option value={selected.id}>{selected.title}</option>
                        )}
                        {businesses.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {businessLoading && <small role="status">Dohvaćanje djelatnosti…</small>}
                    {!businessLoading && businesses.length === 0 && (
                      <small>Nema pronađenih djelatnosti.</small>
                    )}
                    {(businessPage > 1 || businessHasMore) && (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={businessLoading || businessPage === 1}
                          onClick={() => onFindBusiness(businessQuery, businessPage - 1)}
                        >
                          Prethodne djelatnosti
                        </button>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={businessLoading || !businessHasMore}
                          onClick={() => onFindBusiness(businessQuery, businessPage + 1)}
                        >
                          Sljedeće djelatnosti
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <label htmlFor={`${prefix}-starts`}>
                Usluga od
                <input
                  id={`${prefix}-starts`}
                  name="serviceStartsOn"
                  type="date"
                  defaultValue={receipt?.serviceStartsOn ?? ""}
                  required
                />
              </label>
              <label htmlFor={`${prefix}-ends`}>
                Usluga do
                <input
                  id={`${prefix}-ends`}
                  name="serviceEndsOn"
                  type="date"
                  defaultValue={receipt?.serviceEndsOn ?? ""}
                  required
                />
                <small>Završni datum nije uključen.</small>
              </label>
            </>
          )}
          {!receipt && (
            <>
              <label htmlFor={`${prefix}-reference`}>
                Referenca uplate
                <input
                  id={`${prefix}-reference`}
                  name="reference"
                  required
                  maxLength={120}
                  autoComplete="off"
                />
              </label>
              <label htmlFor={`${prefix}-received`}>
                Datum i vrijeme uplate
                <input id={`${prefix}-received`} name="receivedAt" type="datetime-local" required />
              </label>
              <label htmlFor={`${prefix}-gross`}>
                Primljeni iznos (KM)
                <input
                  id={`${prefix}-gross`}
                  name="gross"
                  inputMode="decimal"
                  required
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {receipt && (
            <label htmlFor={`${prefix}-refunded`}>
              Ukupno već vraćeno (KM)
              <input
                id={`${prefix}-refunded`}
                name="refunded"
                inputMode="decimal"
                required
                defaultValue={billingInputValue(receipt.refundedMinor)}
              />
              <small>Evidencija izvršenog povrata; ne šalje novac.</small>
            </label>
          )}
          <label htmlFor={`${prefix}-tax`}>
            Porezni iznos (KM)
            <input
              id={`${prefix}-tax`}
              name="tax"
              inputMode="decimal"
              defaultValue={billingInputValue(receipt?.taxMinor ?? null)}
              placeholder="Nepoznato"
              autoComplete="off"
            />
            <small>Prazno znači nepoznato. Nulu unesi samo ako je potvrđena.</small>
          </label>
          <label htmlFor={`${prefix}-fee`}>
            Naknade naplate (KM)
            <input
              id={`${prefix}-fee`}
              name="fee"
              inputMode="decimal"
              defaultValue={billingInputValue(receipt?.feeMinor ?? null)}
              placeholder="Nepoznato"
              autoComplete="off"
            />
          </label>
          {receipt && (
            <label htmlFor={`${prefix}-reason`}>
              Razlog ispravke
              <input
                id={`${prefix}-reason`}
                name="reason"
                required
                minLength={2}
                maxLength={500}
                autoComplete="off"
              />
            </label>
          )}
        </div>
        {kind === "photo_video" && (
          <p className={styles.footnote}>Foto i video ne ulaze u izdvajanje za razvoj pretplata.</p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary}>
            {disabled ? "Spremanje…" : receipt ? "Sačuvaj ispravku" : "Evidentiraj uplatu"}
          </button>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Odustani
          </button>
        </div>
      </fieldset>
    </form>
  );
}
