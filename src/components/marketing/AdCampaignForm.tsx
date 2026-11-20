"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, type RefObject, useRef, useState } from "react";
import type { CampaignBrief, CampaignSelection } from "../../lib/ad-brief";
import {
  type AdDevice,
  type AdPage,
  adDeviceNames,
  adDevices,
  adFormats,
  adPageNames,
  adPages,
  getAdPlacement,
} from "../../lib/ad-catalog";
import { estimateAdCampaign, getAdRate } from "../../lib/ad-pricing";
import { billingMoney } from "../../lib/billing";
import { type BusinessMediaAsset, businessMediaUrl } from "../../lib/business-media";
import {
  adPlacements,
  type MarketingCommand,
  type MarketingData,
  type Placement,
  type PlacementTarget,
} from "../../lib/marketing";
import styles from "./marketing.module.css";

const assetName = (a: BusinessMediaAsset) =>
  a.kind === "logo" ? "Logotip" : a.kind === "cover" ? "Naslovna slika" : `Fotografija ${a.slot}`;
const assetKey = (a: BusinessMediaAsset) => `${a.kind}:${a.slot}:${a.version}`;
const formatNumber = (n: number) => new Intl.NumberFormat("bs-BA").format(n);
export function AdCampaignForm({
  data,
  target,
  selection,
  submit,
  busy,
  formRef,
}: {
  data: MarketingData;
  target?: PlacementTarget;
  selection?: CampaignSelection;
  submit: (command: MarketingCommand) => Promise<boolean>;
  busy: boolean;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const [placement, setPlacement] = useState<Placement>(target?.placement ?? "banner");
  const [businessId, setBusinessId] = useState(target?.businessId ?? data.businesses[0]?.id ?? "");
  const [device, setDevice] = useState<AdDevice>(selection?.device ?? "mobile");
  const [page, setPage] = useState<AdPage>(selection?.page ?? "home");
  const [format, setFormat] = useState<string>(selection?.format ?? "");
  const [assetId, setAssetId] = useState("");
  const [impressions, setImpressions] = useState(String(selection?.impressionGoal ?? 10000));
  const [manual, setManual] = useState(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const business = data.businesses.find((b) => b.id === businessId);
  const formats = adFormats.filter(
    (f) =>
      getAdPlacement(f.id, page, device) &&
      (!data.adPricing || getAdRate(data.adPricing, f.id, page, device)?.available),
  );
  const chosen = formats.find((f) => f.id === format) ?? formats[0];
  const slot = chosen ? getAdPlacement(chosen.id, page, device) : undefined;
  const estimate =
    data.adPricing && chosen
      ? estimateAdCampaign(data.adPricing, chosen.id, page, device, Number(impressions))
      : null;
  const creative = business?.assets?.find((a) => assetKey(a) === assetId) ?? null;
  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!business) return;
    const f = new FormData(e.currentTarget);
    const value = (k: string) => String(f.get(k) ?? "").trim() || null;
    const quantity = Number(value("quantity"));
    let campaign: CampaignBrief | undefined;
    if (placement === "banner") {
      if (!chosen || !slot) return;
      campaign = {
        device,
        page,
        format: chosen.id,
        impressionGoal: Number(impressions),
        budgetMinor: value("budget") ? Math.round(Number(value("budget")) * 100) : null,
        startsOn: value("startsOn"),
        city: value("city"),
        categoryId: value("category"),
        keyword: value("keyword"),
        creative: creative
          ? { kind: creative.kind, slot: creative.slot, version: creative.version }
          : null,
        destinationWebsite: business.website === true && value("destination") === "website",
        targetGender: value("gender") as CampaignBrief["targetGender"],
        minPriceMinor:
          value("minPrice") !== null ? Math.round(Number(value("minPrice")) * 100) : null,
        maxPriceMinor:
          value("maxPrice") !== null ? Math.round(Number(value("maxPrice")) * 100) : null,
        targetingNote: manual ? value("note") : null,
      };
    }
    const details = {
      kind: placement,
      quantity,
      businessId: business.id,
      ...(campaign ? { campaign } : {}),
    };
    const key = JSON.stringify(details);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    if (await submit({ action: "request", id: pending.current.id, ...details }))
      pending.current = null;
  }
  return (
    <article className={styles.order}>
      <header>
        <h2>Novi oglas</h2>
        <Link href="/oglasavanje">Pregled pozicija</Link>
      </header>
      <form ref={formRef} onSubmit={request} className={styles.form}>
        <label>
          Mjesto prikaza
          <select
            name="placement"
            value={placement}
            onChange={(e) => setPlacement(e.target.value as Placement)}
          >
            {Object.entries(adPlacements).map(([id, title]) => (
              <option value={id} key={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Djelatnost
          <select
            name="business"
            required
            value={business?.id ?? ""}
            onChange={(e) => {
              setBusinessId(e.target.value);
              setAssetId("");
            }}
          >
            {!business && (
              <option value="" disabled>
                Odaberi objavljenu djelatnost
              </option>
            )}
            {data.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        {placement === "banner" && (
          <>
            <div className={styles.campaignGrid}>
              <label>
                Uređaj
                <select value={device} onChange={(e) => setDevice(e.target.value as AdDevice)}>
                  {adDevices.map((id) => (
                    <option key={id} value={id}>
                      {adDeviceNames[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stranica
                <select value={page} onChange={(e) => setPage(e.target.value as AdPage)}>
                  {adPages.map((id) => (
                    <option key={id} value={id}>
                      {adPageNames[id]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Format
              <select value={chosen?.id ?? ""} onChange={(e) => setFormat(e.target.value)} required>
                {!chosen && <option value="">Trenutno nema pozicija</option>}
                {formats.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Broj prikazivanja
              <input
                type="number"
                min="1000"
                max="10000000"
                step="1"
                required
                value={impressions}
                onChange={(e) => setImpressions(e.target.value)}
              />
            </label>
            {estimate && (
              <div className={styles.instructions}>
                <strong>Procjena zakupa · {billingMoney(estimate.netMinor)}</strong>
                {estimate.discountPercent > 0 && (
                  <span>Popust na prikaze {estimate.discountPercent}%</span>
                )}
                {estimate.belowMinimum && (
                  <span>Minimalni zakup {billingMoney(estimate.minimumMinor)}</span>
                )}
              </div>
            )}
            <details className={styles.formOptions}>
              <summary>Termin, budžet i publika</summary>
              <div className={styles.campaignGrid}>
                <label>
                  Početak (opcionalno)
                  <input name="startsOn" type="date" min={new Date().toISOString().slice(0, 10)} />
                </label>
                <label>
                  Najveći budžet (KM)
                  <input
                    name="budget"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    max="1000000"
                  />
                </label>
                <label>
                  Grad
                  <input name="city" maxLength={100} placeholder="Svi gradovi" />
                </label>
                {page !== "home" && (
                  <label>
                    Kategorija
                    <select name="category">
                      <option value="">Sve kategorije</option>
                      {data.categories?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {page === "listing" && (
                  <>
                    <label>
                      Objavljena cijena od (KM)
                      <input
                        type="number"
                        name="minPrice"
                        min="0"
                        max="1000000"
                        step="0.01"
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      Objavljena cijena do (KM)
                      <input
                        type="number"
                        name="maxPrice"
                        min="0"
                        max="1000000"
                        step="0.01"
                        inputMode="decimal"
                      />
                    </label>
                    {chosen?.id !== "loan_calculator" && (
                      <label>
                        Publika po spolu
                        <select name="gender">
                          <option value="">Svi posjetioci</option>
                          <option value="women">Žene koje su pristale</option>
                          <option value="men">Muškarci koji su pristali</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                {page === "search" && (
                  <label>
                    Ključna riječ
                    <input name="keyword" maxLength={80} />
                  </label>
                )}
              </div>
              <label>
                Posebno ciljanje
                <select
                  value={manual ? "manual" : "context"}
                  onChange={(e) => setManual(e.target.value === "manual")}
                >
                  <option value="context">Standardno</option>
                  <option value="manual">Upit za prilagodbu</option>
                </select>
              </label>
              {manual && (
                <label>
                  Opiši posebne uslove
                  <textarea
                    name="note"
                    required
                    rows={2}
                    maxLength={400}
                    placeholder="Npr. ciljanje prema rasponu cijena"
                  />
                  <small>
                    Zahtjev za prilagodbu razmatra administrator prije ugovaranja kampanje.
                  </small>
                </label>
              )}
            </details>
            <label>
              Slika oglasa
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">Iz profila djelatnosti</option>
                {business?.assets?.map((a) => (
                  <option value={assetKey(a)} key={assetKey(a)}>
                    {assetName(a)}
                  </option>
                ))}
              </select>
            </label>
            {business && (
              <div className={styles.creativePreview}>
                {creative && (
                  <Image
                    unoptimized
                    src={businessMediaUrl(business.id, creative)}
                    width={creative.width}
                    height={creative.height}
                    alt={assetName(creative)}
                  />
                )}
                <strong>{business.title}</strong>
                {slot && (
                  <small>
                    {adPageNames[page]} · {adDeviceNames[device]} · {chosen?.title}
                  </small>
                )}
              </div>
            )}
            <label>
              Odredište
              <select key={business?.id} name="destination">
                <option value="profile">Javni profil djelatnosti</option>
                {business?.website && <option value="website">Web stranica djelatnosti</option>}
              </select>
            </label>
          </>
        )}
        <label>
          Broj dana
          <input
            name="quantity"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={90}
            defaultValue={7}
          />
        </label>
        <button type="submit" disabled={busy || !business || (placement === "banner" && !chosen)}>
          Zatraži ponudu
        </button>
      </form>
    </article>
  );
}
export function CampaignDetails({
  campaign: c,
}: {
  campaign: NonNullable<MarketingData["orders"][number]["campaign"]>;
}) {
  const f = adFormats.find((format) => format.id === c.format);
  return (
    <div className={styles.instructions}>
      <strong>
        {f?.title ?? c.format} · {adPageNames[c.page]} · {adDeviceNames[c.device]}
      </strong>
      <span>
        {formatNumber(c.impressions)} / {formatNumber(c.impressionGoal)} prikaza ·{" "}
        {formatNumber(c.clicks)} klikova
      </span>
      {c.startsOn && <span>Planirani početak {c.startsOn}</span>}
      {[c.city, c.categoryName, c.keyword].some(Boolean) && (
        <span>{[c.city, c.categoryName, c.keyword].filter(Boolean).join(" · ")}</span>
      )}
      {c.estimateMinor != null && (
        <span>
          Procijenjeni zakup {billingMoney(c.estimateMinor)}
          {c.minimumMinor > c.estimateMinor ? ` · minimum ${billingMoney(c.minimumMinor)}` : ""}
        </span>
      )}
      {c.benefit && (
        <span>{c.benefit === "advance" ? "Avansni popust" : "Popust dobrodošlice"}</span>
      )}
      {c.targetGender && (
        <span>Publika s pristankom · {c.targetGender === "women" ? "žene" : "muškarci"}</span>
      )}
      {(c.minPriceMinor != null || c.maxPriceMinor != null) && (
        <span>
          Objavljene cijene {c.minPriceMinor != null ? `od ${billingMoney(c.minPriceMinor)}` : ""}{" "}
          {c.maxPriceMinor != null ? `do ${billingMoney(c.maxPriceMinor)}` : ""}
        </span>
      )}
      {c.budgetMinor != null && <span>Budžet do {billingMoney(c.budgetMinor)}</span>}
      {c.creative && (
        <span>
          {c.creative.kind === "gallery"
            ? `Fotografija ${c.creative.slot}`
            : c.creative.kind === "logo"
              ? "Logotip"
              : "Naslovna slika"}
        </span>
      )}
      {c.destinationUrl && <span>{c.destinationUrl}</span>}
      {c.replacedTargetingNote && (
        <strong>
          Ponuda uključuje samo standardno ciljanje. Poseban zahtjev „{c.replacedTargetingNote}“ je
          izuzet iz cijene.
        </strong>
      )}
      {c.targetingNote && <span>Poseban upit · {c.targetingNote}</span>}
    </div>
  );
}
