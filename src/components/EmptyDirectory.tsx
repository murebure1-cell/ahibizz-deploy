import Link from "next/link";
import { Icon } from "./Icon";

export function EmptyDirectory({
  filtered = false,
  withoutOpenFilter,
}: {
  filtered?: boolean;
  withoutOpenFilter?: string;
}) {
  return (
    <div className="empty-directory">
      <span className="empty-icon">
        <Icon name="shop" />
      </span>
      <h2>
        {withoutOpenFilter
          ? "Nema rezultata za „Otvoreno sada“."
          : filtered
            ? "Nema rezultata za ovu pretragu."
            : "Pripremamo prostor za prve djelatnosti."}
      </h2>
      {!withoutOpenFilter && (
        <p>
          {filtered
            ? "Pokušaj s drugim nazivom ili proširi područje pretrage."
            : "Ovdje ćeš pronaći prve objavljene profile."}
        </p>
      )}
      <Link className="text-link" href={withoutOpenFilter ?? (filtered ? "/pretraga" : "/o-nama")}>
        {withoutOpenFilter
          ? "Prikaži i ostale djelatnosti"
          : filtered
            ? "Ukloni uslove pretrage"
            : "Upoznaj AhiBizz"}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
