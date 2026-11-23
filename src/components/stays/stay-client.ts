import { useEffect, useState } from "react";
import { BookingRequestError, bookingError, bookingWrite } from "../../lib/booking-client";

async function stayRequest<T>(path: string, actor?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (actor) headers.set("X-AhiBizz-Account-ID", actor);
  const response = await fetch(`/api/stays/${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new BookingRequestError(data?.code ?? "STAY_UNAVAILABLE", response.status);
  return data;
}

export function writeStay<T>(path: string, actor: string, body: unknown) {
  if (!actor) throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
  return stayRequest<T>(path, actor, bookingWrite("POST", body));
}

export function stayError(error: unknown) {
  if (error instanceof BookingRequestError) {
    if (error.code === "INVALID_STAY_PHOTO")
      return "Fotografija više nije dostupna. Provjeri odabir u galeriji.";
    if (error.code === "STAY_INVALID_TRANSITION")
      return "Status ovog boravka se promijenio. Provjeri kalendar.";
    if (error.code === "STAY_HAS_BOOKINGS")
      return "Jedinica ima predstojeći boravak ili blokadu. Provjeri kalendar.";
    if (error.code.includes("LIMIT")) return "Možeš dodati najviše dvije smještajne jedinice.";
    if (
      error.code.includes("OVERLAP") ||
      error.code === "STAY_CONFLICT" ||
      error.code === "SLOT_UNAVAILABLE"
    )
      return "Smještaj je zauzet u tom periodu. Odaberi drugi datum.";
    if (error.code.includes("DISABLED") || error.code.includes("INELIGIBLE"))
      return "Ova smještajna jedinica trenutno ne prima nove zahtjeve.";
    if (error.code.includes("VERSION") || error.code.includes("STALE"))
      return "Ponuda je izmijenjena. Provjeri cijenu i datume.";
    if (error.code.includes("INVALID") || error.code.includes("INPUT"))
      return "Provjeri unesene podatke.";
    if (error.code.includes("SELF"))
      return "Za vlastitu jedinicu označi zauzeti period u vlasničkom kalendaru.";
    if (error.code.includes("ACTIVE") || error.code.includes("COMMITMENT"))
      return "Jedinica ima predstojeće termine.";
    if (error.status === 403) return "Nemaš pristup ovoj radnji.";
    if (error.status === 404) return "Jedinica ili boravak više nisu dostupni.";
  }
  return bookingError(error);
}

export function useStayRead<T>(path: string | null, actor?: string, revision = 0) {
  const key = JSON.stringify([path, actor, revision]);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    void stayRequest<T>(path, actor, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ key, error: stayError(error) });
      });
    return () => controller.abort();
  }, [path, actor, key]);
  return result?.key === key ? result : null;
}
