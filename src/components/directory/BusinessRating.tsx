"use client";

import { msg } from "../../lib/i18n/translate";
import { bosnianNumber } from "../../lib/number-format";
import type { ReviewSummary } from "../../lib/reviews";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./business-rating.module.css";

export function BusinessRating({ summary }: { summary?: ReviewSummary | null }) {
  const t = useT();
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
  const label = bosnianNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const last = summary.count % 10;
  const teen = summary.count % 100;
  const count = t(
    last >= 2 && last <= 4 && (teen < 12 || teen > 14)
      ? msg("{count} recenzije")
      : msg("{count} recenzija"),
    { count: summary.count },
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
