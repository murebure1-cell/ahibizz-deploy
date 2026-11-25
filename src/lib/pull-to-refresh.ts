import { accountNotificationsPath } from "./account-return";

/**
 * Pull to refresh: on a few screens a finger that drags the page down from its very top opens a
 * gap above the content. A gold coin rolls along the content's top edge towards the symbol in
 * the gap, hops into the symbol's round hole once the pull is far enough, and after the release
 * a light runs along the symbol's edge until the fresh content is there.
 *
 * Everything here is plain arithmetic, so the component only reads touches and writes styles.
 */

/** Sent on the window when a pull starts a refresh; a screen that loads its own data answers it. */
export const pullRefreshEvent = "ahibizz:pull-refresh";
export type PullRefreshDetail = { waitUntil: (work: Promise<unknown>) => void };

/** Where a screen's content comes from: the server page, or data the screen fetches itself. */
export type PullRefreshSource = "server" | "listeners";

/** The screens that refresh on a pull; everywhere else the gesture is left to the browser. */
export function pullRefreshSource(
  pathname: string,
  query: URLSearchParams,
): PullRefreshSource | null {
  if (pathname === "/" || pathname === "/pretraga" || pathname === accountNotificationsPath)
    return "server";
  // The inbox keeps private state in the browser and reloads itself; the page is not re-read.
  if (pathname === "/nalog" && query.get("odjeljak") === "poruke") return "listeners";
  return null;
}

/** Releasing at this many pixels of travel, or further, refreshes. */
export const pullThreshold = 80;
/** Once ready, the pull stays ready until it drops below this, so the coin does not flicker. */
export const pullStandDown = 72;
/** The gap that stays open while the fresh content is on its way. */
export const pullHold = 64;
/** The content never travels further than this, however far the finger goes. */
export const pullLimit = 140;
/** Height of the layer the symbol and the coin are drawn in. */
export const pullStage = 150;

/** The light runs at least this long, so a fast answer does not flash. */
export const pullShortestRefresh = 600;
/** A refresh that has not answered by now is let go; the page stays as it is. */
export const pullLongestRefresh = 8000;
export const pullSettleMs = 300;
export const pullCancelMs = 200;
const hopInMs = 220;
const hopOutMs = 160;

const reach = 280;
const grip = 0.8;

/**
 * How far the content travels for a finger that has moved `drag` pixels down: close to the
 * finger at first and harder the further it goes. 140 px of finger give the 80 px threshold.
 */
export function pullDistance(drag: number): number {
  if (!(drag > 0)) return 0;
  return Math.min(pullLimit, reach * (1 - 1 / ((drag * grip) / reach + 1)));
}

/** A drag counts as a pull only when it starts downwards and is more vertical than sideways. */
export function isPullStart(dx: number, dy: number): boolean {
  return dy > 0 && Math.abs(dy) > Math.abs(dx);
}

/** Ready to refresh: reached at the threshold and kept until the pull clearly goes back. */
export function pullReady(wasReady: boolean, pull: number): boolean {
  return pull >= (wasReady ? pullStandDown : pullThreshold);
}

/** Moves the coin's hop one step: towards the hole while ready, back to the edge otherwise. */
export function stepHop(hop: number, ready: boolean, elapsedMs: number): number {
  const next = ready ? hop + elapsedMs / hopInMs : hop - elapsedMs / hopOutMs;
  return Math.min(1, Math.max(0, next));
}

/*
 * The symbol and its hole in the logo's own units (see components/brand/logo-paths.ts): the
 * symbol's box and the centre and radius of the round hole in its corner.
 */
const symbolBox = { left: 220.28, right: 347.65, top: 249.7, bottom: 374.94 };
const holeInLogo = { x: 245.34, y: 288.81, r: 13.3 };
const symbolWidth = 52;
const scale = symbolWidth / (symbolBox.right - symbolBox.left);
const symbolCentre = {
  x: (symbolBox.left + symbolBox.right) / 2,
  y: (symbolBox.top + symbolBox.bottom) / 2,
};
/** The hole measured from the symbol's centre, in screen pixels. */
const hole = {
  x: (holeInLogo.x - symbolCentre.x) * scale,
  y: (holeInLogo.y - symbolCentre.y) * scale,
  r: holeInLogo.r * scale,
};
/** On the edge the coin is twice the size of the hole; it shrinks into it as it lands. */
const rolling = 2;
const rollRadius = hole.r * rolling;
const takeOffX = hole.x - 26;
const apexAboveHole = 20;
const riseShare = 130 / hopInMs;

const round = (value: number) => Math.round(value * 100) / 100;
const mix = (from: number, to: number, share: number) => from + (to - from) * share;
// Gravity: rising slows down, falling speeds up (easeOutQuad and easeInQuad, easings.net).
const rising = (share: number) => 1 - (1 - share) * (1 - share);
const falling = (share: number) => share * share;

/** SVG transforms that place the logo's own coordinates around the symbol's centre and the coin's. */
export const pullSymbolSpace = `scale(${round(scale * 10000) / 10000}) translate(${round(-symbolCentre.x)} ${round(-symbolCentre.y)})`;
export const pullCoinSpace = `scale(${round(scale * 10000) / 10000}) translate(${round(-holeInLogo.x)} ${round(-holeInLogo.y)})`;
export const pullCoin = holeInLogo;
/** Stroke widths of the loading light in the logo's units: a 3 px line and an 8 px glow. */
export const pullBeam = { line: round(3 / scale), glow: round(8 / scale), blur: round(3 / scale) };

export type PullFrame = {
  /** The symbol's centre below the top of the gap; it stays in the middle of the gap. */
  seatY: number;
  /** 0 while the gap is too small to show the symbol, 1 once it fits. */
  presence: number;
  /** The symbol grows a little as the gap opens. */
  grow: number;
  /** The coin, measured from the symbol's centre. `flip` narrows it while it turns in the air. */
  coin: { x: number; y: number; size: number; flip: number; turn: number };
};

/**
 * Everything that is drawn for a pull of `pull` pixels. `hop` runs from 0 (the coin rolls on the
 * content's edge) to 1 (the coin sits in the hole); `half` is half the width of the screen.
 */
export function pullFrame(pull: number, hop: number, half: number): PullFrame {
  const travel = Math.min(1, Math.max(0, pull) / pullThreshold);
  // The roll starts a fixed distance left of the symbol, but never off a narrow screen.
  const startX = Math.max(22 - half, takeOffX - 119);
  const edgeX = mix(startX, takeOffX, travel);
  const edgeY = pull / 2 - rollRadius - 1.5;
  const rolled = ((edgeX - startX) / rollRadius) * (180 / Math.PI);
  const upright = Math.ceil(rolled / 360) * 360;
  const apexY = hole.y - apexAboveHole;
  const y =
    hop < riseShare
      ? mix(edgeY, apexY, rising(hop / riseShare))
      : mix(apexY, hole.y, falling((hop - riseShare) / (1 - riseShare)));
  return {
    seatY: round(pull / 2),
    presence: round(Math.min(1, Math.max(0, (pull - 16) / 40))),
    grow: round(0.8 + 0.2 * travel),
    coin: {
      x: round(mix(edgeX, hole.x, hop)),
      y: round(hop <= 0 ? edgeY : y),
      size: round(mix(rolling, 1, hop)),
      flip: round(hop <= 0 || hop >= 1 ? 1 : 1 - 0.8 * Math.sin(Math.PI * hop)),
      turn: round(mix(rolled, upright, hop)),
    },
  };
}
