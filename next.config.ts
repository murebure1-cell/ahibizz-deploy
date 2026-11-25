import type { NextConfig } from "next";

export function createNextConfig(distribution: string): NextConfig {
  if (distribution !== "web" && distribution !== "google-play") {
    throw new Error("AHIBIZZ_DISTRIBUTION must be web or google-play.");
  }

  return {
    env: { NEXT_PUBLIC_AHIBIZZ_DISTRIBUTION: distribution },
    async rewrites() {
      const webOnlyRoutes = ["/naplata", "/podrzi", "/api/checkout"];
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
    // Content editing moved out of administration on 2026-11-25; old addresses keep working.
    async redirects() {
      return [
        { source: "/administracija/blog", destination: "/sadrzaj/clanci", permanent: false },
        { source: "/administracija/izgled", destination: "/sadrzaj/izgled", permanent: false },
        {
          source: "/administracija/izgled/pregled",
          destination: "/sadrzaj/izgled/pregled",
          permanent: false,
        },
        {
          source: "/administracija",
          has: [{ type: "query", key: "odjeljak", value: "kategorije" }],
          destination: "/sadrzaj/kategorije",
          permanent: false,
        },
      ];
    },
    output: "standalone",
    // Reuse a page visited in the last 30 seconds on Back or a repeat tap instead of waiting for
    // the server again. Sign-in and sign-out reload the whole page, which clears this cache.
    experimental: { staleTimes: { dynamic: 30, static: 180 } },
    serverExternalPackages: ["nodemailer"],
    poweredByHeader: false,
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
        },
        {
          // Self-hosted typeface files never change under the same name.
          source: "/fonts/:file*",
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
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
          source: "/sadrzaj/izgled/pregled",
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
