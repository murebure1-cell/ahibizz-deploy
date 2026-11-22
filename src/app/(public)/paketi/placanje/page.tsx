import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PackageCheckout } from "../../../../components/billing/PackageCheckout";
import { billingPackages } from "../../../../lib/billing";
import { businessUuid } from "../../../../lib/business-today";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Plaćanje paketa",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const packageId = billingPackages.find((plan) => plan.id === query.paket)?.id ?? "basic";
  const contractId =
    typeof query.ugovor === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.ugovor)
      ? query.ugovor
      : null;
  const abandoned = contractId !== null && query.odustao === "1";
  const period = query.period === "annual" ? "annual" : "monthly";
  const businessId = businessUuid(query.djelatnost) ? query.djelatnost : null;
  const params = new URLSearchParams({ paket: packageId, period });
  if (businessId) params.set("djelatnost", businessId);
  if (contractId) params.set("ugovor", contractId);
  if (abandoned) params.set("odustao", "1");
  let account: SafeAccountProfile | undefined;
  try {
    account = await getAccountService()?.read(await headers());
  } catch (error) {
    if (!(error instanceof AccountAccessError) || ![401, 403].includes(error.status)) throw error;
  }
  if (!account) redirect(`/prijava?nastavi=${encodeURIComponent(`/paketi/placanje?${params}`)}`);
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: "32px 64px" }}>
      <PackageCheckout
        environment="live"
        initialPeriod={period}
        key={account.id}
        userId={account.id}
        initialPackage={packageId}
        initialContract={contractId}
        initialBusinessId={businessId}
        abandoned={abandoned}
      />
    </main>
  );
}
