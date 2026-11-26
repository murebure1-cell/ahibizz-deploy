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
import { appointmentAction, CancelAppointment, OwnerAgenda } from "../booking/AppointmentCard";
import { BusinessMediaManager } from "../directory/BusinessMediaManager";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import common from "../rentals/rentals.module.css";
import { Switch } from "../ui/Switch";
import { StayCalendar } from "./StayCalendar";
import { StayEntry } from "./StayEntries";
import { StayRequest } from "./StayRequest";
import { stayError, useStayRead, writeStay } from "./stay-client";
import { bedsText, unitKinds } from "./stay-labels";
import owner from "./stay-owner.module.css";

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
  /** Online booking of one unit on or off; the rest of the unit stays as it is. */
  async function toggle(unit: StayUnit, enabled: boolean) {
    if (!actor || busy) return;
    setBusy(true);
    setError("");
    try {
      const input: StayUnitInput = {
        id: unit.id,
        expectedVersion: unit.version,
        name: unit.name,
        type: unit.type,
        beds: unit.beds,
        priceMinor: unit.priceMinor,
        description: unit.description,
        enabled,
      };
      await writeStay(`owner/${businessId}`, actor, input);
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
  // A visitor books on the screen drawn for that; what follows is the owner's side.
  if (!actor)
    return (
      <StayRequest
        businessId={businessId}
        catalog={data}
        photos={assets}
        catalogRevision={revision}
        onChangedOffer={refresh}
      />
    );
  const shown = data.units.find((unit) => unit.id === selected) ?? data.units[0];
  return (
    <section className={common.panel} aria-label={t("Sobe i apartmani")} data-design="stay-units">
      <div className={owner.head}>
        <h2>{t("Sobe i apartmani")}</h2>
        <span className={owner.count}>
          {t("{count} od {limit}", { count: data.units.length, limit: 2 })}
        </span>
      </div>
      {actor && Boolean(data.upcoming?.length) && editor === undefined && (
        <OwnerAgenda
          entries={data.upcoming ?? []}
          holds={t("Zahtjev već drži te noći. Odbijanje ih odmah oslobađa.")}
        >
          {(entry) => (
            <StayEntry key={entry.id} owner actor={actor} entry={entry} changed={refresh} />
          )}
        </OwnerAgenda>
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
        <>
          <div className={owner.units}>
            {data.units.map((unit) => {
              const cover = unit.photoSlots
                .map((slot) => assets.find((photo) => photo.slot === slot))
                .find(Boolean);
              return (
                <article key={unit.id} className={owner.unit} aria-label={unit.name}>
                  <div className={owner.row}>
                    <span className={owner.picture} aria-hidden="true">
                      {cover ? (
                        <Image
                          src={businessMediaUrl(unit.businessId, cover, "mine")}
                          width={104}
                          height={104}
                          alt=""
                          unoptimized
                        />
                      ) : (
                        <Icon name="bed" />
                      )}
                    </span>
                    <span className={owner.name}>
                      <strong dir="auto">{unit.name}</strong>
                      {t(unitKinds[unit.type])} · {t(bedsText(unit.beds), { count: unit.beds })}
                      <span className={owner.price}>
                        {bookingMoney(unit.priceMinor)} / {t("noć")}
                      </span>
                    </span>
                    <span className={owner.controls}>
                      <Switch
                        checked={unit.enabled}
                        disabled={busy || !data.eligible}
                        label={t("Online booking za {name}", { name: unit.name })}
                        onChange={(next) => void toggle(unit, next)}
                      />
                      {data.eligible && (
                        <button
                          type="button"
                          className={owner.edit}
                          onClick={() => {
                            setEditor(unit);
                            setGallery(false);
                            setArchiving(null);
                          }}
                        >
                          {t("Uredi")}
                        </button>
                      )}
                    </span>
                  </div>
                  {archiving === unit.id ? (
                    <div className={owner.archive}>
                      <CancelAppointment
                        label={t("Arhiviraj")}
                        disabled={busy}
                        onConfirm={() => void archive(unit)}
                      />
                      <button
                        type="button"
                        className={appointmentAction}
                        disabled={busy}
                        onClick={() => setArchiving(null)}
                      >
                        {t("Odustani")}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {data.eligible && data.units.length >= 2 && (
            <p className={owner.limit}>{t("Dosegnut je broj jedinica za ovu djelatnost.")}</p>
          )}
          {shown && (
            <section className={owner.occupancy} aria-label={t("Zauzetost")}>
              <div className={owner.head}>
                <h3>{t("Zauzetost")}</h3>
                {data.units.length > 1 ? (
                  <span className={owner.pills}>
                    {data.units.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        aria-pressed={unit.id === shown.id}
                        onClick={() => setSelected(unit.id)}
                      >
                        {unit.name}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className={owner.count}>{shown.name}</span>
                )}
              </div>
              <StayCalendar
                key={[shown.id, shown.version, actor].join(":")}
                unit={shown}
                catalogRevision={revision}
                zone={data.timezone}
                actor={actor}
                allowNew={data.eligible}
                changedOffer={refresh}
                changedBookings={refresh}
              />
              <button
                type="button"
                className={owner.quiet}
                onClick={() => setArchiving(archiving === shown.id ? null : shown.id)}
              >
                {t("Arhiviraj {name}", { name: shown.name })}
              </button>
            </section>
          )}
        </>
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
