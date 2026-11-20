"use client";
import { useEffect, useState } from "react";
import { type AdAsset, adAssetPath, htmlAdPolicy } from "../../lib/ad-asset";
export function AdCampaignAsset({
  campaignId,
  asset,
  privateUrl,
}: {
  campaignId: string;
  asset: AdAsset;
  privateUrl?: string;
}) {
  const source = privateUrl ?? adAssetPath(campaignId, asset.version);
  const [document, setDocument] = useState<{ source: string; html: string } | null>(null);
  useEffect(() => {
    if (asset.mimeType !== "text/html") return;
    const abort = new AbortController();
    fetch(source, { signal: abort.signal, credentials: "same-origin", redirect: "error" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const html = await r.text();
        if (!abort.signal.aborted) setDocument({ source, html });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [source, asset.mimeType]);
  const style = { width: "100%", height: "100%", objectFit: "contain" as const, border: 0 };
  if (asset.mimeType === "text/html") {
    if (!document || document.source !== source) return null;
    const srcDoc = `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${htmlAdPolicy}"><meta name="referrer" content="no-referrer"><style>html,body{padding:0;margin:0;max-width:100%;overflow:hidden}img{max-width:100%}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition:none!important}}</style>${document.html}`;
    return (
      <iframe
        title="HTML5 oglas"
        style={{ ...style, pointerEvents: "none" }}
        tabIndex={-1}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
    );
  }
  if (asset.mimeType === "video/mp4")
    return (
      <video
        muted
        controls
        playsInline
        preload="metadata"
        style={style}
        aria-label="Video oglasa"
        src={source}
      />
    );
  // biome-ignore lint/performance/noImgElement: media comes from the authorized versioned endpoint or a private object URL.
  return <img src={source} style={style} alt="Grafika oglasa" decoding="async" />;
}
