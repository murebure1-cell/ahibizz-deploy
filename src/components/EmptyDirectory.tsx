"use client";

import Link from "next/link";
import { Icon } from "./Icon";
import { useT } from "./i18n/LocaleProvider";

export function EmptyDirectory({
  filtered = false,
  withoutOpenFilter,
}: {
  filtered?: boolean;
  withoutOpenFilter?: string;
}) {
  const t = useT();
  return (
    <div className="empty-directory">
      <span className="empty-icon">
        <Icon name="shop" />
      </span>
      <h2>
        {withoutOpenFilter
          ? t("Nema rezultata za „Otvoreno sada“.")
          : filtered
            ? t("Nema rezultata za ovu pretragu.")
            : t("Pripremamo prostor za prve djelatnosti.")}
      </h2>
      {!withoutOpenFilter && (
        <p>
          {filtered
            ? t("Pokušaj s drugim nazivom ili proširi područje pretrage.")
            : t("Ovdje ćeš pronaći prve objavljene profile.")}
        </p>
      )}
      <Link className="text-link" href={withoutOpenFilter ?? (filtered ? "/pretraga" : "/o-nama")}>
        {withoutOpenFilter
          ? t("Prikaži i ostale djelatnosti")
          : filtered
            ? t("Ukloni uslove pretrage")
            : t("Upoznaj AhiBizz")}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
