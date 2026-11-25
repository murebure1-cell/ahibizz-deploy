import Link from "next/link";
import { notFound } from "next/navigation";
import { AhiLogo } from "../../../../components/brand/AhiLogo";
import styles from "../../../../components/directory/public-search.module.css";
import { ReelViewer } from "../../../../components/reels/ReelViewer";
import { reelClosePath } from "../../../../lib/reel-navigation";
import { getTranslator, titled } from "../../../../server/i18n";
import { readEndedReel, readPublicReel, readReelFeed } from "../../../../server/reels/service";
import { currentReelViewer } from "../../../../server/reels/viewer";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Reel djelatnosti");
export const viewport = { themeColor: "#0b0d10", viewportFit: "cover" as const };

export default async function ReelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    djelatnost?: string | string[];
    iz?: string | string[];
    stranica?: string | string[];
  }>;
}) {
  const [{ id }, filter, viewer] = await Promise.all([params, searchParams, currentReelViewer()]);
  const reel = await readPublicReel(id.toLowerCase(), viewer);
  if (!reel) {
    // Notifications and shared links outlive a Reel's 24 hours; explain that instead of a 404.
    const ended = await readEndedReel(id.toLowerCase(), viewer).catch(() => null);
    if (!ended) notFound();
    const t = await getTranslator();
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <Link
          href="/"
          className="brand"
          aria-label={t("AhiBizz — početna")}
          style={{ display: "inline-block", marginBottom: 24 }}
        >
          <AhiLogo decorative />
        </Link>
        <section className={styles.unavailable}>
          <h1>{t("Ovaj Reel je istekao.")}</h1>
          <p>
            {t("Reel je vidljiv 24 sata od objave. Djelatnost {name} i dalje možeš pogledati.", {
              name: ended.businessTitle,
            })}
          </p>
          <p style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 14 }}>
            <Link className="text-link" href={`/djelatnosti/${ended.businessId}`}>
              {t("Pogledaj djelatnost")}
            </Link>
            <Link className="text-link" href="/reels">
              {t("Ostali Reelsi")}
            </Link>
          </p>
        </section>
      </main>
    );
  }
  const businessId = filter.djelatnost === reel.businessId ? reel.businessId : null;
  const feed = await readReelFeed(reel.id, businessId, viewer).catch(() => ({
    items: [],
    // Let the browser retry the next batch while keeping the selected clip available.
    next: reel.id,
  }));
  return (
    <ReelViewer
      key={reel.id}
      initialReels={[reel, ...feed.items]}
      initialCursor={feed.next}
      businessId={businessId}
      closePath={reelClosePath(businessId, filter.iz, filter.stranica)}
    />
  );
}
