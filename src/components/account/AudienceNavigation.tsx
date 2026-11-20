"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { audienceHint } from "../../lib/ad-audience-sample";
import { IS_PLAY_EDITION } from "../../lib/distribution";
export function AudienceNavigation() {
  const path = usePathname();
  useEffect(() => {
    if (
      IS_PLAY_EDITION ||
      !path ||
      path.startsWith("/administracija") ||
      path.startsWith("/pregled")
    )
      return;
    let id: string | null;
    try {
      id = localStorage.getItem(audienceHint);
    } catch {
      return;
    }
    if (!id) return;
    const account = id;
    // A visible, settled navigation is one view. The URL never leaves this component.
    const timer = window.setTimeout(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/account/audience-sample", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": account },
          body: JSON.stringify({ eventId: crypto.randomUUID() }),
        });
        if (res.status === 401 || (res.ok && !(await res.json()).enabled)) {
          if (localStorage.getItem(audienceHint) === account) localStorage.removeItem(audienceHint);
        }
      } catch {}
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [path]);
  return null;
}
