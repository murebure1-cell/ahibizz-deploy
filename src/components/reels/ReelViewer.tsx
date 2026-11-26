"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { businessMediaUrl } from "../../lib/business-media";
import type { Translate } from "../../lib/i18n/translate";
import { messageLink } from "../../lib/messaging";
import { bosnianFormatter } from "../../lib/number-format";
import { reelPath } from "../../lib/reel-navigation";
import {
  type PublicReel,
  type ReelEngagement,
  type ReelFeedPage,
  reelMedia,
} from "../../lib/reels";
import { reportUrl } from "../../lib/support-requests";
import { BusinessLogo } from "../directory/BusinessLogo";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./reel-viewer.module.css";

const numbers = bosnianFormatter();

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

function ageLabel(value: string | null, t: Translate) {
  if (!value) return null;
  const publishedAt = Date.parse(value);
  if (!Number.isFinite(publishedAt)) return null;
  const days = Math.max(0, Math.floor((Date.now() - publishedAt) / 86400000));
  if (!days) return t("Danas");
  if (days === 1) return t("Jučer");
  if (days < 30) return t("Prije {count} dana", { count: days });
  if (days < 365) return t("Prije {count} mj.", { count: Math.floor(days / 30) });
  return t("Prije {count} god.", { count: Math.floor(days / 365) });
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
  const t = useT();
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
      setStatus(t("Reakcija nije sačuvana. Pokušaj ponovo."));
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
      setStatus(t("Link je kopiran."));
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
            aria-label={
              failed ? t("Ponovo učitaj video") : playing ? t("Pauziraj video") : t("Pusti video")
            }
          >
            {!playing && (
              <span className={styles.playButton}>
                <Icon name={failed ? "refresh" : "play"} />
              </span>
            )}
          </button>
        )}
      </div>

      <header className={styles.top}>
        <Link
          href={closePath}
          replace
          prefetch={false}
          className={styles.circleButton}
          aria-label={t("Zatvori Reels")}
        >
          <Icon name="arrow" className={styles.backIcon} />
        </Link>
        <span className={styles.topTitle} aria-hidden="true">
          Reels
        </span>
        <button
          type="button"
          className={styles.circleButton}
          aria-label={muted ? t("Uključi zvuk") : t("Isključi zvuk")}
          onClick={() => {
            const element = video.current;
            if (element) element.muted = !muted;
            onMute(!muted);
          }}
        >
          <Icon name={muted ? "mute" : "volume"} />
        </button>
      </header>

      <div className={styles.rail}>
        <button
          type="button"
          className={styles.railButton}
          aria-label={t("Sviđa mi se")}
          aria-describedby={engagement ? `reel-likes-${reel.id}` : undefined}
          aria-pressed={engagement?.liked ?? false}
          disabled={!engagement || likePending}
          onClick={() => void toggleLike()}
        >
          <span className={styles.railCircle}>
            <Icon name="heart" />
          </span>
          {engagement && (
            <span className={styles.railText} id={`reel-likes-${reel.id}`}>
              {numbers.format(engagement.likes)}
              <span className={styles.srOnly}> {t("lajkova")}</span>
            </span>
          )}
        </button>
        <Link
          href={messageLink({ kind: "business", targetId: reel.businessId })}
          prefetch={false}
          className={styles.railButton}
          aria-label={t("Pošalji poruku djelatnosti")}
        >
          <span className={styles.railCircle}>
            <Icon name="message" />
          </span>
        </Link>
        <button
          type="button"
          className={styles.railButton}
          aria-label={t("Podijeli")}
          onClick={() => void share()}
        >
          <span className={styles.railCircle}>
            <Icon name="share" />
          </span>
        </button>
        <Link
          href={reportUrl("reel", reel.id)}
          prefetch={false}
          className={styles.railButton}
          aria-label={t("Prijavi Reel")}
        >
          <span className={styles.railCircle}>
            <Icon name="shield" />
          </span>
        </Link>
      </div>

      <div className={styles.info}>
        <Link href={businessPath} prefetch={false} className={styles.who}>
          <span className={styles.whoAvatar} aria-hidden="true">
            <BusinessLogo src={logo} alt="" sizes="40px" />
          </span>
          <span className={styles.whoText}>
            <strong className={styles.whoName} dir="auto">
              {reel.businessTitle}
            </strong>
            <span className={styles.whoMeta}>
              {[
                reel.city,
                reel.publishedAt ? ageLabel(reel.publishedAt, t) : null,
                engagement ? `${numbers.format(engagement.views)} ${t("pregleda")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </Link>
        {active ? (
          <h1 className={styles.infoTitle} dir="auto">
            {reel.title}
          </h1>
        ) : (
          <strong className={styles.infoTitle} dir="auto">
            {reel.title}
          </strong>
        )}
        {reel.caption && (
          <p className={styles.infoCaption} dir="auto">
            {reel.caption}
          </p>
        )}
        <Link href={businessPath} prefetch={false} className={styles.open}>
          {t("Otvori djelatnost")}
          <Icon name="chevron" />
        </Link>
      </div>
      {status && (
        <p role="status" className={styles.status}>
          {status}
        </p>
      )}
      {manualShare && (
        <div className={styles.status}>
          <label>
            {t("Link za dijeljenje")}
            <input readOnly value={manualShare} onFocus={(event) => event.target.select()} />
          </label>
          <button type="button" onClick={() => setManualShare(null)}>
            {t("Zatvori")}
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
        aria-label={t("Pozicija u videu")}
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
  const t = useT();
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
      <section ref={feed} className={styles.feed} aria-label={t("Reels djelatnosti")}>
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
              {t("Pokušaj ponovo")}
            </button>
          ) : (
            <span role="status">{t("Učitavam još reelova…")}</span>
          )}
        </div>
      )}
    </main>
  );
}
