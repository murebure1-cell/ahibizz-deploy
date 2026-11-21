"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { HomeBusinessRail, HomeSurface } from "../home/HomeSurface";
import { Icon } from "../Icon";
import { BusinessCard } from "./BusinessCard";
import { previewBusinesses } from "./data";
import { PreviewInstall } from "./PreviewPwa";
import { usePreviewState } from "./PreviewState";

const categories = [
  { name: "Ljepota i zdravlje", label: "Za tebe", icon: "heart" },
  { name: "Dom i uređenje", label: "Za dom", icon: "home" },
  { name: "Hrana i piće", label: "Hrana i piće", icon: "coffee" },
  { name: "Servisi i usluge", label: "Usluge", icon: "shop" },
] as const;

export function PreviewHome() {
  const { place, setPlace } = usePreviewState();
  const [choosingPlace, setChoosingPlace] = useState(false);
  const nearby = previewBusinesses.filter((business) => business.location === place);
  return (
    <HomeSurface
      searchAction="/pregled/pretraga"
      placeField="place"
      place={place}
      categories={categories.map((category) => ({
        id: category.name,
        label: category.label,
        icon: category.icon,
        href: `/pregled/pretraga?category=${encodeURIComponent(category.name)}`,
      }))}
      featuredHref="/pregled/pretraga"
      newest={previewBusinesses
        .slice(0, 1)
        .map((business) => <BusinessCard key={business.id} business={business} />)}
      featured={previewBusinesses.map((business) => (
        <BusinessCard key={business.id} business={business} />
      ))}
      advertisingHref="/oglasavanje"
      nearbyControl={
        <button
          type="button"
          className="preview-place-button"
          aria-expanded={choosingPlace}
          aria-controls="preview-place-picker"
          onClick={() => setChoosingPlace(!choosingPlace)}
        >
          <Icon name="pin" />
          {place}
          <Icon name="chevron" />
        </button>
      }
      nearbyBefore={
        choosingPlace && (
          <div id="preview-place-picker" className="preview-place-picker">
            <span>Izaberi grad za pregled</span>
            {["Tuzla", "Sarajevo", "Zenica"].map((city) => (
              <button
                type="button"
                key={city}
                aria-pressed={city === place}
                onClick={() => {
                  setPlace(city);
                  setChoosingPlace(false);
                }}
              >
                {city}
              </button>
            ))}
          </div>
        )
      }
      nearby={
        <HomeBusinessRail
          label="Djelatnosti u blizini"
          cards={nearby.map((business) => (
            <BusinessCard key={business.id} business={business} compact />
          ))}
        />
      }
      after={
        <>
          <PreviewInstall />
          <footer className="preview-footer preview-container">
            <Image
              src="/brand/ahi-logo-color.svg"
              alt="AhiBizz"
              width={125}
              height={34}
              unoptimized
            />
            <Link href="/o-nama">O projektu</Link>
            <span>Pregled novog izgleda</span>
          </footer>
        </>
      }
    />
  );
}
