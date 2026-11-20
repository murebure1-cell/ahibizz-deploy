"use client";
import Image from "next/image";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AdCandidates, ServedAd } from "../../lib/ad-render";
import { Icon } from "../Icon";
import { AdCampaignAsset } from "./AdCampaignAsset";
import { AdResponse } from "./AdResponse";
import styles from "./campaign-ad.module.css";

const desktop = "(min-width: 768px)";
function watchDevice(update: () => void) {
  const query = window.matchMedia(desktop);
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
const screen = () =>
  (window.matchMedia(desktop).matches ? "desktop" : "mobile") as "desktop" | "mobile";
export function CampaignAd({
  candidates,
  fallback = null,
  region,
}: {
  candidates: AdCandidates;
  fallback?: ReactNode;
  region?: "inline" | "elsewhere";
}) {
  const device = useSyncExternalStore<"desktop" | "mobile" | null>(watchDevice, screen, () => null);
  const ad = device && candidates[device];
  if (!ad) return fallback;
  if (region && (region === "inline") !== (ad.position === "inline")) return null;
  return <Creative key={ad.token} ad={ad} />;
}
let ephemeralTab: string | undefined;
function tabKey() {
  try {
    const prior = sessionStorage.getItem("ahi-ad-tab");
    if (prior && /^[a-f0-9-]{36}$/.test(prior)) return prior;
    ephemeralTab ??= crypto.randomUUID();
    sessionStorage.setItem("ahi-ad-tab", ephemeralTab);
  } catch {
    ephemeralTab ??= crypto.randomUUID();
  }
  return ephemeralTab;
}
function sendEvent(ad: ServedAd, event: "view" | "click") {
  const data = JSON.stringify({ token: ad.token, event, tab: tabKey() });
  return fetch("/api/marketing/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: data,
    keepalive: true,
    cache: "no-store",
  })
    .then((r) => r.ok)
    .catch(() => false);
}
function Creative({ ad }: { ad: ServedAd }) {
  const root = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState(false),
    [frame, setFrame] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const sent = useRef(false),
    clicked = useRef(false);
  const reportClick = useCallback(() => {
    if (!clicked.current) {
      clicked.current = true;
      void sendEvent(ad, "click").then((ok) => {
        if (!ok) clicked.current = false;
      });
    }
  }, [ad]);

  useEffect(() => {
    const modal = dialog.current;
    if (!dismissed && modal && !modal.open) modal.showModal();
    return () => modal?.close();
  }, [dismissed]);
  useEffect(() => {
    const el = root.current;
    if (!el || dismissed || !("IntersectionObserver" in window)) return;
    let visible = false,
      retries = 0,
      timer: ReturnType<typeof setTimeout> | undefined,
      stopped = false;
    function sync() {
      clearTimeout(timer);
      if (!visible || document.visibilityState !== "visible" || sent.current || stopped) return;
      timer = setTimeout(() => {
        sent.current = true;
        void sendEvent(ad, "view").then((ok) => {
          if (!ok && !stopped && retries++ < 1) {
            sent.current = false;
            sync();
          }
        });
      }, 1000);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
        sync();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ad, dismissed]);

  if (dismissed) return null;
  const image = ad.images[frame],
    count = ad.images.length;
  const external = ad.href.startsWith("https://");
  const linkAttrs = {
    href: ad.href,
    rel: external ? "sponsored noopener noreferrer" : "sponsored",
    onClick: reportClick,
    onAuxClick: (event: { button: number }) => {
      if (event.button === 1) reportClick();
    },
  };
  if (ad.position === "icon")
    return (
      <div className={styles.iconAd} ref={root}>
        <a {...linkAttrs} href={ad.href} aria-label={`Sponzorirano: ${ad.title}`}>
          <span className={styles.round}>
            {ad.asset ? (
              <AdCampaignAsset campaignId={ad.campaignId} asset={ad.asset} />
            ) : image ? (
              <Image src={image} fill sizes="64px" unoptimized alt="" />
            ) : (
              <Icon name="shop" />
            )}
          </span>
          <span>{ad.title}</span>
          <small>Oglas</small>
        </a>
      </div>
    );
  const close = (
    <button
      type="button"
      className={styles.close}
      onClick={() => setDismissed(true)}
      aria-label="Zatvori oglas"
    >
      <Icon name="close" />
    </button>
  );
  const response = ad.formatId === "lead_form" || ad.formatId === "loan_calculator";
  const display = (
    <div
      className={styles.creative}
      data-format={ad.formatId}
      data-position={ad.position}
      style={
        {
          "--campaign-width": `${ad.width}px`,
          "--campaign-aspect": `${ad.width}/${ad.height}`,
        } as CSSProperties
      }
    >
      <div
        ref={root}
        className={styles.canvas}
        data-revealed={revealed}
        data-multiple={count > 1 || undefined}
      >
        {(ad.formatId === "slash" || ad.formatId === "reveal") && ad.images.length > 1 && (
          <Image
            className={styles.underPhoto}
            fill
            unoptimized
            sizes="(max-width: 768px) 94vw, 900px"
            src={ad.images[(frame + 1) % count] ?? ad.images[0] ?? ""}
            alt=""
          />
        )}
        {!ad.asset && image && (
          <Image
            key={image}
            className={styles.photo}
            fill
            unoptimized
            sizes="(max-width: 768px) 94vw, 900px"
            src={image}
            alt=""
          />
        )}
        {ad.asset && (
          <div className={styles.asset}>
            <AdCampaignAsset campaignId={ad.campaignId} asset={ad.asset} />
          </div>
        )}
        {ad.formatId === "converger" && !ad.asset && image && (
          <Image className={styles.rightPane} src={image} fill sizes="90vw" unoptimized alt="" />
        )}
        <div className={styles.copy}>
          <span className={styles.label}>Sponzorirano</span>
          <strong>{ad.title}</strong>
          {ad.city && <span className={styles.city}>{ad.city}</span>}
          {!response && (
            <a {...linkAttrs} className={styles.link}>
              Pogledaj {external ? "ponudu" : "djelatnost"} <Icon name="arrow" />
            </a>
          )}
        </div>
        {ad.position === "bottom" && close}
        {ad.formatId === "reveal" && image && (
          <button
            type="button"
            className={styles.reveal}
            aria-pressed={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? "Zatvori fotografiju" : "Otkrij fotografiju"}
          </button>
        )}
      </div>
      {!ad.asset && count > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            aria-label="Prethodna slika oglasa"
            onClick={() => setFrame((frame + count - 1) % count)}
          >
            ‹
          </button>
          <span aria-live="polite">
            {frame + 1} / {count}
          </span>
          <button
            type="button"
            aria-label="Sljedeća slika oglasa"
            onClick={() => setFrame((frame + 1) % count)}
          >
            ›
          </button>
        </div>
      )}
      {response && (
        <AdResponse
          formatId={ad.formatId}
          businessId={ad.businessId}
          campaignId={ad.campaignId}
          principalMinor={ad.principalMinor}
          onOpen={reportClick}
        />
      )}
    </div>
  );

  if (ad.position === "overlay")
    return (
      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setDismissed(true)}
        aria-label={`Sponzorirana ponuda: ${ad.title}`}
      >
        {close}
        {display}
      </dialog>
    );
  return (
    <aside
      className={styles.slot}
      data-position={ad.position}
      data-format={ad.formatId}
      aria-label="Oglas"
    >
      {display}
    </aside>
  );
}
