import type { PublicBusinessView } from "../../lib/public-business";
import type { PreviewBusiness } from "./data";

// These are explicitly fictional design fixtures at public city-centre coordinates.
// They never enter the operational database or claim a real business address.
export function previewPublicBusiness(business: PreviewBusiness): PublicBusinessView {
  const point =
    business.location === "Sarajevo"
      ? [43.8563, 18.4131]
      : business.location === "Zenica"
        ? [44.2017, 17.9039]
        : [44.5384, 18.6671];
  return {
    id: business.id,
    title: business.name,
    categoryName: business.category,
    subcategoryName: null,
    description:
      business.id === "forma"
        ? "Masaže i fizioterapija u mirnom prostoru, uz individualni pristup."
        : business.line,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    addressLine: null,
    city: business.location,
    countryCode: "BA",
    latitude: point[0] ?? null,
    longitude: point[1] ?? null,
    verified: false,
    image: { src: business.image, alt: business.imageAlt },
    gallery: [
      { src: business.image, alt: business.imageAlt },
      ...(business.id === "forma"
        ? [{ src: "/preview/detail.webp", alt: "Peškir i cvijeće, ilustrativna fotografija" }]
        : []),
    ],
  };
}
