import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AnalyticsScreen } from "../../../../components/account/AnalyticsScreen";
import { rowStyles } from "../../../../components/ui/Rows";
import { type AnalyticsPeriod, analyticsPeriods } from "../../../../lib/account-analytics";
import { getAuthService } from "../../../../server/auth/service";
import { titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Analitika", { robots: { index: false, follow: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** "Analitika", opened from the two numbers on "Moj profil". */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ djelatnost?: string | string[]; dana?: string | string[] }>;
}) {
  const auth = getAuthService();
  const session = auth ? await auth.api.getSession({ headers: await headers() }) : null;
  if (!session?.user?.id) redirect(`/prijava?nastavi=${encodeURIComponent("/nalog/analitika")}`);
  const query = await searchParams;
  const business =
    typeof query.djelatnost === "string" && uuid.test(query.djelatnost)
      ? query.djelatnost.toLowerCase()
      : null;
  const days = analyticsPeriods.includes(Number(query.dana) as AnalyticsPeriod)
    ? (Number(query.dana) as AnalyticsPeriod)
    : 30;
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <AnalyticsScreen
        key={`${business}:${days}`}
        accountId={session.user.id}
        business={business}
        days={days}
      />
    </main>
  );
}
