import assert from "node:assert/strict";
import { test } from "node:test";
import { listenForBookingResume } from "../src/components/booking/booking-resume";

function fixture() {
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const browser = new EventTarget();
  const pageshow = (persisted: boolean) =>
    browser.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  const setVisible = (visible: boolean) => {
    page.visibilityState = visible ? "visible" : "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
  };
  let reads = 0;
  const stop = listenForBookingResume(
    () => {
      reads++;
    },
    page,
    browser,
  );
  return {
    focus: () => browser.dispatchEvent(new Event("focus")),
    pageshow,
    setVisible,
    reads: () => reads,
    stop,
  };
}

test("booking refresh groups focus and visibility events when the app resumes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = fixture();
  page.setVisible(false);
  page.focus();
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 0);

  page.setVisible(true);
  page.focus();
  page.pageshow(true);
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 1);

  page.pageshow(true);
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 2);
  page.stop();
});

test("initial page show, a hidden page and an unmounted panel do not refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = fixture();
  page.pageshow(false);
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 0);

  page.focus();
  page.setVisible(false);
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 0);

  page.setVisible(true);
  page.stop();
  page.focus();
  t.mock.timers.tick(500);
  assert.equal(page.reads(), 0);
});
