"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { initialLocationPoint } from "../../lib/business-location";
import { categoryIcon } from "../../lib/home";
import { countryLabel, profileCountries } from "../../lib/people";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./directory.module.css";
import { LocationPicker } from "./LocationPicker";
import { PublishBar, PublishHead, PublishIntro, publishStyles } from "./PublishSteps";

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  vehicleRental?: boolean;
  accommodation?: boolean;
};
export function hasRentalCategory(categories: CategoryOption[], root: string, sub?: string | null) {
  return categories.some((c) => c.vehicleRental === true && (c.id === root || c.id === sub));
}
export function hasStayCategory(categories: CategoryOption[], root: string, sub?: string | null) {
  return categories.some((c) => c.accommodation === true && (c.id === root || c.id === sub));
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

/**
 * The data of a business. An existing business is edited in one form. A new one is entered in
 * three steps (what it does, its basic data, where it is) that save a draft; the photographs and
 * the preview follow in the manager once that draft exists.
 */
export function BusinessEditor({
  initial,
  categories,
  busy,
  onSave,
  onCancel,
  canPublish = false,
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
  currentStatus?: "draft" | "pending" | "published" | "archived";
  bookingEnabled?: boolean;
  onDirty?: () => void;
}) {
  const { t, locale } = useI18n();
  const prefix = useId();
  const creating = !initial;
  const [step, setStep] = useState(1);
  const [problem, setProblem] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState(initial?.categoryId ?? "");
  const [subcategory, setSubcategory] = useState(initial?.subcategoryId ?? "");
  const [point, setPoint] = useState(() =>
    initialLocationPoint(initial?.latitude, initial?.longitude),
  );
  const [locationPending, setLocationPending] = useState(false);
  const [address, setAddress] = useState(initial?.addressLine ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [country, setCountry] = useState(initial?.countryCode ?? "");
  const knownBooking = bookingEnabled;
  const rentsCars = hasRentalCategory(categories, category, subcategory);
  const offersStays = hasStayCategory(categories, category, subcategory);
  const [bookingChoice, setBookingChoice] = useState(knownBooking);
  const bookingDirty = useRef(false);
  useEffect(() => {
    if (knownBooking !== undefined && !bookingDirty.current) setBookingChoice(knownBooking);
  }, [knownBooking]);
  // A new step starts at its top, not where the previous one was left.
  useEffect(() => {
    if (creating && step > 1) form.current?.scrollIntoView({ block: "start" });
  }, [creating, step]);
  const roots = categories.filter((item) => item.parentId === null);
  const children = categories.filter((item) => item.parentId === category);
  const pair = creating ? publishStyles.pair : styles.twoColumns;
  function forward() {
    setProblem("");
    if (step === 1 && !category) {
      setProblem(t("Izaberi kategoriju."));
      return;
    }
    if (step === 2) {
      const fields = form.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '[data-step="2"] :is(input, textarea)',
      );
      for (const field of fields ?? []) if (!field.reportValidity()) return;
    }
    setStep(step + 1);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locationPending) return;
    // Enter in a field of an earlier step moves on; only the last step saves.
    if (creating && step < 3) {
      forward();
      return;
    }
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
        ...(!rentsCars && !offersStays && knownBooking !== undefined && bookingChoice !== undefined
          ? { bookingEnabled: bookingChoice }
          : {}),
      },
      canPublish && submitter?.value !== "draft",
    );
  }

  const titleField = (
    <label htmlFor={`${prefix}-title`}>
      {t("Naziv djelatnosti")}
      <input
        id={`${prefix}-title`}
        name="title"
        defaultValue={initial?.title ?? ""}
        maxLength={120}
        required
        placeholder={t("Kako se zove tvoj posao?")}
      />
    </label>
  );
  const descriptionField = (
    <label htmlFor={`${prefix}-description`}>
      {t("O tvom poslu")}
      <textarea
        id={`${prefix}-description`}
        name="description"
        rows={4}
        defaultValue={initial?.description ?? ""}
        maxLength={4000}
        placeholder={t("Ukratko opiši šta nudiš.")}
      />
    </label>
  );
  const contactFields = (
    <div className={pair}>
      <label htmlFor={`${prefix}-phone`}>
        {t("Telefon")}
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
        {t("Poslovni email")}
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
  );
  const websiteField = (
    <label htmlFor={`${prefix}-website`}>
      {t("Web stranica")}
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
  );
  const placeFields = (
    <>
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
      <fieldset disabled={locationPending} className={creating ? publishStyles.fields : undefined}>
        <label htmlFor={`${prefix}-address`}>
          {t("Adresa")}
          <input
            id={`${prefix}-address`}
            name="addressLine"
            autoComplete="street-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            maxLength={200}
          />
        </label>
        <div className={pair}>
          <label htmlFor={`${prefix}-city`}>
            {t("Grad")}
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
            {t("Država")}
            <select
              id={`${prefix}-country`}
              name="countryCode"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              <option value="">{t("Izaberi državu")}</option>
              {profileCountries.map(([code]) => (
                <option key={code} value={code}>
                  {countryLabel(code, locale)}
                </option>
              ))}
              {country && !profileCountries.some(([code]) => code === country) && (
                <option value={country}>{country}</option>
              )}
            </select>
          </label>
        </div>
      </fieldset>
    </>
  );
  const afterSaving = (
    <>
      {rentsCars && creating && (
        <p className={creating ? publishStyles.note : undefined}>
          {t(
            "Nakon spremanja djelatnosti u odjeljku Automobili možeš dodati dva auta i uključiti online najam.",
          )}
        </p>
      )}
      {offersStays && creating && (
        <p className={creating ? publishStyles.note : undefined}>
          {t("Nakon spremanja u odjeljku Smještaj možeš dodati dvije sobe ili apartmana.")}
        </p>
      )}
    </>
  );
  const bookingToggle = !rentsCars && !offersStays && knownBooking !== undefined && (
    <>
      <label htmlFor={`${prefix}-booking`} className={creating ? publishStyles.check : undefined}>
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
          {t("Omogući online booking")}
        </span>
      </label>
      <p className={creating ? publishStyles.note : undefined}>
        {t("Usluge i raspored postavljaš u svom kalendaru.")}
      </p>
    </>
  );

  if (creating)
    return (
      <form
        ref={form}
        onSubmit={submit}
        onChange={onDirty}
        className={`${publishStyles.flow} ${publishStyles.form}`}
        aria-label={t("Podaci djelatnosti")}
        data-publish-flow=""
        noValidate={step < 3}
      >
        <fieldset disabled={busy}>
          <PublishHead step={step} onClose={onCancel} />
          <div className={publishStyles.step} hidden={step !== 1}>
            <PublishIntro
              title={t("Čime se baviš?")}
              text={t("Po kategoriji te ljudi nalaze u pretrazi.")}
            />
            <div className={publishStyles.tiles}>
              {roots.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  onClick={() => {
                    setCategory(item.id);
                    setSubcategory("");
                    setProblem("");
                    onDirty?.();
                  }}
                >
                  <Icon name={categoryIcon(item.name)} />
                  <span>{item.name}</span>
                  {category === item.id && <Icon name="check" />}
                </button>
              ))}
            </div>
            {children.length > 0 && (
              <fieldset className={publishStyles.kinds}>
                <legend>{t("Podkategorija")}</legend>
                {children.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={subcategory === item.id}
                    onClick={() => {
                      setSubcategory(subcategory === item.id ? "" : item.id);
                      onDirty?.();
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
          <div className={publishStyles.step} hidden={step !== 2} data-step="2">
            <PublishIntro
              title={t("Osnovni podaci")}
              text={t("Ovo ljudi prvo vide na tvojoj kartici.")}
            />
            <div className={publishStyles.fields}>
              {titleField}
              {descriptionField}
              {contactFields}
              {websiteField}
            </div>
          </div>
          <div className={publishStyles.step} hidden={step !== 3}>
            <PublishIntro
              title={t("Gdje te ljudi nalaze?")}
              text={t("Upiši adresu, pa provjeri mjesto na mapi.")}
            />
            {placeFields}
            {afterSaving}
            {bookingToggle}
          </div>
          {problem && (
            <p role="alert" className={publishStyles.problem}>
              {problem}
            </p>
          )}
          <PublishBar>
            {step > 1 && (
              <button type="button" data-kind="back" onClick={() => setStep(step - 1)}>
                {t("Nazad")}
              </button>
            )}
            {step < 3 ? (
              <button type="button" onClick={forward}>
                {t("Dalje")}
              </button>
            ) : (
              <>
                {canPublish && (
                  <button
                    type="submit"
                    name="intent"
                    value="publish"
                    data-kind="back"
                    disabled={locationPending}
                  >
                    {t("Sačuvaj i objavi")}
                  </button>
                )}
                <button type="submit" name="intent" value="draft" disabled={locationPending}>
                  {busy ? t("Spremanje…") : t("Dalje")}
                </button>
              </>
            )}
          </PublishBar>
        </fieldset>
      </form>
    );

  return (
    <form
      onSubmit={submit}
      onChange={onDirty}
      className={styles.editor}
      aria-label={t("Podaci djelatnosti")}
    >
      <fieldset disabled={busy}>
        <div className={styles.formHeading}>
          <span>
            <Icon name="shop" />
          </span>
          <div>
            <h2>{initial?.title ? t("Uredi djelatnost") : t("Predstavi svoj posao.")}</h2>
          </div>
        </div>
        {titleField}
        <div className={styles.twoColumns}>
          <label htmlFor={`${prefix}-category`}>
            {t("Kategorija")}
            <select
              id={`${prefix}-category`}
              value={category}
              required
              onChange={(event) => {
                setCategory(event.target.value);
                setSubcategory("");
              }}
            >
              <option value="">{t("Izaberi kategoriju")}</option>
              {roots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${prefix}-subcategory`}>
            {t("Podkategorija")}
            <select
              id={`${prefix}-subcategory`}
              value={subcategory}
              onChange={(event) => setSubcategory(event.target.value)}
              disabled={!category || children.length === 0}
            >
              <option value="">
                {children.length ? t("Izaberi podkategoriju") : t("Bez podkategorije")}
              </option>
              {children.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {descriptionField}
        <div className={styles.formDivider}>
          <Icon name="phone" />
          <h3>{t("Kontakt")}</h3>
        </div>
        {contactFields}
        {websiteField}
        <div className={styles.formDivider}>
          <Icon name="pin" />
          <h3>{t("Lokacija")}</h3>
        </div>
        {placeFields}
        {bookingToggle && (
          <div>
            <div className={styles.formDivider}>
              <Icon name="calendar" />
              <h3>{t("Termini")}</h3>
            </div>
            {bookingToggle}
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
              ? t("Spremanje…")
              : currentStatus === "published"
                ? canPublish
                  ? t("Sačuvaj izmjene")
                  : t("Pošalji izmjene na pregled")
                : canPublish
                  ? t("Sačuvaj i objavi")
                  : currentStatus === "pending"
                    ? t("Sačuvaj izmjene")
                    : t("Sačuvaj nacrt")}
          </button>
          {canPublish && currentStatus !== "published" && (
            <button
              type="submit"
              name="intent"
              value="draft"
              className={styles.secondary}
              disabled={locationPending}
            >
              {currentStatus === "pending" ? t("Sačuvaj izmjene") : t("Sačuvaj nacrt")}
            </button>
          )}
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {t("Odustani")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
