import { businessAmenities, businessTimeLabel, businessWeekdays } from "../../lib/business-details";
import type { BusinessFields, DirectoryBusiness } from "../../server/directory/types";
import type { CategoryOption } from "./BusinessEditor";
import styles from "./directory.module.css";

const labels: Record<keyof BusinessFields, string> = {
  title: "Naziv",
  categoryId: "Kategorija",
  subcategoryId: "Potkategorija",
  description: "Opis",
  contactEmail: "Email",
  contactPhone: "Telefon",
  websiteUrl: "Web stranica",
  addressLine: "Adresa",
  city: "Grad",
  countryCode: "Država",
  latitude: "Geografska širina",
  longitude: "Geografska dužina",
};

export function BusinessChanges({
  business,
  categories,
}: {
  business: DirectoryBusiness;
  categories: CategoryOption[];
}) {
  const revision = business.editorialRevision;
  const details = revision?.details;
  function display(key: keyof BusinessFields, value: BusinessFields[keyof BusinessFields]) {
    if (value === null) return "—";
    if (key === "categoryId" || key === "subcategoryId")
      return categories.find((entry) => entry.id === value)?.name ?? value;
    return String(value);
  }
  return (
    <details className={styles.proposal}>
      <summary>Izmjene na pregledu</summary>
      <dl>
        {Object.entries(revision?.fields ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>{labels[key as keyof BusinessFields]}</dt>
            <dd>
              {display(key as keyof BusinessFields, business[key as keyof BusinessFields])} →{" "}
              {display(key as keyof BusinessFields, value)}
            </dd>
          </div>
        ))}
        {details && (
          <>
            <div>
              <dt>Sadržaji</dt>
              <dd>
                {details.amenities
                  .map((id) => businessAmenities.find((entry) => entry.id === id)?.label)
                  .join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt>Radno vrijeme</dt>
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
                      .join(", ") || "Zatvoreno"}
                  </div>
                ))}
              </dd>
            </div>
          </>
        )}
        {business.pendingMedia && (
          <div>
            <dt>Fotografije</dt>
            <dd>Pregledaj predložene fotografije prije odluke.</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
