"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./navigation-progress.module.css";

/**
 * A thin gold bar at the top that starts the moment an in-app link is tapped and ends when the
 * next page arrives. It runs in the browser only, so server redirects and 404 statuses keep their
 * real HTTP codes (a route-level loading boundary would turn them into streamed 200s).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [pending, setPending] = useState(false);

  // The new route rendered: the navigation is done.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname and search mark arrival.
  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function start(event: MouseEvent) {
      // Capture phase: Next's Link cancels the native click before a bubbling listener sees it.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      setPending(true);
      clearTimeout(timer);
      // A link whose own handler stops navigation must not leave the bar running.
      timer = setTimeout(() => setPending(false), 10_000);
    }
    const stop = () => setPending(false);
    document.addEventListener("click", start, true);
    window.addEventListener("popstate", stop);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", start, true);
      window.removeEventListener("popstate", stop);
    };
  }, []);

  return <div className={styles.bar} data-pending={pending} aria-hidden="true" />;
}
