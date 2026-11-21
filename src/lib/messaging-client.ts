import { normalizeMessageSearch } from "./messaging";

export class MessagingRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Messaging request could not be completed.");
  }
}
const id = "[A-Za-z0-9_-]{1,128}";
const route = new RegExp(`^threads(?:/(${id})(?:/(messages|read|block))?)?$`);
function validPath(path: string): boolean {
  if (typeof path !== "string" || path.length > 1500 || path.includes("#")) return false;
  const [pathname, query, ...extra] = path.split("?");
  if (extra.length || !pathname) return false;
  const match = route.exec(pathname);
  if (!match) return false;
  const seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (!match[1]) {
      if (key === "inbox" && !["personal", "business"].includes(value)) return false;
      else if (key === "page" && !/^[1-9]\d{0,2}$|^1000$/.test(value)) return false;
      else if (key === "unread" && value !== "1") return false;
      else if (key === "q") {
        try {
          decodeURIComponent(query ?? "");
          normalizeMessageSearch(value);
        } catch {
          return false;
        }
      } else if (!["inbox", "page", "unread"].includes(key)) return false;
    } else if (!match[2]) {
      if (key !== "before" || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647)
        return false;
    } else return false;
  }
  return true;
}
async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1048576) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
export async function messagingRequest(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  if (!validPath(path)) throw new MessagingRequestError(400, "INVALID_MESSAGING_INPUT");
  const response = await fetch(`/api/messaging/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    mode: "same-origin",
    redirect: "error",
  });
  const data = await responseJson(response);
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data))
    throw new MessagingRequestError(
      response.status,
      typeof (data as { code?: unknown })?.code === "string"
        ? (data as { code: string }).code
        : "MESSAGING_UNAVAILABLE",
    );
  return data as Record<string, unknown>;
}
export type MessagingRequest = typeof messagingRequest;
export function messagingWrite(body: unknown, key?: string): RequestInit {
  if (
    key !== undefined &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)
  )
    throw new MessagingRequestError(400, "INVALID_MESSAGING_INPUT");
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key.toLowerCase() } : {}),
    },
    body: JSON.stringify(body),
  };
}
export function messagingError(error: unknown): string {
  const code = error instanceof MessagingRequestError ? error.code : "";
  if (code === "AUTHENTICATION_REQUIRED") return "Prijavi se ponovo.";
  if (code === "ACCOUNT_IDENTITY_CHANGED") return "Prijavi se ponovo svojim nalogom.";
  if (code === "THREAD_NOT_FOUND") return "Razgovor nije dostupan.";
  if (["PERSON_NOT_FOUND", "BUSINESS_NOT_FOUND"].includes(code))
    return "Profil trenutno nije dostupan.";
  if (code === "SELF_MESSAGE_NOT_ALLOWED") return "Izaberi drugi profil za razgovor.";
  if (code === "MESSAGING_BLOCKED") return "Poruke su blokirane u ovom razgovoru.";
  if (code === "CONVERSATION_UNAVAILABLE") return "Nove poruke trenutno nisu dostupne.";
  if (code === "MESSAGING_RATE_LIMIT") return "Previše zahtjeva. Pokušaj uskoro.";
  if (
    [
      "ACCOUNT_SUSPENDED",
      "ACCOUNT_PENDING_APPROVAL",
      "EMAIL_NOT_VERIFIED",
      "ACCOUNT_ACCESS_DENIED",
    ].includes(code)
  )
    return "Poruke nisu dostupne ovom nalogu.";
  if (["INVALID_MESSAGING_INPUT", "INVALID_MESSAGE_BODY", "REQUEST_TOO_LARGE"].includes(code))
    return "Provjeri unesenu poruku.";
  if (code === "IDEMPOTENCY_CONFLICT") return "Zahtjev je izmijenjen. Provjeri razgovor.";
  return "Zahtjev nije potvrđen. Pokušaj ponovo.";
}
