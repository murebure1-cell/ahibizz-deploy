"use client";

import { useEffect } from "react";

/**
 * Counts this page once per browser session for its owner's "Pregledi · 30 dana". Sends only
 * which page it is; nothing about the visitor. Storage that is unavailable still sends once.
 */
/** Where a business visitor came from, read only from the path of the AhiBizz page they left. */
function visitSource(): "search" | "category" | "map" | "other" {
  try {
    const from = new URL(document.referrer);
    if (from.origin !== window.location.origin) return "other";
    if (from.pathname.startsWith("/mapa")) return "map";
    if (from.pathname.startsWith("/pretraga"))
      return from.searchParams.has("categoryId") || from.searchParams.has("subcategoryId")
        ? "category"
        : "search";
  } catch {
    // No referrer or an unreadable one: counted as other.
  }
  return "other";
}

/** Counts a tap on call, message or map for the owner's "Dodiri". Sends nothing about the visitor. */
export function sendTouch(id: string, touch: "call" | "message" | "map") {
  void fetch("/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "touch", id, touch }),
    keepalive: true,
  }).catch(() => {});
}

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
      body: JSON.stringify(
        kind === "business" ? { kind, id, source: visitSource() } : { kind, id },
      ),
      keepalive: true,
    }).catch(() => {});
  }, [kind, id]);
  return null;
}
