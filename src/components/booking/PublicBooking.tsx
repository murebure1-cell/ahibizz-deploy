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
import { type BookingQuote, createBookingSubmission } from "../../lib/booking-submission";
import { addDays, dateKey } from "../../lib/booking-time";
import { createPublicBookingOffer } from "../../lib/public-booking-offer";
import { Icon } from "../Icon";
import { CalendarDays } from "./CalendarDays";
import styles from "./public-booking.module.css";

type Props = {
  businessId: string;
  configuration: PublicBookingConfiguration | null;
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
  const [offers] = useState(() => createPublicBookingOffer(initialConfiguration));
  const [offer, setOffer] = useState(offers.applied),
    [changeNotice, setChangeNotice] = useState("");
  const configuration = offer.configuration;
  const prefix = useId(),
    [serviceId, setService] = useState(configuration?.services[0]?.id ?? ""),
    [date, setDate] = useState(() => dateKey(new Date(), configuration?.timezone ?? "UTC")),
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
    submissionRequest = useRef<typeof bookingRequest | null>(null),
    readController = useRef<AbortController | null>(null),
    appliedOffer = useRef(offer),
    receipt = useRef(done),
    operation = useRef(createBookingSubmission(businessId));
  const api = useRef(request);
  api.current = request;
  receipt.current = done;
  const service = configuration?.services.find((item) => item.id === serviceId);
  const today = dateKey(new Date(), configuration?.timezone ?? "UTC");
  const canBook = offer.available && configuration?.enabled && Boolean(service);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      revision.current++;
      readController.current?.abort();
    };
  }, []);
  const applyLatest = useCallback(() => {
    const next = offers.apply(
      submitting.current || operation.current.uncertain || receipt.current !== null,
    );
    if (next === appliedOffer.current) return;
    const previous = appliedOffer.current.configuration;
    appliedOffer.current = next;
    revision.current++;
    readController.current?.abort();
    needsConfiguration.current = false;
    setOffer(next);
    setSelection("");
    setSlots([]);
    setLoading(false);
    setError("");
    setLogin(false);
    setService((selected) =>
      next.configuration?.services.some((item) => item.id === selected)
        ? selected
        : (next.configuration?.services[0]?.id ?? ""),
    );
    if (next.configuration && previous?.timezone !== next.configuration.timezone)
      setDate(dateKey(new Date(), next.configuration.timezone));
    if (previous) setChangeNotice("Usluga ili raspored su izmijenjeni. Provjeri novi odabir.");
  }, [offers]);
  const receiveProps = useCallback(() => {
    if (!offers.receive(initialConfiguration)) return;
    revision.current++;
    readController.current?.abort();
    needsConfiguration.current = false;
    setLoading(false);
    applyLatest();
  }, [initialConfiguration, offers, applyLatest]);
  useEffect(() => {
    receiveProps();
  }, [receiveProps]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Settled command state releases a queued offer, never the operation or its original request.
  useEffect(() => {
    applyLatest();
  }, [busy, uncertain, done, applyLatest]);
  const refreshConfiguration = useCallback(
    async (current: number, offerRevision: number, signal: AbortSignal) => {
      const result = await request(`businesses/${businessId}`, { signal });
      if (
        !live.current ||
        signal.aborted ||
        current !== revision.current ||
        offerRevision !== offers.latest.revision
      )
        return;
      const next = result.booking as PublicBookingConfiguration;
      if (!next || !Number.isInteger(next.version) || !Array.isArray(next.services))
        throw new Error("invalid_booking_configuration");
      needsConfiguration.current = false;
      if (offers.receiveRead(next, offerRevision)) applyLatest();
      setChangeNotice("Usluga ili raspored su izmijenjeni. Provjeri novi odabir.");
    },
    [businessId, request, offers, applyLatest],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    const current = ++revision.current,
      controller = new AbortController();
    readController.current = controller;
    const offerRevision = offers.latest.revision;
    const config = configuration;
    if (
      busy ||
      uncertain ||
      done ||
      !offer.available ||
      !config?.enabled ||
      !serviceId ||
      (preview && api.current === bookingRequest)
    )
      return;
    const configurationVersion = config.version;
    setLoading(true);
    setError("");
    setSelection("");
    setSlots([]);
    async function read() {
      try {
        if (needsConfiguration.current) {
          await refreshConfiguration(current, offerRevision, controller.signal);
          return;
        }
        const data = await request(
          `businesses/${businessId}/slots?${new URLSearchParams({ serviceId, date })}`,
          { signal: controller.signal },
        );
        if (!live.current || controller.signal.aborted || current !== revision.current) return;
        if (!Array.isArray(data.slots) || data.serviceId !== serviceId || data.date !== date)
          throw new Error("invalid_slots");
        if (data.configurationVersion !== configurationVersion) {
          needsConfiguration.current = true;
          await refreshConfiguration(current, offerRevision, controller.signal);
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
            await refreshConfiguration(current, offerRevision, controller.signal);
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
      if (readController.current === controller) readController.current = null;
    };
  }, [
    businessId,
    configuration?.enabled,
    configuration?.version,
    offer.available,
    offer.revision,
    date,
    serviceId,
    refresh,
    preview,
    refreshConfiguration,
    request,
    busy,
    uncertain,
    done,
  ]);
  const selected = slots.find((item) => item.startsAt === selection);
  async function submit(retry = false) {
    // A parent refresh can arrive before its effect. Never dispatch from that older render.
    receiveProps();
    const quote: BookingQuote | null =
      selected && service && configuration
        ? {
            serviceId,
            startsAt: selected.startsAt,
            configurationVersion: configuration.version,
          }
        : null;
    if (
      submitting.current ||
      (!retry && (uncertain || !quote || !offers.canDispatch(quote))) ||
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
        const transport = api.current;
        const offerRevision = offers.latest.revision;
        submissionActor.current =
          expectedAccountId ??
          (!preview && transport === bookingRequest ? await bookingAccountId() : null);
        if (!live.current) return;
        if (
          !quote ||
          api.current !== transport ||
          offerRevision !== offers.latest.revision ||
          !offers.canDispatch(quote)
        ) {
          setSelection("");
          setSlots([]);
          setChangeNotice("Usluga ili raspored su izmijenjeni. Provjeri novi odabir.");
          return;
        }
        submissionRequest.current = submissionActor.current
          ? bookingActorRequest(submissionActor.current, transport)
          : transport;
      }
      const transport = submissionRequest.current;
      if (!transport) throw new Error("missing_booking_request");
      if (retry) entry = await operation.current.retry(transport);
      else {
        if (!quote) return;
        entry = await operation.current.submit(quote, transport);
      }
      if (live.current) {
        receipt.current = entry;
        setDone(entry);
        setUncertain(false);
        setSelection("");
        setSlots([]);
        submissionRequest.current = null;
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
      submissionRequest.current = null;
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
  if (!done && !busy && !uncertain && !canBook) return null;
  const moment = (value: string, timezone = configuration?.timezone ?? "UTC") =>
    bookingDate(value, timezone, { time: true });
  return (
    <section
      className={styles.booking}
      aria-label="Zakazivanje termina"
      data-design="booking-panel"
    >
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
          <p>{moment(done.startsAt, done.timezone)}</p>
          <p>
            {done.durationMinutes} min · {bookingMoney(done.priceMinor)}
          </p>
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
              receipt.current = null;
              applyLatest();
              setRefresh((value) => value + 1);
            }}
          >
            Izaberi drugi termin
          </button>
        </div>
      ) : configuration && service ? (
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
                  data-design="booking-time"
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
      ) : null}
    </section>
  );
}
