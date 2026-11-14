import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AhiBizz — lokalno počinje s ljudima", template: "%s | AhiBizz" },
  description: "Novi prostor za lokalne djelatnosti, usluge i ljude. AhiBizz je u pripremi.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useValidLang: Bosnian content uses the valid BCP 47 language code bs, missing from this rule's registry.
    <html lang="bs">
      <body>
        <a className="skip-link" href="#glavni-sadrzaj">
          Preskoči na sadržaj
        </a>
        {children}
      </body>
    </html>
  );
}
