"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import styles from "./rail.module.css";

export function HomeRail({
  label,
  className,
  children,
}: {
  label: string;
  className: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });

  useEffect(() => {
    const scroller = track.current;
    if (!scroller) return;
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
  }, []);

  function page(direction: number) {
    const scroller = track.current;
    if (scroller) scroller.scrollBy({ left: direction * (scroller.clientWidth - 24) });
  }

  return (
    <div className={styles.rail}>
      <div className={styles.viewport} data-before={edges.before} data-after={edges.after}>
        <div
          id={id}
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
      {(edges.before || edges.after) && (
        <div className={styles.controls}>
          <button
            type="button"
            aria-controls={id}
            aria-label={`Pomjeri ulijevo: ${label}`}
            disabled={!edges.before}
            onClick={() => page(-1)}
          >
            <Icon name="chevron" />
          </button>
          <button
            type="button"
            aria-controls={id}
            aria-label={`Pomjeri udesno: ${label}`}
            disabled={!edges.after}
            onClick={() => page(1)}
          >
            <Icon name="chevron" />
          </button>
        </div>
      )}
    </div>
  );
}
