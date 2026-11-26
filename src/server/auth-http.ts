import { type AuthService, getAuthService, readAuthConfiguration } from "./auth";
import { administrationSignInEmail } from "./auth/administration";
import { createEmailRateLimiter, type EmailRateLimiter } from "./auth/email-rate-limit";
import { getDatabase } from "./db";

type CurrentUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  approval: string;
};
type UserReader = (id: string) => Promise<CurrentUser | null>;
const fields: Record<string, readonly string[]> = {
  "/sign-up/email": ["name", "email", "password", "callbackURL"],
  "/sign-in/email": ["email", "password", "rememberMe", "callbackURL"],
  "/sign-out": [],
  "/send-verification-email": ["email", "callbackURL"],
  "/request-password-reset": ["email", "redirectTo"],
  "/reset-password": ["newPassword", "token"],
  "/sign-in/social": ["provider", "callbackURL", "errorCallbackURL", "newUserCallbackURL"],
};
const redirectFields = ["callbackURL", "redirectTo", "errorCallbackURL", "newUserCallbackURL"];
const getPaths = new Set(["/get-session", "/verify-email"]);
/** The only place a social sign-in start may send the browser. */
const providerAuthorizeOrigins: Record<string, string> = {
  google: "https://accounts.google.com",
};
const prefix = "/api/auth";

function reply(body: unknown, status = 200, headers?: Headers) {
  const output = new Headers(headers);
  output.delete("Content-Length");
  output.set("Content-Type", "application/json; charset=utf-8");
  output.set("Cache-Control", "no-store");
  output.set("Pragma", "no-cache");
  return new Response(JSON.stringify(body), { status, headers: output });
}

async function bodyWithinLimit(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16_384) {
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
  const value = length ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_body");
  return value as Record<string, unknown>;
}

