"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { businessMediaUrl } from "../../lib/business-media";
import { messageLink } from "../../lib/messaging";
import { reelPath } from "../../lib/reel-navigation";
import {
  type PublicReel,
  type ReelEngagement,
  type ReelFeedPage,
  reelMedia,
} from "../../lib/reels";
import { Icon } from "../Icon";
import styles from "./reel-viewer.module.css";

const numbers = new Intl.NumberFormat("bs-BA");

async function reelRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/reels/${path}`, {
    ...options,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("REEL_UNAVAILABLE");
  return (await response.json()) as T;
}

function ageLabel(value: string | null) {
  if (!value) return null;
  const publishedAt = Date.parse(value);
  if (!Number.isFinite(publishedAt)) return null;
  const days = Math.max(0, Math.floor((Date.now() - publishedAt) / 86400000));
  if (!days) return "Danas";
  if (days === 1) return "Jučer";
  if (days < 30) return `Prije ${days} dana`;
  if (days < 365) return `Prije ${Math.floor(days / 30)} mj.`;
  return `Prije ${Math.floor(days / 365)} god.`;
}

function ReelSlide({
  reel,
  active,
  near,
  muted,
  onMute,
  closePath,
}: {
  reel: PublicReel;
  active: boolean;
  near: boolean;
  muted: boolean;
  onMute: (muted: boolean) => void;
  closePath: string;
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement | null>(null);
  const viewed = useRef(false);
  const writingLike = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(reel.durationMs / 1000);
  const [engagement, setEngagement] = useState<ReelEngagement | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [status, setStatus] = useState("");
  const [manualShare, setManualShare] = useState<string | null>(null);
  const engagementPath = `engagement/${reel.id}`;
  const poster = near && reel.hasPoster ? reelMedia(reel.id, "poster") : undefined;
  const logo =
    near && reel.businessLogo ? businessMediaUrl(reel.businessId, reel.businessLogo) : undefined;
  const businessPath = `/djelatnosti/${reel.businessId}`;
  const hasEngagement = engagement !== null;

  useEffect(() => {
    if (!active || hasEngagement) return;
    const controller = new AbortController();
    void reelRequest<ReelEngagement>(engagementPath, { signal: controller.signal })
      .then((value) => setEngagement((current) => current ?? value))
      .catch(() => {});
    return () => controller.abort();
  }, [active, engagementPath, hasEngagement]);

  useEffect(() => {
    const element = video.current;
    if (!active || !element) {
      setPlaying(false);
      setPosition(0);
      setFailed(false);
      setManualShare(null);
      return;
    }
    let resume = document.visibilityState !== "visible";
    function visibility() {
      if (!element) return;
      if (document.visibilityState !== "visible") {
        resume = !element.paused;
        element.pause();
      } else if (resume) {
        resume = false;
        void element.play().catch(() => setPlaying(false));
      }
    }
    if (!resume) void element.play().catch(() => setPlaying(false));
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      element.pause();
    };
  }, [active]);

  useEffect(() => {
    if (!active || !playing || !hasEngagement || viewed.current) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || !video.current || video.current.paused) return;
      viewed.current = true;
      void reelRequest<ReelEngagement>(engagementPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view" }),
      })
        .then(({ views }) => {
          setEngagement((current) =>
            current ? { ...current, views: Math.max(current.views, views) } : current,
          );
        })
        .catch(() => {
          viewed.current = false;
        });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [active, engagementPath, hasEngagement, playing]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 3600);
    return () => window.clearTimeout(timer);
  }, [status]);

  function togglePlayback() {
    const element = video.current;
    if (!element) return;
    if (failed) {
      setFailed(false);
      element.load();
    }
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }

  async function toggleLike() {
    if (!engagement || writingLike.current) return;
    if (!engagement.canLike || !engagement.accountId) {
      router.push(`/prijava?nastavi=${encodeURIComponent(reelPath(reel.id))}`);
      return;
    }
    writingLike.current = true;
    setLikePending(true);
    try {
      const result = await reelRequest<ReelEngagement>(engagementPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AhiBizz-Account-ID": engagement.accountId,
        },
        body: JSON.stringify({ action: "like", liked: !engagement.liked }),
      });
      setEngagement((current) => ({
        ...result,
        views: Math.max(current?.views ?? 0, result.views),
      }));
    } catch {
      setStatus("Reakcija nije sačuvana. Pokušaj ponovo.");
    } finally {
      writingLike.current = false;
      setLikePending(false);
    }
  }

  async function share() {
    const url = new URL(reelPath(reel.id), window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: reel.title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link je kopiran.");
    } catch {
      setManualShare(url);
    }
  }

  return (
    <article
      className={styles.reel}
      data-reel-id={reel.id}
      data-active={active}
      inert={!active}
      aria-label={reel.title}
    >
      <div className={styles.backdrop} aria-hidden="true">
        {poster && (
          // biome-ignore lint/performance/noImgElement: Reel posters come from the verified media route and are already resized.
          <img className={styles.backdropImage} src={poster} alt="" decoding="async" />
        )}
      </div>
      <div className={styles.media}>
        {active ? (
          <video
            ref={video}
            className={styles.video}
            src={reelMedia(reel.id, "video")}
            poster={poster}
            playsInline
            loop
            muted={muted}
            preload="metadata"
            aria-label={reel.title}
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration;
              if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
            }}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          />
        ) : (
          poster && (
            // biome-ignore lint/performance/noImgElement: The already resized poster keeps neighboring slides light.
            <img className={styles.poster} src={poster} alt="" loading="lazy" decoding="async" />
          )
        )}
        {active && (
          <button
            type="button"
            className={styles.playSurface}
            onClick={togglePlayback}
            aria-label={failed ? "Ponovo učitaj video" : playing ? "Pauziraj video" : "Pusti video"}
          >
            {!playing && (
              <span className={styles.playButton}>
                <Icon name={failed ? "refresh" : "play"} />
              </span>
            )}
          </button>
        )}
      </div>

      <header className={styles.header}>
        <Link href={businessPath} prefetch={false} className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {logo ? (
              // biome-ignore lint/performance/noImgElement: Versioned business logos are already normalized.
              <img src={logo} alt="" width={40} height={40} decoding="async" />
            ) : (
              Array.from(reel.businessTitle)[0]?.toLocaleUpperCase("bs-BA")
            )}
          </span>
          <span className={styles.identityCopy}>
            <strong className={styles.author}>{reel.businessTitle}</strong>
            {reel.publishedAt && (
              <time className={styles.meta} dateTime={reel.publishedAt} suppressHydrationWarning>
                {ageLabel(reel.publishedAt)}
              </time>
            )}
          </span>
        </Link>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={muted ? "Uključi zvuk" : "Isključi zvuk"}
            onClick={() => {
              const element = video.current;
              if (element) element.muted = !muted;
              onMute(!muted);
            }}
          >
            <Icon name={muted ? "mute" : "volume"} />
          </button>
          <Link
            href={closePath}
            replace
            prefetch={false}
            className={styles.iconButton}
            aria-label="Zatvori Reels"
          >
            <Icon name="close" />
          </Link>
        </div>
      </header>

      <div className={styles.actionRail}>
        <button
          type="button"
          className={styles.railAction}
          aria-label="Sviđa mi se"
          aria-describedby={engagement ? `reel-likes-${reel.id}` : undefined}
          aria-pressed={engagement?.liked ?? false}
          disabled={!engagement || likePending}
          onClick={() => void toggleLike()}
        >
          <Icon name="heart" />
          {engagement && (
            <span className={styles.railLabel} id={`reel-likes-${reel.id}`}>
              {numbers.format(engagement.likes)}
              <span className={styles.srOnly}> lajkova</span>
            </span>
          )}
        </button>
        <Link
          href={messageLink({ kind: "business", targetId: reel.businessId })}
          prefetch={false}
          className={styles.railAction}
        >
          <Icon name="message" />
          <span className={styles.railLabel}>Poruka</span>
        </Link>
        <button type="button" className={styles.railAction} onClick={() => void share()}>
          <Icon name="share" />
          <span className={styles.railLabel}>Podijeli</span>
        </button>
        <span className={styles.railAction}>
          <Icon name="eye" />
          {engagement && (
            <span className={styles.railLabel}>{numbers.format(engagement.views)}</span>
          )}
          <span className={styles.srOnly}> pregleda</span>
        </span>
      </div>

      <div className={styles.reelInfo}>
        {reel.caption && <p className={styles.caption}>{reel.caption}</p>}
        <div className={styles.teaser}>
          <span className={styles.teaserThumb} aria-hidden="true">
            {poster ? (
              // biome-ignore lint/performance/noImgElement: This thumbnail reuses the normalized Reel poster.
              <img src={poster} alt="" decoding="async" />
            ) : (
              <Icon name="shop" />
            )}
          </span>
          <div className={styles.teaserText}>
            {active ? (
              <h1 className={styles.teaserTitle}>{reel.title}</h1>
            ) : (
              <strong className={styles.teaserTitle}>{reel.title}</strong>
            )}
            {reel.city && <span className={styles.teaserMeta}>{reel.city}</span>}
          </div>
          <Link href={businessPath} prefetch={false} className={styles.profileButton}>
            Pogledaj djelatnost
          </Link>
        </div>
      </div>
      {status && (
        <p role="status" className={styles.status}>
          {status}
        </p>
      )}
      {manualShare && (
        <div className={styles.status}>
          <label>
            Link za dijeljenje
            <input readOnly value={manualShare} onFocus={(event) => event.target.select()} />
          </label>
          <button type="button" onClick={() => setManualShare(null)}>
            Zatvori
          </button>
        </div>
      )}
      <input
        type="range"
        className={styles.progress}
        min={0}
        max={duration}
        value={Math.min(position, duration)}
        step={0.1}
        aria-label="Pozicija u videu"
        disabled={!active || failed}
        style={
          { "--reel-progress": `${Math.min(100, (position / duration) * 100)}%` } as CSSProperties
        }
        onChange={(event) => {
          const element = video.current;
          if (!element || !Number.isFinite(element.duration)) return;
          element.currentTime = event.currentTarget.valueAsNumber;
          setPosition(element.currentTime);
        }}
      />
    </article>
  );
}

export function ReelViewer({
  initialReels,
  initialCursor,
  businessId,
  closePath,
}: {
  initialReels: [PublicReel, ...PublicReel[]];
  initialCursor: string | null;
  businessId: string | null;
  closePath: string;
}) {
  const router = useRouter();
  const feed = useRef<HTMLElement | null>(null);
  const more = useRef<AbortController | null>(null);
  const [items, setItems] = useState<PublicReel[]>(initialReels);
  const [cursor, setCursor] = useState(initialCursor);
  const [activeId, setActiveId] = useState(initialReels[0].id);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const originId = initialReels[0].id;
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const loadMore = useCallback(async () => {
    if (!cursor || more.current) return;
    const controller = new AbortController();
    more.current = controller;
    setLoading(true);
    setLoadError(false);
    const query = new URLSearchParams({ pocetak: originId });
    if (businessId) query.set("djelatnost", businessId);
    try {
      const result = await reelRequest<ReelFeedPage>(`feed/${cursor}?${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !existing.has(item.id))];
      });
      setCursor(result.next === cursor ? null : result.next);
    } catch {
      if (!controller.signal.aborted) setLoadError(true);
    } finally {
      if (more.current === controller) more.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [businessId, cursor, originId]);

  useEffect(() => {
    const element = feed.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.intersectionRatio >= 0.6);
        const id = visible?.target.getAttribute("data-reel-id");
        if (id) setActiveId(id);
      },
      { root: element, threshold: [0.6] },
    );
    for (const article of Array.from(element.children).slice(0, items.length))
      observer.observe(article);
    return () => observer.disconnect();
  }, [items.length]);
  useEffect(() => () => more.current?.abort(), []);
  useEffect(() => {
    if (activeIndex >= items.length - 2 && cursor && !loadError && !loading) void loadMore();
  }, [activeIndex, cursor, items.length, loadError, loadMore, loading]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        router.replace(closePath);
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      const delta =
        event.key === "ArrowDown" || event.key === "PageDown"
          ? 1
          : event.key === "ArrowUp" || event.key === "PageUp"
            ? -1
            : 0;
      if (!delta) return;
      const target = feed.current?.children[activeIndex + delta];
      if (!target?.hasAttribute("data-reel-id")) return;
      event.preventDefault();
      target.scrollIntoView({ block: "start" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, closePath, router]);

  return (
    <main id="glavni-sadrzaj" className={styles.viewer} data-reel-feed>
      <section ref={feed} className={styles.feed} aria-label="Reels djelatnosti">
        {items.map((reel, index) => (
          <ReelSlide
            key={reel.id}
            reel={reel}
            active={reel.id === activeId}
            near={Math.abs(index - activeIndex) <= 1}
            muted={muted}
            onMute={setMuted}
            closePath={closePath}
          />
        ))}
      </section>
      {activeIndex === items.length - 1 && (loadError || loading) && (
        <div className={styles.feedEnd}>
          {loadError ? (
            <button type="button" className={styles.profileButton} onClick={() => void loadMore()}>
              Pokušaj ponovo
            </button>
          ) : (
            <span role="status">Učitavam još reelova…</span>
          )}
        </div>
      )}
    </main>
  );
}
