import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { HomeCategory } from "../../lib/home";
import { Icon, type IconName } from "../Icon";
import { HomeLogoMarquee } from "./HomeLogoMarquee";
import styles from "./home.module.css";

export function HomeEmptyState({
  children,
  icon = "shop",
}: {
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={styles.empty}>
      <span>
        <Icon name={icon} />
      </span>
      <p>{children}</p>
    </div>
  );
}

/** The live directory and the isolated fixture use one visual surface with separate data adapters. */
export function HomeSurface({
  searchAction,
  placeField,
  place = "",
  categories,
  featured,
  featuredHref,
  nearby,
  nearbyControl,
  nearbyBefore,
  advertisingHref,
  creditsHref,
  after,
}: {
  searchAction: "/pretraga" | "/pregled/pretraga";
  placeField: "mjesto" | "place";
  place?: string;
  categories: readonly HomeCategory[];
  featured: ReactNode;
  featuredHref: string;
  nearby: ReactNode;
  nearbyControl: ReactNode;
  nearbyBefore?: ReactNode;
  advertisingHref: string;
  creditsHref?: string;
  after?: ReactNode;
}) {
  return (
    <main id="glavni-sadrzaj" className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title">
        <Image
          className={styles.heroPhoto}
          src="/preview/hero.webp"
          alt=""
          fill
          sizes="100vw"
          fetchPriority="high"
        />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <div className={styles.heroLocation}>
            <Icon name="pin" /> Ljudi i poslovi, blizu tebe
          </div>
          <h1 id="home-title">
            Pronađi pravu
            <br />
            uslugu<span>.</span>
          </h1>
          <p>Od dobrog majstora do mjesta za predah.</p>
          <Form action={searchAction} className={styles.search}>
            <label>
              <Icon name="search" />
              <span className={styles.srOnly}>Naziv ili usluga</span>
              <input type="search" name="q" placeholder="Šta tražiš?" maxLength={120} />
            </label>
            <label className={styles.searchPlace}>
              <Icon name="pin" />
              <span className={styles.srOnly}>Grad ili mjesto</span>
              <input
                name={placeField}
                placeholder="Grad ili mjesto"
                defaultValue={place}
                maxLength={100}
              />
            </label>
            <button type="submit" className={styles.searchSubmit} aria-label="Pretraži djelatnosti">
              <Icon name="search" />
              <span>Pretraži</span>
            </button>
          </Form>
        </div>
      </section>
      <nav
        className={`${styles.container} ${styles.categories}`}
        aria-label="Kategorije djelatnosti"
      >
        {categories.length ? (
          categories.map((category) => (
            <Link key={category.id} href={category.href}>
              <span>
                <Icon name={category.icon ?? "shop"} />
              </span>
              {category.label}
            </Link>
          ))
        ) : (
          <Link href={searchAction}>
            <span>
              <Icon name="search" />
            </span>
            Sve djelatnosti
          </Link>
        )}
      </nav>
      <section
        className={`${styles.container} ${styles.section}`}
        aria-labelledby="featured-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>IZ CIJELE ZAJEDNICE</span>
            <h2 id="featured-heading">Istaknute djelatnosti</h2>
          </div>
          <Link href={featuredHref} className={styles.subtleLink}>
            Pogledaj sve <Icon name="chevron" />
          </Link>
        </div>
        <div className={styles.businessGrid}>{featured}</div>
      </section>
      <section className={`${styles.container} ${styles.ad}`} aria-label="Oglasni prostor">
        <div>
          <span className={styles.kicker}>OGLASNI PROSTOR</span>
          <h2>
            Tvoj posao.
            <br />
            Na pravom mjestu.
          </h2>
        </div>
        <Link href={advertisingHref} className={`${styles.button} ${styles.buttonDark}`}>
          Oglasi se <Icon name="chevron" />
        </Link>
        <span className={styles.adMark} aria-hidden="true">
          a.
        </span>
      </section>
      <section className={`${styles.container} ${styles.section}`} aria-labelledby="nearby-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>U KOMŠILUKU</span>
            <h2 id="nearby-heading">Blizu tebe</h2>
          </div>
          {nearbyControl}
        </div>
        {nearbyBefore}
        <div className={styles.nearbyGrid}>{nearby}</div>
      </section>
      <HomeLogoMarquee />
      <section
        className={`${styles.container} ${styles.credits}`}
        aria-labelledby="credits-heading"
      >
        <div className={styles.creditsIcon} aria-hidden="true">
          a<span>c</span>
        </div>
        <div>
          <span className={styles.kicker}>AHI CREDITS</span>
          <h2 id="credits-heading">
            Daj svom poslu
            <br />
            više prostora.
          </h2>
          <p>Istakni se tamo gdje te ljudi traže.</p>
        </div>
        {creditsHref ? (
          <Link href={creditsHref} className={styles.button}>
            Upoznaj Credits <Icon name="chevron" />
          </Link>
        ) : (
          <span className={styles.preparing}>U pripremi</span>
        )}
      </section>
      {after}
    </main>
  );
}
