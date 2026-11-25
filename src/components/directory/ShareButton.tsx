"use client";

import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";

/**
 * Hands the page to the device's share sheet. Where there is none, the link is copied and a
 * short note says so; if copying is refused too, the link itself is shown to copy by hand.
 */
export function ShareButton({
  title,
  path,
  className,
  statusClassName,
}: {
  title: string;
  path: string;
  className?: string;
  statusClassName?: string;
}) {
  const t = useT();
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => setStatus(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [status]);
  async function share() {
    const url = new URL(path, window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus(t("Link je kopiran."));
    } catch {
      setStatus(url);
    }
  }
  return (
    <>
      <button type="button" className={className} aria-label={t("Podijeli")} onClick={share}>
        <Icon name="share" />
      </button>
      <span role="status" className={statusClassName}>
        {status}
      </span>
    </>
  );
}
