"use client";
import Link from "next/link";
import { useState } from "react";
import { appointmentDate, appointmentTile, outsideThisMonth } from "../../lib/appointment-display";
import { bookingDate, bookingMoney } from "../../lib/booking";
import { dateKey } from "../../lib/booking-time";
import { msg } from "../../lib/i18n/translate";
import { dayRange } from "../../lib/rental-request";
import { type StayBooking, stayNights } from "../../lib/stays";
import {
  AppointmentCard,
  type AppointmentTone,
  appointmentAction,
  BusinessActions,
  CancelAppointment,
  OwnerCard,
} from "../booking/AppointmentCard";
import { useI18n } from "../i18n/LocaleProvider";
import { stayError, writeStay } from "./stay-client";
import { nightsText } from "./stay-labels";

const statuses = {
  requested: msg("Čeka potvrdu"),
  confirmed: msg("Potvrđeno"),
  declined: msg("Odbijeno"),
  cancelled: msg("Otkazano"),
};
const tones: Record<StayBooking["status"], AppointmentTone> = {
  requested: "waiting",
  confirmed: "confirmed",
  declined: "refused",
  cancelled: "refused",
};

export function StayEntry({
  entry,
  actor,
  owner = false,
  past = false,
  changed,
}: {
  entry: StayBooking;
  actor: string;
  owner?: boolean;
  /** In the customer's history: the card without the tile's colour. */
  past?: boolean;
  changed: () => void;
}) {
  const { t, locale } = useI18n();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const starts = bookingDate(`${entry.checkIn}T12:00:00Z`, "UTC", { locale });
  const isBlock = entry.kind === "block";
  const canChangeArrival = entry.checkIn >= dateKey(new Date(), entry.timezone);
  const canApprove = owner && entry.status === "requested" && canChangeArrival;
  const canDecline = owner && entry.status === "requested";
  const canCancel =
    canChangeArrival && (entry.status === "confirmed" || (!owner && entry.status === "requested"));
  async function decide(action: "approve" | "decline" | "cancel") {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await writeStay(`decide/${entry.businessId}/${entry.id}`, actor, {
        action,
        expectedVersion: entry.version,
      });
      changed();
    } catch (failure) {
      setError(t(stayError(failure)));
    } finally {
      setWorking(false);
    }
  }
  // The person who asked for the stay sees it as one of their appointments, as drawn.
  if (!owner) {
    const today = dateKey(new Date(), entry.timezone);
    const year = today.slice(0, 4);
    const nights = stayNights(entry.checkIn, entry.checkOut);
    const until = appointmentDate(entry.checkOut, locale, year);
    return (
      <AppointmentCard
        tile={appointmentTile(entry.checkIn, locale)}
        spoken={starts}
        title={
          Number.isInteger(nights) && nights > 0
            ? `${entry.unitName} · ${t(nightsText(nights), { count: nights })}`
            : entry.unitName
        }
        detail={
          <>
            <Link href={`/djelatnosti/${entry.businessId}`} dir="auto">
              {entry.businessTitle}
            </Link>
            {` · ${
              outsideThisMonth(entry.checkIn, today)
                ? `${appointmentDate(entry.checkIn, locale, year)} – ${until}`
                : t("do {when}", { when: until })
            } · ${bookingMoney(entry.totalMinor)}`}
          </>
        }
        state={t(statuses[entry.status])}
        tone={tones[entry.status]}
        past={past}
        problem={error || undefined}
      >
        <BusinessActions
          businessId={entry.businessId}
          directions={entry.status === "confirmed" && canChangeArrival}
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
  }
  // The owner's view, as drawn on the board "Zahtjevi i termini".
  const nights = stayNights(entry.checkIn, entry.checkOut);
  const span = `${dayRange(entry.checkIn, entry.checkOut, locale)}${
    Number.isInteger(nights) && nights > 0 ? ` · ${t(nightsText(nights), { count: nights })}` : ""
  }`;
  return (
    <OwnerCard
      who={isBlock ? null : entry.customerName || t("Gost")}
      detail={`${entry.unitName} · ${span}`}
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
      {(canApprove || canDecline || canCancel) && (
        <>
          {canApprove && (
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
