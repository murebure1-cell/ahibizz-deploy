import Link from "next/link";
import styles from "../../../../components/directory/public-search.module.css";

export default function BusinessNotFound() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.unavailable}>
        <h1>Profil nije pronađen.</h1>
        <p>Možda je uklonjen ili još nije objavljen.</p>
        <Link className="text-link" href="/pretraga">
          Istraži djelatnosti
        </Link>
      </section>
    </main>
  );
}
