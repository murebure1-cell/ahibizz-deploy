"use client";

import { useEffect, useState } from "react";
import {
  type BusinessDetails,
  businessAmenities,
  businessOpenState,
  businessTimeLabel,
  businessWeekdays,
} from "../../lib/business-details";
import { Icon } from "../Icon";
import styles from "./business-details.module.css";

export function BusinessOpenStatus({
  details,
  checkedAt,
}: {
  details?: BusinessDetails | null;
  checkedAt?: string;
}) {
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
  const state = now ? businessOpenState(details, now) : null;
  if (state === null) return null;
  return (
    <span
      className={styles.openStatus}
      data-open={state === "open"}
      title={details?.timezone ?? undefined}
    >
      <Icon name="clock" />
      {state === "open" ? "Otvoreno" : "Zatvoreno"}
    </span>
  );
}

function AmenityIcon({ id }: { id: string }) {
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
  const amenities = businessAmenities.filter((entry) => details?.amenities.includes(entry.id));
  if (!amenities.length) return null;
  return (
    <ul
      className={styles.amenities}
      data-compact={compact || undefined}
      aria-label="Sadržaji i pogodnosti"
    >
      {amenities.map((entry) => (
        <li key={entry.id} title={entry.label}>
          <AmenityIcon id={entry.id} />
          <span>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}
export function BusinessHours({ details }: { details?: BusinessDetails | null }) {
  if (!details?.hours || !details.timezone) return null;
  return (
    <div className={styles.hours}>
      <div className={styles.hoursHeader}>
        <BusinessOpenStatus details={details} />
        <small>{details.timezone}</small>
      </div>
      <dl>
        {details.hours.map((day) => (
          <div key={day.weekday}>
            <dt>{businessWeekdays[day.weekday - 1]}</dt>
            <dd>
              {day.windows.length
                ? day.windows
                    .map(
                      (window) =>
                        `${businessTimeLabel(window.startMinute)}–${businessTimeLabel(window.endMinute)}`,
                    )
                    .join(" · ")
                : "Zatvoreno"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
