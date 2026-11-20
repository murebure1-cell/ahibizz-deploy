import type { BusinessDetails } from "./business-details";
import { initialLocationPoint } from "./business-location";
import {
  type BusinessMediaAsset,
  type BusinessMediaSummary,
  businessMediaUrl,
  readBusinessMediaSummary,
} from "./business-media";
import type { ReviewSummary } from "./reviews";

export type PublicBusinessView = {
  details?: BusinessDetails | null;
  reviews?: ReviewSummary;
  id: string;
  title: string;
  categoryName: string | null;
  subcategoryName: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  localFeatured?: boolean;
  image?: { src: string; alt: string };
  gallery?: { src: string; alt: string }[];
  logo?: { src: string; alt: string };
};

export function publicBusinessImages(
  businessId: string,
  summary: BusinessMediaSummary | undefined,
  imageUrl: (id: string, asset: BusinessMediaAsset) => string | null = businessMediaUrl,
): Pick<PublicBusinessView, "image" | "logo" | "gallery"> {
  if (!summary) return {};
  try {
    const media = readBusinessMediaSummary(summary),
      cover = media.cover ? imageUrl(businessId, media.cover) : null,
      logo = media.logo ? imageUrl(businessId, media.logo) : null;
    return {
      ...(cover ? { image: { src: cover, alt: "Naslovna fotografija djelatnosti" } } : {}),
      ...(logo ? { logo: { src: logo, alt: "Logo djelatnosti" } } : {}),
      gallery: media.gallery.flatMap((asset, index) => {
        const src = imageUrl(businessId, asset);
        return src ? [{ src, alt: `Fotografija djelatnosti ${index + 1}` }] : [];
      }),
    };
  } catch {
    return {};
  }
}
export function safeBusinessImage(
  image: { src: string; alt: string } | undefined,
  preview = false,
): { src: string; alt: string } | undefined {
  if (
    !image ||
    typeof image.src !== "string" ||
    typeof image.alt !== "string" ||
    image.src.includes("\\") ||
    [...image.src].some((c) => c.charCodeAt(0) <= 32)
  )
    return undefined;
  const publicPath =
    /^\/api\/business-media\/public\/[A-Za-z0-9_-]{1,128}\/(?:logo|cover|gallery)\/[0-8]\?v=[1-9]\d{0,9}$/.test(
      image.src,
    );
  if (publicPath || (preview && image.src.startsWith("/preview/") && !image.src.includes("..")))
    return image;
  if (preview && image.src.startsWith("blob:") && typeof window !== "undefined") {
    try {
      if (new URL(image.src).origin === window.location.origin) return image;
    } catch {}
  }
  return undefined;
}

export function businessContactLinks(business: PublicBusinessView) {
  const rawPhone = business.contactPhone?.trim() ?? "";
  const normalizedPhone = rawPhone.replace(/[ ().-]/g, "");
  const phone =
    /^[+0-9][0-9 ().-]{3,39}$/.test(rawPhone) && /^\+?\d{4,15}$/.test(normalizedPhone)
      ? `tel:${normalizedPhone}`
      : null;
  const rawEmail = business.contactEmail?.trim() ?? "";
  const email =
    rawEmail.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(rawEmail)
      ? `mailto:${encodeURIComponent(rawEmail)}`
      : null;
  let website: string | null = null;
  if (
    business.websiteUrl &&
    !Array.from(business.websiteUrl).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  ) {
    try {
      const url = new URL(business.websiteUrl);
      if (url.protocol === "https:" && url.hostname && !url.username && !url.password)
        website = url.href;
    } catch {
      /* Invalid optional links are omitted. */
    }
  }
  return { phone, email, website };
}

export function publicBusinessPoint(business: PublicBusinessView) {
  return initialLocationPoint(business.latitude, business.longitude);
}

export function businessLocationLabel(business: PublicBusinessView): string {
  let country = business.countryCode?.trim().toUpperCase() ?? "";
  if (/^[A-Z]{2}$/.test(country)) {
    country = new Intl.DisplayNames(["bs"], { type: "region" }).of(country) ?? country;
  } else country = "";
  const values = [business.addressLine?.trim(), business.city?.trim(), country].filter(
    (item): item is string => Boolean(item),
  );
  const unique = [
    ...new Map(values.map((value) => [value.toLocaleLowerCase("bs"), value])).values(),
  ];
  return unique.join(", ") || "Lokacija nije unesena.";
}

export function businessDirections(business: PublicBusinessView, mode: "driving" | "walking") {
  const point = publicBusinessPoint(business);
  if (!point || !["driving", "walking"].includes(mode)) return null;
  const parameters = new URLSearchParams({
    api: "1",
    destination: `${point.latitude},${point.longitude}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${parameters}`;
}
