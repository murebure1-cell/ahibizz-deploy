import {
  normalizeMessageBody,
  normalizeMessageSearch,
  readChatConversation,
  readChatReceipt,
  readChatThreadPage,
} from "../lib/messaging";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { getMessagingService, MessagingAccessError, type MessagingService } from "./messaging";

const noCache = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
const uuidPattern = "[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const uuid = new RegExp(`^${uuidPattern}$`, "i"),
  route = new RegExp(
    `^/api/messaging/threads(?:/(${uuidPattern})(?:/(messages|read|block))?)?$`,
    "i",
  );
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noCache });
}
function invalid(): never {
  throw new MessagingAccessError(400, "INVALID_MESSAGING_INPUT");
}
function integer(value: unknown, min = 0, max = 2147483647): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function query(url: URL, keys: readonly string[]) {
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!keys.includes(key) || seen.has(key)) invalid();
    seen.add(key);
  }
}
function numeric(value: string | null, max: number) {
  if (value === null) return undefined;
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > max) invalid();
  return Number(value);
}
async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) {
        await reader.cancel().catch(() => {});
        throw new MessagingAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      invalid();
    }
  } finally {
    reader.releaseLock();
  }
}
export function createMessagingHttpHandler({
  service,
  baseURL,
}: {
  service: MessagingService;
  baseURL: string;
}) {
  const origin = new URL(baseURL).origin;
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) invalid();
      const url = new URL(request.url),
        match = route.exec(url.pathname);
      if (!match) return reply({ code: "NOT_FOUND" }, 404);
      if (url.hash) invalid();
      const id = match[1]?.toLowerCase(),
        action = match[2]?.toLowerCase();
      if (request.method === "GET") {
        if (action) return reply({ code: "NOT_FOUND" }, 404);
        if (!id) {
          query(url, ["inbox", "page", "q", "unread"]);
          const inbox = url.searchParams.get("inbox") ?? "personal";
          if (!["personal", "business"].includes(inbox)) invalid();
          const page = numeric(url.searchParams.get("page"), 1000) ?? 1;
          const queryValue = url.searchParams.get("q");
          let search = "";
          if (queryValue !== null) {
            try {
              decodeURIComponent(url.search);
              search = normalizeMessageSearch(queryValue);
            } catch {
              invalid();
            }
          }
          const unread = url.searchParams.get("unread");
          if (unread !== null && unread !== "1") invalid();
          return reply(
            readChatThreadPage(
              await service.list(request.headers, {
                inbox,
                page,
                ...(search ? { q: search } : {}),
                ...(unread === "1" ? { unread: true } : {}),
              }),
            ),
          );
        }
        query(url, ["before"]);
        const before = numeric(url.searchParams.get("before"), 2147483647);
        return reply(
          readChatConversation(
            await service.read(request.headers, id, before === undefined ? {} : { before }),
          ),
        );
      }
      if (request.method !== "POST" || (id && !action)) return reply({ code: "NOT_FOUND" }, 404);
      if (url.searchParams.size) invalid();
      if (request.headers.get("origin") !== origin) return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        !/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const key = request.headers.get("idempotency-key") ?? "";
      if (action !== "read" && !uuid.test(key)) invalid();
      const value = await body(request);
      if (!id) {
        const input = object(value, ["kind", "targetId"]);
        if (
          (input.kind !== "person" && input.kind !== "business") ||
          typeof input.targetId !== "string" ||
          !(input.kind === "business"
            ? uuid.test(input.targetId)
            : /^[A-Za-z0-9_-]{1,128}$/.test(input.targetId))
        )
          invalid();
        return reply({
          receipt: readChatReceipt(await service.open(request.headers, input, key.toLowerCase())),
        });
      }
      if (action === "messages") {
        const input = object(value, ["body"]);
        try {
          normalizeMessageBody(input.body);
        } catch {
          invalid();
        }
        return reply({
          receipt: readChatReceipt(
            await service.send(request.headers, id, input, key.toLowerCase()),
          ),
        });
      }
      if (action === "block") {
        const input = object(value, ["blocked"]);
        if (typeof input.blocked !== "boolean") invalid();
        return reply({
          receipt: readChatReceipt(
            await service.block(request.headers, id, input, key.toLowerCase()),
          ),
        });
      }
      const input = object(value, ["throughSequence"]);
      if (!integer(input.throughSequence)) invalid();
      const result = await service.markRead(request.headers, id, input);
      if (!integer(result.readSequence) || result.readSequence < input.throughSequence)
        throw new Error("invalid_read_pointer");
      return reply({ readSequence: result.readSequence });
    } catch (error) {
      if (error instanceof MessagingAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "MESSAGING_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleMessagingRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration();
    if (!configuration) return reply({ code: "MESSAGING_UNAVAILABLE" }, 503);
    const service = getMessagingService();
    if (!service) return reply({ code: "MESSAGING_UNAVAILABLE" }, 503);
    return createMessagingHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "MESSAGING_UNAVAILABLE" }, 503);
  }
}
