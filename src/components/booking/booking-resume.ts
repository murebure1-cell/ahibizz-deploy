const resumeDelayMs = 120;

export function listenForBookingResume(
  refresh: () => void,
  page: EventTarget & Pick<Document, "visibilityState"> = document,
  browser: EventTarget = window,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(event: Event) {
    if (event.type === "pageshow" && !(event as PageTransitionEvent).persisted) return;
    if (page.visibilityState !== "visible" || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (page.visibilityState === "visible") refresh();
    }, resumeDelayMs);
  }
  browser.addEventListener("focus", schedule);
  browser.addEventListener("pageshow", schedule);
  page.addEventListener("visibilitychange", schedule);
  return () => {
    clearTimeout(timer);
    browser.removeEventListener("focus", schedule);
    browser.removeEventListener("pageshow", schedule);
    page.removeEventListener("visibilitychange", schedule);
  };
}
