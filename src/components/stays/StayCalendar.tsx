"use client";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { accountSectionPath } from "../../lib/account-return";
import { bookingDate, bookingMoney, bookingMonth } from "../../lib/booking";
import { BookingRequestError, bookingAccountId } from "../../lib/booking-client";
import { addDays, dateKey } from "../../lib/booking-time";
import { lastArrivalDate, lastStayDate, stayCalendarMonth } from "../../lib/stay-calendar";
import { type StayIntent, StayRecoveryRequired, staySubmissions } from "../../lib/stay-submission";
import {
  type StayBooking,
  type StayInterval,
  type StayRequestInput,
  type StayUnit,
  stayNights,
  stayQuote,
} from "../../lib/stays";
import { Icon } from "../Icon";
import common from "../rentals/rentals.module.css";
import { StayEntry } from "./StayEntries";
import { stayError, useStayRead, writeStay } from "./stay-client";
import styles from "./stays.module.css";

const weekdays = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"];

export function StayCalendar({
  unit,
  zone,
  actor,
  catalogRevision,
  allowNew,
  changedOffer,
  changedBookings,
}: {
  unit: StayUnit;
  zone: string;
  actor?: string;
  catalogRevision: number;
  allowNew: boolean;
  changedOffer: () => void;
  changedBookings: () => void;
}) {
  const today = dateKey(new Date(), zone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [choosingEnd, setChoosingEnd] = useState(false);
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const [pending, setPending] = useState<StayIntent | null>(null);
  const frozen = working || !!pending;
  useEffect(() => {
    if (!staySubmissions.previouslyUsed()) return;
    let live = true;
    void (actor ? Promise.resolve(actor) : bookingAccountId())
      .then((account) => {
        const saved = staySubmissions.pending(account);
        if (!live || !saved) return;
        setPending(saved);
        if (saved.unitId === unit.id) {
          setArrival(saved.body.checkIn);
          setDeparture(saved.body.checkOut);
          setMonth(saved.body.checkIn.slice(0, 7));
          setDay(saved.body.checkIn);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [actor, unit.id]);
  const { first, end, next, previous, days, weekdayOffset } = stayCalendarMonth(month);
  const base = `${actor ? "owner" : "public"}/${unit.businessId}/${unit.id}`;
  const calendar = useStayRead<{ entries: (StayBooking | StayInterval)[] }>(
    `${base}/calendar?from=${first}&to=${end}`,
    actor,
    revision + catalogRevision,
  );
  const entries = calendar?.data?.entries ?? [];
  const active = entries.filter(
    (e) => !("status" in e) || e.status === "requested" || e.status === "confirmed",
  );
  const valid = arrival >= today && departure > arrival;
  const crossesMonth = valid && (arrival < first || departure > end);
  const extra = useStayRead<{ available: boolean }>(
    crossesMonth ? `${base}/availability?from=${arrival}&to=${departure}` : null,
    actor,
    revision + catalogRevision,
  );
  const occupied =
    valid &&
    (crossesMonth
      ? extra?.data?.available === false
      : active.some((e) => e.checkIn < departure && e.checkOut > arrival));
  const ready = !!calendar?.data && (!crossesMonth || !!extra?.data);
  const dayEntries = entries.filter((e) => e.checkIn <= day && e.checkOut > day);
  const nights = valid ? stayNights(arrival, departure) : 0;
  function browse(target: string | null) {
    if (!target) return;
    setMonth(target);
    setDay(target === today.slice(0, 7) ? today : `${target}-01`);
  }
  function clearMessage() {
    setNotice("");
    setError("");
    setLogin(false);
  }
  function selectDay(value: string) {
    setDay(value);
    clearMessage();
    if (value < today || !allowNew) return;
    if (choosingEnd && arrival && value > arrival) {
      setDeparture(value);
      setChoosingEnd(false);
    } else if (value <= lastArrivalDate) {
      setArrival(value);
      setDeparture("");
      setChoosingEnd(true);
    }
  }
  async function submit(e: FormEvent, recover = false) {
    e.preventDefault();
    if (
      writing.current ||
      (recover ? !pending : pending || !allowNew || !valid || !ready || occupied)
    )
      return;
    writing.current = true;
    setWorking(true);
    clearMessage();
    try {
      const account = actor ?? (await bookingAccountId());
      if (recover && pending && pending.account !== account)
        throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
      const send = (path: string, accountId: string, body: StayRequestInput) =>
        writeStay<{ entry: StayBooking }>(path, accountId, body);
      const receipt =
        recover && pending
          ? await staySubmissions.retry(pending, send)
          : await staySubmissions.submit(
              {
                account,
                businessId: unit.businessId,
                unitId: unit.id,
                kind: actor ? "block" : "customer",
                body: {
                  requestId: crypto.randomUUID(),
                  expectedUnitVersion: unit.version,
                  checkIn: arrival,
                  checkOut: departure,
                },
              },
              send,
            );
      setPending(null);
      if (receipt.unitId === unit.id) {
        setDay(receipt.checkIn);
        setMonth(receipt.checkIn.slice(0, 7));
      }
      setArrival("");
      setDeparture("");
      setChoosingEnd(false);
      setRevision((v) => v + 1);
      changedBookings();
      setNotice(
        recover
          ? "Prethodni zahtjev je potvrđen u evidenciji."
          : actor
            ? "Noći su označene kao zauzete."
            : "Zahtjev je poslan vlasniku.",
      );
    } catch (failure) {
      if (failure instanceof StayRecoveryRequired) {
        setPending(failure.intent);
        return;
      }
      if (recover && pending && !staySubmissions.pending(pending.account)) setPending(null);
      setError(stayError(failure));
      if (failure instanceof BookingRequestError) {
        if (failure.status === 401) setLogin(true);
        if (failure.status === 409) {
          setRevision((v) => v + 1);
          if (failure.code.includes("VERSION") || failure.code.includes("OFFER")) changedOffer();
        }
      }
    } finally {
      writing.current = false;
      setWorking(false);
    }
  }
  function retryRead() {
    setRevision((v) => v + 1);
  }
  return (
    <section className={common.calendar} aria-label={`Kalendar za ${unit.name}`}>
      <div className={common.columns}>
        <div className={common.dates}>
          <div className={common.month}>
            <button
              type="button"
              aria-label="Prethodni mjesec"
              disabled={frozen || !previous || (!actor && month <= today.slice(0, 7))}
              onClick={() => browse(previous)}
            >
              <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
            </button>
            <strong>{bookingMonth(month)}</strong>
            <button
              type="button"
              aria-label="Sljedeći mjesec"
              disabled={frozen || !next}
              onClick={() => browse(next)}
            >
              <Icon name="chevron" />
            </button>
          </div>
          <div className={common.days}>
            {weekdays.map((d) => (
              <small key={d}>{d}</small>
            ))}
            {weekdays.slice(0, weekdayOffset).map((weekday) => (
              <span key={weekday} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const value = `${month}-${String(i + 1).padStart(2, "0")}`;
              const taken = active.some((e) => e.checkIn <= value && e.checkOut > value);
              return (
                <button
                  type="button"
                  key={value}
                  className={styles.day}
                  aria-label={
                    bookingDate(`${value}T12:00:00Z`, "UTC") + (taken ? ", zauzeta noć" : "")
                  }
                  aria-current={value === today ? "date" : undefined}
                  aria-pressed={
                    value === arrival || value === departure || (!arrival && value === day)
                  }
                  data-between={
                    (arrival && departure && value > arrival && value < departure) || undefined
                  }
                  data-night-taken={taken || undefined}
                  disabled={frozen || (!actor && value < today)}
                  onClick={() => selectDay(value)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className={common.dayAgenda} aria-live="polite">
            {calendar?.error ? (
              <p role="alert">
                {calendar.error}{" "}
                <button type="button" className={common.smallAction} onClick={retryRead}>
                  Pokušaj ponovo
                </button>
              </p>
            ) : !calendar?.data ? (
              <p>Učitavanje kalendara…</p>
            ) : (
              <>
                <strong>{bookingDate(`${day}T12:00:00Z`, "UTC")}</strong>
                {actor && dayEntries.some((e) => "status" in e) ? (
                  dayEntries.map(
                    (e) =>
                      "status" in e && (
                        <StayEntry
                          key={e.id}
                          actor={actor}
                          owner
                          entry={e}
                          changed={() => {
                            retryRead();
                            changedBookings();
                          }}
                        />
                      ),
                  )
                ) : (
                  <p>
                    {active.some((e) => e.checkIn <= day && e.checkOut > day)
                      ? "Zauzeta noć"
                      : "Slobodna noć"}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {pending && (
          <section className={common.range} aria-label="Provjera prethodnog zahtjeva">
            <h4>Ishod zahtjeva još nije potvrđen.</h4>
            <p>
              {bookingDate(`${pending.body.checkIn}T12:00:00Z`, "UTC")} —{" "}
              {bookingDate(`${pending.body.checkOut}T12:00:00Z`, "UTC")}
            </p>
            <button
              type="button"
              className={common.primary}
              disabled={working}
              onClick={(e) => void submit(e, true)}
            >
              Provjeri isti zahtjev
            </button>
            <Link href={accountSectionPath("appointments")}>Moji termini</Link>
            {error && (
              <p role="alert" className={common.error}>
                {error}
              </p>
            )}
          </section>
        )}
        {allowNew && !pending && (
          <form className={common.range} onSubmit={submit}>
            <h4>{actor ? "Označi zauzete noći" : "Rezerviši smještaj"}</h4>
            <label>
              {actor ? "Od" : "Dolazak"}
              <input
                type="date"
                required
                min={today}
                max={lastArrivalDate}
                value={arrival}
                disabled={frozen}
                onChange={(e) => {
                  const date = e.target.value;
                  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > lastArrivalDate)) return;
                  setArrival(date);
                  if (date >= today) {
                    setDay(date);
                    setMonth(date.slice(0, 7));
                  }
                  if (!date || date >= departure) setDeparture("");
                  setChoosingEnd(true);
                  clearMessage();
                }}
              />
            </label>
            <label>
              {actor ? "Do" : "Odlazak"}
              <input
                type="date"
                required
                max={lastStayDate}
                min={arrival ? addDays(arrival, 1) : addDays(today, 1)}
                value={departure}
                disabled={frozen}
                onChange={(e) => {
                  if (e.target.value && !/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
                  setDeparture(e.target.value);
                  setChoosingEnd(false);
                  clearMessage();
                }}
              />
            </label>
            {arrival && departure && !valid && (
              <p role="status">Odlazak mora biti nakon dolaska.</p>
            )}
            {extra?.error && (
              <p role="alert">
                {extra.error}{" "}
                <button className={common.smallAction} type="button" onClick={retryRead}>
                  Pokušaj ponovo
                </button>
              </p>
            )}
            {occupied && (
              <p role="status" className={common.error}>
                Smještaj je zauzet u tom periodu.
              </p>
            )}
            {!actor && valid && (
              <div className={common.total}>
                <span>
                  Ukupno · {nights} {nights === 1 ? "noć" : "noći"}
                </span>
                <strong>{bookingMoney(stayQuote(unit.priceMinor, arrival, departure))}</strong>
              </div>
            )}
            <button
              className={common.primary}
              type="submit"
              disabled={frozen || !valid || !ready || occupied}
            >
              {working ? "Slanje…" : actor ? "Označi zauzeto" : "Pošalji zahtjev"}
            </button>
            {error && (
              <p role="alert" className={common.error}>
                {error}{" "}
                {login && (
                  <Link
                    href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${unit.businessId}#business-stays`)}`}
                  >
                    Prijava
                  </Link>
                )}
              </p>
            )}
            {notice && (
              <p role="status" className={common.success}>
                {notice}{" "}
                {!actor && <Link href={accountSectionPath("appointments")}>Moji termini</Link>}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
