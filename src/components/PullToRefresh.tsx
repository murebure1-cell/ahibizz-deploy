"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  isPullStart,
  type PullRefreshDetail,
  type PullRefreshSource,
  pullBeam,
  pullCancelMs,
  pullCoin,
  pullCoinSpace,
  pullDistance,
  pullFrame,
  pullHold,
  pullLongestRefresh,
  pullReady,
  pullRefreshEvent,
  pullRefreshSource,
  pullSettleMs,
  pullShortestRefresh,
  pullStage,
  pullSymbolSpace,
  stepHop,
} from "../lib/pull-to-refresh";
import { logoSymbol, logoSymbolBody, logoSymbolHole } from "./brand/logo-paths";
import { useT } from "./i18n/LocaleProvider";
import styles from "./pull-to-refresh.module.css";

type Phase = "idle" | "pulling" | "refreshing" | "leaving" | "returning";
type Finger = { id: number; x: number; y: number; pulling: boolean };

const blockers =
  'textarea, input[type="range"], [contenteditable="true"], [data-pull-refresh="off"], [role="dialog"], gmp-map-3d, .gm-style';

/** A pull must not start on something that takes the drag itself: a map, a sheet, an inner list. */
function pullBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (document.querySelector("dialog[open]") || target.closest(blockers)) return true;
  for (
    let node: Element | null = target;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.position === "fixed") return true;
    if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1)
      return true;
  }
  return false;
}

const touchOf = (list: TouchList, id: number) =>
  Array.from(list).find((touch) => touch.identifier === id);

/** Pull to refresh on the screens named in lib/pull-to-refresh.ts; nothing elsewhere. */
export function PullToRefresh() {
  const pathname = usePathname();
  const query = useSearchParams()?.toString() ?? "";
  const source = pullRefreshSource(pathname, new URLSearchParams(query));
  // A new screen starts clean: nothing of an unfinished pull carries over.
  return source ? <PullSurface key={`${pathname}?${query}`} source={source} /> : null;
}

