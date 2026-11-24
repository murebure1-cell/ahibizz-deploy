import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "../components/directory/public-search.module.css";
import { getTranslator } from "../server/i18n";

export const metadata: Metadata = { title: "Stranica nije pronađena" };

// Unmatched URLs render outside the public route group, so this page carries its own brand link.
export default async function NotFound() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link
        href="/"
        aria-label={t("AhiBizz — početna")}
        style={{ display: "inline-block", marginBottom: 24 }}
      >
        <Image
          src="/brand/ahi-logo-color.svg"
          alt="AhiBizz"
          width={148}
          height={40}
          unoptimized
          priority
        />
      </Link>
      <section className={styles.unavailable}>
        <h1>{t("Stranica nije pronađena.")}</h1>
        <p>{t("Link je možda pogrešan ili je stranica uklonjena.")}</p>
        <p style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 14 }}>
          <Link className="text-link" href="/">
            {t("Početna")}
          </Link>
          <Link className="text-link" href="/pretraga">
            {t("Istraži djelatnosti")}
          </Link>
          <Link className="text-link" href="/pomoc">
            {t("Pomoć")}
          </Link>
        </p>
      </section>
    </main>
  );
}
