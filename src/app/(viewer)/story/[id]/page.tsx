import { redirect } from "next/navigation";
import { StoryViewer } from "../../../../components/reels/StoryViewer";
import { businessUuid } from "../../../../lib/business-today";
import { titled } from "../../../../server/i18n";
import { listPublicReels } from "../../../../server/reels/service";
import { currentReelViewer } from "../../../../server/reels/viewer";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Reels djelatnosti", {
  robots: { index: false, follow: false },
});
export const viewport = { themeColor: "#0b0d10", viewportFit: "cover" as const };

/**
 * A business's live Reels as a story, oldest first, opened from the ring on its profile or on its
 * owner's personal profile. "?osoba=<id>" returns to that personal profile when it ends.
 */
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ osoba?: string | string[] }>;
}) {
  const [{ id }, { osoba }] = await Promise.all([params, searchParams]);
  const businessId = id.toLowerCase();
  if (!businessUuid(businessId)) redirect("/reels");
  const person = typeof osoba === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(osoba) ? osoba : null;
  const closeHref = person ? `/ljudi/${encodeURIComponent(person)}` : `/djelatnosti/${businessId}`;
  const reels = await listPublicReels(businessId, 20, 0, await currentReelViewer()).catch(() => []);
  if (!reels.length) redirect(closeHref);
  return <StoryViewer reels={[...reels].reverse()} closeHref={closeHref} />;
}
