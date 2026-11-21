"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./rail.module.css";

export function HomeRail({
  label,
  className,
  listings = false,
  children,
}: {
  label: string;
  className: string | undefined;
  listings?: boolean;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });

  useEffect(() => {
    const scroller = track.current;
    if (!scroller || listings) return;
    function updateEdges() {
      if (!scroller) return;
      const before = scroller.scrollLeft > 2;
      const after = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 2;
      setEdges((previous) =>
        before === previous.before && after === previous.after ? previous : { before, after },
      );
    }
    const observer = new ResizeObserver(updateEdges);
    const observeItems = () => {
      observer.disconnect();
      observer.observe(scroller);
      for (const item of scroller.children) observer.observe(item);
      updateEdges();
    };
    observeItems();
    const changes = new MutationObserver(observeItems);
    changes.observe(scroller, { childList: true });
    scroller.addEventListener("scroll", updateEdges, { passive: true });
    return () => {
      observer.disconnect();
      changes.disconnect();
      scroller.removeEventListener("scroll", updateEdges);
    };
  }, [listings]);

  return (
    <section className={styles.rail} aria-label={label} data-listings={listings || undefined}>
      <div className={styles.viewport} data-before={edges.before} data-after={edges.after}>
        <div
          ref={track}
          className={`${styles.track} ${className ?? ""}`}
          onFocusCapture={({ currentTarget, target }) => {
            const bounds = currentTarget.getBoundingClientRect();
            const slide = Array.from(currentTarget.children).find((item) => item.contains(target));
            if (!slide) return;
            const item = slide.getBoundingClientRect();
            if (item.left < bounds.left + 2 || item.right > bounds.right - 2) {
              // Align the focused slide to its snap point. A smaller adjustment may snap back.
              currentTarget.scrollBy({ left: item.left - bounds.left - 3, behavior: "instant" });
            }
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
