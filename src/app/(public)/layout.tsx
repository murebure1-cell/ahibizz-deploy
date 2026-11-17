import type { ReactNode } from "react";
import { FavoritesProvider } from "../../components/favorites/FavoritesProvider";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { getSupportConfig } from "../../lib/support";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader supportAvailable={getSupportConfig() !== null} />
      <FavoritesProvider>{children}</FavoritesProvider>
      <SiteFooter />
    </>
  );
}
