"use client";
import Link from "next/link";
import { useState } from "react";
import { appointmentDay, appointmentTile, rentalSpan } from "../../lib/appointment-display";
import { bookingDate, bookingMoney } from "../../lib/booking";
import { msg } from "../../lib/i18n/translate";
import type { RentalBooking } from "../../lib/rentals";
import {
  AppointmentCard,
  type AppointmentTone,
  BusinessActions,
  CancelAppointment,
} from "../booking/AppointmentCard";
import { useI18n } from "../i18n/LocaleProvider";
import { rentalError, writeRental } from "./rental-client";
import styles from "./rentals.module.css";

const statuses = {
  requested: msg("Čeka potvrdu"),
  confirmed: msg("Potvrđeno"),
  declined: msg("Odbijeno"),
  cancelled: msg("Otkazano"),
};
const tones: Record<RentalBooking["status"], AppointmentTone> = {
  requested: "waiting",
  confirmed: "confirmed",
  declined: "refused",
  cancelled: "refused",
};

export function RentalEntry({
  entry,
  actor,
  owner = false,
  past = false,
  changed,
}: {
  entry: RentalBooking;
  actor: string;
  owner?: boolean;
  /** In the customer's history: the card without the tile's colour. */
  past?: boolean;
  changed: () => void;
}) {
  const { t, locale } = useI18n();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const starts = bookingDate(entry.startsAt, entry.timezone, { time: true, locale });
  const ends = bookingDate(entry.endsAt, entry.timezone, { time: true, locale });
  const isBlock = entry.kind === "block";
  const beforePickup = Date.parse(entry.startsAt) > Date.now();
  const canDecline = owner && entry.status === "requested";
  const canCancel =
    beforePickup && (entry.status === "confirmed" || (!owner && entry.status === "requested"));
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
      setError(t(rentalError(failure)));
    } finally {
      setWorking(false);
    }
  }
  // The person who asked for the vehicle sees it as one of their appointments, as drawn.
  if (!owner)
    return (
      <AppointmentCard
        tile={appointmentTile(appointmentDay(entry.startsAt, entry.timezone), locale)}
        spoken={bookingDate(entry.startsAt, entry.timezone, { locale })}
        title={entry.vehicleName}
        detail={
          <>
            <Link href={`/djelatnosti/${entry.businessId}`} dir="auto">
              {entry.businessTitle}
            </Link>
            {` · ${rentalSpan(
              entry,
              appointmentDay(new Date().toISOString(), entry.timezone),
              locale,
            )} · ${bookingMoney(entry.totalMinor)}`}
          </>
        }
        state={t(statuses[entry.status])}
        tone={tones[entry.status]}
        past={past}
        problem={error || undefined}
      >
        <BusinessActions
          businessId={entry.businessId}
          directions={entry.status === "confirmed" && beforePickup}
        />
        {canCancel && (
          <CancelAppointment
            label={t("Otkaži")}
            disabled={working}
            onConfirm={() => void decide("cancel")}
          />
        )}
      </AppointmentCard>
    );
  return (
    <article className={styles.entry}>
      <div className={styles.topline}>
        <strong>
          {owner
            ? isBlock
              ? t("Ručna blokada")
              : entry.customerName || t("Zahtjev za najam")
            : entry.vehicleName}
        </strong>
        <span className={styles.badge} data-state={entry.status}>
          {isBlock && entry.status === "confirmed" ? t("Zauzeto") : t(statuses[entry.status])}
        </span>
      </div>
      {owner ? (
        <span>{entry.vehicleName}</span>
      ) : (
        <Link href={`/djelatnosti/${entry.businessId}`} dir="auto">
          {entry.businessTitle}
        </Link>
      )}
      <p>
        {starts} — {ends}
      </p>
      {!isBlock && <strong>{bookingMoney(entry.totalMinor)}</strong>}
      {(canDecline || canCancel) && (
        <div className={styles.actions}>
          {canDecline && (
            <>
              {beforePickup && (
                <button
                  type="button"
                  disabled={working}
                  className={styles.primary}
                  onClick={() => void decide("approve")}
                >
                  {t("Odobri")}
                </button>
              )}
              <button
                type="button"
                disabled={working}
                className={styles.secondary}
                onClick={() => void decide("decline")}
              >
                {t("Odbij")}
              </button>
            </>
          )}
          {canCancel && (
            <button
              type="button"
              disabled={working}
              className={styles.secondary}
              onClick={() => void decide("cancel")}
            >
              {isBlock ? t("Ukloni blokadu") : t("Otkaži najam")}
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
