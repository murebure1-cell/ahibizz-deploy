"use client";

import Image from "next/image";
import Link from "next/link";
import { Icon } from "../Icon";
import type { PreviewBusiness } from "./data";
import { usePreviewState } from "./PreviewState";

export function BusinessCard({
  business,
  compact = false,
}: {
  business: PreviewBusiness;
  compact?: boolean;
}) {
  const state = usePreviewState();
  const saved = state.saved.has(business.id);
  return (
    <article
      data-design="directory-card"
      className={`business-card${compact ? " business-card-compact" : ""}`}
    >
      <div className="business-photo">
        <Image
          src={business.image}
          alt={business.imageAlt}
          fill
          sizes={
            compact
              ? "(max-width: 700px) 100px, 260px"
              : "(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 280px"
          }
        />
        <button
          type="button"
          className="save-business"
          aria-label={`${saved ? "Ukloni" : "Sačuvaj"} ${business.name}`}
          aria-pressed={saved}
          onClick={() => state.toggleSaved(business.id)}
        >
          <Icon name="heart" fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="business-info">
        <span className="business-category">{business.category}</span>
        <h3>
          <Link href={`/pregled/djelatnost?profil=${business.id}`}>{business.name}</Link>
        </h3>
        <p className="business-line">{business.line}</p>
        <span className="business-place">
          <Icon name="pin" />
          {business.location}
        </span>
      </div>
    </article>
  );
}
