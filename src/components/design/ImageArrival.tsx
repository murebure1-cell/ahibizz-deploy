"use client";

import { useEffect } from "react";

/**
 * Marks images that finish downloading after the page is interactive, so motion.css can fade
 * them in. Images are never hidden in advance: one that loaded earlier, or a browser without
 * JavaScript, simply shows the image as it is.
 */
export function ImageArrival() {
  useEffect(() => {
    const arrived = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) target.dataset.arrived = "true";
    };
    // `load` does not bubble, so listen during capture to see every image on the page.
    document.addEventListener("load", arrived, true);
    return () => document.removeEventListener("load", arrived, true);
  }, []);
  return null;
}
