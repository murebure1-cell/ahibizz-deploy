import type { ReactNode } from "react";
import { PublicShell } from "../../components/design/AppProviders";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import {
  googleMapIdMeta,
  googleMapsKeyMeta,
  readGoogleMapId,
  readGoogleMapsKey,
} from "../../lib/google-maps";
import { getSupportConfig } from "../../lib/support";
import { designCss } from "../../lib/visual-design";
import { readPublishedDesign } from "../../server/visual-design-store";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const design = await readPublishedDesign();
  // Read at request time so setting the key on the server needs no rebuild.
  const mapsKey = readGoogleMapsKey(process.env.GOOGLE_MAPS_API_KEY);
  const mapId = mapsKey ? readGoogleMapId(process.env.GOOGLE_MAPS_MAP_ID) : null;
  return (
    <PublicShell
      header={
        <>
          {mapsKey && <meta name={googleMapsKeyMeta} content={mapsKey} />}
          {mapId && <meta name={googleMapIdMeta} content={mapId} />}
          <SiteHeader supportAvailable={getSupportConfig() !== null} />
        </>
      }
      footer={<SiteFooter />}
      stylesheet={<style id="ahibizz-published-design">{designCss(design)}</style>}
    >
      {children}
    </PublicShell>
  );
}
