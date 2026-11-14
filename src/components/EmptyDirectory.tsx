import Link from "next/link";
import { Icon } from "./Icon";

export function EmptyDirectory({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="empty-directory">
      <span className="empty-icon">
        <Icon name="shop" />
      </span>
      <h2>
        {filtered
          ? "Ovdje još nema objavljenih djelatnosti."
          : "Pripremamo prostor za prve djelatnosti."}
      </h2>
      <p>Novi imenik tek nastaje. Profili će biti dostupni nakon objave.</p>
      <Link className="text-link" href={filtered ? "/pretraga" : "/o-nama"}>
        {filtered ? "Ukloni uslove pretrage" : "Upoznaj AhiBizz"}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
