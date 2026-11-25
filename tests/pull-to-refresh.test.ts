import assert from "node:assert/strict";
import test from "node:test";
import { accountNotificationsPath } from "../src/lib/account-return";
import {
  isPullStart,
  pullDistance,
  pullFrame,
  pullHold,
  pullLimit,
  pullReady,
  pullRefreshSource,
  pullStandDown,
  pullThreshold,
  stepHop,
} from "../src/lib/pull-to-refresh";

const query = (text = "") => new URLSearchParams(text);
// The rolling coin's radius on the screen: twice the hole in a symbol 52 px wide.
const rollRadius = 10.86;

test("pull to refresh is on for home, search, notifications and messages, and nowhere else", () => {
  assert.equal(pullRefreshSource("/", query()), "server");
  assert.equal(pullRefreshSource("/pretraga", query("upit=pekara")), "server");
  assert.equal(pullRefreshSource(accountNotificationsPath, query()), "server");
  // The inbox reloads itself, so the account page is not read again from the server.
  assert.equal(pullRefreshSource("/nalog", query("odjeljak=poruke")), "listeners");
  assert.equal(pullRefreshSource("/nalog", query()), null);
  assert.equal(pullRefreshSource("/nalog", query("odjeljak=postavke")), null);
  assert.equal(pullRefreshSource("/djelatnosti/pekara", query()), null);
  assert.equal(pullRefreshSource("/mapa", query()), null);
});

test("the content follows the finger closely at first and harder the further it goes", () => {
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(-40), 0);
  assert.equal(pullDistance(Number.NaN), 0);
  assert.ok(Math.abs(pullDistance(140) - pullThreshold) < 0.01);
  const first = pullDistance(50);
  const second = pullDistance(100) - pullDistance(50);
  const third = pullDistance(150) - pullDistance(100);
  assert.ok(first > second && second > third && third > 0);
  assert.ok(first < 50);
  assert.equal(pullDistance(5000), pullLimit);
});

test("a pull starts only downwards and more vertical than sideways", () => {
  assert.equal(isPullStart(0, 9), true);
  assert.equal(isPullStart(4, 9), true);
  assert.equal(isPullStart(9, 4), false);
  assert.equal(isPullStart(9, 9), false);
  assert.equal(isPullStart(0, -9), false);
});

test("ready is reached at the threshold and kept until the pull clearly goes back", () => {
  assert.equal(pullReady(false, pullThreshold - 0.1), false);
  assert.equal(pullReady(false, pullThreshold), true);
  assert.equal(pullReady(true, pullThreshold - 5), true);
  assert.equal(pullReady(true, pullStandDown - 0.1), false);
  assert.ok(pullHold < pullStandDown && pullStandDown < pullThreshold);
});

test("the hop reaches the hole in 220 ms and returns in 160 ms, never past either end", () => {
  assert.equal(stepHop(0, true, 110), 0.5);
  assert.equal(stepHop(0.9, true, 110), 1);
  assert.equal(stepHop(1, false, 80), 0.5);
  assert.equal(stepHop(0.2, false, 80), 0);
  assert.equal(stepHop(0, false, 16), 0);
});

test("the coin rolls on the content's edge and is hidden until the gap opens", () => {
  const half = 195;
  const closed = pullFrame(0, 0, half);
  // Its lowest point is above the top of the gap, so nothing of it shows before a pull.
  assert.ok(closed.seatY + closed.coin.y + rollRadius < 0);
  assert.equal(closed.presence, 0);
  assert.equal(closed.coin.turn, 0);
  const early = pullFrame(40, 0, half);
  const late = pullFrame(pullThreshold, 0, half);
  assert.ok(early.coin.x < late.coin.x && late.coin.x < 0);
  assert.ok(early.coin.turn < late.coin.turn);
  // Rolling without slipping: the turn matches the distance travelled.
  const travelled = ((late.coin.x - closed.coin.x) / rollRadius) * (180 / Math.PI);
  assert.ok(Math.abs(late.coin.turn - travelled) < 1);
  // It rides just above the content's top edge, which is `pull` below the top of the gap.
  assert.ok(Math.abs(late.seatY + late.coin.y + rollRadius + 1.5 - pullThreshold) < 0.1);
  assert.equal(late.presence, 1);
  assert.equal(late.grow, 1);
  // Past the threshold it waits at the take-off point.
  assert.equal(pullFrame(pullThreshold + 30, 0, half).coin.x, late.coin.x);
});

test("the hop is an arc that ends in the hole, upright and at the hole's size", () => {
  const half = 195;
  const from = pullFrame(pullThreshold, 0, half).coin;
  const mid = pullFrame(pullThreshold, 0.5, half).coin;
  const to = pullFrame(pullThreshold, 1, half).coin;
  assert.equal(to.size, 1);
  assert.equal(to.flip, 1);
  assert.equal(to.turn % 360, 0);
  assert.ok(to.turn >= from.turn);
  // Higher than both ends on the way: it jumps, it does not slide.
  assert.ok(mid.y < from.y && mid.y < to.y);
  assert.ok(from.x < mid.x && mid.x < to.x);
  assert.ok(mid.flip < 0.5 && mid.size < from.size && mid.size > to.size);
  // Once in the hole it no longer depends on how far the content was pulled.
  assert.deepEqual(pullFrame(pullHold, 1, half).coin, to);
});

test("a narrow screen keeps the start of the roll on the screen", () => {
  const narrow = pullFrame(0, 0, 160).coin.x;
  assert.ok(160 + narrow >= 22);
  assert.ok(pullFrame(0, 0, 195).coin.x < narrow);
});
