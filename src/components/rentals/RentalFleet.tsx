"use client";
import Image from "next/image";
import { type FormEvent, useRef, useState } from "react";
import { bookingMoney } from "../../lib/booking";
import { type BusinessMediaAsset, businessMediaUrl } from "../../lib/business-media";
import type { RentalIntent } from "../../lib/rental-submission";
import {
  RENTAL_BRANDS,
  type RentalCatalog,
  type RentalVehicle,
  type RentalVehicleInput,
} from "../../lib/rentals";
import { Icon } from "../Icon";
import { RentalCalendar } from "./RentalCalendar";
import { RentalEntry } from "./RentalEntries";
import { RentalRecovery } from "./RentalRecovery";
import { rentalError, useRentalRead, writeRental } from "./rental-client";
import styles from "./rentals.module.css";

const fuels = { petrol: "Benzin", diesel: "Dizel", hybrid: "Hibrid", electric: "Električni" };
const gears = { manual: "Manuelni", automatic: "Automatski" };
const units = { hour: "započeti sat", day: "započeta 24 sata" };
const paymentLabels = { hour: "Po započetom satu", day: "Po započeta 24 sata" };
type Photo = Pick<BusinessMediaAsset, "slot" | "kind" | "version" | "width" | "height">;

function VehicleForm({
  car,
  businessId,
  actor,
  photos,
  mediaOnReview,
  done,
  cancel,
}: {
  car?: RentalVehicle;
  businessId: string;
  actor: string;
  photos: Photo[];
  mediaOnReview?: boolean;
  done: () => void;
  cancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<number | null>(car?.photoSlot ?? null);
  const newId = useRef<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const field = (key: string) => String(data.get(key) ?? "").trim();
    const amount = field("price").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError("Unesi cijenu u KM, s najviše dvije decimale.");
      return;
    }
    const [marke, feninga = ""] = amount.split(".");
    newId.current ??= crypto.randomUUID();
    const input: RentalVehicleInput = {
      id: car?.id ?? newId.current,
      expectedVersion: car?.version ?? 0,
      name: field("name"),
      brand: field("brand"),
      model: field("model"),
      year: field("year") ? Number(field("year")) : null,
      seats: Number(field("seats")),
      fuel: field("fuel") as RentalVehicle["fuel"],
      transmission: field("transmission") as RentalVehicle["transmission"],
      description: field("description") || null,
      priceMinor: Number(marke) * 100 + Number(feninga.padEnd(2, "0")),
      priceUnit: field("unit") as RentalVehicle["priceUnit"],
      enabled: data.has("enabled"),
      photoSlot: photo,
    };
    setSaving(true);
    setError("");
    try {
      await writeRental(`owner/${businessId}`, actor, input);
      done();
    } catch (failure) {
      setError(rentalError(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className={styles.form}
      onSubmit={save}
      aria-label={car ? "Uredi automobil" : "Novi automobil"}
    >
      <h3>{car ? "Uredi automobil" : "Novi automobil"}</h3>
      <fieldset disabled={saving} className={styles.fields}>
        <label className={styles.full}>
          Naziv automobila
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={car?.name}
            placeholder="npr. Golf 8 Comfortline"
          />
        </label>
        <label>
          Marka
          <select aria-label="Marka" name="brand" required defaultValue={car?.brand ?? ""}>
            <option disabled value="">
              Odaberi marku
            </option>
            {RENTAL_BRANDS.map((brand) => (
              <option key={brand}>{brand}</option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input name="model" required maxLength={80} defaultValue={car?.model} />
        </label>
        <label>
          Gorivo
          <select aria-label="Gorivo" name="fuel" required defaultValue={car?.fuel ?? ""}>
            <option disabled value="">
              Odaberi gorivo
            </option>
            {Object.entries(fuels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mjenjač
          <select
            aria-label="Mjenjač"
            name="transmission"
            required
            defaultValue={car?.transmission ?? ""}
          >
            <option disabled value="">
              Odaberi mjenjač
            </option>
            {Object.entries(gears).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Broj sjedišta
          <input type="number" name="seats" required min={1} max={99} defaultValue={car?.seats} />
        </label>
        <label>
          Godište
          <input
            type="number"
            name="year"
            min={1886}
            max={new Date().getUTCFullYear() + 2}
            defaultValue={car?.year ?? ""}
          />
        </label>
        <label>
          Cijena (KM)
          <input
            name="price"
            inputMode="decimal"
            required
            defaultValue={car ? (car.priceMinor / 100).toFixed(2) : ""}
          />
        </label>
        <label>
          Obračun
          <select aria-label="Obračun" name="unit" required defaultValue={car?.priceUnit ?? ""}>
            <option disabled value="">
              Odaberi obračun
            </option>
            {Object.entries(paymentLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.full}>
          Opis <small>(opcionalno)</small>
          <textarea
            name="description"
            maxLength={1000}
            rows={2}
            defaultValue={car?.description ?? ""}
          />
        </label>
        {mediaOnReview && <p>Novu fotografiju možeš odabrati nakon odobrenja.</p>}
        {photos.length > 0 ? (
          <fieldset className={styles.photoChoice}>
            <legend>Fotografija automobila</legend>
            <label>
              <input
                type="radio"
                name="photo"
                checked={photo === null}
                onChange={() => setPhoto(null)}
              />{" "}
              Bez fotografije
            </label>
            {photos.map((asset) => (
              <label key={asset.slot}>
                <input
                  type="radio"
                  name="photo"
                  checked={photo === asset.slot}
                  aria-label={`Fotografija ${asset.slot}`}
                  onChange={() => setPhoto(asset.slot)}
                />
                <Image
                  width={84}
                  height={52}
                  unoptimized
                  alt={`Fotografija ${asset.slot}`}
                  src={businessMediaUrl(businessId, asset, "mine")}
                />
              </label>
            ))}
          </fieldset>
        ) : (
          <p className={styles.full}>
            {mediaOnReview
              ? "Automobil možeš sačuvati i bez fotografije."
              : "Fotografiju možeš dodati u galeriju djelatnosti i zatim odabrati ovdje."}
          </p>
        )}
        <label className={styles.checkbox}>
          <input name="enabled" type="checkbox" defaultChecked={car?.enabled ?? true} /> Primaj
          zahtjeve za ovaj automobil
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary}>
            {saving ? "Spremanje…" : "Sačuvaj automobil"}
          </button>
          <button type="button" className={styles.secondary} onClick={cancel}>
            Odustani
          </button>
        </div>
      </fieldset>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

type FleetProps = {
  businessId: string;
  actor?: string;
  photos?: Photo[];
  mediaOnReview?: boolean;
  initialCatalog?: RentalCatalog;
  onPhotos?: () => void;
};
export function RentalFleet(props: FleetProps) {
  return (
    <RentalRecovery
      key={`${props.actor ?? "public"}:${props.businessId}`}
      actor={props.actor}
      businessId={props.businessId}
    >
      {(onUncertain) => <FleetContent {...props} onUncertain={onUncertain} />}
    </RentalRecovery>
  );
}
function FleetContent({
  businessId,
  actor,
  photos = [],
  mediaOnReview,
  initialCatalog,
  onPhotos,
  onUncertain,
}: FleetProps & {
  onUncertain: (intent: RentalIntent) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<RentalVehicle | null | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const state = useRentalRead<RentalCatalog>(
    initialCatalog && !actor && revision === 0
      ? null
      : `${actor ? "owner" : "public"}/${businessId}`,
    actor,
    revision,
  );
  const data = state?.data ?? (!actor && !state && revision === 0 ? initialCatalog : undefined);
  function refresh() {
    setRevision((v) => v + 1);
  }
  async function archive(car: RentalVehicle) {
    if (!actor || working) return;
    setWorking(true);
    setError("");
    try {
      await writeRental(`archive/${businessId}/${car.id}`, actor, { expectedVersion: car.version });
      setArchiveId(null);
      setSelected(null);
      refresh();
    } catch (failure) {
      setError(rentalError(failure));
    } finally {
      setWorking(false);
    }
  }
  if (!state && !data)
    return actor ? (
      <p className={styles.muted} role="status">
        Dohvaćanje automobila…
      </p>
    ) : null;
  if (!data)
    return (
      <p role="alert" className={styles.error}>
        {state?.error}{" "}
        <button type="button" className={styles.secondary} onClick={refresh}>
          Pokušaj ponovo
        </button>
      </p>
    );
  if (!actor && !data.vehicles.length) return null;
  if (actor && !data.eligible && !data.vehicles.length) return null;
  return (
    <section className={styles.panel} aria-label="Automobili za najam">
      <div className={styles.topline}>
        <h2>{actor ? "Automobili" : "Automobili za najam"}</h2>
        {actor && <span className={styles.badge}>{data.vehicles.length} / 2 automobila</span>}
      </div>
      {actor && editor === undefined && Boolean(data.upcoming?.length) && (
        <div className={styles.agenda}>
          <h3>Zahtjevi za najam</h3>
          {data.upcoming?.map((entry) => (
            <RentalEntry key={entry.id} entry={entry} owner actor={actor} changed={refresh} />
          ))}
        </div>
      )}
      {actor && editor === undefined && data.eligible && (
        <div className={styles.actions}>
          {data.vehicles.length < 2 && (
            <button type="button" className={styles.primary} onClick={() => setEditor(null)}>
              Dodaj automobil
            </button>
          )}
          {onPhotos && (
            <button type="button" className={styles.secondary} onClick={onPhotos}>
              Galerija djelatnosti
            </button>
          )}
        </div>
      )}
      {actor && editor !== undefined ? (
        <VehicleForm
          key={editor?.id ?? "new"}
          car={editor ?? undefined}
          businessId={businessId}
          actor={actor}
          photos={photos}
          mediaOnReview={mediaOnReview}
          done={() => {
            setEditor(undefined);
            refresh();
          }}
          cancel={() => setEditor(undefined)}
        />
      ) : (
        data.vehicles.map((car) => {
          const photo = photos.find((image) => image.slot === car.photoSlot);
          const open = selected === car.id;
          return (
            <article key={car.id} className={styles.card}>
              <div className={styles.carHeader}>
                {photo ? (
                  <Image
                    className={styles.carPhoto}
                    src={businessMediaUrl(businessId, photo, actor ? "mine" : "public")}
                    width={112}
                    height={80}
                    alt={car.name}
                    unoptimized
                  />
                ) : (
                  <div className={styles.carIcon}>
                    <Icon name="car" />
                  </div>
                )}
                <div className={styles.carTitle}>
                  <h3>{car.name}</h3>
                  <p>
                    {car.brand} {car.model}
                    {car.year ? ` · ${car.year}` : ""}
                  </p>
                </div>
                {actor && !car.enabled && <span className={styles.badge}>Najam isključen</span>}
              </div>
              <p className={styles.specs}>
                {fuels[car.fuel]} · {gears[car.transmission]} · {car.seats} sjedišta
              </p>
              {car.description && <p>{car.description}</p>}
              <div className={styles.topline}>
                <span className={styles.rate}>
                  <strong>{bookingMoney(car.priceMinor)}</strong> / {units[car.priceUnit]}
                </span>
                <button
                  className={styles.secondary}
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    setSelected(open ? null : car.id);
                    setError("");
                    setArchiveId(null);
                  }}
                >
                  <Icon name="calendar" /> {actor ? "Kalendar" : "Provjeri dostupnost"}
                </button>
              </div>
              {actor && (
                <div className={styles.actions}>
                  {data.eligible && (
                    <button
                      type="button"
                      className={styles.smallAction}
                      onClick={() => {
                        setEditor(car);
                        setArchiveId(null);
                      }}
                    >
                      Uredi automobil
                    </button>
                  )}
                  {archiveId !== car.id ? (
                    <button
                      type="button"
                      className={styles.smallAction}
                      onClick={() => {
                        setArchiveId(car.id);
                        setError("");
                      }}
                    >
                      Arhiviraj
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={working}
                        className={styles.secondary}
                        onClick={() => void archive(car)}
                      >
                        Potvrdi arhiviranje
                      </button>
                      <button
                        type="button"
                        disabled={working}
                        className={styles.smallAction}
                        onClick={() => setArchiveId(null)}
                      >
                        Odustani
                      </button>
                    </>
                  )}
                </div>
              )}
              {open && (
                <RentalCalendar
                  key={`${car.id}:${car.version}:${actor ?? "public"}`}
                  car={car}
                  zone={data.timezone}
                  actor={actor}
                  allowNew={data.eligible}
                  onChangedOffer={refresh}
                  onUncertain={onUncertain}
                />
              )}
            </article>
          );
        })
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
