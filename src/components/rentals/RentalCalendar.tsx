"use client";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { accountSectionPath } from "../../lib/account-return";
import { bookingDate, bookingMoney, bookingMonth } from "../../lib/booking";
import { BookingRequestError, bookingAccountId } from "../../lib/booking-client";
import { addDays, dateKey, localInstant } from "../../lib/booking-time";
import {
  type RentalIntent,
  RentalRecoveryRequired,
  rentalSubmissions,
} from "../../lib/rental-submission";
import {
  type RentalBooking,
  type RentalInterval,
  type RentalVehicle,
  rentalQuote,
} from "../../lib/rentals";
import { Icon } from "../Icon";
import { RentalEntry } from "./RentalEntries";
import { rentalError, useRentalRead, writeRental } from "./rental-client";
import styles from "./rentals.module.css";

function nextMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
function instant(value: string, zone: string) {
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)$/.exec(value);
  return match?.[1] ? localInstant(match[1], Number(match[2]) * 60 + Number(match[3]), zone) : null;
}

export function RentalCalendar({
  car,
  zone,
  actor,
  catalogRevision,
  allowNew = true,
  onChangedOffer,
  onUncertain,
}: {
  car: RentalVehicle;
  zone: string;
  actor?: string;
  catalogRevision: number;
  allowNew?: boolean;
  onChangedOffer: () => void;
  onUncertain: (intent: RentalIntent) => void;
}) {
  const today = dateKey(new Date(), zone);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const [revision, setRevision] = useState(0);
  const writing = useRef(false);
  const start = localInstant(`${month}-01`, 0, zone);
  const following = nextMonth(month, 1);
  const end = localInstant(`${following}-01`, 0, zone);
  const query = new URLSearchParams({ from: start ?? "", to: end ?? "" });
  const state = useRentalRead<{ entries: (RentalInterval | RentalBooking)[] }>(
    start && end
      ? `${actor ? "owner" : "public"}/${car.businessId}/${car.id}/calendar?${query}`
      : null,
    actor,
    revision + catalogRevision,
  );
  const entries = state?.data?.entries ?? [];
  const active = entries.filter(
    (entry) => !("status" in entry) || entry.status === "requested" || entry.status === "confirmed",
  );
  const onDay = (entry: RentalInterval, date: string) =>
    dateKey(new Date(entry.startsAt), zone) <= date &&
    dateKey(new Date(Date.parse(entry.endsAt) - 1), zone) >= date;
  const dayEntries = entries.filter((entry) => onDay(entry, selected));
  const from = instant(pickup, zone),
    to = instant(dropoff, zone);
  const valid = from && to && Date.parse(from) >= Date.now() && from < to;
  const beyondMonth = Boolean(valid && from && to && start && end && (from < start || to > end));
  const rangeQuery = new URLSearchParams({ from: from ?? "", to: to ?? "" });
  const extra = useRentalRead<{ available: boolean }>(
    beyondMonth
      ? `${actor ? "owner" : "public"}/${car.businessId}/${car.id}/availability?${rangeQuery}`
      : null,
    actor,
    revision + catalogRevision,
  );
  const rangeReady = Boolean(state?.data && (!beyondMonth || extra?.data));
  const occupied = beyondMonth
    ? extra?.data?.available === false
    : Boolean(
        valid && active.some((e) => e.startsAt < (to as string) && e.endsAt > (from as string)),
      );
  const total = valid
    ? rentalQuote(car.priceMinor, car.priceUnit, from as string, to as string)
    : null;
  function choose(day: string) {
    setSelected(day);
    if (day >= today) {
      const part = pickup.slice(11) || "09:00";
      setPickup(`${day}T${part}`);
      if (!dropoff || dropoff <= `${day}T${part}`) setDropoff(`${addDays(day, 1)}T${part}`);
    }
    setError("");
    setSuccess("");
  }
  function browse(delta: number) {
    const target = nextMonth(month, delta);
    setMonth(target);
    setSelected(target === today.slice(0, 7) ? today : `${target}-01`);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !from || !to || !rangeReady || occupied || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    setLogin(false);
    try {
      const account = actor ?? (await bookingAccountId());
      await rentalSubmissions.submit(
        {
          account,
          businessId: car.businessId,
          vehicleId: car.id,
          vehicleName: car.name,
          timezone: zone,
          kind: actor ? "block" : "customer",
          body: {
            requestId: crypto.randomUUID(),
            startsAt: from,
            endsAt: to,
            expectedVehicleVersion: car.version,
          },
        },
        writeRental,
      );
      setPickup("");
      setDropoff("");
      setSelected(dateKey(new Date(from), zone));
      setMonth(dateKey(new Date(from), zone).slice(0, 7));
      setRevision((v) => v + 1);
      if (actor) onChangedOffer();
      setSuccess(actor ? "Period je označen kao zauzet." : "Zahtjev je poslan vlasniku.");
    } catch (failure) {
      if (failure instanceof RentalRecoveryRequired) {
        onUncertain(failure.intent);
        return;
      }
      setError(rentalError(failure));
      if (failure instanceof BookingRequestError) {
        if (failure.status === 401) setLogin(true);
        if (failure.status === 409) {
          setRevision((v) => v + 1);
          if (failure.code.includes("VERSION") || failure.code.includes("OFFER")) onChangedOffer();
        }
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const count = Number(addDays(`${following}-01`, -1).slice(8));
  const weekday = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <section className={styles.calendar} aria-label={`Kalendar za ${car.name}`}>
      <div className={styles.topline}>
        <h3>Kalendar</h3>
        <span className={styles.muted}>{zone}</span>
      </div>
      <div className={styles.columns}>
        <div className={styles.dates}>
          <div className={styles.month}>
            <button
              type="button"
              aria-label="Prethodni mjesec"
              onClick={() => browse(-1)}
              disabled={busy || (!actor && month <= today.slice(0, 7))}
            >
              <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
            </button>
            <strong>{bookingMonth(month)}</strong>
            <button
              type="button"
              aria-label="Sljedeći mjesec"
              disabled={busy}
              onClick={() => browse(1)}
            >
              <Icon name="chevron" />
            </button>
          </div>
          <div className={styles.days}>
            {["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"].map((day) => (
              <small key={day}>{day}</small>
            ))}
            {Array.from({ length: weekday }, (_, i) => (
              <span key={`pad-${addDays(`${month}-01`, i - weekday)}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const day = `${month}-${String(i + 1).padStart(2, "0")}`,
                taken = active.some((entry) => onDay(entry, day));
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`${bookingDate(`${day}T12:00:00Z`, "UTC")}${taken ? ", ima zauzetih termina" : ""}`}
                  aria-current={day === today ? "date" : undefined}
                  aria-pressed={day === selected}
                  data-busy={taken || undefined}
                  disabled={busy || (!actor && day < today)}
                  onClick={() => choose(day)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className={styles.dayAgenda} aria-live="polite">
            <strong>{bookingDate(`${selected}T12:00:00Z`, "UTC")}</strong>
            {state?.error ? (
              <p role="alert">
                {state.error}{" "}
                <button
                  type="button"
                  className={styles.smallAction}
                  onClick={() => setRevision((v) => v + 1)}
                >
                  Pokušaj ponovo
                </button>
              </p>
            ) : !state?.data ? (
              <p>Dohvaćanje kalendara…</p>
            ) : dayEntries.length === 0 ? (
              <p>Nema zauzetih termina.</p>
            ) : (
              dayEntries.map((entry) =>
                actor && "status" in entry ? (
                  <RentalEntry
                    key={entry.id}
                    actor={actor}
                    owner
                    entry={entry}
                    changed={onChangedOffer}
                  />
                ) : (
                  <p key={entry.startsAt}>
                    Zauzeto · {bookingDate(entry.startsAt, zone, { time: true })} —{" "}
                    {bookingDate(entry.endsAt, zone, { time: true })}
                  </p>
                ),
              )
            )}
          </div>
        </div>
        {allowNew && (
          <form className={styles.range} onSubmit={submit}>
            <h4>{actor ? "Označi zauzeti period" : "Zatraži najam"}</h4>
            <label>
              {actor ? "Početak blokade" : "Preuzimanje"}
              <input
                type="datetime-local"
                required
                disabled={busy}
                min={`${today}T00:00`}
                value={pickup}
                onChange={(e) => {
                  setPickup(e.target.value);
                  setError("");
                  setSuccess("");
                  if (e.target.value) {
                    setMonth(e.target.value.slice(0, 7));
                    setSelected(e.target.value.slice(0, 10));
                  }
                }}
              />
            </label>
            <label>
              {actor ? "Kraj blokade" : "Vraćanje"}
              <input
                type="datetime-local"
                required
                disabled={busy}
                min={pickup || `${today}T00:00`}
                value={dropoff}
                onChange={(e) => {
                  setDropoff(e.target.value);
                  setError("");
                  setSuccess("");
                }}
              />
            </label>
            {pickup && dropoff && !valid && (
              <p role="status">
                {!from || !to
                  ? "Izaberi drugi sat zbog promjene vremena."
                  : "Početak mora biti u budućnosti, a kraj nakon početka."}
              </p>
            )}
            {beyondMonth && extra?.error && (
              <p role="alert">
                {extra.error}{" "}
                <button
                  type="button"
                  className={styles.smallAction}
                  onClick={() => setRevision((v) => v + 1)}
                >
                  Pokušaj ponovo
                </button>
              </p>
            )}
            {occupied && (
              <p role="status" className={styles.error}>
                Automobil je zauzet u tom periodu.
              </p>
            )}
            {!actor && total !== null && (
              <div className={styles.total}>
                <span>Ukupno</span>
                <strong>{bookingMoney(total)}</strong>
              </div>
            )}
            <button
              type="submit"
              className={styles.primary}
              disabled={!valid || !rangeReady || occupied || busy || (!actor && total === null)}
            >
              {busy ? "Slanje…" : actor ? "Označi zauzeto" : "Pošalji zahtjev"}
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}{" "}
                {login && (
                  <Link
                    href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${car.businessId}#business-rentals`)}`}
                  >
                    Prijava
                  </Link>
                )}
              </p>
            )}
            {success && (
              <p role="status" className={styles.success}>
                {success}{" "}
                {!actor && <Link href={accountSectionPath("appointments")}>Moji termini</Link>}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
