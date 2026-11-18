"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { initialLocationPoint } from "../../lib/business-location";
import { profileCountries } from "../../lib/people";
import { Icon } from "../Icon";
import styles from "./directory.module.css";
import { LocationPicker } from "./LocationPicker";

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  vehicleRental?: boolean;
};
export function hasRentalCategory(categories: CategoryOption[], root: string, sub?: string | null) {
  return categories.some((c) => c.vehicleRental === true && (c.id === root || c.id === sub));
}
export type BusinessFields = {
  bookingEnabled?: boolean;
  title: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
};
export function BusinessEditor({
  initial,
  categories,
  busy,
  onSave,
  onCancel,
  canPublish = false,
  preview = false,
  currentStatus,
  bookingEnabled,
  onDirty,
}: {
  initial?: Partial<BusinessFields>;
  categories: CategoryOption[];
  busy: boolean;
  onSave: (fields: BusinessFields, publish: boolean) => void;
  onCancel: () => void;
  canPublish?: boolean;
  preview?: boolean;
  currentStatus?: "draft" | "pending" | "published" | "archived";
  bookingEnabled?: boolean;
  onDirty?: () => void;
}) {
  const prefix = useId();
  const [category, setCategory] = useState(initial?.categoryId ?? "");
  const [subcategory, setSubcategory] = useState(initial?.subcategoryId ?? "");
  const [point, setPoint] = useState(() =>
    initialLocationPoint(initial?.latitude, initial?.longitude),
  );
  const [locationPending, setLocationPending] = useState(false);
  const [address, setAddress] = useState(initial?.addressLine ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [country, setCountry] = useState(initial?.countryCode ?? "");
  const knownBooking = bookingEnabled ?? (preview ? (initial?.bookingEnabled ?? false) : undefined);
  const rentsCars = hasRentalCategory(categories, category, subcategory);
  const [bookingChoice, setBookingChoice] = useState(knownBooking);
  const bookingDirty = useRef(false);
  useEffect(() => {
    if (knownBooking !== undefined && !bookingDirty.current) setBookingChoice(knownBooking);
  }, [knownBooking]);
  const roots = categories.filter((item) => item.parentId === null);
  const children = categories.filter((item) => item.parentId === category);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locationPending) return;
    const data = new FormData(event.currentTarget);
    const read = (name: string) => String(data.get(name) ?? "").trim();
    const optional = (name: string) => read(name) || null;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    onSave(
      {
        title: read("title"),
        categoryId: category,
        subcategoryId: subcategory || null,
        description: optional("description"),
        contactEmail: optional("contactEmail"),
        contactPhone: optional("contactPhone"),
        websiteUrl: optional("websiteUrl"),
        addressLine: address.trim() || null,
        city: city.trim() || null,
        countryCode: country || null,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        ...(!rentsCars && knownBooking !== undefined && bookingChoice !== undefined
          ? { bookingEnabled: bookingChoice }
          : {}),
      },
      canPublish && submitter?.value !== "draft",
    );
  }
  return (
    <form
      onSubmit={submit}
      onChange={onDirty}
      className={styles.editor}
      aria-label="Podaci djelatnosti"
    >
      <fieldset disabled={busy}>
        <div className={styles.formHeading}>
          <span>
            <Icon name="shop" />
          </span>
          <div>
            <h2>{initial?.title ? "Uredi djelatnost" : "Predstavi svoj posao."}</h2>
          </div>
        </div>
        <label htmlFor={`${prefix}-title`}>
          Naziv djelatnosti
          <input
            id={`${prefix}-title`}
            name="title"
            defaultValue={initial?.title ?? ""}
            maxLength={120}
            required
            placeholder="Kako se zove tvoj posao?"
          />
        </label>
        <div className={styles.twoColumns}>
          <label htmlFor={`${prefix}-category`}>
            Kategorija
            <select
              id={`${prefix}-category`}
              value={category}
              required
              onChange={(event) => {
                setCategory(event.target.value);
                setSubcategory("");
              }}
            >
              <option value="">Izaberi kategoriju</option>
              {roots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${prefix}-subcategory`}>
            Podkategorija
            <select
              id={`${prefix}-subcategory`}
              value={subcategory}
              onChange={(event) => setSubcategory(event.target.value)}
              disabled={!category || children.length === 0}
            >
              <option value="">
                {children.length ? "Izaberi podkategoriju" : "Bez podkategorije"}
              </option>
              {children.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label htmlFor={`${prefix}-description`}>
          O tvom poslu
          <textarea
            id={`${prefix}-description`}
            name="description"
            rows={4}
            defaultValue={initial?.description ?? ""}
            maxLength={4000}
            placeholder="Ukratko opiši šta nudiš."
          />
        </label>
        <div className={styles.formDivider}>
          <Icon name="phone" />
          <h3>Kontakt</h3>
        </div>
        <div className={styles.twoColumns}>
          <label htmlFor={`${prefix}-phone`}>
            Telefon
            <input
              id={`${prefix}-phone`}
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              defaultValue={initial?.contactPhone ?? ""}
              maxLength={40}
              placeholder="+387…"
            />
          </label>
          <label htmlFor={`${prefix}-email`}>
            Poslovni email
            <input
              id={`${prefix}-email`}
              name="contactEmail"
              type="email"
              autoComplete="email"
              defaultValue={initial?.contactEmail ?? ""}
              maxLength={254}
              placeholder="kontakt@…"
            />
          </label>
        </div>
        <label htmlFor={`${prefix}-website`}>
          Web stranica
          <input
            id={`${prefix}-website`}
            name="websiteUrl"
            type="url"
            pattern="https://.*"
            defaultValue={initial?.websiteUrl ?? ""}
            maxLength={1000}
            placeholder="https://…"
          />
        </label>
        <div className={styles.formDivider}>
          <Icon name="pin" />
          <h3>Lokacija</h3>
        </div>
        <LocationPicker
          value={point}
          disabled={busy}
          onPending={setLocationPending}
          onChange={(selection) => {
            onDirty?.();
            setPoint(selection.point);
            if (selection.address) {
              setAddress(selection.address.addressLine ?? "");
              setCity(selection.address.city ?? "");
              setCountry(selection.address.countryCode ?? "");
            }
          }}
        />
        <fieldset disabled={locationPending}>
          <label htmlFor={`${prefix}-address`}>
            Adresa
            <input
              id={`${prefix}-address`}
              name="addressLine"
              autoComplete="street-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={200}
            />
          </label>
          <div className={styles.twoColumns}>
            <label htmlFor={`${prefix}-city`}>
              Grad
              <input
                id={`${prefix}-city`}
                name="city"
                autoComplete="address-level2"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                maxLength={100}
              />
            </label>
            <label htmlFor={`${prefix}-country`}>
              Država
              <select
                id={`${prefix}-country`}
                name="countryCode"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              >
                <option value="">Izaberi državu</option>
                {profileCountries.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
                {country && !profileCountries.some(([code]) => code === country) && (
                  <option value={country}>{country}</option>
                )}
              </select>
            </label>
          </div>
        </fieldset>
        {rentsCars && !initial && (
          <p>
            Nakon spremanja djelatnosti u odjeljku Automobili možeš dodati dva auta i uključiti
            online najam.
          </p>
        )}
        {!rentsCars && knownBooking !== undefined && (
          <div>
            <div className={styles.formDivider}>
              <Icon name="calendar" />
              <h3>Termini</h3>
            </div>
            <label htmlFor={`${prefix}-booking`}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                <input
                  id={`${prefix}-booking`}
                  type="checkbox"
                  style={{ width: 18, height: 18, minHeight: 18, padding: 0, flexShrink: 0 }}
                  checked={bookingChoice ?? knownBooking}
                  onChange={(event) => {
                    bookingDirty.current = event.target.checked !== knownBooking;
                    setBookingChoice(event.target.checked);
                  }}
                />{" "}
                Omogući online booking
              </span>
            </label>
            <p>Usluge i raspored postavljaš u svom kalendaru.</p>
          </div>
        )}
        <div className={styles.formActions}>
          <button
            type="submit"
            name="intent"
            value="publish"
            className={styles.primary}
            disabled={locationPending}
          >
            {busy
              ? "Spremanje…"
              : preview
                ? "Sačuvaj u pregledu"
                : currentStatus === "published"
                  ? canPublish
                    ? "Sačuvaj izmjene"
                    : "Pošalji izmjene na pregled"
                  : canPublish
                    ? "Sačuvaj i objavi"
                    : currentStatus === "pending"
                      ? "Sačuvaj izmjene"
                      : "Sačuvaj nacrt"}
          </button>
          {canPublish && !preview && currentStatus !== "published" && (
            <button
              type="submit"
              name="intent"
              value="draft"
              className={styles.secondary}
              disabled={locationPending}
            >
              {currentStatus === "pending" ? "Sačuvaj izmjene" : "Sačuvaj nacrt"}
            </button>
          )}
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Odustani
          </button>
        </div>
      </fieldset>
    </form>
  );
}
