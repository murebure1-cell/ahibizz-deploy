"use client";

import { useEffect } from "react";

/**
 * Counts this page once per browser session for its owner's "Pregledi · 30 dana". Sends only
 * which page it is; nothing about the visitor. Storage that is unavailable still sends once.
 */
export function ViewBeacon({ kind, id }: { kind: "person" | "business"; id: string }) {
  useEffect(() => {
    const key = `ahibizz-view:${kind}:${id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private windows may refuse storage; the server still ignores an owner's own views.
    }
    void fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
      keepalive: true,
    }).catch(() => {});
  }, [kind, id]);
  return null;
}
