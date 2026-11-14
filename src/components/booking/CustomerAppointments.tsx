"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type BookingEntry,
  bookingDate,
  bookingMoney,
  bookingStatusLabels,
} from "../../lib/booking";
import { bookingError, bookingRequest, bookingWrite } from "../../lib/booking-client";
import { Icon } from "../Icon";
import styles from "./public-booking.module.css";

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
  const [entries, setEntries] = useState<BookingEntry[]>([]),
    [ready, setReady] = useState(false),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [credits, setCredits] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    writing = useRef(false),
    api = useRef(request);
  api.current = request;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter deliberately repeats the same read after a user action.
  useEffect(() => {
    if (!active || (preview && api.current === bookingRequest)) return;
    const current = ++revision.current,
      controller = new AbortController();
    setError("");
    void api
      .current(`mine?page=${page}`, { signal: controller.signal })
      .then((data) => {
        if (current !== revision.current) return;
        if (!Array.isArray(data.entries) || data.page !== page)
          throw new Error("invalid_appointments");
        setEntries(data.entries);
        setMore(Boolean(data.hasMore));
        setCredits(Number.isInteger(data.credits) ? data.credits : null);
        setReady(true);
      })
      .catch((failure) => {
        if (!controller.signal.aborted && current === revision.current)
          setError(bookingError(failure));
      });
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [active, page, refresh, preview]);
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
      if (result.entry?.id !== entry.id || result.entry?.status !== "cancelled")
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
        <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Osvježi
        </button>
      </div>
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
      {ready && entries.length === 0 && (
        <div className={styles.empty}>
          <Icon name="calendar" />
          <h3>Još nema termina.</h3>
          <Link href={preview ? "/pregled/pretraga" : "/pretraga"}>Pronađi djelatnost</Link>
        </div>
      )}
      <div className={styles.entryList}>
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
                  disabled={busy}
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
          <span>{page}</span>
          <button type="button" disabled={busy || !more} onClick={() => setPage(page + 1)}>
            Sljedeća
          </button>
        </nav>
      )}
    </section>
  );
}
