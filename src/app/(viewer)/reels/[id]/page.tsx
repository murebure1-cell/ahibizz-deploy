import { notFound } from "next/navigation";
import { ReelViewer } from "../../../../components/reels/ReelViewer";
import { reelClosePath } from "../../../../lib/reel-navigation";
import { readPublicReel, readReelFeed } from "../../../../server/reels/service";
import { currentReelViewer } from "../../../../server/reels/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reel djelatnosti" };
export const viewport = { themeColor: "#0b1725", viewportFit: "cover" as const };

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
  if (!reel) notFound();
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
