import {
  readOwnReviewState,
  readReviewCommand,
  readReviewModerationPage,
  readReviewPage,
} from "../lib/reviews";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { getReviewsService, ReviewsAccessError, type ReviewsService } from "./reviews";
import { commandInput } from "./reviews/validation";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
function invalid(): never {
  throw new ReviewsAccessError(400, "INVALID_REVIEW_INPUT");
}
function duplicateKeys(text: string) {
  const seen = new Set<string>();
  let depth = 0,
    keyExpected = false;
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      if (depth === 1 && keyExpected) {
        const key = JSON.parse(text.slice(start, index + 1)) as string;
        if (seen.has(key)) return true;
        seen.add(key);
        keyExpected = false;
      }
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) keyExpected = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) keyExpected = true;
  }
  return false;
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12288) {
        await reader.cancel();
        throw new ReviewsAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (duplicateKeys(text)) invalid();
    return value;
  } catch (error) {
    if (error instanceof ReviewsAccessError) throw error;
    invalid();
  }
}
export function createReviewsHttpHandler({
  service,
  baseURL,
}: {
  service: ReviewsService;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) invalid();
      const url = new URL(request.url);
      if (url.pathname === "/api/reviews/admin" && request.method === "GET") {
        let page = 1;
        for (const [key, value] of url.searchParams) {
          if (
            key !== "page" ||
            url.searchParams.getAll(key).length !== 1 ||
            !/^[1-9]\d{0,3}$/.test(value) ||
            Number(value) > 1000
          )
            invalid();
          page = Number(value);
        }
        return reply(readReviewModerationPage(await service.moderationList(request.headers, page)));
      }
      const match =
        /^\/api\/reviews\/businesses\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?:\/(own|withdraw))?$/i.exec(
          url.pathname,
        );
      const admin =
        /^\/api\/reviews\/admin\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/moderate$/i.exec(
          url.pathname,
        );
      if (!match && !admin) return reply({ code: "NOT_FOUND" }, 404);
      if (request.method === "GET" && match) {
        if (match[2] === "own") {
          if (url.search) invalid();
          try {
            return reply(
              readOwnReviewState(await service.own(request.headers, match[1] as string)),
            );
          } catch (error) {
            // A guest reading a public profile is expected; answer without an error status.
            if (
              (error instanceof ReviewsAccessError || error instanceof AccountAccessError) &&
              error.status === 401 &&
              error.code === "AUTHENTICATION_REQUIRED"
            )
              return reply({ anonymous: true });
            throw error;
          }
        }
        if (match[2]) return reply({ code: "NOT_FOUND" }, 404);
        let page = 1;
        for (const [key, value] of url.searchParams) {
          if (
            key !== "page" ||
            url.searchParams.getAll(key).length !== 1 ||
            !/^[1-9]\d{0,3}$/.test(value) ||
            Number(value) > 1000
          )
            invalid();
          page = Number(value);
        }
        return reply(readReviewPage(await service.list(match[1] as string, page)));
      }
      const action =
        admin && request.method === "POST"
          ? "moderate"
          : match?.[2] === "own" && request.method === "PUT"
            ? "save"
            : match?.[2] === "withdraw" && request.method === "POST"
              ? "withdraw"
              : null;
      if (!action) return reply({ code: "NOT_FOUND" }, 404);
      if (url.search) invalid();
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      await service.authenticate(request.headers);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = commandInput(await input(request), action);
      const id = (admin?.[1] ?? match?.[1]) as string;
      return reply(readReviewCommand(await service[action](request.headers, id, body)));
    } catch (error) {
      if (error instanceof ReviewsAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "REVIEWS_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleReviewsRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getReviewsService();
    if (!configuration || !service) return reply({ code: "REVIEWS_UNAVAILABLE" }, 503);
    return createReviewsHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "REVIEWS_UNAVAILABLE" }, 503);
  }
}
