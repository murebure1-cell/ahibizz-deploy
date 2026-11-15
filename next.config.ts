import type { NextConfig } from "next";

const config: NextConfig = {
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
        ],
      },
    ];
  },
};

export default config;
