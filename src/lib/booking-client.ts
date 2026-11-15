export class BookingRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super("Booking request could not be completed.");
  }
}
export async function bookingRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/booking/${path}`, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object")
    throw new BookingRequestError(data?.code ?? "BOOKING_UNAVAILABLE", response.status);
  return data;
}

export function bookingActorRequest(
  expectedAccountId: string | undefined,
  request: typeof bookingRequest = bookingRequest,
): typeof bookingRequest {
  return (path, options = {}) => {
    if (!expectedAccountId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401));
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request(path, { ...options, headers });
  };
}

export function bookingAccessDenied(failure: unknown): failure is BookingRequestError {
  return failure instanceof BookingRequestError && [401, 403].includes(failure.status);
}

/** Resolve a public form's signed actor only after an explicit booking attempt. */
export async function bookingAccountId(): Promise<string> {
  const response = await fetch("/api/account", {
    credentials: "same-origin",
    cache: "no-store",
    mode: "same-origin",
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new BookingRequestError(
      typeof data?.code === "string" ? data.code : "BOOKING_UNAVAILABLE",
      response.status,
    );
  if (typeof data?.account?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.account.id))
    throw new BookingRequestError("BOOKING_UNAVAILABLE", 503);
  return data.account.id;
}
export function bookingWrite(method: string, body: unknown, idempotencyKey?: string): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  };
}
export function bookingError(error: unknown) {
  const code = error instanceof BookingRequestError ? error.code : "";
  if (code === "AUTHENTICATION_REQUIRED") return "Prijavi se da nastaviš.";
  if (code === "ACCOUNT_IDENTITY_CHANGED") return "Prijavi se ponovo svojim nalogom.";
  if (["ACCOUNT_PENDING_APPROVAL", "EMAIL_NOT_VERIFIED", "ACCOUNT_SUSPENDED"].includes(code))
    return "Nalog još nema pristup zakazivanju.";
  if (["SLOT_UNAVAILABLE", "BOOKING_CONFLICT"].includes(code))
    return "Termin je u međuvremenu zauzet. Izaberi drugi.";
  if (code === "VERSION_CONFLICT")
    return "Podaci su izmijenjeni. Osvježi pregled i pokušaj ponovo.";
  if (code === "SELF_BOOKING_NOT_ALLOWED") return "Za svoj posao dodaj ručni termin u kalendaru.";
  if (code === "BOOKING_DISABLED") return "Booking trenutno nije dostupan.";
  if (code === "BOOKING_SERVICE_NOT_FOUND") return "Usluga više nije dostupna. Izaberi drugu.";
  if (code === "BOOKING_CONFIGURATION_CHANGED")
    return "Usluge ili raspored su izmijenjeni. Provjeri novi odabir.";
  if (code === "INVALID_BOOKING_INPUT" || code === "UNEXPECTED_FIELD")
    return "Provjeri unesene podatke.";
  if (code === "BOOKING_NOT_FOUND" || code === "BUSINESS_NOT_FOUND")
    return "Termin ili djelatnost nisu dostupni.";
  if (code === "INVALID_BOOKING_TRANSITION")
    return "Ova promjena više nije dostupna za taj termin.";
  return "Zahtjev nije uspio. Pokušaj ponovo.";
}
