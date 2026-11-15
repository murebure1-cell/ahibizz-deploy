export class BusinessMediaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Business media request could not be completed.");
  }
}
export function businessMediaActorRequest(
  expectedAccountId: string | undefined,
  request: typeof businessMediaRequest = businessMediaRequest,
): typeof businessMediaRequest {
  return (path, options = {}) => {
    if (!expectedAccountId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new BusinessMediaRequestError(401, "ACCOUNT_IDENTITY_CHANGED"));
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request(path, { ...options, headers });
  };
}
export function businessMediaAccessDenied(failure: unknown): boolean {
  return failure instanceof BusinessMediaRequestError && [401, 403].includes(failure.status);
}
export function businessMediaNeedsRecovery(
  intent: { uncertain?: boolean; receipt?: unknown },
  failure: unknown,
): boolean {
  if (intent.uncertain || intent.receipt) return true;
  return !(
    failure instanceof BusinessMediaRequestError &&
    failure.status >= 400 &&
    failure.status < 500 &&
    failure.status !== 408
  );
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
    mode: "same-origin",
    redirect: "error",
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
  if (code === "ACCOUNT_IDENTITY_CHANGED") return "Prijavi se ponovo svojim nalogom.";
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
