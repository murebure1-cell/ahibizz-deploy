"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { accountSectionPath } from "../../lib/account-return";
import { appointmentMoment } from "../../lib/appointment-display";
import { bookingMoney, bookingShortDate } from "../../lib/booking";
import { BookingRequestError, bookingAccountId } from "../../lib/booking-client";
import { addDays, dateKey, localInstant } from "../../lib/booking-time";
import { type BusinessMediaAsset, businessMediaUrl } from "../../lib/business-media";
import {
  rentalDefaults,
  rentalInstant,
  rentalTimes,
  rentalUnits,
  rentalWhen,
  takenDays,
} from "../../lib/rental-request";
import {
  type RentalIntent,
  RentalRecoveryRequired,
  rentalSubmissions,
} from "../../lib/rental-submission";
import {
  type RentalCatalog,
  type RentalInterval,
  type RentalVehicle,
  rentalQuote,
} from "../../lib/rentals";
import panel from "../booking/booking-panel.module.css";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { rentalError, useRentalRead, writeRental } from "./rental-client";
import { rentalFuels, rentalGears } from "./rental-labels";
import styles from "./rental-request.module.css";

type Photo = Pick<BusinessMediaAsset, "slot" | "kind" | "version" | "width" | "height">;
type When = { pickup: string; dropoff: string };

/** What a price is counted in, as it stands after the amount: "80,00 KM / 24 h". */
const per = { hour: "1 h", day: "24 h" } as const;

/**
 * One of the two moments: its day opens the device's own calendar, its hour is a list of half
 * hours. The day is written in the app's words, so the field that opens the calendar lies over
 * it, unseen.
 */
function Moment({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  /** "2026-11-27T09:00", or empty before the first offer is ready. */
  value: string;
  min: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const day = value.slice(0, 10);
  const hour = value.slice(11, 16);
  return (
    <div className={styles.when}>
      <label className={styles.day}>
        <span className={styles.dayLabel} aria-hidden="true">
          {label}
        </span>
        <strong className={styles.dayName} aria-hidden="true">
          {day ? bookingShortDate(day, locale) : "—"}
        </strong>
        <input
          type="date"
          aria-label={`${label}: ${t("Datum")}`}
          required
          disabled={disabled || !value}
          min={min}
          value={day}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker();
            } catch {
              // Without a calendar of its own the field still takes a typed date.
            }
          }}
          onChange={(event) => {
            if (event.target.value) onChange(`${event.target.value}T${hour || "09:00"}`);
          }}
        />
      </label>
      <label className={styles.hour}>
        <select
          aria-label={`${label}: ${t("Vrijeme")}`}
          disabled={disabled || !value}
          value={hour}
          onChange={(event) => onChange(`${day}T${event.target.value}`)}
        >
          {/* Before the first offer is ready the tile shows a dash, not the first hour. */}
          {!hour && <option value="">—</option>}
          {rentalTimes(hour).map((time) => (
            <option key={time} value={time}>
              {t("u {time}", { time })}
            </option>
          ))}
        </select>
        <Icon name="chevron" aria-hidden="true" />
      </label>
    </div>
  );
}

/**
 * Asking for a vehicle, as a visitor of the business's page sees it: which vehicle, from when
 * until when, what it comes to, and the button that sends the request. The owner marks taken
 * periods in the calendar of the vehicle instead (RentalCalendar).
 */
