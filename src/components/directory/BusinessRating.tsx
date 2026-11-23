import { bosnianNumber } from "../../lib/number-format";
import type { ReviewSummary } from "../../lib/reviews";
import { Icon } from "../Icon";
import styles from "./business-rating.module.css";

export function BusinessRating({ summary }: { summary?: ReviewSummary | null }) {
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
  const noun = last >= 2 && last <= 4 && (teen < 12 || teen > 14) ? "recenzije" : "recenzija";
  return (
    <span
      role="img"
      className={styles.rating}
      aria-label={`${label} od 5 · ${summary.count} ${noun}`}
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
        <small>
          {summary.count} {noun}
        </small>
      </span>
    </span>
  );
}
