"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppAppearance } from "../appearance/AppAppearance";
import { FavoritesProvider } from "../favorites/FavoritesProvider";
import { DeviceLocationProvider } from "../location/DeviceLocation";
import { AppPwaProvider } from "../pwa/AppPwa";

export const designerFramePath = "/administracija/izgled/pregled";

export function AppProviders({ children }: { children: ReactNode }) {
  if (usePathname() === designerFramePath) return <>{children}</>;
  return (
    <AppAppearance>
      <DeviceLocationProvider>
        <AppPwaProvider>{children}</AppPwaProvider>
      </DeviceLocationProvider>
    </AppAppearance>
  );
}

export function PublicShell({
  children,
  header,
  footer,
  stylesheet,
}: {
  children: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  stylesheet: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === designerFramePath) return <>{children}</>;
  return (
    <>
      {pathname !== "/administracija/izgled" && stylesheet}
      {header}
      <FavoritesProvider>{children}</FavoritesProvider>
      {footer}
    </>
  );
}
