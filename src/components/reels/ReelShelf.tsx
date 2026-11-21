import Link from "next/link";
import { type PublicReel, reelDuration, reelMedia } from "../../lib/reels";
import { listPublicReels } from "../../server/reels/service";
import { currentReelViewer } from "../../server/reels/viewer";
import styles from "./reels.module.css";

export function ReelCards({
  reels,
  shelf = false,
  businessScope = null,
}: {
  reels: PublicReel[];
  shelf?: boolean;
  businessScope?: string | null;
}) {
  return (
    <ul className={shelf ? styles.shelfCards : styles.cards}>
      {reels.map((reel) => (
        <li key={reel.id}>
          <Link
            href={`/reels/${reel.id}${businessScope ? `?djelatnost=${businessScope}` : ""}`}
            className={styles.reelCard}
            prefetch={false}
          >
            <div className={styles.poster}>
              {reel.hasPoster && (
                // biome-ignore lint/performance/noImgElement: The server serves an already sized, normalized WebP with live publication checks.
                <img src={reelMedia(reel.id, "poster")} alt="" loading="lazy" decoding="async" />
              )}
              <span className={styles.play} aria-hidden="true">
                ▶
              </span>
              <span className={styles.duration}>{reelDuration(reel.durationMs)}</span>
            </div>
            <div className={styles.cardText}>
              <span>{reel.businessTitle}</span>
              <strong>{reel.title}</strong>
            </div>
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
  const listUrl = businessId ? `/reels?djelatnost=${businessId}` : "/reels";
  return (
    <section
      className={styles.shelf}
      aria-label={businessId ? "Reels ove djelatnosti" : "Reels djelatnosti"}
    >
      <header className={styles.sectionHeading}>
        <h2>{businessId ? "Reels" : "Reels djelatnosti"}</h2>
        <Link href={listUrl} prefetch={false}>
          Pogledaj sve <span aria-hidden="true">→</span>
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
