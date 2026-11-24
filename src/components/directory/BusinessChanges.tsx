import { businessAmenities, businessTimeLabel, businessWeekdays } from "../../lib/business-details";
import { msg } from "../../lib/i18n/translate";
import type { BusinessFields, DirectoryBusiness } from "../../server/directory/types";
import { useT } from "../i18n/LocaleProvider";
import type { CategoryOption } from "./BusinessEditor";
import styles from "./directory.module.css";

const labels: Record<keyof BusinessFields, string> = {
  title: msg("Naziv"),
  categoryId: msg("Kategorija"),
  subcategoryId: msg("Potkategorija"),
  description: msg("Opis"),
  contactEmail: "Email",
  contactPhone: msg("Telefon"),
  websiteUrl: msg("Web stranica"),
  addressLine: msg("Adresa"),
  city: msg("Grad"),
  countryCode: msg("Država"),
  latitude: msg("Geografska širina"),
  longitude: msg("Geografska dužina"),
};

export function BusinessChanges({
  business,
  categories,
}: {
  business: DirectoryBusiness;
  categories: CategoryOption[];
}) {
  const t = useT();
  const revision = business.editorialRevision;
  const details = revision?.details;
  function display(key: keyof BusinessFields, value: BusinessFields[keyof BusinessFields]) {
    if (value === null) return "—";
    if (key === "categoryId" || key === "subcategoryId")
      return t(categories.find((entry) => entry.id === value)?.name ?? String(value));
    return String(value);
  }
  return (
    <details className={styles.proposal}>
      <summary>{t("Izmjene na pregledu")}</summary>
      <dl>
        {Object.entries(revision?.fields ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>{t(labels[key as keyof BusinessFields])}</dt>
            <dd>
              {display(key as keyof BusinessFields, business[key as keyof BusinessFields])} ·
              Predloženo: {display(key as keyof BusinessFields, value)}
            </dd>
          </div>
        ))}
        {details && (
          <>
            <div>
              <dt>{t("Sadržaji")}</dt>
              <dd>
                {details.amenities
                  .map((id) => businessAmenities.find((entry) => entry.id === id)?.label)
                  .join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Radno vrijeme")}</dt>
              <dd>
                {details.timezone ?? "—"}
                {details.hours?.map((day) => (
                  <div key={day.weekday}>
                    {businessWeekdays[day.weekday - 1]} ·{" "}
                    {day.windows
                      .map(
                        (win) =>
                          businessTimeLabel(win.startMinute) +
                          "–" +
                          businessTimeLabel(win.endMinute),
                      )
                      .join(", ") || t("Zatvoreno")}
                  </div>
                ))}
              </dd>
            </div>
          </>
        )}
        {business.pendingMedia && (
          <div>
            <dt>{t("Fotografije")}</dt>
            <dd>{t("Pregledaj predložene fotografije prije odluke.")}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
