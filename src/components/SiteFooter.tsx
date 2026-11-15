import Image from "next/image";
import Link from "next/link";
import { getSupportConfig } from "../lib/support";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div>
          <Link className="brand footer-brand" href="/" aria-label="AhiBizz — početna">
            <Image
              src="/brand/ahi-logo-white.svg"
              alt="AhiBizz"
              width={156}
              height={42}
              unoptimized
            />
          </Link>
          <p>Lokalno počinje s ljudima.</p>
        </div>
        <nav aria-label="Navigacija podnožja">
          <Link href="/pretraga">Istraži djelatnosti</Link>
          <Link href="/o-nama">O AhiBizzu</Link>
          {getSupportConfig() && <Link href="/podrzi">Podrži AhiBizz</Link>}
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} AhiBizz</span>
        <span>Nova platforma je u pripremi.</span>
      </div>
    </footer>
  );
}
