import Link from "next/link";
import { IS_PLAY_EDITION } from "../lib/distribution";
import { getSupportConfig } from "../lib/support";
import { getTranslator } from "../server/i18n";
import { AhiLogo } from "./brand/AhiLogo";
import { LanguagePicker } from "./i18n/LanguagePicker";

export async function SiteFooter() {
  const t = await getTranslator();
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <Link className="brand footer-brand" href="/" aria-label={t("AhiBizz — početna")}>
          <AhiLogo decorative />
        </Link>
        <nav aria-label={t("Navigacija podnožja")}>
          <Link href="/o-nama">{t("O AhiBizzu")}</Link>
          <Link href="/privatnost">{t("Privatnost")}</Link>
          <Link href="/pomoc">{t("Pomoć")}</Link>
          <Link href="/blog">{t("Blog")}</Link>
          {!IS_PLAY_EDITION && <Link href="/instaliraj">{t("Instaliraj aplikaciju")}</Link>}
          {!IS_PLAY_EDITION && getSupportConfig() && <Link href="/podrzi">{t("Doniraj")}</Link>}
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} AhiBizz</span>
        <LanguagePicker />
      </div>
    </footer>
  );
}
