"use client";

import { useEffect, useState } from "react";

function clock(timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

/**
 * Whether the viewer's own clock shows another time than the clock of a place's time zone.
 * Times of a business are told on the business's clock; its zone is named only to a viewer for
 * whom that makes a difference. Devices name the same clock differently (Sarajevo, Belgrade,
 * Zagreb, Warsaw), so the clocks are compared and not the names. The viewer's zone is known
 * only in their browser, so the answer is false until the first effect has run.
 */
export function useOtherClock(zone: string | null | undefined): boolean {
  const [other, setOther] = useState(false);
  useEffect(() => {
    if (!zone) {
      setOther(false);
      return;
    }
    try {
      setOther(clock(zone) !== clock());
    } catch {
      setOther(false);
    }
  }, [zone]);
  return other;
}
