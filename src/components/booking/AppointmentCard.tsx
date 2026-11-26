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

/** "LH" for "Lejla Hodžić": the first letters of the first two words. */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A request or a booking as the owner sees it, as drawn on the board "Zahtjevi i termini": who
 * asked (or a lock for a period the owner closed by hand), what and when, the amount or the
 * state, and the owner's actions under them.
 */
export function OwnerCard({
  who,
  detail,
  amount,
  state,
  tone,
  problem,
  children,
}: {
  /** The guest's name; null for a period the owner closed by hand. */
  who: string | null;
  detail: string;
  amount?: string;
  state?: string;
  tone?: AppointmentTone;
  problem?: string;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <span className={styles.avatar} aria-hidden="true" data-block={who === null || undefined}>
          {who === null ? <Icon name="lock" /> : initials(who) || "?"}
        </span>
        <div className={styles.what}>
          <h3 dir="auto">{who ?? t("Ručni unos")}</h3>
          <p dir="auto">{detail}</p>
        </div>
        {state ? (
          <span className={styles.state} data-tone={tone}>
            {state}
          </span>
        ) : (
          amount && <strong className={styles.amount}>{amount}</strong>
        )}
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
 * The owner's coming requests and bookings, in the board's two groups: what waits for an answer,
 * with a word on what a request holds, and what is agreed or closed by hand.
 */
export function OwnerAgenda<T extends { id: string; status: string }>({
  entries,
  holds,
  children,
}: {
  entries: readonly T[];
  /** What a waiting request already holds, said under the waiting group. */
  holds: string;
  children: (entry: T) => ReactNode;
}) {
  const t = useT();
  const waiting = entries.filter((entry) => entry.status === "requested");
  const agreed = entries.filter((entry) => entry.status !== "requested");
  return (
    <div className={styles.list}>
      {waiting.length > 0 && (
        <section className={styles.group} aria-label={t("Čeka odgovor")}>
          <h3>
            {t("Čeka odgovor")} · {waiting.length}
          </h3>
          <div className={styles.cards}>{waiting.map(children)}</div>
          <p className={styles.lead}>{holds}</p>
        </section>
      )}
      {agreed.length > 0 && (
        <section className={styles.group} aria-label={t("Potvrđeno uskoro")}>
          <h3>{t("Potvrđeno uskoro")}</h3>
          <div className={styles.cards}>{agreed.map(children)}</div>
        </section>
      )}
    </div>
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
