import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "../components/directory/public-search.module.css";

export const metadata: Metadata = { title: "Stranica nije pronađena" };

// Unmatched URLs render outside the public route group, so this page carries its own brand link.
export default function NotFound() {
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link
        href="/"
        aria-label="AhiBizz — početna"
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
        <h1>Stranica nije pronađena.</h1>
        <p>Link je možda pogrešan ili je stranica uklonjena.</p>
        <p style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 14 }}>
          <Link className="text-link" href="/">
            Početna
          </Link>
          <Link className="text-link" href="/pretraga">
            Istraži djelatnosti
          </Link>
          <Link className="text-link" href="/pomoc">
            Pomoć
          </Link>
        </p>
      </section>
    </main>
  );
}
