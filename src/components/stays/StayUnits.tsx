"use client";
import Image from "next/image";
import { type FormEvent, useRef, useState } from "react";
import { bookingMoney } from "../../lib/booking";
import {
  type BusinessMediaAsset,
  type BusinessMediaManifest,
  businessMediaUrl,
  inventoryMedia,
} from "../../lib/business-media";
import type { StayCatalog, StayUnit, StayUnitInput } from "../../lib/stays";
import { BusinessMediaManager } from "../directory/BusinessMediaManager";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import common from "../rentals/rentals.module.css";
import { StayCalendar } from "./StayCalendar";
import { StayEntry } from "./StayEntries";
import { stayError, useStayRead, writeStay } from "./stay-client";
import styles from "./stays.module.css";

function UnitForm({
  unit,
  businessId,
  actor,
  photos,
  photosConfirmed,
  mediaOnReview,
  cancel,
  saved,
  onPhotos,
}: {
  unit?: StayUnit;
  businessId: string;
  actor: string;
  photos: BusinessMediaAsset[];
  photosConfirmed: boolean;
  mediaOnReview?: boolean;
  cancel: () => void;
  saved: () => void;
  onPhotos: () => void;
}) {
  const t = useT();
  const [editedSlots, setSlots] = useState<number[] | null>(null);
  const slots = (editedSlots ?? unit?.photoSlots ?? []).filter(
    (slot) => !photosConfirmed || photos.some((photo) => photo.slot === slot),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const working = useRef(false);
  const id = useRef<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working.current) return;
    const data = new FormData(event.currentTarget);
    const field = (key: string) => String(data.get(key) ?? "").trim();
    const price = field("price").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 100000) {
      setError(t("Unesi cijenu od 0 do 100.000 KM, s najviše dvije decimale."));
      return;
    }
    const [whole, fraction = ""] = price.split(".");
    id.current ??= crypto.randomUUID();
    const input: StayUnitInput = {
      id: unit?.id ?? id.current,
      expectedVersion: unit?.version ?? 0,
      name: field("name"),
      type: field("type") as StayUnit["type"],
      beds: Number(field("beds")),
      priceMinor: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
      description: field("description") || null,
      enabled: data.has("enabled"),
      ...(editedSlots === null ? {} : { photoSlots: slots }),
    };
    working.current = true;
    setSaving(true);
    setError("");
    try {
      await writeStay(`owner/${businessId}`, actor, input);
      saved();
    } catch (e) {
      setError(t(stayError(e)));
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      aria-label={unit ? t("Uredi jedinicu") : t("Nova jedinica")}
      onSubmit={save}
      className={common.form}
    >
      <h3>{unit ? t("Uredi jedinicu") : t("Nova jedinica")}</h3>
      <fieldset className={common.fields} disabled={saving}>
        <label className={common.full}>
          {t("Naziv jedinice")}
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={unit?.name}
            placeholder="npr. Apartman s balkonom"
          />
        </label>
        <label>
          {t("Vrsta smještaja")}
          <select name="type" defaultValue={unit?.type ?? "room"}>
            <option value="room">{t("Soba")}</option>
            <option value="apartment">{t("Apartman")}</option>
          </select>
        </label>
        <label>
          {t("Broj kreveta")}
          <input
            name="beds"
            type="number"
            required
            min={1}
            max={99}
            defaultValue={unit?.beds ?? 1}
          />
        </label>
        <label>
          {t("Cijena po noći (KM)")}
          <input
            name="price"
            inputMode="decimal"
            required
            defaultValue={unit ? (unit.priceMinor / 100).toFixed(2) : ""}
          />
        </label>
        <label className={common.full}>
          {t("Opis")} <small>(opcionalno)</small>
          <textarea
            name="description"
            maxLength={1000}
            rows={2}
            defaultValue={unit?.description ?? ""}
          />
        </label>
        <fieldset className={common.photoChoice}>
          <legend>{t("Fotografije jedinice")}</legend>
          {mediaOnReview && <p>{t("Novu fotografiju možeš odabrati nakon odobrenja.")}</p>}
          {photos.map((p) => (
            <label key={p.slot}>
              <input
                type="checkbox"
                aria-label={`Fotografija ${p.slot}`}
                checked={slots.includes(p.slot)}
                onChange={(e) =>
                  setSlots(
                    e.currentTarget.checked
                      ? [...slots, p.slot]
                      : slots.filter((slot) => slot !== p.slot),
                  )
                }
              />
              <Image
                alt=""
                unoptimized
                width={84}
                height={56}
                src={businessMediaUrl(businessId, p, "mine")}
              />
            </label>
          ))}
          <button type="button" className={common.secondary} onClick={onPhotos}>
            {t("Upravljaj fotografijama")}
          </button>
        </fieldset>
        <label className={common.checkbox}>
          <input type="checkbox" name="enabled" defaultChecked={unit?.enabled ?? true} />{" "}
          {t("Primaj zahtjeve za ovu jedinicu")}
        </label>
        <div className={common.actions}>
          <button className={common.primary} type="submit">
            {saving ? t("Spremanje…") : t("Sačuvaj jedinicu")}
          </button>
          <button className={common.secondary} type="button" onClick={cancel}>
            {t("Odustani")}
          </button>
        </div>
      </fieldset>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function UnitPhotos({
  unit,
  photos,
  owner,
}: {
  unit: StayUnit;
  photos: BusinessMediaAsset[];
  owner: boolean;
}) {
  const t = useT();
  const available = unit.photoSlots.flatMap((slot) => photos.filter((p) => p.slot === slot));
  const [selected, setSelected] = useState<number | null>(null);
  const main = available.find((p) => p.slot === selected) ?? available[0];
  if (!main) return null;
  const url = (photo: BusinessMediaAsset) =>
    businessMediaUrl(unit.businessId, photo, owner ? "mine" : "public");
  return (
    <section className={styles.gallery} aria-label={`Fotografije: ${unit.name}`}>
      <Image
        className={styles.cover}
        width={560}
        height={300}
        src={url(main)}
        alt={`${unit.name} · fotografija ${available.indexOf(main) + 1}`}
        unoptimized
      />
      {available.length > 1 && (
        <div className={styles.thumbnails}>
          {available.map((photo, index) => (
            <button
              type="button"
              key={photo.slot}
              aria-label={t("Prikaži fotografiju {number}", { number: index + 1 })}
              aria-pressed={photo.slot === main.slot}
              onClick={() => setSelected(photo.slot)}
            >
              <Image width={72} height={48} alt="" src={url(photo)} unoptimized />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function StayUnits({
  businessId,
  actor,
  businessTitle,
  photos = [],
  mediaOnReview = false,
  initialCatalog,
  onMediaChanged,
}: {
  businessId: string;
  actor?: string;
  businessTitle?: string;
  photos?: BusinessMediaAsset[];
  mediaOnReview?: boolean;
  initialCatalog?: StayCatalog;
  onMediaChanged?: (manifest: BusinessMediaManifest) => void;
}) {
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<StayUnit | null | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gallery, setGallery] = useState(false);
  const [currentPhotos, setCurrentPhotos] = useState<BusinessMediaAsset[] | null>(null);
  const cat = useStayRead<StayCatalog>(
    !actor && initialCatalog && revision === 0 ? null : (actor ? "owner/" : "public/") + businessId,
    actor,
    revision,
  );
  const retained = useRef<StayCatalog | null>(null);
  const last = cat?.data ?? (revision === 0 ? initialCatalog : undefined);
  if (cat?.error) retained.current = null;
  else if (last) retained.current = last;
  const data = last ?? (!cat?.error ? retained.current : null);
  const refresh = () => setRevision((v) => v + 1);
  async function archive(unit: StayUnit) {
    if (!actor || busy) return;
    setBusy(true);
    setError("");
    try {
      await writeStay(`archive/${businessId}/${unit.id}`, actor, {
        expectedVersion: unit.version,
      });
      setArchiving(null);
      setSelected(null);
      refresh();
    } catch (e) {
      setError(t(stayError(e)));
    } finally {
      setBusy(false);
    }
  }
  const assets = currentPhotos ?? photos;
  if (cat?.error)
    return (
      <p role="alert" className={common.error}>
        {cat.error}{" "}
        <button type="button" className={common.secondary} onClick={refresh}>
          {t("Pokušaj ponovo")}
        </button>
      </p>
    );
  if (!data) return actor ? <p role="status">{t("Dohvaćanje smještaja…")}</p> : null;
  if (!data.units.length && (!actor || !data.eligible)) return null;
  return (
    <section className={common.panel} aria-label={t("Smještajne jedinice")}>
      <div className={common.topline}>
        <h2>{t("Smještaj")}</h2>
        {actor && <span className={common.badge}>{data.units.length} / 2 jedinice</span>}
      </div>
      {actor && Boolean(data.upcoming?.length) && editor === undefined && (
        <div className={common.agenda}>
          <h3>{t("Zahtjevi za smještaj")}</h3>
          {data.upcoming?.map((entry) => (
            <StayEntry key={entry.id} owner actor={actor} entry={entry} changed={refresh} />
          ))}
        </div>
      )}
      {actor && data.eligible && editor === undefined && data.units.length < 2 && (
        <div className={common.actions}>
          <button
            type="button"
            className={common.primary}
            onClick={() => {
              setEditor(null);
              setError("");
            }}
          >
            {t("Dodaj jedinicu")}
          </button>
        </div>
      )}
      {actor && editor !== undefined ? (
        <UnitForm
          key={editor?.id ?? "new"}
          unit={editor ?? undefined}
          actor={actor}
          photos={assets}
          photosConfirmed={currentPhotos !== null}
          mediaOnReview={mediaOnReview}
          businessId={businessId}
          saved={() => {
            setEditor(undefined);
            setGallery(false);
            refresh();
          }}
          cancel={() => {
            setEditor(undefined);
            setGallery(false);
          }}
          onPhotos={() => setGallery((v) => !v)}
        />
      ) : (
        data.units.map((unit) => {
          const open = selected === unit.id;
          return (
            <article key={unit.id} className={common.card} aria-label={unit.name}>
              <UnitPhotos unit={unit} photos={assets} owner={!!actor} />
              <div className={common.topline}>
                <div className={common.carTitle}>
                  <h3 dir="auto">{unit.name}</h3>
                  <p>
                    {unit.type === "room" ? t("Soba") : t("Apartman")} · {unit.beds}{" "}
                    {unit.beds === 1 ? "krevet" : "kreveta"}
                  </p>
                </div>
                {actor && !unit.enabled && (
                  <span className={common.badge}>{t("Booking isključen")}</span>
                )}
              </div>
              {unit.description && <p dir="auto">{unit.description}</p>}
              <div className={common.topline}>
                <span className={common.rate}>
                  <strong>{bookingMoney(unit.priceMinor)}</strong> / noć
                </span>
                <button
                  type="button"
                  className={common.secondary}
                  aria-expanded={open}
                  onClick={() => {
                    setSelected(open ? null : unit.id);
                    setArchiving(null);
                    setError("");
                  }}
                >
                  <Icon name="calendar" />
                  {actor ? t("Kalendar") : t("Provjeri dostupnost")}
                </button>
              </div>
              {actor && (
                <div className={common.actions}>
                  {data.eligible && (
                    <button
                      type="button"
                      className={common.smallAction}
                      onClick={() => {
                        setEditor(unit);
                        setGallery(false);
                        setArchiving(null);
                      }}
                    >
                      {t("Uredi jedinicu")}
                    </button>
                  )}
                  {archiving !== unit.id ? (
                    <button
                      className={common.smallAction}
                      type="button"
                      onClick={() => {
                        setArchiving(unit.id);
                        setError("");
                      }}
                    >
                      {t("Arhiviraj")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={common.secondary}
                        onClick={() => void archive(unit)}
                      >
                        {t("Potvrdi arhiviranje")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={common.smallAction}
                        onClick={() => setArchiving(null)}
                      >
                        {t("Odustani")}
                      </button>
                    </>
                  )}
                </div>
              )}
              {open && (
                <StayCalendar
                  key={[unit.id, unit.version, actor ?? "public"].join(":")}
                  unit={unit}
                  catalogRevision={revision}
                  zone={data.timezone}
                  actor={actor}
                  allowNew={data.eligible && (!!actor || unit.enabled)}
                  changedOffer={refresh}
                  changedBookings={() => {
                    if (actor) refresh();
                  }}
                />
              )}
            </article>
          );
        })
      )}
      {gallery && actor && editor !== undefined && (
        <BusinessMediaManager
          businessId={businessId}
          businessTitle={businessTitle ?? ""}
          expectedAccountId={actor}
          onBack={() => setGallery(false)}
          onChanged={(manifest) => {
            const approved = inventoryMedia(manifest);
            if (approved) setCurrentPhotos(approved.gallery);
            onMediaChanged?.(manifest);
          }}
        />
      )}
      {error && (
        <p role="alert" className={common.error}>
          {error}
        </p>
      )}
    </section>
  );
}
