import { notFound } from "next/navigation";
import { RequestScreen } from "../../../components/support/RequestScreen";
import { supportTarget } from "../../../lib/support-requests";
export const metadata = { title: "Prijavi sadržaj" };
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ vrsta?: string; oznaka?: string }>;
}) {
  const params = await searchParams;
  const target = supportTarget(params.vrsta, params.oznaka);
  if (!target || target.subject === "deletion") notFound();
  return <RequestScreen target={target} />;
}
