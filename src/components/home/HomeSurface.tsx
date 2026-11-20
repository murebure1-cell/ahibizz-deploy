import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HomeCategory } from "../../lib/home";
import {
  defaultVisualDesign,
  homeCoverId,
  homeCoverPhotos,
  type VisualDesign,
} from "../../lib/visual-design";
import { Icon, type IconName } from "../Icon";
import { HomeCategories } from "./HomeCategories";
import { HomeLogoMarquee } from "./HomeLogoMarquee";
import { HomeRail } from "./HomeRail";
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
  design = defaultVisualDesign(),
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
  banner,
  creditsHref,
  after,
}: {
  design?: VisualDesign;
  searchAction: "/pretraga" | "/pregled/pretraga";
  placeField: "mjesto" | "place";
  place?: string;
  categories: readonly HomeCategory[];
  featured?: ReactNode;
  featuredHref: string;
  nearby: ReactNode;
  nearbyControl: ReactNode;
  nearbyBefore?: ReactNode;
  advertisingHref: string;
  banner?: { id: string; title: string; city: string; image: string | null } | null;
  creditsHref?: string;
  after?: ReactNode;
}) {
  const titles = design.sectionTitles ?? {};
  const sections: Record<string, ReactNode> = {
    featured: featured && (
      <section
        className={`${styles.container} ${styles.section}`}
        data-design="home-featured"
        aria-labelledby="featured-heading"
      >
        <div className={styles.sectionHeading}>
          <h2 id="featured-heading">{titles.featured || "Istaknute djelatnosti"}</h2>
          <Link href={featuredHref} className={styles.subtleLink}>
            Pogledaj sve <Icon name="chevron" />
          </Link>
        </div>
        <HomeRail
          listings
          label={titles.featured || "Istaknute djelatnosti"}
          className={styles.businessGrid}
        >
          {featured}
        </HomeRail>
      </section>
    ),
    ad: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.ad}`}
        aria-label="Oglasni prostor"
        data-design="home-ad"
      >
        {banner?.image && (
          <div aria-hidden="true" className={styles.sponsorBackdrop}>
            <Image
              src={banner.image}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 800px) 100vw, 1100px"
            />
          </div>
        )}
        <div className={banner?.image ? styles.adOnPhoto : undefined}>
          <span className={styles.kicker}>{banner ? "SPONZORIRANO" : "OGLASNI PROSTOR"}</span>
          <h2>{banner?.title || titles.ad || "Tvoj posao.\nNa pravom mjestu."}</h2>
          {banner?.city && <small>{banner.city}</small>}
        </div>
        <Link
          href={banner ? `/djelatnosti/${banner.id}` : advertisingHref}
          className={`${styles.button} ${styles.buttonDark}`}
        >
          {banner ? "Pogledaj djelatnost" : "Oglasi se"} <Icon name="chevron" />
        </Link>
        {!banner && (
          <span className={styles.adMark} aria-hidden="true">
            a.
          </span>
        )}
      </section>
    ),
    nearby: (
      <section
        className={`${styles.container} ${styles.section}`}
        aria-labelledby="nearby-heading"
        data-design="home-nearby"
      >
        <div className={styles.sectionHeading}>
          <h2 id="nearby-heading">{titles.nearby || "Blizu tebe"}</h2>
          {nearbyControl}
        </div>
        {nearbyBefore}
        <div className={styles.nearbyGrid}>{nearby}</div>
      </section>
    ),
    logos: <HomeLogoMarquee title={titles.logos} />,
    credits: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.credits}`}
        data-design="home-credits"
        aria-labelledby="credits-heading"
      >
        <div className={styles.creditsIcon} aria-hidden="true">
          a<span>c</span>
        </div>
        <div>
          <span className={styles.kicker}>AHI CREDITS</span>
          <h2 id="credits-heading">{titles.credits || "Daj svom poslu\nviše prostora."}</h2>
          <p>Istakni se tamo gdje te ljudi traže.</p>
        </div>
        {creditsHref ? (
          <Link href={creditsHref} className={styles.button}>
            Moji krediti <Icon name="chevron" />
          </Link>
        ) : (
          <span className={styles.preparing}>U pripremi</span>
        )}
      </section>
    ),
  };
  return (
    <main id="glavni-sadrzaj" className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title" data-design="home-hero">
        <Image
          className={styles.heroPhoto}
          data-design="home-photo"
          src={homeCoverPhotos[homeCoverId(design.heroImage)].src}
          alt=""
          fill
          sizes="100vw"
          fetchPriority="high"
        />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <h1 id="home-title" data-design="home-title">
            {design.heroTitle.endsWith(".") ? (
              <>
                {design.heroTitle.slice(0, -1)}
                <span>.</span>
              </>
            ) : (
              design.heroTitle
            )}
          </h1>
          {design.heroSubtitle && <p className={styles.heroSubtitle}>{design.heroSubtitle}</p>}
          <Form action={searchAction} className={styles.search} data-design="home-search">
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
            <button
              type="submit"
              className={styles.searchSubmit}
              aria-label="Pretraži djelatnosti"
              data-design="home-search-submit"
            >
              <Icon name="search" />
              <span>Pretraži</span>
            </button>
          </Form>
        </div>
      </section>
      <HomeCategories categories={categories} searchAction={searchAction} />
      {design.homeOrder.map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
      {after}
    </main>
  );
}
