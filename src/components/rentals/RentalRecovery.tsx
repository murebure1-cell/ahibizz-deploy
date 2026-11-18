"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { accountSectionPath } from "../../lib/account-return";
import { bookingDate } from "../../lib/booking";
import { BookingRequestError, bookingAccountId } from "../../lib/booking-client";
import {
  type RentalIntent,
  RentalRecoveryRequired,
  rentalSubmissions,
} from "../../lib/rental-submission";
import { rentalError, writeRental } from "./rental-client";
import styles from "./rentals.module.css";

export function RentalRecovery({
  actor,
  businessId,
  onResolved,
  children,
}: {
  actor?: string;
  businessId?: string;
  onResolved?: () => void;
  children?: (onUncertain: (intent: RentalIntent) => void) => ReactNode;
}) {
  const [pending, setPending] = useState<RentalIntent | null>(null);
  const [message, setMessage] = useState("");
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!rentalSubmissions.previouslyUsed()) return;
    let live = true;
    (actor ? Promise.resolve(actor) : bookingAccountId())
      .then((id) => {
        const saved = rentalSubmissions.pending(id);
        if (live && saved && (!businessId || businessId === saved.businessId)) setPending(saved);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [actor, businessId]);

  async function recover() {
    if (!pending || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await bookingAccountId();
      if (id !== pending.account || (actor && id !== actor))
        throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
      const receipt = await rentalSubmissions.retry(pending, writeRental);
      setPending(null);
      const statuses = {
        requested: "Zahtjev je zaprimljen i čeka potvrdu vlasnika.",
        confirmed:
          receipt.kind === "block" ? "Period je označen kao zauzet." : "Najam je potvrđen.",
        declined: "Vlasnik je odbio zahtjev za najam.",
        cancelled: receipt.kind === "block" ? "Blokada je uklonjena." : "Najam je otkazan.",
      };
      setMessage(statuses[receipt.status]);
      onResolved?.();
    } catch (failure) {
      if (!rentalSubmissions.pending(pending.account)) setPending(null);
      setError(
        failure instanceof RentalRecoveryRequired
          ? "Ishod još nije potvrđen. Možeš ponovo provjeriti isti zahtjev."
          : rentalError(failure),
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  if (pending && (!actor || pending.account === actor))
    return (
      <section className={styles.panel} aria-label="Provjera prethodnog zahtjeva">
        <h3>Ishod zahtjeva još nije potvrđen.</h3>
        <strong>{pending.vehicleName}</strong>
        <p>
          {bookingDate(pending.body.startsAt, pending.timezone, { time: true })} —{" "}
          {bookingDate(pending.body.endsAt, pending.timezone, { time: true })}
        </p>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            type="button"
            disabled={busy}
            onClick={() => void recover()}
          >
            {busy ? "Provjera…" : "Provjeri isti zahtjev"}
          </button>
          {businessId && (
            <Link className={styles.secondary} href={accountSectionPath("appointments")}>
              Moji termini
            </Link>
          )}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>
    );
  return (
    <>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {children?.((intent) => {
        setError("");
        setMessage("");
        setPending(intent);
      })}
    </>
  );
}
