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
import nearbyStyles from "./nearby.module.css";

export function HomeNearbyGroups({
  local,
  organic,
  expanded = false,
}: {
  local: ReactNode[];
  organic: ReactNode[];
  expanded?: boolean;
}) {
  function show(items: ReactNode[], label: string) {
    return expanded ? (
      <div className={styles.nearbyGrid}>{items}</div>
    ) : (
      <HomeRail listings label={label} className={styles.businessGrid}>
        {items.slice(0, 4)}
      </HomeRail>
    );
  }
  return (
    <>
      <div className={nearbyStyles.group} data-design="home-local-featured">
        <h3>Istaknuto na tvojoj lokaciji</h3>
        {local.length ? (
          show(local, "Istaknuto na tvojoj lokaciji")
        ) : (
          <p className={styles.availability}>Trenutno nema lokalnih isticanja.</p>
        )}
      </div>
      {organic.length > 0 && (
        <div className={nearbyStyles.group}>
          <h3>Djelatnosti u blizini</h3>
          {show(organic, "Djelatnosti u blizini")}
        </div>
      )}
    </>
  );
}

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

export function HomePromotionSection({
  title,
  href,
  kind,
  cards,
}: {
  title: string;
  href: string;
  kind: "featured" | "category-featured";
  cards: ReactNode[] | null;
}) {
  const id = `${kind}-heading`;
  const count = cards?.length ?? 0;
  if (kind === "featured" && count === 0) return null;
  return (
    <section
      className={`${styles.container} ${styles.section}`}
      data-design={`home-${kind}`}
      data-empty={kind === "category-featured" && count === 0 ? true : undefined}
      aria-labelledby={id}
    >
      <div className={styles.sectionHeading}>
        <h2 id={id}>{title}</h2>
        {count > 0 && (
          <Link href={href} className={styles.subtleLink}>
            Pogledaj sve <Icon name="chevron" />
          </Link>
        )}
      </div>
      {count > 0 ? (
        <HomeRail listings label={title} className={styles.businessGrid}>
          {cards}
        </HomeRail>
      ) : (
        <p className={styles.availability}>
          {cards ? "Nema aktivnih isticanja." : "Imenik trenutno nije dostupan."}
        </p>
      )}
    </section>
  );
}

export function HomeNearbySection({
  title,
  control,
  before,
  children,
}: {
  title: string;
  control?: ReactNode;
  before?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      className={`${styles.container} ${styles.section}`}
      aria-labelledby="nearby-heading"
      data-design="home-nearby"
    >
      <div className={styles.sectionHeading}>
        <h2 id="nearby-heading">{title}</h2>
        {control}
      </div>
      {before}
      <div className={styles.nearbyGrid}>{children}</div>
    </section>
  );
}

/** The live directory and the isolated fixture use one visual surface with separate data adapters. */
export function HomeSurface({
  design = defaultVisualDesign(),
  searchAction,
  placeField,
  place = "",
  categories = [],
  discovery,
  featured,
  featuredHref,
  categoryFeatured = [],
  nearby,
  nearbyControl,
  nearbyBefore,
  advertisingHref,
  banner,
  slots,
  creditsHref,
  after,
}: {
  design?: VisualDesign;
  searchAction: "/pretraga" | "/pregled/pretraga";
  placeField: "mjesto" | "place";
  place?: string;
  categories?: readonly HomeCategory[];
  discovery?: ReactNode;
  featured?: ReactNode;
  featuredHref: string;
  categoryFeatured?: ReactNode[];
  nearby?: ReactNode;
  nearbyControl?: ReactNode;
  nearbyBefore?: ReactNode;
  advertisingHref: string;
  banner?: { id: string; title: string; city: string; image: string | null } | null;
  slots?: {
    categories?: ReactNode;
    featured?: ReactNode;
    categoryFeatured?: ReactNode;
    nearby?: ReactNode;
    floatingAd?: ReactNode;
    inlineAd?: (fallback: ReactNode) => ReactNode;
  };
  creditsHref?: string;
  after?: ReactNode;
}) {
  const titles = design.sectionTitles ?? {};
  const sections: Record<string, ReactNode> = {
    featured: slots?.featured ?? (
      <HomePromotionSection
        kind="featured"
        title={titles.featured || "Istaknute djelatnosti"}
        href={featuredHref}
        cards={featured ? [featured] : []}
      />
    ),
    categoryFeatured: slots?.categoryFeatured ?? (
      <HomePromotionSection
        kind="category-featured"
        title={titles.categoryFeatured || "Istaknuto u kategoriji"}
        href={searchAction === "/pretraga" ? "/pretraga?istaknute=kategorija" : searchAction}
        cards={categoryFeatured}
      />
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
    nearby: slots?.nearby ?? (
      <HomeNearbySection
        title={titles.nearby || "Blizu tebe"}
        control={nearbyControl}
        before={nearbyBefore}
      >
        {nearby}
      </HomeNearbySection>
    ),
    logos: <HomeLogoMarquee title={titles.logos} />,
    promotion: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.callout}`}
        data-design="home-promotion"
        aria-labelledby="promotion-heading"
      >
        <Link
          href="/oglasavanje"
          className={styles.calloutLink}
          aria-labelledby="promotion-heading"
        >
          <span aria-hidden="true" className={styles.calloutIcon}>
            <Icon name="star" />
          </span>
          <h2 id="promotion-heading">{titles.promotion || "Istakni svoju djelatnost"}</h2>
          <Icon name="chevron" className={styles.calloutArrow} />
        </Link>
      </section>
    ),
    community: (
      <section
        className={`${styles.container} ${styles.callout} ${styles.community}`}
        data-design="home-community"
        aria-labelledby="community-heading"
      >
        <Link href="/o-nama" className={styles.calloutLink} aria-labelledby="community-heading">
          <span aria-hidden="true" className={styles.calloutIcon}>
            <Icon name="people" />
          </span>
          <h2 id="community-heading">{titles.community || "AhiBizz zajednica"}</h2>
          <Icon name="chevron" className={styles.calloutArrow} />
        </Link>
      </section>
    ),
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
  const reelStrip = discovery && (
    <div className={`${styles.container} ${styles.reelStrip}`}>{discovery}</div>
  );
  const hasAd = design.homeOrder.includes("ad");

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
      {slots?.categories ?? (
        <HomeCategories
          categories={categories}
          searchAction={
            place ? `${searchAction}?${new URLSearchParams({ [placeField]: place })}` : searchAction
          }
        />
      )}
      {!hasAd && reelStrip}
      {hasAd && slots?.floatingAd}
      {design.homeOrder.map((id) => (
        <Fragment key={id}>
          {id === "ad" && slots?.inlineAd ? slots.inlineAd(sections.ad) : sections[id]}
          {id === "ad" && reelStrip}
        </Fragment>
      ))}
      {after}
    </main>
  );
}
