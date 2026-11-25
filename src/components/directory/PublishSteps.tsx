import type { ReactNode } from "react";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./publish.module.css";

/**
 * Publishing a business runs in five steps: category, basic data and place are one form that
 * saves a draft; photographs and the preview follow once that draft exists.
 */
export const publishSteps = 5;

/** The top of every step: a way out, the name of the flow and how far along it is. */
export function PublishHead({ step, onClose }: { step: number; onClose: () => void }) {
  const t = useT();
  const position = t("Korak {step} od {total}", { step, total: publishSteps });
  return (
    <>
      <header className={styles.head}>
        <button type="button" className={styles.close} aria-label={t("Zatvori")} onClick={onClose}>
          <Icon name="close" />
        </button>
        <strong>{t("Objavi djelatnost")}</strong>
        <span>{position}</span>
      </header>
      <div className={styles.dots} role="img" aria-label={position}>
        {Array.from({ length: publishSteps }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: The dots are a fixed row that never reorders.
          <span key={index} data-current={index + 1 === step || undefined} />
        ))}
      </div>
    </>
  );
}

/** What the step asks, in one heading and one line. */
export function PublishIntro({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.intro}>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

/** The actions of a step, kept within reach at the bottom of the screen. */
export function PublishBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}

export const publishStyles = styles;
