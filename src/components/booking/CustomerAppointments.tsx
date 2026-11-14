"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type BookingEntry,
  type BookingListView,
  bookingDate,
  bookingMoney,
  bookingStatusLabels,
} from "../../lib/booking";
import { bookingError, bookingRequest, bookingWrite } from "../../lib/booking-client";
import { Icon } from "../Icon";
import styles from "./public-booking.module.css";

type AppointmentPage = {
  key: string;
  entries: BookingEntry[];
  more: boolean;
  credits: number | null;
};

export function CustomerAppointments({
  active = true,
  heading = true,
  preview = false,
  request = bookingRequest,
}: {
  active?: boolean;
  heading?: boolean;
  preview?: boolean;
  request?: typeof bookingRequest;
}) {
  const [result, setResult] = useState<AppointmentPage | null>(null),
    [view, setView] = useState<BookingListView>("upcoming"),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    writing = useRef(false),
    api = useRef(request);
  api.current = request;
  const selection = `${view}:${page}`;
  const ready = result?.key === selection;
  const entries = ready ? result.entries : [];
  const more = ready && result.more;
  const credits = ready ? result.credits : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    if (!active || (preview && api.current === bookingRequest)) return;
    const current = ++revision.current,
      controller = new AbortController();
    setError("");
    setLoading(true);
    void api
      .current(`mine?page=${page}&view=${view}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || current !== revision.current) return;
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
        setResult({
          key: `${view}:${page}`,
          entries: data.entries,
          more: data.hasMore,
          credits: Number.isInteger(data.credits) ? data.credits : null,
        });
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
  }, [active, page, view, refresh, preview]);
  async function cancel(entry: BookingEntry) {
    if (writing.current || (preview && api.current === bookingRequest)) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.current(
        `entries/${entry.id}/action`,
        bookingWrite("POST", { expectedVersion: entry.version, action: "cancel" }),
      );
      if (
        result.entry?.id !== entry.id ||
        result.entry?.businessId !== entry.businessId ||
        result.entry?.status !== "cancelled" ||
        !Number.isInteger(result.entry.version) ||
        result.entry.version <= entry.version
      )
        throw new Error("unconfirmed_cancel");
      setNotice(preview ? "Termin je otkazan u pregledu." : "Termin je otkazan.");
    } catch (failure) {
      setError(bookingError(failure));
    } finally {
      writing.current = false;
      setBusy(false);
      setRefresh((value) => value + 1);
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
        <p role="alert" className={styles.error}>
          {error}
        </p>
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
      {(page > 1 || more) && (
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
