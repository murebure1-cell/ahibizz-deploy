import { notFound, redirect } from "next/navigation";
import { RequestScreen } from "../../../components/support/RequestScreen";
import { reportHelpPath } from "../../../lib/help-center";
import { supportTarget } from "../../../lib/support-requests";
import { titled } from "../../../server/i18n";
export const generateMetadata = titled("Prijavi sadržaj");
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ vrsta?: string | string[]; oznaka?: string | string[] }>;
}) {
  const params = await searchParams;
  if (params.vrsta === undefined && params.oznaka === undefined) redirect(reportHelpPath);
  const target = supportTarget(params.vrsta, params.oznaka);
  if (!target || target.subject === "deletion" || target.subject === "help") notFound();
  return <RequestScreen target={target} />;
}
