import type { Metadata } from "next";
import { PricingCatalog } from "../../../components/billing/PricingCatalog";
import { getAuthDatabasePool } from "../../../server/auth/service";
import { getPackageBenefits } from "../../../server/paypal-subscriptions/benefits";

export const metadata: Metadata = { title: "Paketi" };
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const pool = getAuthDatabasePool();
  const initialBenefits = pool ? await getPackageBenefits(pool).catch(() => null) : null;
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: "40px 64px" }}>
      <PricingCatalog initialBenefits={initialBenefits} />
    </main>
  );
}
