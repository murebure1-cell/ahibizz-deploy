"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { messageLink } from "../../lib/messaging";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./appointments.module.css";

/** How a state reads at a glance: agreed, waiting for an answer, turned down, or simply over. */
export type AppointmentTone = "confirmed" | "waiting" | "refused" | "over";

/**
 * One appointment as drawn on the board "Moji termini": the day in a tile, what it is and where,
 * its state, and under them what can be done with it. A service, a rented vehicle and a stay all
 * use it, so the list reads as one.
 */
export function AppointmentCard({
  tile,
  spoken,
  title,
  detail,
  state,
  tone,
  past = false,
  problem,
  children,
}: {
  /** The short weekday and the day of the month it starts on. */
  tile: { weekday: string; number: string };
  /** The same day in words, for a reader who cannot see the tile. */
  spoken: string;
  title: ReactNode;
  detail: ReactNode;
  state: string;
  tone: AppointmentTone;
  /** Behind us: the same card without the tile's colour. */
  past?: boolean;
  problem?: string;
  /** The actions, as `AppointmentAction` buttons and links. */
  children?: ReactNode;
}) {
  return (
    <article className={styles.card} data-past={past || undefined}>
      <div className={styles.top}>
        <span className={styles.tile} aria-hidden="true">
          <span>{tile.weekday}</span>
          <strong>{tile.number}</strong>
        </span>
        <div className={styles.what}>
          <h3 dir="auto">{title}</h3>
          <p>
            <span className={styles.spoken}>{spoken} </span>
            {detail}
          </p>
        </div>
        <span className={styles.state} data-tone={tone}>
          {state}
        </span>
      </div>
      {children && <div className={styles.actions}>{children}</div>}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </article>
  );
}

/**
 * Giving an appointment up takes two presses: the first turns the button into a question, the
 * second answers it. Three buttons stand side by side on a phone, and one slip of a finger must
 * not cancel anything. The question goes away by itself after a few seconds or when focus leaves.
 */
export function CancelAppointment({
  label,
  disabled,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), 5000);
    return () => window.clearTimeout(timer);
  }, [asking]);
  return (
    <button
      type="button"
      className={styles.action}
      data-danger
      data-asking={asking || undefined}
      disabled={disabled}
      onBlur={() => setAsking(false)}
      onClick={() => {
        setAsking(!asking);
        if (asking) onConfirm();
      }}
    >
      <span aria-live="polite">{asking ? t("Sigurno?") : label}</span>
    </button>
  );
}

/** The two ways to the business that every kind of appointment offers. */
export function BusinessActions({
  businessId,
  directions,
}: {
  businessId: string;
  /** Agreed and still ahead: the way there is worth showing. */
  directions: boolean;
}) {
  const t = useT();
  let messages: string | null = null;
  try {
    messages = messageLink({ kind: "business", targetId: businessId });
  } catch {
    // An id no message can go to: the card stays, without the link.
  }
  return (
    <>
      {directions && (
        <Link className={styles.action} href={`/djelatnosti/${businessId}/uputstva`}>
          <Icon name="route" aria-hidden="true" />
          {t("Uputstva")}
        </Link>
      )}
      {messages && (
        <Link className={styles.action} href={messages}>
          <Icon name="message" aria-hidden="true" />
          {t("Poruka")}
        </Link>
      )}
    </>
  );
}

export const appointmentAction = styles.action;
