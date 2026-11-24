import Link from "next/link";
import { businessMediaUrl } from "../../lib/business-media";
import { reelCardPath } from "../../lib/reel-navigation";
import { type PublicReel, reelDuration, reelMedia } from "../../lib/reels";
import { getTranslator } from "../../server/i18n";
import { listPublicReels } from "../../server/reels/service";
import { currentReelViewer } from "../../server/reels/viewer";
import { BusinessLogo } from "../directory/BusinessLogo";
import { Icon } from "../Icon";
import styles from "./reels.module.css";

export function ReelCards({
  reels,
  shelf = false,
  businessScope = null,
  page = 1,
}: {
  reels: PublicReel[];
  shelf?: boolean;
  businessScope?: string | null;
  page?: number;
}) {
  return (
    <ul className={shelf ? styles.shelfCards : styles.cards}>
      {reels.map((reel) => (
        <li key={reel.id}>
          <Link
            href={reelCardPath(
              reel.id,
              businessScope,
              shelf ? (businessScope ? "profil" : "pocetna") : undefined,
              page,
            )}
            className={styles.reelCard}
            prefetch={false}
          >
            {reel.hasPoster && (
              // biome-ignore lint/performance/noImgElement: Already normalized and served with live publication checks.
              <img
                className={styles.poster}
                src={reelMedia(reel.id, "poster")}
                alt=""
                loading="lazy"
                decoding="async"
              />
            )}
            <span className={styles.reelBusiness}>
              <span className={styles.reelAvatar} aria-hidden="true">
                <BusinessLogo
                  src={
                    reel.businessLogo
                      ? businessMediaUrl(reel.businessId, reel.businessLogo)
                      : undefined
                  }
                  alt=""
                  sizes="30px"
                />
              </span>
              <span className={styles.businessName}>{reel.businessTitle}</span>
            </span>
            <span className={styles.cardText}>
              <strong>{reel.title}</strong>
              <span className={styles.duration}>
                <Icon name="play" />
                {reelDuration(reel.durationMs)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Shelf({ businessId }: { businessId: string | null }) {
  const reels = await listPublicReels(
    businessId,
    businessId ? 3 : 10,
    0,
    await currentReelViewer(),
  ).catch(() => []);
  if (!reels.length) return null;
  const t = await getTranslator();
  const listUrl = businessId ? `/reels?djelatnost=${businessId}` : "/reels";
  return (
    <section
      className={styles.shelf}
      aria-label={businessId ? t("Reels ove djelatnosti") : t("Reels djelatnosti")}
    >
      <header className={styles.sectionHeading}>
        <h2>{businessId ? "Reels" : t("Reels djelatnosti")}</h2>
        <Link href={listUrl} prefetch={false} aria-label={t("Sve Reels objave")}>
          {t("Sve objave")}
        </Link>
      </header>
      <ReelCards reels={reels} shelf businessScope={businessId} />
    </section>
  );
}

export function RecentReels() {
  return <Shelf businessId={null} />;
}
export function BusinessReels({ businessId }: { businessId: string }) {
  return <Shelf businessId={businessId} />;
}
