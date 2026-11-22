import Image from "next/image";
import Link from "next/link";
import { IS_PLAY_EDITION } from "../lib/distribution";
import { getSupportConfig } from "../lib/support";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <Link className="brand footer-brand" href="/" aria-label="AhiBizz — početna">
          <Image
            src="/brand/ahi-logo-white.svg"
            alt="AhiBizz"
            width={156}
            height={42}
            unoptimized
          />
        </Link>
        <nav aria-label="Navigacija podnožja">
          <Link href="/o-nama">O AhiBizzu</Link>
          <Link href="/privatnost">Privatnost</Link>
          <Link href="/pomoc">Pomoć</Link>
          <Link href="/blog">Blog</Link>
          {!IS_PLAY_EDITION && <Link href="/paketi">Paketi</Link>}
          {!IS_PLAY_EDITION && <Link href="/instaliraj">Instaliraj aplikaciju</Link>}
          {!IS_PLAY_EDITION && getSupportConfig() && <Link href="/podrzi">Doniraj</Link>}
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} AhiBizz</span>
      </div>
    </footer>
  );
}
