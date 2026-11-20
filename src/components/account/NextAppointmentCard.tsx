"use client";

import { appointmentCalendar, type NextAppointment } from "../../lib/next-appointment";
import { Icon } from "../Icon";
import styles from "./overview.module.css";

export function NextAppointmentCard({ row, open }: { row: NextAppointment; open: () => void }) {
  const stay = row.kind === "stay";
  const format = new Intl.DateTimeFormat("bs", {
    timeZone: stay ? "UTC" : row.timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(stay ? {} : { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
  });
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
    <section className={styles.contracts} aria-label="Sljedeći termin">
      <header>
        <h2>Sljedeći termin</h2>
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
                ? "Dolazak i odlazak"
                : row.kind === "rental"
                  ? "Preuzimanje i vraćanje"
                  : "Vrijeme termina"}
            </dt>
            <dd>{format.formatRange(new Date(row.startsAt), new Date(row.endsAt))}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{row.status === "confirmed" ? "Potvrđen" : "Čeka potvrdu"}</dd>
          </div>
        </dl>
        <div className={styles.appointmentActions}>
          <button type="button" className={styles.manage} onClick={open}>
            Moji termini <Icon name="chevron" />
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
