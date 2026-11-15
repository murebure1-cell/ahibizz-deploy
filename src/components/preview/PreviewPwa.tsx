"use client";

import Image from "next/image";
import { Icon } from "../Icon";
import { useAppPwa } from "../pwa/AppPwa";

export function PreviewInstall({ standalone = false }: { standalone?: boolean }) {
  const pwa = useAppPwa();
  if ((pwa.installed || pwa.accepted) && !standalone) return null;
  return (
    <section
      className={`preview-install${standalone ? " preview-install-page" : " preview-container"}`}
      aria-labelledby="install-title"
    >
      <Image src="/preview-app/icons/icon-192.png" width={62} height={62} alt="" unoptimized />
      <div>
        <span className="preview-kicker">AHIBIZZ NA TELEFONU</span>
        <h2 id="install-title">Uvijek pri ruci.</h2>
        <p>Dodaj AhiBizz na početni ekran.</p>
      </div>
      <button
        className="preview-button"
        type="button"
        onClick={() => void pwa.install()}
        disabled={pwa.installed || pwa.accepted || pwa.prompting}
      >
        <Icon name="download" />
        {pwa.installed
          ? "Koristiš AhiBizz aplikaciju"
          : pwa.accepted
            ? "Instalacija je pokrenuta"
            : "Instaliraj AhiBizz"}
      </button>
      <p className="preview-install-note" role="status">
        {pwa.note}
      </p>
    </section>
  );
}
