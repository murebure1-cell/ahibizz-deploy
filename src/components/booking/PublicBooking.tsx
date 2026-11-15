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
  bookingAccountId,
  bookingActorRequest,
  bookingError,
  bookingRequest,
} from "../../lib/booking-client";
import { createBookingSubmission } from "../../lib/booking-submission";
import { addDays, dateKey } from "../../lib/booking-time";
import { Icon } from "../Icon";
import { CalendarDays } from "./CalendarDays";
import styles from "./public-booking.module.css";

type Props = {
  businessId: string;
  configuration: PublicBookingConfiguration;
  preview?: boolean;
  request?: typeof bookingRequest;
  expectedAccountId?: string;
};

export function PublicBooking(props: Props) {
  return (
    <BookingWorkspace
      key={`${props.businessId}:${props.expectedAccountId ?? "public"}`}
      {...props}
    />
  );
}

function BookingWorkspace({
  businessId,
  configuration: initialConfiguration,
  preview = false,
  request = bookingRequest,
  expectedAccountId,
}: Props) {
  const [configuration, setConfiguration] = useState(initialConfiguration),
    [changeNotice, setChangeNotice] = useState("");
  const prefix = useId(),
    [serviceId, setService] = useState(configuration.services[0]?.id ?? ""),
    [date, setDate] = useState(() => dateKey(new Date(), configuration.timezone)),
    [slots, setSlots] = useState<BookingSlot[]>([]),
    [selection, setSelection] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false),
    [done, setDone] = useState<BookingEntry | null>(null),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    live = useRef(false),
    needsConfiguration = useRef(false),
    submitting = useRef(false),
    submissionActor = useRef<string | null>(expectedAccountId ?? null),
    operation = useRef(createBookingSubmission(businessId));
  const api = useRef(request);
  api.current = request;
  const service = configuration.services.find((item) => item.id === serviceId);
  const today = dateKey(new Date(), configuration.timezone);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
    };
  }, []);
  const refreshConfiguration = useCallback(
    async (current: number, signal: AbortSignal) => {
      const result = await api.current(`businesses/${businessId}`, { signal });
      if (!live.current || signal.aborted || current !== revision.current) return;
      const next = result.booking as PublicBookingConfiguration;
      if (!next || !Number.isInteger(next.version) || !Array.isArray(next.services))
        throw new Error("invalid_booking_configuration");
      setSelection("");
      setSlots([]);
      setConfiguration(next);
      setService((selected) =>
        next.services.some((item) => item.id === selected)
          ? selected
          : (next.services[0]?.id ?? ""),
      );
      needsConfiguration.current = false;
      setChangeNotice("Usluga ili raspored su izmijenjeni. Provjeri novi odabir.");
    },
    [businessId],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    const current = ++revision.current,
      controller = new AbortController();
    if (
      uncertain ||
      !configuration.enabled ||
      !serviceId ||
      (preview && api.current === bookingRequest)
    )
      return;
    setLoading(true);
    setError("");
    setSelection("");
    setSlots([]);
    async function read() {
      try {
        if (needsConfiguration.current) {
          await refreshConfiguration(current, controller.signal);
          return;
        }
        const data = await api.current(
          `businesses/${businessId}/slots?${new URLSearchParams({ serviceId, date })}`,
          { signal: controller.signal },
        );
        if (!live.current || controller.signal.aborted || current !== revision.current) return;
        if (!Array.isArray(data.slots) || data.serviceId !== serviceId || data.date !== date)
          throw new Error("invalid_slots");
        if (data.configurationVersion !== configuration.version) {
          needsConfiguration.current = true;
          await refreshConfiguration(current, controller.signal);
          return;
        }
        setSlots(data.slots);
      } catch (failure) {
        if (!live.current || controller.signal.aborted || current !== revision.current) return;
        if (
          failure instanceof BookingRequestError &&
          ["BOOKING_SERVICE_NOT_FOUND", "BOOKING_DISABLED"].includes(failure.code)
        ) {
          needsConfiguration.current = true;
          try {
            await refreshConfiguration(current, controller.signal);
          } catch (refreshFailure) {
            if (live.current && !controller.signal.aborted && current === revision.current)
              setError(bookingError(refreshFailure));
          }
        } else {
          setError(bookingError(failure));
        }
      } finally {
        if (live.current && current === revision.current) setLoading(false);
      }
    }
    void read();
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
    uncertain,
  ]);
  if (!configuration.enabled || !service) return null;
  const selected = slots.find((item) => item.startsAt === selection);
  async function submit(retry = false) {
    if (
      submitting.current ||
      (!retry && (uncertain || !selected || !service)) ||
      (retry && !operation.current.uncertain) ||
      (preview && api.current === bookingRequest)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setLogin(false);
    try {
      let entry: BookingEntry;
      if (!retry) {
        submissionActor.current =
          expectedAccountId ??
          (!preview && api.current === bookingRequest ? await bookingAccountId() : null);
      }
      const submissionRequest = submissionActor.current
        ? bookingActorRequest(submissionActor.current, api.current)
        : api.current;
      if (retry) entry = await operation.current.retry(submissionRequest);
      else {
        if (!selected) return;
        entry = await operation.current.submit(
          { serviceId, startsAt: selected.startsAt, configurationVersion: configuration.version },
          submissionRequest,
        );
      }
      if (live.current) {
        setDone(entry);
        setUncertain(false);
      }
    } catch (failure) {
      if (!live.current) return;
      setLogin(
        failure instanceof BookingRequestError &&
          ["AUTHENTICATION_REQUIRED", "ACCOUNT_IDENTITY_CHANGED"].includes(failure.code),
      );
      setError(bookingError(failure));
      if (operation.current.uncertain) {
        setUncertain(true);
        setError("Slanje nije potvrđeno. Provjeri isti zahtjev ili otvori Moje termine.");
        return;
      }
      setUncertain(false);
      if (
        failure instanceof BookingRequestError &&
        ["BOOKING_CONFIGURATION_CHANGED", "BOOKING_SERVICE_NOT_FOUND", "BOOKING_DISABLED"].includes(
          failure.code,
        )
      ) {
        needsConfiguration.current = true;
        setSelection("");
        setSlots([]);
        setRefresh((value) => value + 1);
      }
      if (failure instanceof BookingRequestError && failure.code === "SLOT_UNAVAILABLE") {
        setRefresh((value) => value + 1);
      }
    } finally {
      submitting.current = false;
      if (live.current) setBusy(false);
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
              disabled={busy || uncertain}
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
            disabled={busy || uncertain}
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
                  disabled={busy || uncertain}
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
              <div className={styles.actions}>
                {uncertain && (
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => void submit(true)}
                  >
                    {busy ? "Provjera…" : "Provjeri isti zahtjev"}
                  </button>
                )}
                {login ? (
                  <Link
                    className={styles.secondary}
                    href={`/prijava?nastavi=${encodeURIComponent(`/djelatnosti/${businessId}#business-appointments`)}`}
                    target={uncertain ? "_blank" : undefined}
                    rel={uncertain ? "noopener" : undefined}
                  >
                    Prijavi se
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || uncertain}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    Osvježi termine
                  </button>
                )}
                <Link
                  className={styles.secondary}
                  target={uncertain ? "_blank" : undefined}
                  rel={uncertain ? "noopener" : undefined}
                  href={
                    preview ? "/pregled/prostor/nalog?odjeljak=termini" : "/nalog?odjeljak=termini"
                  }
                >
                  Moji termini
                </Link>
              </div>
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
            disabled={busy || uncertain || loading || !selected}
            onClick={() => void submit()}
          >
            {busy
              ? uncertain
                ? "Provjera…"
                : "Slanje…"
              : preview
                ? "Pošalji zahtjev u pregledu"
                : "Pošalji zahtjev za termin"}
          </button>
        </>
      )}
    </section>
  );
}
