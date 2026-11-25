"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { contentPaths } from "../../lib/admin-navigation";
import { AppAppearance } from "../appearance/AppAppearance";
import { FavoritesProvider } from "../favorites/FavoritesProvider";
import { DeviceLocationProvider } from "../location/DeviceLocation";
import { MobileDock } from "../MobileDock";
import { NavigationProgress } from "../NavigationProgress";
import { AppPwaProvider } from "../pwa/AppPwa";
import { ImageArrival } from "./ImageArrival";

export const designerFramePath = contentPaths.designFrame;

export function AppProviders({ children }: { children: ReactNode }) {
  if (usePathname() === designerFramePath) return <>{children}</>;
  return (
    <AppAppearance>
      <Suspense>
        <NavigationProgress />
      </Suspense>
      <ImageArrival />
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
      {pathname !== contentPaths.design && stylesheet}
      {header}
      <FavoritesProvider>{children}</FavoritesProvider>
      {footer}
      <Suspense>
        <MobileDock />
      </Suspense>
    </>
  );
}
