"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { campaignPath } from "../../lib/ad-brief";
import {
  type AdDevice,
  type AdFormat,
  type AdFormatId,
  type AdFormatPlacement,
  type AdPage,
  adDeviceNames,
  adDevices,
  adFormats,
  adPageNames,
  adPages,
} from "../../lib/ad-catalog";
import { type AdPricing, estimateAdCampaign, getAdRate } from "../../lib/ad-pricing";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { formatCreditsFromBam } from "../../lib/wallet";
import { Icon } from "../Icon";
import styles from "./ad-guide.module.css";

const km = (minor: number) =>
  `${new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 }).format(minor / 100)} KM`;
const positionNames: Record<AdFormatPlacement["position"], string> = {
  top: "Iznad sadržaja",
  inline: "Unutar sadržaja",
  side: "Bočna pozicija",
  bottom: "Dno ekrana",
  overlay: "Preko sadržaja",
  icon: "Red kategorija",
};

function rateFor(pricing: AdPricing | null, format: AdFormat, placement: AdFormatPlacement) {
  return pricing
    ? getAdRate(pricing, format.id, placement.page, placement.device)
    : { available: true, cpmMinor: null };
}

function FormatPreview({
  device,
  page,
  format,
  position,
  image,
}: {
  device: AdDevice;
  page: AdPage;
  format: AdFormat;
  position: AdFormatPlacement["position"];
  image: string | null;
}) {
  const creative = (
    <div className={styles.adMarker} data-position={position}>
      {image ? (
        <Image src={image} alt="Pregled odabrane slike oglasa" unoptimized fill />
      ) : (
        <>
          <Icon name={position === "icon" ? "shop" : "star"} />
          <span>{format.title}</span>
        </>
      )}
    </div>
  );
  return (
    <div
      className={styles.canvas}
      role="img"
      aria-label={`Prikaz pozicije: ${adDeviceNames[device]}, ${adPageNames[page]}, ${positionNames[position]}`}
    >
      <div className={styles.frame} data-device={device} aria-hidden="true">
        <div className={styles.mockHeader}>
          <b>ahibizz.</b>
          <Icon name="menu" />
        </div>
        {page === "home" ? (
          <div className={styles.mockCategories}>
            {position === "icon" && creative}
            <i />
            <i />
            <i />
            <i />
          </div>
        ) : (
          <div className={styles.mockPlaceholder}>{adPageNames[page]}</div>
        )}
        {position === "top" && creative}
        <div className={styles.mockBody} data-side={position === "side"}>
          <div className={styles.mockFlow}>
            <div className={styles.mockCards}>
              <i />
              <i />
              <i />
              <i />
            </div>
            {position === "inline" && creative}
            <div className={styles.mockLines}>
              <i />
              <i />
            </div>
          </div>
          {position === "side" && creative}
        </div>
        {(position === "bottom" || position === "overlay") && creative}
      </div>
    </div>
  );
}

