import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DesignPreview } from "../../../../../components/design/DesignPreview";
import { getAccountService } from "../../../../../server/auth/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulator prikaza", robots: { index: false, follow: false } };

export default async function DesignPreviewPage() {
  const service = getAccountService();
  const profile = service ? await service.read(await headers()).catch(() => null) : null;
  if (profile?.role !== "owner" || profile.approval !== "approved") notFound();
  return <DesignPreview />;
}
