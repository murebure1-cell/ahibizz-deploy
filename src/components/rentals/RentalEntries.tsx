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
  appointmentAction,
  BusinessActions,
  CancelAppointment,
  OwnerCard,
} from "../booking/AppointmentCard";
import { useI18n } from "../i18n/LocaleProvider";
import { rentalError, writeRental } from "./rental-client";

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
  // The owner's view, as drawn on the board "Zahtjevi i termini".
  return (
    <OwnerCard
      who={isBlock ? null : entry.customerName || t("Gost")}
      detail={`${entry.vehicleName} · ${rentalSpan(
        entry,
        appointmentDay(new Date().toISOString(), entry.timezone),
        locale,
      )}`}
      amount={isBlock ? undefined : bookingMoney(entry.totalMinor)}
      state={
        isBlock
          ? t("Blokada")
          : entry.status === "requested"
            ? undefined
            : t(statuses[entry.status])
      }
      tone={isBlock ? "over" : tones[entry.status]}
      problem={error || undefined}
    >
      {(canDecline || canCancel) && (
        <>
          {canDecline && beforePickup && (
            <button
              type="button"
              className={appointmentAction}
              data-main
              disabled={working}
              onClick={() => void decide("approve")}
            >
              {t("Odobri")}
            </button>
          )}
          {canDecline && (
            <button
              type="button"
              className={appointmentAction}
              disabled={working}
              onClick={() => void decide("decline")}
            >
              {t("Odbij")}
            </button>
          )}
          {canCancel && (
            <CancelAppointment
              label={isBlock ? t("Ukloni blokadu") : t("Otkaži")}
              disabled={working}
              onConfirm={() => void decide("cancel")}
            />
          )}
        </>
      )}
    </OwnerCard>
  );
}
