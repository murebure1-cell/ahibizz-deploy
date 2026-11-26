"use client";

import { useEffect, useState } from "react";
import {
  type BusinessDetails,
  businessAmenities,
  businessTimeLabel,
  businessWeekdays,
} from "../../lib/business-details";
import { hoursNow, spanLabel, weekSpans } from "../../lib/business-hours";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { Sheet } from "../ui/Sheet";
import styles from "./business-details.module.css";

/** The present moment, kept fresh while a business with hours is on the screen. */
function useNow(details: BusinessDetails | null | undefined, checkedAt?: string) {
  const [now, setNow] = useState<Date | null>(() => (checkedAt ? new Date(checkedAt) : null));
  useEffect(() => {
    if (!details?.hours) return;
    const update = () => setNow(new Date());
    update();
    const interval = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [details]);
  return now;
}

export function BusinessOpenStatus({
  details,
  checkedAt,
  inline = false,
  unknown,
}: {
  details?: BusinessDetails | null;
  checkedAt?: string;
  /** Plain text in a line of facts instead of the pill that sits over a photo. */
  inline?: boolean;
  /** What to say while the moment is not known yet; nothing when left out. */
  unknown?: string;
}) {
  const t = useT();
  const now = useNow(details, checkedAt);
  const state = now ? hoursNow(details, now) : null;
  if (!state)
    return unknown ? (
      <span className={inline ? styles.openInline : undefined}>{unknown}</span>
    ) : null;
  return (
    <span
      className={inline ? styles.openInline : styles.openStatus}
      data-open={state.open}
      title={details?.timezone ?? undefined}
    >
      {state.open ? <span className={styles.openDot} aria-hidden="true" /> : <Icon name="lock" />}
      {!state.open
        ? t("Zatvoreno")
        : state.closesAt === null
          ? t("Otvoreno")
          : t("Otvoreno do {time}", { time: businessTimeLabel(state.closesAt) })}
    </span>
  );
}

export function AmenityIcon({ id }: { id: string }) {
  const path: Record<string, React.ReactNode> = {
    wifi: (
      <>
        <path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0" />
        <circle cx="12" cy="20" r="1" />
      </>
    ),
    parking: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
      </>
    ),
    accessible: (
      <>
        <circle cx="12" cy="4" r="2" />
        <path d="m11 8 1 5h5l3 6M12 9h5M8 11a5 5 0 1 0 7 7" />
      </>
    ),
    pets: (
      <>
        <ellipse cx="12" cy="17" rx="5" ry="4" />
        <ellipse cx="5" cy="9" rx="2" ry="3" />
        <ellipse cx="10" cy="5" rx="2" ry="3" />
        <ellipse cx="16" cy="6" rx="2" ry="3" />
        <ellipse cx="20" cy="11" rx="2" ry="3" />
      </>
    ),
    "card-payment": (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M2 10h20M6 15h4" />
      </>
    ),
    family: (
      <>
        <circle cx="8" cy="6" r="3" />
        <circle cx="17" cy="10" r="2" />
        <path d="M2 21v-4a6 6 0 0 1 12 0v4m1 0v-3a4 4 0 0 1 7 0v3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path[id]}
    </svg>
  );
}
export function BusinessAmenities({
  details,
  compact = false,
}: {
  details?: BusinessDetails | null;
  compact?: boolean;
}) {
  const t = useT();
  const amenities = businessAmenities.filter((entry) => details?.amenities.includes(entry.id));
  if (!amenities.length) return null;
  return (
    <ul
      className={styles.amenities}
      data-compact={compact || undefined}
      aria-label={t("Sadržaji i pogodnosti")}
    >
      {amenities.map((entry) => (
        <li key={entry.id} title={t(entry.label)}>
          <AmenityIcon id={entry.id} />
          <span>{t(entry.label)}</span>
        </li>
      ))}
    </ul>
  );
}
/** The week as drawn: whether it is open now and until when, then the seven days with today marked. */
export function BusinessHours({ details }: { details?: BusinessDetails | null }) {
  const t = useT();
  const now = useNow(details);
  // The zone is named only to a viewer whose own clock shows another time. Devices name the
  // same clock differently (Sarajevo, Belgrade, Zagreb), so the clocks are compared, not the names.
  const [elsewhere, setElsewhere] = useState(false);
  const zone = details?.timezone;
  useEffect(() => {
    if (!zone) return;
    const clock = (timeZone?: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date());
    try {
      setElsewhere(clock(zone) !== clock());
    } catch {
      setElsewhere(false);
    }
  }, [zone]);
  if (details?.hours?.length !== 7 || !details.timezone) return null;
  const state = now ? hoursNow(details, now) : null;
  const week = weekSpans(details.hours);
  return (
    <div className={styles.hours}>
      {state && (
        <p className={styles.hoursNow} data-open={state.open}>
          <strong>
            {state.open ? (
              <span className={styles.openDot} aria-hidden="true" />
            ) : (
              <Icon name="lock" className={styles.hoursLock} />
            )}
            {state.open ? t("Otvoreno") : t("Zatvoreno")}
          </strong>
          {state.open && state.closesAt !== null && (
            <span>{t("zatvara se u {time}", { time: businessTimeLabel(state.closesAt) })}</span>
          )}
          {!state.open && state.opensAt !== null && (
            <span>{t("otvara se u {time}", { time: businessTimeLabel(state.opensAt) })}</span>
          )}
        </p>
      )}
      <ul className={styles.hoursWeek}>
        {week.map((spans, index) => {
          const today = state?.weekday === index + 1;
          return (
            <li
              key={businessWeekdays[index]}
              className={styles.hoursDay}
              data-today={today || undefined}
            >
              <span className={styles.hoursDayName}>{t(businessWeekdays[index] ?? "")}</span>
              {today && <em className={styles.hoursToday}>{t("Danas")}</em>}
              <span className={styles.hoursDayTimes}>
                {spans.length ? spans.map(spanLabel).join(" · ") : t("Zatvoreno")}
              </span>
            </li>
          );
        })}
      </ul>
      {elsewhere && <p className={styles.hoursZone}>{details.timezone}</p>}
    </div>
  );
}

/** The open status in a line of facts; a press opens the week in a sheet. */
export function BusinessHoursSheet({ details }: { details: BusinessDetails }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.hoursButton}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className={styles.srOnly}>{t("Radno vrijeme")}: </span>
        <BusinessOpenStatus details={details} inline unknown={t("Radno vrijeme")} />
        <Icon name="chevron" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("Radno vrijeme")}
        closeLabel={t("Zatvori")}
      >
        <BusinessHours details={details} />
      </Sheet>
    </>
  );
}
