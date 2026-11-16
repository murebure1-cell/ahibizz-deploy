"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BookingEntry,
  type BookingListView,
  bookingDate,
  bookingMoney,
  bookingStatusLabels,
} from "../../lib/booking";
import {
  bookingAccessDenied,
  bookingActorRequest,
  bookingError,
  bookingRequest,
  bookingWrite,
} from "../../lib/booking-client";
import {
  type CustomerAppointmentsState,
  customerAppointmentCancelled,
  customerAppointmentsFailed,
  readCustomerCancellation,
  reconcileCustomerCancellations,
} from "../../lib/customer-appointments-state";
import { Icon } from "../Icon";
import styles from "./public-booking.module.css";

type Props = {
  active?: boolean;
  heading?: boolean;
  preview?: boolean;
  request?: typeof bookingRequest;
  expectedAccountId?: string;
};

export function CustomerAppointments(props: Props) {
  return <AppointmentsWorkspace key={props.expectedAccountId ?? "unavailable"} {...props} />;
}

function AppointmentsWorkspace({
  active = true,
  heading = true,
  preview = false,
  request = bookingRequest,
  expectedAccountId,
}: Props) {
  const [readState, setReadState] = useState<CustomerAppointmentsState>({
      result: null,
      requiresLogin: false,
    }),
    [view, setView] = useState<BookingListView>("upcoming"),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    authority = useRef(0),
    live = useRef(false),
    controllers = useRef(new Set<AbortController>()),
    writing = useRef(false),
    cancellations = useRef(new Map<string, BookingEntry>()),
    api = useMemo(
      () => bookingActorRequest(expectedAccountId, request),
      [expectedAccountId, request],
    );
  const clearPrivate = useCallback((failure: unknown) => {
    authority.current++;
    revision.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    writing.current = false;
    cancellations.current.clear();
    setReadState({ result: null, requiresLogin: true });
    setNotice("");
    setError(bookingError(failure));
    setBusy(false);
    setLoading(false);
  }, []);
  const previousApi = useRef(api);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      authority.current++;
      revision.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      cancellations.current.clear();
    };
  }, []);
  useEffect(() => {
    if (previousApi.current === api) return;
    previousApi.current = api;
    authority.current++;
    revision.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setReadState({ result: null, requiresLogin: false });
    setNotice("");
    setError("");
    writing.current = false;
    cancellations.current.clear();
    setBusy(false);
  }, [api]);
  const { result, requiresLogin } = readState;
  const selection = `${view}:${page}`;
  const ready = result?.key === selection;
  const entries = ready ? result.entries : [];
  const more = ready && result.more;
  const credits = ready ? result.credits : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    if (!active || (preview && request === bookingRequest)) return;
    const current = ++revision.current,
      generation = authority.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setError("");
    setLoading(true);
    void api(`mine?page=${page}&view=${view}`, { signal: controller.signal })
      .then((data) => {
        if (
          !live.current ||
          generation !== authority.current ||
          controller.signal.aborted ||
          current !== revision.current
        )
          return;
        if (
          !Array.isArray(data.entries) ||
          data.page !== page ||
          data.view !== view ||
          typeof data.hasMore !== "boolean" ||
          typeof data.asOf !== "string" ||
          !Number.isFinite(Date.parse(data.asOf))
        )
          throw new Error("invalid_appointments");
        if (data.entries.length === 0 && page > 1) {
          setPage(page - 1);
          return;
        }
        setReadState({
          result: reconcileCustomerCancellations(
            {
              key: `${view}:${page}`,
              entries: data.entries,
              more: data.hasMore,
              credits: Number.isInteger(data.credits) ? data.credits : null,
            },
            cancellations.current.values(),
          ),
          requiresLogin: false,
        });
      })
      .catch((failure) => {
        if (!live.current || generation !== authority.current) return;
        if (bookingAccessDenied(failure)) {
          clearPrivate(failure);
          return;
        }
        if (!controller.signal.aborted && current === revision.current) {
          setReadState((previous) => customerAppointmentsFailed(previous, failure));
          setError(bookingError(failure));
        }
      })
      .finally(() => {
        controllers.current.delete(controller);
        if (live.current && generation === authority.current && current === revision.current)
          setLoading(false);
      });
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [active, page, view, refresh, preview, api, clearPrivate, request]);
  async function cancel(entry: BookingEntry) {
    if (requiresLogin || writing.current || (preview && request === bookingRequest)) return;
    const generation = authority.current,
      controller = new AbortController();
    controllers.current.add(controller);
    writing.current = true;
    revision.current++;
    setLoading(false);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(`entries/${entry.id}/action`, {
        ...bookingWrite("POST", { expectedVersion: entry.version, action: "cancel" }),
        signal: controller.signal,
      });
      if (!live.current || generation !== authority.current || controller.signal.aborted) return;
      const cancelled = readCustomerCancellation(result.entry, entry, expectedAccountId);
      revision.current++;
      setLoading(false);
      cancellations.current.set(cancelled.id, cancelled);
      setReadState((previous) => customerAppointmentCancelled(previous, cancelled));
      setNotice(preview ? "Termin je otkazan u pregledu." : "Termin je otkazan.");
    } catch (failure) {
      if (!live.current || generation !== authority.current) return;
      if (bookingAccessDenied(failure)) {
        clearPrivate(failure);
        return;
      }
      setReadState((previous) => customerAppointmentsFailed(previous, failure));
      setError(bookingError(failure));
    } finally {
      controllers.current.delete(controller);
      if (live.current && generation === authority.current) {
        writing.current = false;
        setBusy(false);
        setRefresh((value) => value + 1);
      }
    }
  }
  return (
    <section className={styles.appointments} aria-label="Moji termini">
      <div className={styles.listHeading}>
        {heading && <h2>Moji termini</h2>}
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Osvježi
        </button>
      </div>
      <fieldset className={styles.viewSwitch} aria-label="Prikaz termina">
        {(
          [
            ["upcoming", "Aktuelni"],
            ["history", "Historija"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            disabled={busy}
            onClick={() => {
              setView(value);
              setPage(1);
              setError("");
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {preview && <p className={styles.note}>Proba bez stvarnog zakazivanja.</p>}
      {credits !== null && credits > 0 && <p className={styles.credit}>Ahi Credits: {credits}</p>}
      {error && (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          {requiresLogin && (
            <div className={styles.actions}>
              <Link
                className={styles.secondary}
                href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dtermini"
              >
                Prijavi se
              </Link>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.success}>
          {notice}
        </p>
      )}
      {!ready && !error && (
        <p role="status" className={styles.note}>
          Provjeravam tvoje termine…
        </p>
      )}
      {ready && entries.length === 0 && !loading && !error && (
        <div className={styles.empty}>
          <Icon name="calendar" />
          <h3>{view === "history" ? "Još nema ranijih termina." : "Nema aktuelnih termina."}</h3>
          {view === "upcoming" && (
            <Link href={preview ? "/pregled/pretraga" : "/pretraga"}>Pronađi djelatnost</Link>
          )}
        </div>
      )}
      <div className={styles.entryList} aria-busy={loading}>
        {entries.map((entry) => (
          <article key={entry.id} className={styles.entry}>
            <div>
              <span className={styles.status} data-status={entry.status}>
                {bookingStatusLabels[entry.status]}
              </span>
              <h3>{entry.serviceName}</h3>
              <Link
                href={
                  preview
                    ? `/pregled/djelatnost?profil=${entry.businessId}`
                    : `/djelatnosti/${entry.businessId}`
                }
              >
                {entry.businessTitle}
              </Link>
              <p>{bookingDate(entry.startsAt, entry.timezone, { time: true })}</p>
              <span className={styles.note}>
                {entry.durationMinutes} min · {bookingMoney(entry.priceMinor)}
              </span>
            </div>
            {["requested", "confirmed"].includes(entry.status) &&
              new Date(entry.startsAt) > new Date() && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy || loading}
                  onClick={() => void cancel(entry)}
                >
                  Otkaži termin
                </button>
              )}
          </article>
        ))}
      </div>
      {ready && (page > 1 || more) && (
        <nav className={styles.pagination} aria-label="Stranice termina">
          <button type="button" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
            Prethodna
          </button>
          <span aria-current="page">{page}</span>
          <button type="button" disabled={busy || !more} onClick={() => setPage(page + 1)}>
            Sljedeća
          </button>
        </nav>
      )}
    </section>
  );
}
