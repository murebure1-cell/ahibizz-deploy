"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type BookingEntry,
  type BookingSlot,
  bookingDate,
  bookingMoney,
  bookingStatusLabels,
  type PublicBookingConfiguration,
} from "../../lib/booking";
import {
  BookingRequestError,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import { addDays, dateKey } from "../../lib/booking-time";
import { Icon } from "../Icon";
import { CalendarDays } from "./CalendarDays";
import styles from "./public-booking.module.css";

export function PublicBooking({
  businessId,
  configuration: initialConfiguration,
  preview = false,
  request = bookingRequest,
}: {
  businessId: string;
  configuration: PublicBookingConfiguration;
  preview?: boolean;
  request?: typeof bookingRequest;
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration),
    [changeNotice, setChangeNotice] = useState("");
  const prefix = useId(),
    [serviceId, setService] = useState(configuration.services[0]?.id ?? ""),
    [date, setDate] = useState(() => dateKey(new Date(), configuration.timezone)),
    [slots, setSlots] = useState<BookingSlot[]>([]),
    [selection, setSelection] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false),
    [done, setDone] = useState<BookingEntry | null>(null),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    submitting = useRef(false),
    operation = useRef<{ body: string; key: string } | null>(null);
  const api = useRef(request);
  api.current = request;
  const service = configuration.services.find((item) => item.id === serviceId);
  const today = dateKey(new Date(), configuration.timezone);
  const refreshConfiguration = useCallback(
    async (current?: number) => {
      const result = await api.current(`businesses/${businessId}`);
      if (current !== undefined && current !== revision.current) return;
      const next = result.booking as PublicBookingConfiguration;
      if (!next || !Number.isInteger(next.version) || !Array.isArray(next.services))
        throw new Error("invalid_booking_configuration");
      setSelection("");
      setConfiguration(next);
      if (!next.services.some((item) => item.id === serviceId))
        setService(next.services[0]?.id ?? "");
      setChangeNotice("Usluga ili raspored su izmijenjeni. Provjeri novi odabir.");
    },
    [businessId, serviceId],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    const current = ++revision.current,
      controller = new AbortController();
    if (!configuration.enabled || !serviceId || (preview && api.current === bookingRequest)) return;
    setLoading(true);
    setError("");
    setSelection("");
    setSlots([]);
    void api
      .current(`businesses/${businessId}/slots?${new URLSearchParams({ serviceId, date })}`, {
        signal: controller.signal,
      })
      .then(async (data) => {
        if (current !== revision.current) return;
        if (!Array.isArray(data.slots) || data.serviceId !== serviceId || data.date !== date)
          throw new Error("invalid_slots");
        if (data.configurationVersion !== configuration.version) {
          await refreshConfiguration(current);
          return;
        }
        setSlots(data.slots);
      })
      .catch((failure) => {
        if (!controller.signal.aborted && current === revision.current)
          setError(bookingError(failure));
      })
      .finally(() => {
        if (current === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [
    businessId,
    configuration.enabled,
    configuration.version,
    date,
    serviceId,
    refresh,
    preview,
    refreshConfiguration,
  ]);
  if (!configuration.enabled || !service) return null;
  const selected = slots.find((item) => item.startsAt === selection);
  async function submit() {
    if (submitting.current || !selected || !service || (preview && api.current === bookingRequest))
      return;
    const body = {
        serviceId,
        startsAt: selected.startsAt,
        configurationVersion: configuration.version,
      },
      serialized = JSON.stringify(body);
    if (operation.current?.body !== serialized)
      operation.current = { body: serialized, key: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    setError("");
    setLogin(false);
    try {
      const data = await api.current(
        `businesses/${businessId}/requests`,
        bookingWrite("POST", body, operation.current.key),
      );
      if (
        data.entry?.businessId !== businessId ||
        data.entry?.kind !== "customer" ||
        data.entry?.startsAt !== selected.startsAt
      )
        throw new Error("unconfirmed_request");
      setDone(data.entry);
      operation.current = null;
    } catch (failure) {
      setLogin(
        failure instanceof BookingRequestError && failure.code === "AUTHENTICATION_REQUIRED",
      );
      setError(bookingError(failure));
      if (
        failure instanceof BookingRequestError &&
        failure.code === "BOOKING_CONFIGURATION_CHANGED"
      ) {
        operation.current = null;
        try {
          await refreshConfiguration();
        } catch {
          setError("Raspored nije dostupan. Otvori profil ponovo.");
        }
      }
      if (!(failure instanceof BookingRequestError) || failure.status >= 500)
        setError("Slanje nije potvrđeno. Provjeri Moje termine prije novog zahtjeva.");
      if (failure instanceof BookingRequestError && failure.code === "BOOKING_DISABLED") {
        setSelection("");
        setSlots([]);
      }
      if (failure instanceof BookingRequestError && failure.code === "SLOT_UNAVAILABLE") {
        operation.current = null;
        setRefresh((value) => value + 1);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const moment = (value: string) => bookingDate(value, configuration.timezone, { time: true });
  return (
    <section className={styles.booking} aria-label="Zakazivanje termina">
      <header className={styles.heading}>
        <span>
          <Icon name="calendar" />
        </span>
        <div>
          <p>{preview ? "Proba bez stvarnog zakazivanja" : "Booking"}</p>
          <h2>Zakaži termin</h2>
        </div>
      </header>
      {done ? (
        <div role="status" className={styles.success}>
          <Icon name="check" />
          <h3>{preview ? "Zahtjev je sačuvan u pregledu." : "Zahtjev je poslan."}</h3>
          <strong>{done.serviceName}</strong>
          <p>{moment(done.startsAt)}</p>
          <p>{bookingStatusLabels[done.status]}</p>
          <Link
            href={preview ? "/pregled/prostor/nalog?odjeljak=termini" : "/nalog?odjeljak=termini"}
          >
            Moji termini
          </Link>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setRefresh((value) => value + 1);
            }}
          >
            Izaberi drugi termin
          </button>
        </div>
      ) : (
        <>
          {changeNotice && (
            <p role="status" className={styles.note}>
              {changeNotice}
            </p>
          )}
          <label className={styles.label} htmlFor={`${prefix}-service`}>
            Usluga
            <select
              id={`${prefix}-service`}
              value={serviceId}
              disabled={busy}
              onChange={(event) => {
                setService(event.target.value);
                setLogin(false);
                setChangeNotice("");
              }}
            >
              {configuration.services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.durationMinutes} min · {bookingMoney(item.priceMinor)}
                </option>
              ))}
            </select>
          </label>
          <CalendarDays
            date={date}
            onChange={(next) => {
              setDate(next);
              setLogin(false);
            }}
            minDate={today}
            maxDate={addDays(today, 90)}
            disabled={busy}
          />
          <div className={styles.timeHeading}>
            <h3>Slobodni termini</h3>
            <span>{configuration.timezone}</span>
          </div>
          {loading ? (
            <p role="status" className={styles.note}>
              Provjeravam termine…
            </p>
          ) : !error && slots.length === 0 ? (
            <p className={styles.note}>Za ovaj dan nema slobodnih termina.</p>
          ) : (
            <fieldset className={styles.times} aria-label="Odaberi slobodan termin">
              {slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  aria-pressed={selection === slot.startsAt}
                  disabled={busy}
                  onClick={() => {
                    setSelection(slot.startsAt);
                    setError("");
                  }}
                >
                  {new Intl.DateTimeFormat("en-GB-u-nu-latn", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                    timeZone: configuration.timezone,
                  }).format(new Date(slot.startsAt))}
                </button>
              ))}
            </fieldset>
          )}
          {error && (
            <div role="alert" className={styles.error}>
              <p>{error}</p>
              {login ? (
                <Link
                  href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${businessId}#business-appointments`)}`}
                >
                  Prijavi se
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    Osvježi termine
                  </button>
                  <Link
                    href={
                      preview
                        ? "/pregled/prostor/nalog?odjeljak=termini"
                        : "/nalog?odjeljak=termini"
                    }
                  >
                    Moji termini
                  </Link>
                </>
              )}
            </div>
          )}
          <div className={styles.total}>
            <span>{service.durationMinutes} min</span>
            <strong>{bookingMoney(service.priceMinor)}</strong>
          </div>
          {selected && <p className={styles.summary}>{moment(selected.startsAt)}</p>}
          <p className={styles.note}>
            {preview
              ? "Sve ostaje u ovom probnom pregledu."
              : "Tvoje ime i email dijele se s vlasnikom radi dogovora."}
          </p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || loading || !selected}
            onClick={() => void submit()}
          >
            {busy
              ? "Slanje…"
              : preview
                ? "Pošalji zahtjev u pregledu"
                : "Pošalji zahtjev za termin"}
          </button>
        </>
      )}
    </section>
  );
}
