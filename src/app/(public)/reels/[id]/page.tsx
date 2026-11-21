import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../../../components/reels/reels.module.css";
import { reelDuration, reelMedia } from "../../../../lib/reels";
import { readPublicReel, reelNeighbors } from "../../../../server/reels/service";
import { currentReelViewer } from "../../../../server/reels/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reel djelatnosti" };

export default async function ReelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ djelatnost?: string | string[] }>;
}) {
  const [{ id }, filter, viewer] = await Promise.all([params, searchParams, currentReelViewer()]);
  const reel = await readPublicReel(id.toLowerCase());
  if (!reel) notFound();
  const scope = filter.djelatnost === reel.businessId ? reel.businessId : null;
  const suffix = scope ? `?djelatnost=${scope}` : "";
  const { previous, next } = await reelNeighbors(reel, scope, viewer).catch(() => ({
    previous: null,
    next: null,
  }));
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href={`/reels${suffix}`} className={styles.back}>
        ← {scope ? "Reels djelatnosti" : "Svi reels"}
      </Link>
      <article className={styles.watch}>
        {/* biome-ignore lint/a11y/useMediaCaption: Authors may caption clips in the video and supply a textual description immediately beside it. */}
        <video
          controls
          playsInline
          preload="none"
          src={reelMedia(reel.id, "video")}
          poster={reel.hasPoster ? reelMedia(reel.id, "poster") : undefined}
          aria-label={reel.title}
        />
        <header className={styles.detail}>
          <Link href={`/djelatnosti/${reel.businessId}`}>{reel.businessTitle} →</Link>
          <h1>{reel.title}</h1>
          <p>
            {reel.city ? `${reel.city} · ` : ""}
            {reelDuration(reel.durationMs)}
          </p>
          {reel.caption && <p>{reel.caption}</p>}
        </header>
      </article>
      {(previous || next) && (
        <nav className={styles.pagination} aria-label="Promijeni reel">
          {previous && (
            <Link href={`/reels/${previous}${suffix}`} prefetch={false}>
              ← Prethodni reel
            </Link>
          )}
          {next && (
            <Link href={`/reels/${next}${suffix}`} prefetch={false}>
              Sljedeći reel →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
