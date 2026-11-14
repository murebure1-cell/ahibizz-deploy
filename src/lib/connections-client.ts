export class ConnectionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Connection request could not be completed.");
  }
}
export async function connectionRequest(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  if (
    !/^(?:people(?:\?|\/|$)|connections(?:\?|\/|$)|visibility$)/.test(path) ||
    path.includes("..") ||
    path.includes("#")
  )
    throw new ConnectionRequestError(400, "INVALID_CONNECTION_INPUT");
  const response = await fetch(`/api/connections/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object" || Array.isArray(result))
    throw new ConnectionRequestError(
      response.status,
      typeof result?.code === "string" ? result.code : "CONNECTIONS_UNAVAILABLE",
    );
  return result;
}
export function connectionError(error: unknown): string {
  const code = error instanceof ConnectionRequestError ? error.code : "";
  if (code === "AUTHENTICATION_REQUIRED") return "Prijavi se ponovo.";
  if (code === "PUBLIC_PROFILE_REQUIRED") return "Prvo uključi javni profil u svom nalogu.";
  if (["PERSON_NOT_FOUND", "NOT_FOUND"].includes(code)) return "Profil nije javno dostupan.";
  if (
    [
      "VERSION_CONFLICT",
      "CONNECTION_CONFLICT",
      "INVALID_TRANSITION",
      "CONNECTION_ALREADY_EXISTS",
      "CONNECTION_ACTION_NOT_ALLOWED",
    ].includes(code)
  )
    return "Zahtjev je izmijenjen. Učitaj trenutni pregled.";
  if (code === "INVALID_CONNECTION_INPUT") return "Provjeri unesene podatke.";
  return "Promjena nije potvrđena. Pokušaj ponovo ili učitaj trenutni pregled.";
}
