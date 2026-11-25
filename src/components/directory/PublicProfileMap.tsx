"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { LocationPoint } from "../../lib/business-location";
import styles from "./public-profile.module.css";

const LocationMap = dynamic(() => import("./LocationMap").then((module) => module.LocationMap), {
  ssr: false,
});

/** The map on a public profile; it is made only when the page has been scrolled near it. */
export function PublicProfileMap({
  point,
  category,
}: {
  point: LocationPoint;
  category?: string | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!element.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "160px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.map} ref={element}>
      {visible && (
        <LocationMap point={point} disabled readOnly category={category} onPoint={() => {}} />
      )}
    </div>
  );
}
