"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { businessMediaUrl } from "../../lib/business-media";
import { reelPath } from "../../lib/reel-navigation";
import { type PublicReel, type ReelEngagement, reelMedia } from "../../lib/reels";
import { AhiMark } from "../AhiMark";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./story.module.css";

function hoursAgo(value: string | null) {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((Date.now() - at) / 3600000));
}

/**
 * A business's live Reels as a story (drawn 2026-11-27): bars at the top fill while a Reel
 * plays, a tap on the right goes on, on the left goes back, holding pauses, the end closes.
 */
export function StoryViewer({ reels, closeHref }: { reels: PublicReel[]; closeHref: string }) {
  const t = useT();
  const router = useRouter();
  const [index, setIndex] = useState(0),
    [muted, setMuted] = useState(true),
    [held, setHeld] = useState(false),
    [engagement, setEngagement] = useState<ReelEngagement | null>(null),
    [liking, setLiking] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    bar = useRef<HTMLSpanElement>(null),
    pressed = useRef(0),
    viewed = useRef(new Set<string>());
  const reel = reels[index];

  const close = useCallback(() => router.replace(closeHref), [router, closeHref]);
  const go = useCallback(
    (step: 1 | -1) => {
      const next = index + step;
      if (next >= reels.length) close();
      else if (next >= 0) setIndex(next);
      else if (video.current) video.current.currentTime = 0;
    },
    [index, reels.length, close],
  );

  // The bar of the playing Reel follows the video itself, so a stall never runs ahead.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const element = video.current;
      if (element && bar.current) {
        const ratio = element.duration > 0 ? element.currentTime / element.duration : 0;
        bar.current.style.transform = `scaleX(${Math.min(1, ratio)})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (held) element.pause();
    else void element.play().catch(() => {});
  }, [held]);

  // Likes and one view per Reel after two seconds of playing, as on the Reels page.
  useEffect(() => {
    if (!reel) return;
    const id = reel.id;
    const controller = new AbortController();
    setEngagement(null);
    fetch(`/api/reels/engagement/${id}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setEngagement((await response.json()) as ReelEngagement);
      })
      .catch(() => {});
    const timer = window.setTimeout(() => {
      if (viewed.current.has(id) || !video.current || video.current.paused) return;
      viewed.current.add(id);
      void fetch(`/api/reels/engagement/${id}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view" }),
      }).catch(() => viewed.current.delete(id));
    }, 2000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [reel]);

  async function like() {
    if (!reel || !engagement || liking) return;
    if (!engagement.canLike || !engagement.accountId) {
      router.push(`/prijava?nastavi=${encodeURIComponent(reelPath(reel.id))}`);
      return;
    }
    setLiking(true);
    try {
      const response = await fetch(`/api/reels/engagement/${reel.id}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-AhiBizz-Account-ID": engagement.accountId,
        },
        body: JSON.stringify({ action: "like", liked: !engagement.liked }),
      });
      if (response.ok) setEngagement((await response.json()) as ReelEngagement);
    } finally {
      setLiking(false);
    }
  }

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [close, go]);

  if (!reel) return null;
  const logo = reel.businessLogo ? businessMediaUrl(reel.businessId, reel.businessLogo) : null;
  const hours = hoursAgo(reel.publishedAt);
  return (
    <div className={styles.story} role="dialog" aria-modal="true" aria-label={reel.businessTitle}>
      <video
        key={reel.id}
        ref={video}
        className={styles.video}
        src={reelMedia(reel.id, "video")}
        poster={reel.hasPoster ? reelMedia(reel.id, "poster") : undefined}
        playsInline
        autoPlay
        muted={muted}
        preload="auto"
        aria-label={reel.title}
        onEnded={() => go(1)}
      />
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.bars} aria-hidden="true">
        {reels.map((item, i) => (
          <span key={item.id}>
            <span
              ref={i === index ? bar : undefined}
              style={{ transform: i < index ? "scaleX(1)" : "scaleX(0)" }}
            />
          </span>
        ))}
      </div>
      {/* Tap zones: a third on the left goes back, the rest goes on; holding pauses. */}
      <button
        type="button"
        className={styles.back}
        aria-label={t("Prethodni")}
        onPointerDown={() => {
          pressed.current = Date.now();
          setHeld(true);
        }}
        onPointerUp={() => {
          setHeld(false);
          if (Date.now() - pressed.current < 250) go(-1);
        }}
        onPointerLeave={() => setHeld(false)}
      />
      <button
        type="button"
        className={styles.next}
        aria-label={t("Sljedeći")}
        onPointerDown={() => {
          pressed.current = Date.now();
          setHeld(true);
        }}
        onPointerUp={() => {
          setHeld(false);
          if (Date.now() - pressed.current < 250) go(1);
        }}
        onPointerLeave={() => setHeld(false)}
      />
      <header className={styles.head}>
        <Link href={`/djelatnosti/${reel.businessId}`} className={styles.who}>
          <span className={styles.logo}>
            {logo ? (
              <Image src={logo} alt="" width={68} height={68} unoptimized />
            ) : (
              <AhiMark size={18} />
            )}
          </span>
          <span>
            <strong dir="auto">{reel.businessTitle}</strong>
            {hours !== null && (
              <small>{hours === 0 ? t("upravo") : t("prije {n} h", { n: hours })}</small>
            )}
          </span>
        </Link>
        <button
          type="button"
          className={styles.icon}
          aria-label={muted ? t("Uključi zvuk") : t("Isključi zvuk")}
          onClick={() => setMuted(!muted)}
        >
          <Icon name={muted ? "mute" : "volume"} />
        </button>
        <button type="button" className={styles.icon} aria-label={t("Zatvori")} onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <div className={styles.text}>
        <strong dir="auto">{reel.title}</strong>
        {reel.caption && <span dir="auto">{reel.caption}</span>}
      </div>
      <button
        type="button"
        className={styles.like}
        aria-pressed={engagement?.liked ?? false}
        aria-label={t("Sviđa mi se")}
        disabled={!engagement || liking}
        onClick={() => void like()}
      >
        <Icon name="heart" fill={engagement?.liked ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
