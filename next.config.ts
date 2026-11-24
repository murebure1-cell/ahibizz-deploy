import type { NextConfig } from "next";

export function createNextConfig(distribution: string): NextConfig {
  if (distribution !== "web" && distribution !== "google-play") {
    throw new Error("AHIBIZZ_DISTRIBUTION must be web or google-play.");
  }

  return {
    env: { NEXT_PUBLIC_AHIBIZZ_DISTRIBUTION: distribution },
    async rewrites() {
      const webOnlyRoutes = [
        "/paketi",
        "/oglasavanje",
        "/naplata",
        "/podrzi",
        "/istakni",
        "/nalog/isticanja",
        "/api/checkout",
        "/api/paketi",
      ];
      return {
        beforeFiles:
          distribution === "google-play"
            ? webOnlyRoutes.map((path) => ({
                source: `${path}/:path*`,
                destination: "/store-unavailable",
              }))
            : [],
        afterFiles: [],
        fallback: [],
      };
    },
    output: "standalone",
    serverExternalPackages: ["nodemailer"],
    poweredByHeader: false,
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
        },
        {
          source: "/app.webmanifest",
          headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
        },
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Permissions-Policy", value: "camera=(), microphone=()" },
            // Browsers ignore this header over plain HTTP, so local development is unaffected.
            // No includeSubDomains or preload: other services may share the final domain.
            { key: "Strict-Transport-Security", value: "max-age=31536000" },
          ],
        },
        {
          source: "/administracija/izgled/pregled",
          headers: [
            { key: "X-Frame-Options", value: "SAMEORIGIN" },
            {
              key: "Content-Security-Policy",
              value: "frame-ancestors 'self'; form-action 'none'; connect-src 'none'",
            },
            { key: "Cache-Control", value: "private, no-store" },
          ],
        },
      ];
    },
  };
}

export default createNextConfig(process.env.AHIBIZZ_DISTRIBUTION ?? "web");
