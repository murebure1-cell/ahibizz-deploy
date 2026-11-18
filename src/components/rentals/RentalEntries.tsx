"use client";
import Link from "next/link";
import { useState } from "react";
import { bookingDate, bookingMoney } from "../../lib/booking";
import type { RentalBooking } from "../../lib/rentals";
import { rentalError, useRentalRead, writeRental } from "./rental-client";
import styles from "./rentals.module.css";

const statuses = {
  requested: "Čeka potvrdu",
  confirmed: "Potvrđeno",
  declined: "Odbijeno",
  cancelled: "Otkazano",
};

export function RentalEntry({
  entry,
  actor,
  owner = false,
  changed,
}: {
  entry: RentalBooking;
  actor: string;
  owner?: boolean;
  changed: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const starts = bookingDate(entry.startsAt, entry.timezone, { time: true });
  const ends = bookingDate(entry.endsAt, entry.timezone, { time: true });
  const isBlock = entry.kind === "block";
  const canAct =
    (entry.status === "requested" || entry.status === "confirmed") &&
    Date.parse(entry.startsAt) > Date.now();
  async function decide(action: "approve" | "decline" | "cancel") {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await writeRental(`decide/${entry.businessId}/${entry.id}`, actor, {
        action,
        expectedVersion: entry.version,
      });
      changed();
    } catch (failure) {
      setError(rentalError(failure));
    } finally {
      setWorking(false);
    }
  }
  return (
    <article className={styles.entry}>
      <div className={styles.topline}>
        <strong>
          {owner
            ? isBlock
              ? "Ručna blokada"
              : entry.customerName || "Zahtjev za najam"
            : entry.vehicleName}
        </strong>
        <span className={styles.badge} data-state={entry.status}>
          {isBlock && entry.status === "confirmed" ? "Zauzeto" : statuses[entry.status]}
        </span>
      </div>
      {owner ? (
        <span>{entry.vehicleName}</span>
      ) : (
        <Link href={`/djelatnosti/${entry.businessId}`}>{entry.businessTitle}</Link>
      )}
      <p>
        {starts} — {ends}
      </p>
      {!isBlock && <strong>{bookingMoney(entry.totalMinor)}</strong>}
      {canAct && (
        <div className={styles.actions}>
          {owner && entry.status === "requested" && (
            <>
              <button
                type="button"
                disabled={working}
                className={styles.primary}
                onClick={() => void decide("approve")}
              >
                Odobri
              </button>
              <button
                type="button"
                disabled={working}
                className={styles.secondary}
                onClick={() => void decide("decline")}
              >
                Odbij
              </button>
            </>
          )}
          {(!owner || entry.status === "confirmed") && (
            <button
              type="button"
              disabled={working}
              className={styles.secondary}
              onClick={() => void decide("cancel")}
            >
              {isBlock ? "Ukloni blokadu" : "Otkaži najam"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </article>
  );
}

export function MyRentals({ actor }: { actor: string }) {
  const [revision, setRevision] = useState(0);
  const state = useRentalRead<{ entries: RentalBooking[] }>("mine", actor, revision);
  if (!state || (state.data && state.data.entries.length === 0)) return null;
  return (
    <section className={styles.panel} aria-label="Moji najmovi">
      <h2>Najam automobila</h2>
      {state.error && (
        <p role="alert">
          {state.error}{" "}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setRevision((value) => value + 1)}
          >
            Pokušaj ponovo
          </button>
        </p>
      )}
      {state.data?.entries.map((entry) => (
        <RentalEntry
          key={entry.id}
          entry={entry}
          actor={actor}
          changed={() => setRevision((value) => value + 1)}
        />
      ))}
    </section>
  );
}
