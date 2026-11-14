export class BusinessMediaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Business media request could not be completed.");
  }
}
export async function businessMediaRequest(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  if (
    !/^(mine|public)\/[A-Za-z0-9_-]{1,128}(?:\/(?:logo|cover|gallery)\/\d(?:\?v=\d+)?)?$/.test(path)
  )
    throw new BusinessMediaRequestError(400, "INVALID_BUSINESS_MEDIA_INPUT");
  const response = await fetch(`/api/business-media/${path}`, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data))
    throw new BusinessMediaRequestError(
      response.status,
      typeof data?.code === "string" ? data.code : "BUSINESS_MEDIA_UNAVAILABLE",
    );
  return data;
}
export function businessMediaError(error: unknown): string {
  const code = error instanceof BusinessMediaRequestError ? error.code : "";
  if (code === "AUTHENTICATION_REQUIRED") return "Prijavi se ponovo.";
  if (["BUSINESS_NOT_FOUND", "BUSINESS_ACCESS_DENIED"].includes(code))
    return "Djelatnost nije dostupna.";
  if (code === "VERSION_CONFLICT") return "Djelatnost je izmijenjena. Učitaj trenutno stanje.";
  if (["MEDIA_TOO_LARGE", "REQUEST_TOO_LARGE"].includes(code))
    return "Izaberi fotografiju do 4 MB.";
  if (["MEDIA_INVALID", "INVALID_CONTENT_TYPE"].includes(code))
    return "Izaberi ispravnu JPG, PNG ili WebP fotografiju.";
  if (code === "BUSINESS_ARCHIVED") return "Prvo vrati djelatnost iz arhive.";
  return "Promjena nije potvrđena. Provjeri trenutno stanje ili ponovi zahtjev.";
}
