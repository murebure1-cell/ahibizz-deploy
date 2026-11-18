import { useEffect, useState } from "react";
import { BookingRequestError, bookingError, bookingWrite } from "../../lib/booking-client";

async function rentalRequest<T>(
  path: string,
  actor?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (actor) headers.set("X-AhiBizz-Account-ID", actor);
  const response = await fetch(`/api/rentals/${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || (!response.ok && typeof data.code !== "string"))
    throw new Error("invalid_rental_response");
  if (!response.ok) throw new BookingRequestError(data.code, response.status);
  return data;
}

export function writeRental<T>(path: string, actor: string, body: unknown) {
  if (!actor) throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
  return rentalRequest<T>(path, actor, bookingWrite("POST", body));
}

export function rentalError(error: unknown) {
  if (error instanceof BookingRequestError) {
    if (error.code === "RENTAL_HAS_BOOKINGS")
      return "Automobil ima predstojeći najam ili blokadu. Provjeri njegov kalendar.";
    if (error.code.includes("LIMIT")) return "Na besplatnom paketu možeš dodati dva automobila.";
    if (
      error.code.includes("OVERLAP") ||
      error.code === "RENTAL_CONFLICT" ||
      error.code === "SLOT_UNAVAILABLE"
    )
      return "Automobil je zauzet u tom periodu. Odaberi drugo vrijeme.";
    if (error.code === "RENTAL_NOT_AVAILABLE") return "Automobil trenutno ne prima nove zahtjeve.";
    if (error.code.includes("DISABLED") || error.code.includes("INELIGIBLE"))
      return "Ovaj automobil trenutno ne prima nove zahtjeve.";
    if (error.code.includes("VERSION") || error.code.includes("STALE"))
      return "Ponuda je izmijenjena. Provjeri cijenu i vrijeme.";
    if (error.code === "INVALID_RENTAL_INTERVAL") return "Provjeri vrijeme preuzimanja i vraćanja.";
    if (error.code.includes("INVALID") || error.code.includes("INPUT"))
      return "Provjeri unesene podatke.";
    if (error.code.includes("SELF"))
      return "Za vlastiti automobil označi zauzeti period u vlasničkom kalendaru.";
    if (error.code.includes("ACTIVE") || error.code.includes("COMMITMENT"))
      return "Automobil ima predstojeće termine.";
    if (error.status === 403) return "Nemaš pristup ovoj radnji.";
    if (error.status === 404) return "Automobil ili termin više nije dostupan.";
  }
  return bookingError(error);
}

export function useRentalRead<T>(path: string | null, actor?: string, revision = 0) {
  const key = JSON.stringify([path, actor, revision]);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    void rentalRequest<T>(path, actor, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ key, error: rentalError(error) });
      });
    return () => controller.abort();
  }, [path, actor, key]);
  return result?.key === key ? result : null;
}
