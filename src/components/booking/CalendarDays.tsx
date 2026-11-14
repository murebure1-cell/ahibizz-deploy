"use client";
import { useEffect, useState } from "react";
import { bookingDate, bookingMonth } from "../../lib/booking";
import { addDays } from "../../lib/booking-time";
import { Icon } from "../Icon";
import styles from "./public-booking.module.css";

export function CalendarDays({
  date,
  onChange,
  minDate,
  maxDate,
  disabled = false,
}: {
  date: string;
  onChange: (date: string) => void;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
}) {
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  const first = `${month}-01`,
    firstDate = new Date(`${first}T12:00:00Z`),
    weekday = (firstDate.getUTCDay() + 6) % 7;
  const nextMonth = () => {
    const d = new Date(firstDate);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 7);
  };
  const next = nextMonth(),
    last = addDays(`${next}-01`, -1),
    count = Number(last.slice(8));
  function previous() {
    const d = new Date(firstDate);
    d.setUTCMonth(d.getUTCMonth() - 1);
    setMonth(d.toISOString().slice(0, 7));
  }
  return (
    <div className={styles.calendar}>
      <div className={styles.month}>
        <button
          type="button"
          aria-label="Prethodni mjesec"
          disabled={disabled || Boolean(minDate && month <= minDate.slice(0, 7))}
          onClick={previous}
        >
          <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
        </button>
        <strong>{bookingMonth(month)}</strong>
        <button
          type="button"
          aria-label="Sljedeći mjesec"
          disabled={disabled || Boolean(maxDate && next > maxDate.slice(0, 7))}
          onClick={() => setMonth(next)}
        >
          <Icon name="chevron" />
        </button>
      </div>
      <div className={styles.weekdays} aria-hidden="true">
        {["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"].map((day) => (
          <span key={day}>{day.slice(0, 1)}</span>
        ))}
      </div>
      <fieldset className={styles.days} aria-label="Odaberi dan termina">
        {Array.from({ length: weekday }, (_, i) => (
          <span key={addDays(first, i - weekday)} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              type="button"
              key={key}
              aria-pressed={date === key}
              aria-label={bookingDate(`${key}T12:00:00Z`, "UTC")}
              disabled={
                disabled || Boolean(minDate && key < minDate) || Boolean(maxDate && key > maxDate)
              }
              onClick={() => onChange(key)}
            >
              {i + 1}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