export function RentalRequest({
  businessId,
  catalog,
  photos = [],
  catalogRevision,
  onChangedOffer,
  onUncertain,
  useRead = useRentalRead,
  write = writeRental,
  account = bookingAccountId,
}: {
  businessId: string;
  catalog: RentalCatalog;
  photos?: Photo[];
  catalogRevision: number;
  /** The offer is no longer what was shown: read it again. */
  onChangedOffer: () => void;
  /** A request whose outcome is not known is handed to the recovery around this screen. */
  onUncertain: (intent: RentalIntent) => void;
  /** The three below are replaced only by the local preview, which has no server. */
  useRead?: typeof useRentalRead;
  write?: typeof writeRental;
  account?: () => Promise<string>;
}) {
  const { t, locale } = useI18n();
  const zone = catalog.timezone;
  const [carId, setCarId] = useState(catalog.vehicles[0]?.id ?? "");
  const car: RentalVehicle | undefined =
    catalog.vehicles.find((item) => item.id === carId) ?? catalog.vehicles[0];
  // The first offer depends on today's date, so it is made on the device, after the page is
  // drawn: the server and the device may stand on two sides of midnight.
  const [today, setToday] = useState("");
  const [when, setWhen] = useState<When>({ pickup: "", dropoff: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    name: string;
    from: string;
    to: string;
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const [revision, setRevision] = useState(0);
  const writing = useRef(false);
  useEffect(() => {
    const day = dateKey(new Date(), zone);
    setToday(day);
    setWhen(rentalDefaults(day));
  }, [zone]);

  const from = rentalInstant(when.pickup, zone);
  const to = rentalInstant(when.dropoff, zone);
  const valid = Boolean(from && to && Date.parse(from) >= Date.now() && from < to);
  const base = car ? `public/${businessId}/${car.id}` : null;
  const availability = useRead<{ available: boolean }>(
    base && valid && from && to
      ? `${base}/availability?${new URLSearchParams({ from, to })}`
      : null,
    undefined,
    revision + catalogRevision,
  );
  const ahead = today
    ? { from: localInstant(today, 0, zone), to: localInstant(addDays(today, 180), 0, zone) }
    : null;
  const calendar = useRead<{ entries: RentalInterval[] }>(
    base && ahead?.from && ahead.to
      ? `${base}/calendar?${new URLSearchParams({ from: ahead.from, to: ahead.to })}`
      : null,
    undefined,
    revision + catalogRevision,
  );
  if (!car) return null;

  const occupied = valid && availability?.data?.available === false;
  const ready = Boolean(valid && availability?.data);
  const units = valid && from && to ? rentalUnits(car.priceUnit, from, to) : 0;
  const total = valid && from && to ? rentalQuote(car.priceMinor, car.priceUnit, from, to) : null;
  const taken = takenDays(calendar?.data?.entries ?? [], zone, today || "0000-00-00", locale);
  const change = (next: Partial<When>) => {
    setWhen((current) => rentalWhen(current, next));
    setError("");
  };

  async function submit() {
    if (!car || !valid || !from || !to || !ready || occupied || total === null || writing.current)
      return;
    writing.current = true;
    setBusy(true);
    setError("");
    setLogin(false);
    try {
      await rentalSubmissions.submit(
        {
          account: await account(),
          businessId,
          vehicleId: car.id,
          vehicleName: car.name,
          timezone: zone,
          kind: "customer",
          body: {
            requestId: crypto.randomUUID(),
            startsAt: from,
            endsAt: to,
            expectedVehicleVersion: car.version,
          },
        },
        write,
      );
      setDone({ name: car.name, from, to, total });
      setRevision((value) => value + 1);
    } catch (failure) {
      if (failure instanceof RentalRecoveryRequired) {
        onUncertain(failure.intent);
        return;
      }
      setError(t(rentalError(failure)));
      if (failure instanceof BookingRequestError) {
        if (failure.status === 401) setLogin(true);
        if (failure.status === 409) {
          setRevision((value) => value + 1);
          if (failure.code.includes("VERSION") || failure.code.includes("OFFER")) onChangedOffer();
        }
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const year = today.slice(0, 4) || undefined;
  return (
    <section className={panel.panel} aria-label={t("Najam vozila")} data-design="rental-request">
      <header className={panel.head}>
        <h2>{t("Najam vozila")}</h2>
      </header>
      {done ? (
        <div role="status" className={panel.done}>
          <span className={panel.doneMark} aria-hidden="true">
            <Icon name="check" />
          </span>
          <h3>{t("Zahtjev je poslan.")}</h3>
          <p className={panel.doneWhat} dir="auto">
            {done.name}
          </p>
          <p>
            {appointmentMoment(done.from, zone, locale, year)} –{" "}
            {appointmentMoment(done.to, zone, locale, year)}
          </p>
          <p>
            {bookingMoney(done.total)} · {t("Čeka potvrdu")}
          </p>
          <div className={panel.actions}>
            <Link className={panel.send} href={accountSectionPath("appointments")}>
              {t("Moji termini")}
            </Link>
            <button type="button" className={panel.minor} onClick={() => setDone(null)}>
              {t("Novi zahtjev")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={panel.group}>
            <div className={panel.groupHead}>
              <h3>{t("Vozilo")}</h3>
            </div>
            <div role="radiogroup" aria-label={t("Vozilo")} className={styles.vehicles}>
              {catalog.vehicles.map((item) => {
                const chosen = item.id === car.id;
                const photo = photos.find((image) => image.slot === item.photoSlot);
                const price = `${bookingMoney(item.priceMinor)} / ${per[item.priceUnit]}`;
                const make = `${item.brand} ${item.model}`.trim();
                return (
                  // biome-ignore lint/a11y/useSemanticElements: A vehicle is a card with a picture and details, which a native radio cannot hold.
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    className={styles.vehicle}
                    disabled={busy}
                    onClick={() => {
                      setCarId(item.id);
                      setError("");
                    }}
                  >
                    <span className={styles.row}>
                      <span className={styles.picture} aria-hidden="true">
                        {photo ? (
                          <Image
                            src={businessMediaUrl(businessId, photo, "public")}
                            width={104}
                            height={104}
                            alt=""
                            unoptimized
                          />
                        ) : (
                          <Icon name="car" />
                        )}
                      </span>
                      <span className={styles.name}>
                        <strong dir="auto">{item.name}</strong>
                        {chosen
                          ? price
                          : `${t(rentalFuels[item.fuel])} · ${t(rentalGears[item.transmission])} · ${price}`}
                      </span>
                      <span className={styles.mark} aria-hidden="true">
                        <Icon name="check" />
                      </span>
                    </span>
                    {chosen && (
                      <span className={styles.chips}>
                        {make && !item.name.toLowerCase().includes(make.toLowerCase()) && (
                          <span dir="auto">{make}</span>
                        )}
                        <span>{t(rentalFuels[item.fuel])}</span>
                        <span>{t(rentalGears[item.transmission])}</span>
                        {item.year && <span>{item.year}.</span>}
                        <span>{t("{count} sjedišta", { count: item.seats })}</span>
                      </span>
                    )}
                    {chosen && item.description && (
                      <span className={styles.about} dir="auto">
                        {item.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={panel.group}>
            <div className={panel.groupHead}>
              <h3>{t("Kada")}</h3>
            </div>
            <div className={styles.whens}>
              <Moment
                label={t("Preuzimanje")}
                value={when.pickup}
                min={today}
                disabled={busy}
                onChange={(pickup) => change({ pickup })}
              />
              <Moment
                label={t("Vraćanje")}
                value={when.dropoff}
                min={when.pickup.slice(0, 10) || today}
                disabled={busy}
                onChange={(dropoff) => change({ dropoff })}
              />
            </div>
            {taken.periods.length > 0 && (
              <p className={panel.note}>
                {t("Zauzeto: {periods}", {
                  periods: `${taken.periods.join(", ")}${taken.more ? "…" : ""}`,
                })}
              </p>
            )}
            {when.pickup && when.dropoff && !valid && (
              <p role="status" className={panel.note}>
                {!from || !to
                  ? t("Izaberi drugi sat zbog promjene vremena.")
                  : t("Početak mora biti u budućnosti, a kraj nakon početka.")}
              </p>
            )}
            {occupied && (
              <p role="status" className={styles.taken}>
                {t("Automobil je zauzet u tom periodu.")}
              </p>
            )}
          </div>
          {(error || (valid && availability?.error)) && (
            <div role="alert" className={panel.error}>
              <p>{error || availability?.error}</p>
              <div className={panel.actions}>
                {login ? (
                  <Link
                    className={panel.minor}
                    href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${businessId}#business-rentals`)}`}
                  >
                    {t("Prijavi se")}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={panel.minor}
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setRevision((value) => value + 1);
                    }}
                  >
                    {t("Pokušaj ponovo")}
                  </button>
                )}
              </div>
            </div>
          )}
          {total !== null && (
            <dl className={panel.summary}>
              <div>
                <dt dir="auto">{car.name}</dt>
                <dd>
                  {units} × {per[car.priceUnit]}
                </dd>
              </div>
              <div>
                <dt>{t("Cijena")}</dt>
                <dd>
                  {bookingMoney(car.priceMinor)} / {per[car.priceUnit]}
                </dd>
              </div>
              <div className={panel.total}>
                <dt>{t("Ukupno")}</dt>
                <dd>{bookingMoney(total)}</dd>
              </div>
            </dl>
          )}
          <p className={panel.note}>
            {car.priceUnit === "hour"
              ? t("Obračun po započetom satu.")
              : t("Obračun po započeta 24 sata.")}{" "}
            {t("Plaćaš kod djelatnosti. U aplikaciji nema plaćanja.")}{" "}
            {t("Tvoje ime i email dijele se s vlasnikom radi dogovora.")}
          </p>
          <div className={panel.foot}>
            <button
              type="button"
              className={panel.send}
              disabled={busy || !ready || occupied || total === null}
              onClick={() => void submit()}
            >
              {busy ? t("Slanje…") : t("Pošalji zahtjev")}
            </button>
            <p className={panel.note}>
              {t("Zahtjev odmah zauzima vozilo. Vlasnik ga potvrđuje ili odbija.")}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
