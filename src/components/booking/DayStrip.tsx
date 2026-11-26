"use client";
import { useEffect, useState } from "react";
import { bookingDate, bookingMonth, bookingShortDay } from "../../lib/booking";
import { addDays } from "../../lib/booking-time";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./booking-panel.module.css";

/**
 * A week of days to choose from, as drawn: seven chips with the day's short name and its number.
 * The arrows move by a week between the first and the last day that can be chosen, and the week
 * on show follows the chosen day.
 */
export function DayStrip({
  date,
  onChange,
  minDate,
  maxDate,
  disabled = false,
}: {
  date: string;
  onChange: (date: string) => void;
  minDate: string;
  maxDate: string;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const [start, setStart] = useState(minDate);
  useEffect(() => {
    // The chosen day stays in view: the week moves in sevens from the first day until it holds it.
    setStart((current) => {
      if (date < minDate) return minDate;
      let week = current < minDate ? minDate : current;
      while (date < week) week = addDays(week, -7);
      while (date > addDays(week, 6)) week = addDays(week, 7);
      return week < minDate ? minDate : week;
    });
  }, [date, minDate]);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const last = days[6] ?? start;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3>{t("Dan")}</h3>
        <span>{bookingMonth((days[3] ?? start).slice(0, 7), locale)}</span>
        <button
          type="button"
          className={styles.weekStep}
          aria-label={t("Prethodna sedmica")}
          disabled={disabled || start <= minDate}
          onClick={() => setStart(addDays(start, -7) < minDate ? minDate : addDays(start, -7))}
        >
          <Icon name="chevron" data-back="" />
        </button>
        <button
          type="button"
          className={styles.weekStep}
          aria-label={t("Sljedeća sedmica")}
          disabled={disabled || last >= maxDate}
          onClick={() => setStart(addDays(start, 7))}
        >
          <Icon name="chevron" />
        </button>
      </div>
      <fieldset className={styles.days} aria-label={t("Odaberi dan termina")}>
        {days.map((day) => (
          <button
            type="button"
            key={day}
            className={styles.day}
            aria-pressed={date === day}
            aria-label={bookingDate(`${day}T12:00:00Z`, "UTC", { locale })}
            disabled={disabled || day > maxDate}
            onClick={() => onChange(day)}
          >
            <span>{bookingShortDay(day, locale)}</span>
            <strong>{Number(day.slice(8))}</strong>
          </button>
        ))}
      </fieldset>
    </div>
  );
}
