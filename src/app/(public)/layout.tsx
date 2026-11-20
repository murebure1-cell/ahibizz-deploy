import type { ReactNode } from "react";
import { PublicShell } from "../../components/design/AppProviders";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { getSupportConfig } from "../../lib/support";
import { designCss } from "../../lib/visual-design";
import { readPublishedDesign } from "../../server/visual-design-store";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const design = await readPublishedDesign();
  return (
    <PublicShell
      header={<SiteHeader supportAvailable={getSupportConfig() !== null} />}
      footer={<SiteFooter />}
      stylesheet={<style id="ahibizz-published-design">{designCss(design)}</style>}
    >
      {children}
    </PublicShell>
  );
}
