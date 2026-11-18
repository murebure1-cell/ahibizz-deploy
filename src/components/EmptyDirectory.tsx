import Link from "next/link";
import { Icon } from "./Icon";

export function EmptyDirectory({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="empty-directory">
      <span className="empty-icon">
        <Icon name="shop" />
      </span>
      <h2>
        {filtered ? "Nema rezultata za ovu pretragu." : "Pripremamo prostor za prve djelatnosti."}
      </h2>
      <p>
        {filtered
          ? "Pokušaj s drugim nazivom ili proširi područje pretrage."
          : "Ovdje ćeš pronaći prve objavljene profile."}
      </p>
      <Link className="text-link" href={filtered ? "/pretraga" : "/o-nama"}>
        {filtered ? "Ukloni uslove pretrage" : "Upoznaj AhiBizz"}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
