import type { Metadata } from "next";
import { PricingCatalog } from "../../../components/billing/PricingCatalog";
import { getAuthDatabasePool } from "../../../server/auth/service";
import { getPackageBenefits } from "../../../server/paypal-subscriptions/benefits";
import { readPlatformCreditsOnly } from "../../../server/wallet/platform-policy";
import { readWalletRate } from "../../../server/wallet/service";

export const metadata: Metadata = { title: "Paketi" };
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const pool = getAuthDatabasePool();
  const creditsOnly = readPlatformCreditsOnly();
  const [initialBenefits, walletRate] = await Promise.all([
    pool ? getPackageBenefits(pool).catch(() => null) : null,
    pool && creditsOnly ? readWalletRate(pool).catch(() => null) : null,
  ]);
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: "40px 64px" }}>
      <PricingCatalog
        initialBenefits={initialBenefits}
        creditsOnly={creditsOnly}
        walletRate={walletRate}
      />
    </main>
  );
}
