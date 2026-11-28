import { appHandoffPagePath, appReturnLink, readAppHandoff } from "../lib/app-handoff";

export type StartAppHandoff = (input: {
  headers: Headers;
  body: { challenge: string; account: string };
}) => Promise<{ code: string }>;

const plain = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A redirect the browser follows: to the app with its code, or back to a page of this site as a
 * path. Never a full address of this site, which Next writes wrongly behind the ingress guard.
 */
function go(location: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

async function formWithinLimit(request: Request, limit = 2048) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function statusOf(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 0;
}

/**
 * The form must come from this site. A browser names the page's origin; when a referrer policy
 * hides it ("Origin: null") it still marks the request same-origin in Sec-Fetch-Site, a header no
 * page can set. Anything else, including another site that hides its origin, is refused.
 */
function fromThisSite(request: Request, origin: string) {
  const sent = request.headers.get("origin");
  if (sent === origin) return true;
  return (
    (sent === null || sent === "null") && request.headers.get("sec-fetch-site") === "same-origin"
  );
}

/**
 * "Nastavi u aplikaciji": an ordinary form, so the code travels only in the redirect the browser
 * hands to the app. A script on the page can neither read that redirect nor follow it.
 */
export function createAppSignInHandler(options: { baseURL: string; start: StartAppHandoff }) {
  const origin = new URL(options.baseURL).origin;
  return async function appSignIn(request: Request): Promise<Response> {
    if (!fromThisSite(request, origin)) return plain(403);
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    )
      return plain(415);
    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await formWithinLimit(request));
    } catch {
      return plain(400);
    }
    const accounts = form.getAll("nalog");
    const account = accounts.length === 1 ? (accounts[0] ?? "") : "";
    const handoff = readAppHandoff(form, ["nalog"]);
    if (!handoff || !/^[A-Za-z0-9_-]{1,128}$/.test(account)) return plain(400);
    const page = appHandoffPagePath(handoff);
    try {
      const { code } = await options.start({
        headers: request.headers,
        body: { challenge: handoff.challenge, account },
      });
      return go(appReturnLink(code, handoff.state, request.headers.get("user-agent")));
    } catch (error) {
      const status = statusOf(error);
      // Signed out meanwhile: sign in, then back to the same confirmation.
      if (status === 401) return go(`/prijava?nastavi=${encodeURIComponent(page)}`);
      // Another account became the active one, or this one may not sign in to the app: the page
      // shows which it is.
      if (status === 409 || status === 403) return go(page);
      return go(`${page}&greska=${status === 429 ? "previse" : "1"}`);
    }
  };
}
