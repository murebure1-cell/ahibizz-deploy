"use client";

import { bosnianForm, msg } from "../../lib/i18n/translate";
import { localNumber } from "../../lib/number-format";
import type { ReviewSummary } from "../../lib/reviews";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./business-rating.module.css";

export function BusinessRating({
  summary,
  inline = false,
}: {
  summary?: ReviewSummary | null;
  /** One star, the value and the count on a single line, for a row of facts. */
  inline?: boolean;
}) {
  const { t, locale } = useI18n();
  if (
    !summary ||
    !Number.isInteger(summary.count) ||
    summary.count < 1 ||
    !Number.isInteger(summary.sum) ||
    summary.sum < summary.count ||
    summary.sum > summary.count * 5
  )
    return null;
  const value = summary.sum / summary.count;
  const label = localNumber(locale, value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const count = t(
    bosnianForm(
      summary.count,
      msg("{count} recenzija"),
      msg("{count} recenzije"),
      msg("{count} recenzija"),
    ),
    { count: summary.count },
  );
  if (inline)
    return (
      <span
        role="img"
        className={styles.inline}
        aria-label={`${t("{value} od 5", { value: label })} · ${count}`}
      >
        <Icon name="star" />
        <strong aria-hidden="true">{label}</strong>
        <small aria-hidden="true">{count}</small>
      </span>
    );
  return (
    <span
      role="img"
      className={styles.rating}
      aria-label={`${t("{value} od 5", { value: label })} · ${count}`}
    >
      <strong aria-hidden="true">{label}</strong>
      <span aria-hidden="true">
        <span className={styles.stars}>
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index}>
              <Icon name="star" />
              <span
                style={{
                  clipPath: `inset(0 ${100 - Math.min(1, Math.max(0, value - index)) * 100}% 0 0)`,
                }}
              >
                <Icon name="star" />
              </span>
            </span>
          ))}
        </span>
        <small>{count}</small>
      </span>
    </span>
  );
}
