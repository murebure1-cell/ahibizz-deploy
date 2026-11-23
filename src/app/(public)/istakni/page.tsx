import Link from "next/link";
import styles from "../../../components/support/resources.module.css";
import { IS_PLAY_EDITION } from "../../../lib/distribution";
import { promotionDurations, promotionKinds, promotionLabels } from "../../../lib/promotions";

export const metadata = { title: "Istakni djelatnost" };
export default function PromotePage() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>Istakni djelatnost</h1>
      {IS_PLAY_EDITION ? (
        <>
          <p>Ovaj odjeljak nije dostupan u aplikaciji.</p>
          <Link href="/">Na početnu</Link>
        </>
      ) : (
        <>
          <p>
            Objava djelatnosti je besplatna. Za dodatnu vidljivost odaberi mjesto i period
            isticanja.
          </p>
          <ul>
            {promotionKinds.map((kind) => (
              <li key={kind}>{promotionLabels[kind]}</li>
            ))}
          </ul>
          <p>
            Isticanje traje {promotionDurations.join(", ")} dana. Cijenu vidiš prije narudžbe. Ako
            je mjesto zauzeto, možeš odabrati prvi slobodan termin.
          </p>
          <p>
            Uplati bankovnim transferom prema uputama uz narudžbu. Isticanje uključujemo nakon
            potvrde uplate.
          </p>
          <Link className="button button-navy" href="/nalog/isticanja">
            Moja isticanja
          </Link>
        </>
      )}
    </main>
  );
}
