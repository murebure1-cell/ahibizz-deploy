"use client";
import Link from "next/link";
import { useState } from "react";
import { bookingDate, bookingMoney } from "../../lib/booking";
import { dateKey } from "../../lib/booking-time";
import { msg } from "../../lib/i18n/translate";
import type { StayBooking } from "../../lib/stays";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "../rentals/rentals.module.css";
import { stayError, writeStay } from "./stay-client";

const statuses = {
  requested: msg("Čeka potvrdu"),
  confirmed: msg("Potvrđeno"),
  declined: msg("Odbijeno"),
  cancelled: msg("Otkazano"),
};

export function StayEntry({
  entry,
  actor,
  owner = false,
  changed,
}: {
  entry: StayBooking;
  actor: string;
  owner?: boolean;
  changed: () => void;
}) {
  const { t, locale } = useI18n();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const starts = bookingDate(`${entry.checkIn}T12:00:00Z`, "UTC", { locale });
  const ends = bookingDate(`${entry.checkOut}T12:00:00Z`, "UTC", { locale });
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
  return (
    <article className={styles.entry}>
      <div className={styles.topline}>
        <strong>
          {owner
            ? isBlock
              ? t("Ručna blokada")
              : entry.customerName || t("Zahtjev za smještaj")
            : entry.unitName}
        </strong>
        <span className={styles.badge} data-state={entry.status}>
          {isBlock && entry.status === "confirmed" ? t("Zauzeto") : t(statuses[entry.status])}
        </span>
      </div>
      {owner ? (
        <span>{entry.unitName}</span>
      ) : (
        <Link href={`/djelatnosti/${entry.businessId}`}>{entry.businessTitle}</Link>
      )}
      <p>
        {starts} — {ends}
      </p>
      {!isBlock && <strong>{bookingMoney(entry.totalMinor)}</strong>}
      {(canApprove || canDecline || canCancel) && (
        <div className={styles.actions}>
          {canApprove && (
            <button
              type="button"
              disabled={working}
              className={styles.primary}
              onClick={() => void decide("approve")}
            >
              {t("Odobri")}
            </button>
          )}
          {canDecline && (
            <button
              type="button"
              disabled={working}
              className={styles.secondary}
              onClick={() => void decide("decline")}
            >
              {t("Odbij")}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              disabled={working}
              className={styles.secondary}
              onClick={() => void decide("cancel")}
            >
              {isBlock ? t("Ukloni blokadu") : t("Otkaži boravak")}
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