export function AdExplorer({
  pricing,
  creditRate,
}: {
  pricing: AdPricing | null;
  creditRate?: number | null;
}) {
  const priceLabel = (amount: number) =>
    creditRate === undefined ? km(amount) : formatCreditsFromBam(amount, creditRate);
  const [device, setDevice] = useState<AdDevice>("mobile");
  const [page, setPage] = useState<AdPage>("home");
  const [chosen, setChosen] = useState<AdFormatId>("mobile_leaderboard");
  const [standardDevice, setStandardDevice] = useState<AdDevice>("desktop");
  const [impressions, setImpressions] = useState("125000");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image);
    },
    [image],
  );
  const options = adFormats.flatMap((format) =>
    format.placements
      .filter(
        (p) => p.device === device && p.page === page && rateFor(pricing, format, p).available,
      )
      .map((placement) => ({ format, placement })),
  );
  const selected = options.find((o) => o.format.id === chosen) ?? options[0];
  const price = selected ? rateFor(pricing, selected.format, selected.placement).cpmMinor : null;
  const volume = Number(impressions);
  const validVolume = Number.isSafeInteger(volume) && volume >= 1000 && volume <= 10000000;
  const estimate =
    selected && pricing && validVolume
      ? estimateAdCampaign(pricing, selected.format.id, page, device, volume)
      : null;
  const preview = (format: AdFormat) => {
    const placements = format.placements.filter((p) => rateFor(pricing, format, p).available);
    const place =
      placements.find((p) => p.page === page && p.device === device) ??
      placements.find((p) => p.device === device) ??
      placements[0];
    if (!place) return;
    setPage(place.page);
    setDevice(place.device);
    setChosen(format.id);
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "start" });
  };
  return (
    <>
      <section id="pozicije" className={styles.section} ref={ref} tabIndex={-1}>
        <h2>Gdje se prikazuje tvoj oglas?</h2>
        <div className={styles.explorer}>
          <div className={styles.controls}>
            <fieldset className={styles.switcher} aria-label="Uređaj za pregled">
              {adDevices.map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={device === d}
                  onClick={() => setDevice(d)}
                >
                  {adDeviceNames[d]}
                </button>
              ))}
            </fieldset>
            <fieldset className={styles.pageChoices} aria-label="Stranica za prikaz">
              {adPages.map((p) => (
                <button type="button" key={p} aria-pressed={p === page} onClick={() => setPage(p)}>
                  {adPageNames[p]}
                </button>
              ))}
            </fieldset>
            {selected && (
              <div className={styles.fields}>
                <label>
                  Format oglasa
                  <select
                    value={selected.format.id}
                    onChange={(event) => setChosen(event.target.value as AdFormatId)}
                  >
                    {options.map(({ format }) => (
                      <option key={format.id} value={format.id}>
                        {format.title}
                      </option>
                    ))}
                  </select>
                </label>
                <p>{selected.format.description}</p>
                <div className={styles.specRow}>
                  <span>
                    {selected.placement.width} × {selected.placement.height} px
                  </span>
                  <b>
                    {price !== null ? `${priceLabel(price)} / 1.000 prikaza` : "Cijena na upit"}
                  </b>
                </div>
                <label className={styles.upload}>
                  <Icon name="download" />
                  Isprobaj svoju sliku
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
                          file.type,
                        ) ||
                        file.size > 1000000
                      ) {
                        setImageError("Odaberi JPG, PNG, WebP ili GIF do 1.000 KB.");
                        event.target.value = "";
                        return;
                      }
                      setImage(URL.createObjectURL(file));
                      setImageError("");
                      event.target.value = "";
                    }}
                  />
                </label>
                {image && (
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => setImage(null)}
                  >
                    Ukloni sliku iz pregleda
                  </button>
                )}
                {imageError && <p role="alert">{imageError}</p>}
              </div>
            )}
            {!selected && <p>Za ovaj uređaj i stranicu trenutno nema dostupnih pozicija.</p>}
          </div>
          {selected && (
            <FormatPreview
              device={device}
              page={page}
              format={selected.format}
              position={selected.placement.position}
              image={image}
            />
          )}
          {selected && (
            <div className={styles.quote}>
              <div className={styles.calcFields}>
                {price !== null ? (
                  <>
                    <label>
                      Željeni broj prikaza
                      <input
                        inputMode="numeric"
                        type="number"
                        min="1000"
                        max="10000000"
                        step="1"
                        aria-invalid={!validVolume}
                        aria-describedby={!validVolume ? "broj-prikaza-greska" : undefined}
                        value={impressions}
                        onChange={(event) => setImpressions(event.target.value)}
                      />
                    </label>
                    <div aria-live="polite">
                      <span>Procjena kampanje</span>
                      <strong>
                        {estimate
                          ? priceLabel(Math.max(estimate.netMinor, estimate.minimumMinor))
                          : "—"}
                      </strong>
                      {estimate && estimate.discountPercent > 0 && (
                        <small>Uključen popust od {estimate.discountPercent}%</small>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <span>Odabrana pozicija</span>
                    <strong>{selected.format.title}</strong>
                  </div>
                )}
              </div>
              {estimate?.belowMinimum && (
                <p>
                  Minimalni zakup banera iznosi {priceLabel(estimate.minimumMinor)}. Konačne uslove
                  vidiš u ponudi.
                </p>
              )}
              {price !== null && !validVolume && (
                <p id="broj-prikaza-greska">Unesi cijeli broj između 1.000 i 10.000.000 prikaza.</p>
              )}
              {!IS_PLAY_EDITION && (price === null || validVolume) && (
                <Link
                  className={styles.primary}
                  href={campaignPath({
                    format: selected.format.id,
                    page,
                    device,
                    impressionGoal: validVolume && price !== null ? volume : undefined,
                  })}
                >
                  Zatraži ponudu <Icon name="arrow" />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <section id="cjenovnik" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Standardni formati i cijene</h2>
          <fieldset className={styles.switcher} aria-label="Uređaj za cjenovnik">
            {adDevices.map((d) => (
              <button
                type="button"
                key={d}
                aria-pressed={standardDevice === d}
                onClick={() => setStandardDevice(d)}
              >
                {adDeviceNames[d]}
              </button>
            ))}
          </fieldset>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <caption>
              Cijene u {creditRate === undefined ? "KM" : "Ahi kreditima"} za 1.000 prikaza (CPM).
              Primjenjivi porez iskazuje se u ponudi.
            </caption>
            <thead>
              <tr>
                <th scope="col">Format</th>
                {adPages.map((p) => (
                  <th key={p} scope="col">
                    {adPageNames[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adFormats
                .filter(
                  (f) =>
                    f.family === "standard" &&
                    f.placements.some((p) => p.device === standardDevice),
                )
                .map((format) => {
                  const first = format.placements.find((p) => p.device === standardDevice);
                  return (
                    <tr key={format.id}>
                      <th scope="row">
                        {format.title}
                        {first && (
                          <small>
                            {first.width} × {first.height}
                          </small>
                        )}
                      </th>
                      {adPages.map((pageOption) => {
                        const placement = format.placements.find(
                          (p) => p.device === standardDevice && p.page === pageOption,
                        );
                        const rate = placement && rateFor(pricing, format, placement);
                        return (
                          <td key={pageOption}>
                            {rate?.available ? (
                              rate.cpmMinor === null ? (
                                "Na upit"
                              ) : (
                                priceLabel(rate.cpmMinor)
                              )
                            ) : (
                              <span title="Nije dostupno">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.section}>
        <h2>Posebni formati</h2>
        <div className={styles.formatGrid}>
          {adFormats
            .filter((f) => f.family !== "standard")
            .map((format) => {
              const places = format.placements.filter((p) => rateFor(pricing, format, p).available);
              const prices = places
                .map((p) => rateFor(pricing, format, p).cpmMinor)
                .filter((p): p is number => p !== null);
              const min = prices.length ? Math.min(...prices) : null;
              return (
                <button
                  key={format.id}
                  type="button"
                  disabled={!places.length}
                  className={styles.formatCard}
                  onClick={() => preview(format)}
                  aria-label={`Pregledaj format ${format.title}`}
                >
                  <span
                    className={styles.mini}
                    data-position={format.placements[0]?.position}
                    aria-hidden="true"
                  >
                    <i />
                  </span>
                  <span className={styles.formatCopy}>
                    <strong>{format.title}</strong>
                    <span>{format.description}</span>
                    <small>
                      {!places.length
                        ? "Pauzirano"
                        : min !== null
                          ? `Od ${priceLabel(min)} / 1.000 prikaza`
                          : "Na upit"}
                    </small>
                  </span>
                  <Icon name="chevron" />
                </button>
              );
            })}
        </div>
      </section>
    </>
  );
}
