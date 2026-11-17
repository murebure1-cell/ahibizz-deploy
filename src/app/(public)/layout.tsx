import type { ReactNode } from "react";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { getSupportConfig } from "../../lib/support";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader supportAvailable={getSupportConfig() !== null} />
      {children}
      <SiteFooter />
    </>
  );
}
