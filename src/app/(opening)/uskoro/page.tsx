import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UnderConstruction } from "../../../components/opening/UnderConstruction";
import { beforeOpening, openingMoment, returnPath } from "../../../lib/opening";
import { getTranslator } from "../../../server/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("Uskoro otvaramo"), robots: { index: false, follow: false } };
}

/**
 * The page a visitor without an account sees until the app opens (see src/proxy.ts, which shows
 * it in place of the public pages, and lib/opening.ts, which holds the day). It stands outside
 * the public pages' frame on purpose: no header, no dock, no footer.
 */
export default async function OpeningPage({
  searchParams,
}: {
  searchParams: Promise<{ od?: string | string[] }>;
}) {
  const moment = openingMoment(process.env.AHIBIZZ_OPENING_AT);
  const now = Date.now();
  // Open already, or no opening set: this address has nothing to show.
  if (!beforeOpening(moment, now)) redirect("/");
  const { od } = await searchParams;
  return (
    <main id="glavni-sadrzaj" data-fullscreen="true">
      <UnderConstruction opensAt={moment} now={now} from={returnPath(od)} />
    </main>
  );
}
