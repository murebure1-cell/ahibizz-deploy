import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppAppearance } from "../components/appearance/AppAppearance";
import { AppPwaProvider } from "../components/pwa/AppPwa";
import { appearanceBootstrap } from "../lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AhiBizz — lokalno počinje s ljudima", template: "%s | AhiBizz" },
  description: "Novi prostor za lokalne djelatnosti, usluge i ljude. AhiBizz je u pripremi.",
  robots: { index: false, follow: false },
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "AhiBizz", statusBarStyle: "default" },
  icons: {
    icon: "/preview-app/icons/icon-192.png",
    apple: "/preview-app/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#142c40", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useValidLang: Bosnian content uses the valid BCP 47 language code bs, missing from this rule's registry.
    <html lang="bs" suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Static first-party preference bootstrap contains no user content.
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap }}
        />
      </head>
      <body>
        <a className="skip-link" href="#glavni-sadrzaj">
          Preskoči na sadržaj
        </a>
        <AppAppearance>
          <AppPwaProvider>{children}</AppPwaProvider>
        </AppAppearance>
      </body>
    </html>
  );
}
