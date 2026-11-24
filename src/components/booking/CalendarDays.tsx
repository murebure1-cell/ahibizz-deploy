"use client";
import { useEffect, useState } from "react";
import { bookingDate, bookingMonth, bookingWeekdays } from "../../lib/booking";
import { addDays } from "../../lib/booking-time";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
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
  const { t, locale } = useI18n();
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
          aria-label={t("Prethodni mjesec")}
          disabled={disabled || Boolean(minDate && month <= minDate.slice(0, 7))}
          onClick={previous}
        >
          <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
        </button>
        <strong>{bookingMonth(month, locale)}</strong>
        <button
          type="button"
          aria-label={t("Sljedeći mjesec")}
          disabled={disabled || Boolean(maxDate && next > maxDate.slice(0, 7))}
          onClick={() => setMonth(next)}
        >
          <Icon name="chevron" />
        </button>
      </div>
      <div className={styles.weekdays} aria-hidden="true">
        {bookingWeekdays(locale).map((day, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: The seven weekdays never reorder.
          <span key={index}>{day}</span>
        ))}
      </div>
      <fieldset className={styles.days} aria-label={t("Odaberi dan termina")}>
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
              aria-label={bookingDate(`${key}T12:00:00Z`, "UTC", { locale })}
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
