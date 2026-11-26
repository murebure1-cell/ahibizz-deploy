import type { MetadataRoute } from "next";
import { siteOrigin } from "../server/site-origin";

export const dynamic = "force-dynamic";

/** Search engines may read the public pages; accounts, administration and interfaces stay out. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/nalog",
        "/administracija",
        "/sadrzaj",
        "/meni",
        "/prijava",
        "/registracija",
        "/zaboravljena-lozinka",
        "/nova-lozinka",
        "/blokirani-korisnici",
        "/sacuvane-pretrage",
        "/razvoj-pregled",
      ],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
