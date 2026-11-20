import Link from "next/link";
import styles from "../../../components/support/resources.module.css";

export const metadata = { title: "Isticanje djelatnosti" };

export default function PromotionPage() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/">Početna</Link>
      <h1>Isticanje djelatnosti</h1>
      <section className={styles.section}>
        <h2>U kategoriji</h2>
        <p>
          Tvoja objavljena djelatnost ima prednost u svojoj kategoriji i ulazi u izbor istaknutih na
          početnoj. Isticanje traje 7 dana i košta 10 KM.
        </p>
        <Link href="/naplata">Odaberi djelatnost</Link>
      </section>
      <section className={styles.section}>
        <h2>Na lokaciji</h2>
        <p>
          Posjetioci koji su u blizini ili pretražuju tvoj grad vide te među lokalno istaknutim
          djelatnostima. U Mojim oglasima odaberi „Isticanje u blizini“ i broj dana.
        </p>
        <Link href="/nalog?odjeljak=oglasi">Otvori moje oglase</Link>
      </section>
      <section className={styles.section}>
        <h2>Na početnoj stranici</h2>
        <p>
          Oglas može biti baner ili istaknuta djelatnost koju vide posjetioci iz svih gradova.
        </p>
        <Link href="/nalog?odjeljak=oglasi">Zatraži ponudu za početnu</Link>
      </section>
      <section className={styles.section}>
        <h2>Isticanje uz paket</h2>
        <p>Poslovni i Premium paket uključuju dane isticanja za tvoju djelatnost.</p>
        <Link href="/paketi">Uporedi pakete</Link>
      </section>
    </main>
  );
}
