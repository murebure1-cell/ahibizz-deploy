export function reelPath(id: string) {
  return `/reels/${id}`;
}

export function reelCardPath(
  id: string,
  businessId: string | null,
  source?: "pocetna" | "profil",
  page = 1,
) {
  const params = new URLSearchParams();
  if (businessId) params.set("djelatnost", businessId);
  if (source) params.set("iz", source);
  if (page > 1) params.set("stranica", String(page));
  return `${reelPath(id)}${params.size ? `?${params}` : ""}`;
}

export function reelClosePath(businessId: string | null, source: unknown, page: unknown) {
  if (source === "pocetna") return "/";
  if (source === "profil" && businessId) return `/djelatnosti/${businessId}`;
  const params = new URLSearchParams();
  if (typeof page === "string" && /^[1-9]\d{0,2}$/.test(page) && page !== "1")
    params.set("stranica", page);
  if (businessId) params.set("djelatnost", businessId);
  return params.size ? `/reels?${params}` : "/reels";
}