/** An intentionally small HTTP surface; the library owns passwords, tokens and cookies. */
export function createAuthHttpHandler(options: {
  auth: AuthService;
  baseURL: string;
  readUser: UserReader;
  /** Per-address attempt limits; production always passes one (see handleAuthRequest). */
  limitEmail?: EmailRateLimiter;
  /** Social providers configured on the server; their start and callback routes open only then. */
  socialProviders?: readonly string[];
  /** The address behind a sign-in name such as "administrator"; null when there is none. */
  signInName?: (name: string) => Promise<string | null>;
}) {
  const social = new Set(
    (options.socialProviders ?? []).filter((id) => Object.hasOwn(providerAuthorizeOrigins, id)),
  );
  return async function authHttp(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : "";
    const callback = /^\/callback\/([a-z]+)$/.exec(path)?.[1];
    const allowed =
      request.method === "GET"
        ? getPaths.has(path) ||
          /^\/reset-password\/[A-Za-z0-9_-]{8,256}$/.test(path) ||
          (callback !== undefined && social.has(callback))
        : request.method === "POST" &&
          Object.hasOwn(fields, path) &&
          (path !== "/sign-in/social" || social.size > 0);
    if (!allowed) return reply({ code: "NOT_FOUND" }, 404);
    if (request.url.length > 8192) return reply({ code: "INVALID_REQUEST" }, 400);
    let target = request;
    let provider: string | null = null;
    if (request.method === "POST") {
      if (request.headers.get("origin") !== new URL(options.baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      try {
        const body = await bodyWithinLimit(request);
        if (Object.keys(body).some((key) => !fields[path]?.includes(key)))
          return reply({ code: "UNEXPECTED_FIELD" }, 400);
        if (path === "/sign-in/social") {
          if (typeof body.provider !== "string" || !social.has(body.provider))
            return reply({ code: "PROVIDER_NOT_FOUND" }, 404);
          provider = body.provider;
        }
        // A sign-in name instead of an address: only the administration has one.
        if (
          path === "/sign-in/email" &&
          options.signInName &&
          typeof body.email === "string" &&
          !body.email.includes("@")
        ) {
          const address = await options.signInName(body.email);
          if (address) body.email = address;
        }
        for (const name of redirectFields) {
          const value = body[name];
          if (
            value !== undefined &&
            (typeof value !== "string" ||
              new URL(value, options.baseURL).origin !== new URL(options.baseURL).origin)
          )
            return reply({ code: "INVALID_REDIRECT" }, 400);
        }
        if (options.limitEmail) {
          let decision: Awaited<ReturnType<EmailRateLimiter>> = { allowed: true };
          try {
            decision = await options.limitEmail(path, body.email);
          } catch {
            // Fail open: Better Auth's own limits still apply and the database error surfaces there.
          }
          if (!decision.allowed) {
            const retry = String(decision.retryAfter);
            return reply(
              { code: "RATE_LIMITED" },
              429,
              new Headers({ "Retry-After": retry, "X-Retry-After": retry }),
            );
          }
        }
        // The browser follows the URL in the JSON reply, so the library needs no Location header.
        const forwarded = path === "/sign-in/social" ? { ...body, disableRedirect: true } : body;
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        target = new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(forwarded),
        });
      } catch {
        return reply({ code: "INVALID_REQUEST" }, 400);
      }
    }
    try {
      const response = await options.auth.handler(target);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("Pragma", "no-cache");
      if (response.status >= 500) return reply({ code: "AUTH_UNAVAILABLE" }, 503, headers);
      // Starting Google sign-in may still carry a Location to Google's own page; the JSON URL
      // below is checked against the same origin, so drop the header instead of refusing.
      if (
        path === "/sign-in/social" &&
        provider &&
        response.status < 300 &&
        headers.has("Location") &&
        new URL(headers.get("Location") ?? "", options.baseURL).origin ===
          providerAuthorizeOrigins[provider]
      )
        headers.delete("Location");
      const location = headers.get("Location");
      if (location && new URL(location, options.baseURL).origin !== new URL(options.baseURL).origin)
        return reply({ code: "INVALID_REDIRECT" }, 400);
      // Verification and reset links redirect with an empty body even if the
      // library retains a JSON content type. Do not parse that body as JSON.
      if (location && response.status >= 300 && response.status < 400)
        return new Response(response.body, { status: response.status, headers });
      if (!headers.get("content-type")?.includes("application/json"))
        return new Response(response.body, { status: response.status, headers });
      const data = await response.json();
      if (!response.ok) {
        const code =
          typeof data?.code === "string" && /^[A-Z_0-9]+$/.test(data.code)
            ? data.code
            : "AUTH_FAILED";
        return reply({ code }, response.status, headers);
      }
      if (path === "/get-session") {
        if (!data?.user?.id) return reply(null, 200, headers);
        const user = await options.readUser(data.user.id);
        if (
          !user?.emailVerified ||
          user.approval !== "approved" ||
          !["member", "owner"].includes(user.role)
        )
          return reply(null, 200, headers);
        return reply({ user, session: { expiresAt: data.session?.expiresAt } }, 200, headers);
      }
      if (path === "/sign-in/social") {
        // Hand back only the provider's own authorization page; anything else is refused.
        let next: URL | null = null;
        try {
          next = typeof data?.url === "string" ? new URL(data.url) : null;
        } catch {}
        if (!next || !provider || next.origin !== providerAuthorizeOrigins[provider])
          return reply({ code: "AUTH_FAILED" }, 502, headers);
        return reply({ url: next.href }, 200, headers);
      }
      // Session tokens never enter JavaScript-visible response bodies.
      return reply({ ok: true }, response.status, headers);
    } catch {
      return reply({ code: "AUTH_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleAuthRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration();
    const auth = getAuthService();
    if (!configuration || !auth) return reply({ code: "AUTH_UNAVAILABLE" }, 503);
    return createAuthHttpHandler({
      auth,
      baseURL: configuration.baseURL,
      limitEmail: createEmailRateLimiter(getDatabase(), configuration.secret),
      socialProviders: configuration.google ? ["google"] : [],
      signInName: (name) => administrationSignInEmail(getDatabase(), name),
      readUser: async (id) => {
        const result = await getDatabase().query(
          'SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id = $1 LIMIT 1',
          [id],
        );
        return (result.rows[0] as CurrentUser | undefined) ?? null;
      },
    })(request);
  } catch {
    return reply({ code: "AUTH_UNAVAILABLE" }, 503);
  }
}
