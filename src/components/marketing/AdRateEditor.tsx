"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { adDeviceNames, adFormats, adPageNames } from "../../lib/ad-catalog";
import {
  type AdPricing,
  type AdPricingChange,
  getAdRate,
  volumeLabels,
} from "../../lib/ad-pricing";
import styles from "./marketing.module.css";

const positions = adFormats.flatMap((format) =>
  format.placements.map((placement) => ({ format, placement })),
);
const minor = (form: FormData, key: string) => {
  const raw = String(form.get(key) ?? "")
    .trim()
    .replace(",", ".");
  return /^\d+(?:\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : null;
};
export function AdRateEditor({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false),
    [pricing, setPricing] = useState<AdPricing | null>(null),
    [status, setStatus] = useState(""),
    [position, setPosition] = useState(0),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const running = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh retries the server read after a conflict.
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setPricing(null);
    setStatus("");
    fetch("/api/marketing/rates", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-AhiBizz-Account-ID": accountId },
      signal: abort.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const next: AdPricing = await res.json();
        if (!abort.signal.aborted) setPricing(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus("Cjenovnik trenutno nije dostupan.");
      });
    return () => abort.abort();
  }, [accountId, open, refresh]);
  async function save(change: AdPricingChange) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/marketing/rates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify(change),
      });
      if (res.status === 409) {
        setStatus("Cjenovnik je u međuvremenu promijenjen. Učitaj novu verziju.");
        return;
      }
      if (!res.ok) throw new Error();
      setPricing(await res.json());
      setStatus("Cjenovnik je sačuvan.");
    } catch {
      setStatus("Izmjena nije sačuvana. Provjeri iznose i popuste pa pokušaj ponovo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const selected = positions[position];
  if (!selected) return null;
  const { format, placement } = selected;
  const rate = pricing ? getAdRate(pricing, format.id, placement.page, placement.device) : null;
  function updateRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pricing) return;
    const form = new FormData(e.currentTarget),
      raw = String(form.get("cpm") ?? "").trim(),
      cpmMinor = minor(form, "cpm");
    if (raw && cpmMinor === null) {
      setStatus("Unesi ispravan iznos u KM.");
      return;
    }
    void save({
      action: "rate",
      version: pricing.version,
      formatId: format.id,
      page: placement.page,
      device: placement.device,
      available: form.has("available"),
      cpmMinor,
    });
  }
  function updateTerms(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pricing) return;
    const form = new FormData(e.currentTarget),
      minimumMinor = minor(form, "minimum");
    if (minimumMinor === null) return;
    void save({
      action: "terms",
      version: pricing.version,
      minimumMinor,
      advancePercent: Number(form.get("advance")),
      welcomePercent: Number(form.get("welcome")),
      volumePercent: volumeLabels.map((_, i) => Number(form.get("v" + i))),
    });
  }
  return (
    <details className={styles.order} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Cjenovnik i pozicije oglasa</summary>
      {open && pricing && rate && (
        <>
          <form
            className={styles.form}
            key={pricing.version + "-" + position}
            onSubmit={updateRate}
          >
            <label>
              Pozicija
              <select value={position} onChange={(e) => setPosition(Number(e.target.value))}>
                {positions.map(({ format, placement }, i) => (
                  <option key={[format.id, placement.device, placement.page].join("-")} value={i}>
                    {adPageNames[placement.page]} · {adDeviceNames[placement.device]} ·{" "}
                    {format.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cijena za 1.000 prikaza (KM)
              <input
                name="cpm"
                type="number"
                min=".01"
                max="10000"
                step=".01"
                placeholder="Na upit"
                defaultValue={rate.cpmMinor === null ? "" : rate.cpmMinor / 100}
              />
            </label>
            <label>
              <input name="available" type="checkbox" defaultChecked={rate.available} /> Dostupna za
              nove kampanje
            </label>
            <button type="submit" disabled={busy}>
              Sačuvaj poziciju
            </button>
          </form>
          <details>
            <summary>Minimalni zakup i popusti</summary>
            <form className={styles.form} key={pricing.version} onSubmit={updateTerms}>
              <label>
                Minimalni zakup (KM)
                <input
                  required
                  type="number"
                  name="minimum"
                  min="0"
                  max="1000000"
                  step=".01"
                  defaultValue={pricing.terms.minimumMinor / 100}
                />
              </label>
              {volumeLabels.map((label, i) => (
                <label key={label}>
                  {label} prikaza · popust (%)
                  <input
                    required
                    type="number"
                    min="0"
                    max="99"
                    name={"v" + i}
                    defaultValue={pricing.terms.volumePercent[i]}
                  />
                </label>
              ))}
              <label>
                Avansni popust (%)
                <input
                  required
                  type="number"
                  min="0"
                  max="99"
                  name="advance"
                  defaultValue={pricing.terms.advancePercent}
                />
              </label>
              <label>
                Popust dobrodošlice (%)
                <input
                  required
                  type="number"
                  min="0"
                  max="99"
                  name="welcome"
                  defaultValue={pricing.terms.welcomePercent}
                />
              </label>
              <button type="submit" disabled={busy}>
                Sačuvaj uslove
              </button>
            </form>
          </details>
          <form
            className={styles.form}
            key={"contact" + pricing.version}
            onSubmit={(event) => {
              event.preventDefault();
              const phone = String(new FormData(event.currentTarget).get("phone") ?? "").replace(
                /[ ()-]/g,
                "",
              );
              void save({
                action: "contact",
                version: pricing.version,
                contactPhone: phone || null,
              });
            }}
          >
            <label>
              Javni telefon oglašavanja
              <input
                type="tel"
                name="phone"
                maxLength={32}
                placeholder="+387…"
                defaultValue={pricing.contactPhone ?? ""}
              />
            </label>
            <button type="submit" disabled={busy}>
              Sačuvaj kontakt
            </button>
          </form>
        </>
      )}
      {open && !pricing && !status && <p role="status">Učitavanje cjenovnika…</p>}
      {status && (
        <p role="status">
          {status}{" "}
          <button type="button" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            Osvježi
          </button>
        </p>
      )}
    </details>
  );
}
