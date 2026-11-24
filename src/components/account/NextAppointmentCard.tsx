"use client";

import {
  appointmentCalendar,
  appointmentWhen,
  type NextAppointment,
} from "../../lib/next-appointment";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./overview.module.css";

export function NextAppointmentCard({ row, open }: { row: NextAppointment; open: () => void }) {
  const t = useT();
  const stay = row.kind === "stay";

  function download() {
    const url = URL.createObjectURL(
      new Blob([appointmentCalendar(row)], { type: "text/calendar;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ahibizz-termin.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <section className={styles.contracts} aria-label={t("Sljedeći termin")}>
      <header>
        <h2>{t("Sljedeći termin")}</h2>
      </header>
      <article className={styles.contract}>
        <div className={styles.contractName}>
          <span className={styles.mark}>
            <Icon name="calendar" />
          </span>
          <div>
            <h3>{row.name}</h3>
            <p>{row.businessTitle}</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>
              {stay
                ? t("Dolazak i odlazak")
                : row.kind === "rental"
                  ? t("Preuzimanje i vraćanje")
                  : t("Vrijeme termina")}
            </dt>
            <dd>{appointmentWhen(row)}</dd>
          </div>
          <div>
            <dt>{t("Status")}</dt>
            <dd>{row.status === "confirmed" ? t("Potvrđen") : t("Čeka potvrdu")}</dd>
          </div>
        </dl>
        <div className={styles.appointmentActions}>
          <button type="button" className={styles.manage} onClick={open}>
            {t("Moji termini")} <Icon name="chevron" />
          </button>
          {row.status === "confirmed" && (
            <button type="button" className={styles.manage} onClick={download}>
              <Icon name="calendar" /> Dodaj u kalendar
            </button>
          )}
        </div>
      </article>
    </section>
  );
}