function PullSurface({ source }: { source: PullRefreshSource }) {
  const t = useT();
  const router = useRouter();
  const [reading, startReading] = useTransition();
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const edge = useRef<SVGRectElement>(null);
  const seat = useRef<SVGGElement>(null);
  const presence = useRef<SVGGElement>(null);
  const coinPlace = useRef<SVGGElement>(null);
  const coinLook = useRef<SVGGElement>(null);
  const pageRead = useRef<(() => void) | null>(null);

  // The server page has been read again.
  useEffect(() => {
    if (reading) return;
    pageRead.current?.();
    pageRead.current = null;
  }, [reading]);

  /** Fetches the fresh content and resolves when it is in place, never sooner than the light needs. */
  const load = useCallback(() => {
    const work: Promise<unknown>[] = [];
    const detail: PullRefreshDetail = { waitUntil: (job) => work.push(job) };
    window.dispatchEvent(new CustomEvent(pullRefreshEvent, { detail }));
    if (source === "server")
      work.push(
        new Promise<void>((resolve) => {
          pageRead.current = resolve;
          startReading(() => router.refresh());
        }),
      );
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    return Promise.all([
      wait(pullShortestRefresh),
      Promise.race([Promise.allSettled(work), wait(pullLongestRefresh)]),
    ]);
  }, [router, source]);

  useEffect(() => {
    const layer = root.current;
    const line = edge.current;
    const place = seat.current;
    const mark = presence.current;
    const coinAt = coinPlace.current;
    const coinShape = coinLook.current;
    if (!layer || !line || !place || !mark || !coinAt || !coinShape) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let phase: Phase = "idle";
    let finger: Finger | null = null;
    let movers: HTMLElement[] = [];
    let pull = 0;
    let hop = 0;
    let ready = false;
    let half = 0;
    let frame = 0;
    let painted = 0;
    let timer = 0;
    let alive = true;

    const enter = (next: Phase) => {
      phase = next;
      layer.dataset.phase = next;
    };
    const flag = (name: "ready" | "holed" | "settle", value: string | null) => {
      if (value === null) delete layer.dataset[name];
      else layer.dataset[name] = value;
    };
    /** Moves the page content; `ms` 0 follows the finger, anything else travels on the app's curve. */
    const shift = (distance: number, ms: number) => {
      for (const mover of movers) {
        mover.style.transition = ms ? `transform ${ms}ms var(--ease-out)` : "none";
        mover.style.transform = `translate3d(0, ${distance}px, 0)`;
      }
    };
    const draw = () => {
      const view = pullFrame(pull, hop, half);
      layer.style.clipPath = `inset(0 0 ${Math.max(0, pullStage - pull)}px 0)`;
      line.style.transform = `translateY(${pull - 1}px)`;
      place.style.transform = `translate(${half}px, ${view.seatY}px)`;
      mark.style.opacity = String(view.presence);
      mark.style.transform = calm.matches ? "" : `scale(${view.grow})`;
      coinAt.style.transform = `translate(${view.coin.x}px, ${view.coin.y}px)`;
      coinShape.style.transform = `scale(${view.coin.size * view.coin.flip}, ${view.coin.size}) rotate(${view.coin.turn}deg)`;
    };
    const release = () => {
      for (const mover of movers) {
        mover.style.transition = "";
        mover.style.transform = "";
      }
      movers = [];
    };
    const rest = () => {
      release();
      pull = 0;
      hop = 0;
      ready = false;
      flag("ready", null);
      flag("holed", null);
      enter("idle");
    };
    /** After the finger lifts: every piece travels to where `pull` now says, then the page rests. */
    const settle = (kind: "hold" | "back" | "cancel", ms: number) => {
      flag("settle", kind);
      shift(pull, ms);
      draw();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        flag("settle", null);
        if (kind !== "hold") rest();
      }, ms + 40);
    };
    /** Whether letting go now would refresh; it also turns the symbol from pale to full. */
    const judge = () => {
      const next = pullReady(ready, pull);
      if (next !== ready) flag("ready", next ? "" : null);
      ready = next;
    };
    const tick = (now: number) => {
      frame = 0;
      const elapsed = painted ? Math.min(64, now - painted) : 16;
      painted = now;
      if (phase === "pulling") {
        judge();
        shift(pull, 0);
      }
      // With less motion there is no hop: the hole is simply there.
      hop = calm.matches ? (ready ? 1 : 0) : stepHop(hop, ready, elapsed);
      flag("holed", hop >= 1 ? "" : null);
      draw();
      if (hop > 0 && hop < 1) schedule();
      else painted = 0;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const begin = () => {
      const header = document.querySelector<HTMLElement>(".site-header");
      // On the home page the logo lies over the photograph and travels with it.
      const headerMoves = header !== null && getComputedStyle(header).position === "absolute";
      movers = [
        document.getElementById("glavni-sadrzaj"),
        document.querySelector<HTMLElement>(".site-footer"),
        headerMoves ? header : null,
      ].filter((item): item is HTMLElement => item !== null);
      const top = header && !headerMoves ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      layer.style.top = `${top}px`;
      half = layer.getBoundingClientRect().width / 2;
      enter("pulling");
    };
    const refresh = () => {
      enter("refreshing");
      setBusy(true);
      pull = pullHold;
      settle("hold", pullSettleMs);
      schedule();
      void load().then(() => {
        if (!alive) return;
        setBusy(false);
        enter("leaving");
        pull = 0;
        settle("back", pullSettleMs);
      });
    };
    const cancel = () => {
      enter("returning");
      hop = 0;
      ready = false;
      flag("ready", null);
      flag("holed", null);
      pull = 0;
      settle("cancel", pullCancelMs);
    };

    const onStart = (event: TouchEvent) => {
      if (phase !== "idle" || finger || event.touches.length !== 1) return;
      if (window.scrollY > 0 || pullBlocked(event.target)) return;
      const touch = event.touches[0];
      if (touch)
        finger = { id: touch.identifier, x: touch.clientX, y: touch.clientY, pulling: false };
    };
    const onMove = (event: TouchEvent) => {
      if (!finger) return;
      const touch = touchOf(event.touches, finger.id);
      if (!touch) return;
      const dx = touch.clientX - finger.x;
      const dy = touch.clientY - finger.y;
      if (!finger.pulling) {
        if (dx === 0 && dy === 0) return;
        // Once the browser has started its own scroll the drag is no longer ours to take.
        if (!event.cancelable || window.scrollY > 0 || !isPullStart(dx, dy)) {
          finger = null;
          return;
        }
        finger.pulling = true;
        begin();
      }
      if (event.cancelable) event.preventDefault();
      pull = pullDistance(dy);
      schedule();
    };
    const onEnd = (event: TouchEvent) => {
      if (!finger || touchOf(event.touches, finger.id)) return;
      const pulled = finger.pulling;
      finger = null;
      if (!pulled) return;
      // The last move may not have been drawn yet: decide from where the finger really was.
      judge();
      if (ready && event.type === "touchend") refresh();
      else cancel();
    };

    document.documentElement.dataset.pullRefresh = "on";
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      release();
      delete document.documentElement.dataset.pullRefresh;
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [load]);

  return (
    <>
      <div ref={root} className={styles.root} data-phase="idle" aria-hidden="true">
        <svg className={styles.stage} width="100%" height={pullStage} aria-hidden="true">
          <rect ref={edge} className={styles.edge} width="100%" height="1" />
          <g ref={seat} className={styles.seat}>
            <g ref={presence} className={styles.presence}>
              <g className={styles.leave}>
                <g className={styles.pop}>
                  <g transform={pullSymbolSpace}>
                    <g className={styles.ink}>
                      <path
                        transform={logoSymbolBody.transform}
                        d={logoSymbolBody.d}
                        fill="currentColor"
                      />
                      {logoSymbol.slice(1).map((path) => (
                        <path
                          key={path.transform}
                          transform={path.transform}
                          d={path.d}
                          fill="currentColor"
                        />
                      ))}
                    </g>
                    <path
                      className={styles.hole}
                      transform={logoSymbolHole.transform}
                      d={logoSymbolHole.d}
                    />
                    <g className={styles.light}>
                      <path
                        className={`${styles.beam} ${styles.glow}`}
                        pathLength={1}
                        transform={logoSymbolBody.transform}
                        d={logoSymbolBody.d}
                        strokeWidth={pullBeam.glow}
                        style={{ filter: `blur(${pullBeam.blur}px)` }}
                      />
                      <path
                        className={styles.beam}
                        pathLength={1}
                        transform={logoSymbolBody.transform}
                        d={logoSymbolBody.d}
                        strokeWidth={pullBeam.line}
                      />
                    </g>
                  </g>
                </g>
              </g>
            </g>
            <g ref={coinPlace} className={styles.coinPlace}>
              <g ref={coinLook} className={styles.coinLook}>
                <g className={styles.coin} transform={pullCoinSpace}>
                  <circle cx={pullCoin.x} cy={pullCoin.y} r={pullCoin.r} fill="#e8c068" />
                  <circle
                    cx={pullCoin.x}
                    cy={pullCoin.y}
                    r="9.31"
                    fill="none"
                    stroke="#b8872b"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M238.94 286.61a7.4 7.4 0 0 1 5.6-5.4"
                    fill="none"
                    stroke="#fff1c4"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
      <p className={styles.status} role="status">
        {busy ? t("Osvježavamo sadržaj…") : ""}
      </p>
    </>
  );
}
