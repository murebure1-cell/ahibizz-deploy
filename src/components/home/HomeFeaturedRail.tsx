"use client";

import { useEffect, useRef, useState } from "react";
import { readHomeCardPage } from "../../lib/home-nearby";
import type { PublicBusinessView } from "../../lib/public-business";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { useT } from "../i18n/LocaleProvider";
import { HomeBusinessRail } from "./HomeSurface";
import styles from "./nearby.module.css";

export function HomeFeaturedRail({
  title,
  initial,
  initiallyMore,
  categories,
  pageSize,
  example,
}: {
  title: string;
  initial: PublicBusinessView[];
  initiallyMore: boolean;
  categories: Parameters<typeof readHomeCardPage>[1];
  pageSize: number;
  example: PublicBusinessView | null;
}) {
  const t = useT();
  const [businesses, setBusinesses] = useState(initial);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initiallyMore);
  const [state, setState] = useState<"pending" | "failed" | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function append() {
    if (!hasMore || request.current) return;
    const next = page + 1;
    const controller = new AbortController();
    request.current = controller;
    setState("pending");
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`/api/directory/businesses?istaknute=sve&page=${next}`, {
        signal: controller.signal,
        cache: "no-store",
        mode: "same-origin",
        redirect: "error",
      });
      if (!response.ok) throw new Error("DIRECTORY_UNAVAILABLE");
      const updated = readHomeCardPage(await response.json(), categories, {
        page: next,
        pageSize,
      });
      setBusinesses((current) => [
        ...new Map([...current, ...updated.items].map((item) => [item.id, item])).values(),
      ]);
      setPage(next);
      setHasMore(updated.hasMore);
      setState(null);
    } catch {
      setState("failed");
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
    }
  }

  const cards = businesses.map((business) => (
    <DirectoryResultCard key={business.id} business={business} compact />
  ));
  if (example && !businesses.some((business) => business.id === example.id))
    cards.push(<DirectoryResultCard key={example.id} business={example} compact example />);
  return (
    <>
      <HomeBusinessRail label={title} cards={cards} />
      {hasMore && (
        <button
          className={styles.more}
          disabled={state === "pending"}
          type="button"
          onClick={append}
        >
          {state === "pending"
            ? t("Učitavanje…")
            : state === "failed"
              ? t("Pokušaj ponovo")
              : t("Prikaži još")}
        </button>
      )}
    </>
  );
}
