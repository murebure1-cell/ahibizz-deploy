import type { Metadata } from "next";
import { PricingCatalog } from "../../../components/billing/PricingCatalog";

export const metadata: Metadata = { title: "Paketi" };

export default function PackagesPage() {
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: "40px 64px" }}>
      <PricingCatalog />
    </main>
  );
}
