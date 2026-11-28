import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Pool } from "pg";
import {
  appHandoffChallenge,
  appHandoffCode,
  appHandoffSeconds,
  appHandoffVerifier,
} from "../../lib/app-handoff";
import { countAttempt } from "./attempt-limit";

const prefix = "app-handoff:";
/** Codes one account may start in the window: room for a few retries, not for a flood. */
const startLimit = { windowSeconds: 10 * 60, max: 10 };

/** The database keeps only a code's SHA-256, so nothing stored there can be exchanged. */
export function appHandoffIdentifier(code: string): string {
  return `${prefix}${createHash("sha256").update(code).digest("hex")}`;
}

/** RFC 7636 S256: BASE64URL(SHA-256(ASCII(verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

type StartBody = { challenge: string; account: string };
const accountPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** What the confirmation form sends, as a Standard Schema (better-call validates with it). */
const startBody = {
  "~standard": {
    version: 1 as const,
    vendor: "ahibizz",
    validate(value: unknown): { value: StartBody } | { issues: { message: string }[] } {
      const body =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      if (
        body &&
        Object.keys(body).every((key) => key === "challenge" || key === "account") &&
        appHandoffChallenge(body.challenge) &&
        typeof body.account === "string" &&
        accountPattern.test(body.account)
      )
        return { value: { challenge: body.challenge, account: body.account } };
      return { issues: [{ message: "Link za prijavu u aplikaciju nije ispravan." }] };
    },
    types: undefined as unknown as { input: StartBody; output: StartBody },
  },
};

/**
 * The administration account does its work on the website. It never signs in to the app, so a
 * mistaken tap on "Nastavi u aplikaciji" cannot hand its rights to a phone.
 */
export async function administrationAccount(pool: Pool, userId: string) {
  const { rows } = await pool.query<{ account_kind: string }>(
    "SELECT account_kind FROM auth_user WHERE id = $1",
    [userId],
  );
  return rows[0]?.account_kind === "administration";
}
const notForThisAccount = () =>
  new APIError("FORBIDDEN", {
    code: "APP_SIGN_IN_NOT_ALLOWED",
    message: "Ovaj nalog se ne prijavljuje u aplikaciju.",
  });

const invalidCode = () =>
  new APIError("UNAUTHORIZED", {
    code: "INVALID_APP_CODE",
    message: "Prijava u aplikaciju nije uspjela. Pokušaj ponovo.",
  });

/**
 * Signing in to the native app through the website (see lib/app-handoff.ts). Starting is for the
 * server only: the confirmation form calls it with the browser's session. Two locks keep it off
 * the internet: the library does not route a SERVER_ONLY endpoint, and auth-http.ts does not
 * list it. Exchanging is the app's request; it creates a new session of the app's own, so
 * signing out on the website leaves the app signed in and the other way round.
 */
export function createAppHandoff(pool: Pool) {
  return {
    id: "ahibizz-app-handoff",
    endpoints: {
      startAppHandoff: createAuthEndpoint(
        "/app-handoff/start",
        {
          method: "POST",
          requireHeaders: true,
          use: [sessionMiddleware],
          body: startBody,
          metadata: { SERVER_ONLY: true },
        },
        async (context) => {
          const { challenge, account } = context.body;
          const { user } = context.context.session;
          // The page named one account; switching accounts in another tab must not hand over
          // a different one.
          if (account !== user.id)
            throw new APIError("CONFLICT", {
              code: "ACCOUNT_CHANGED",
              message: "Prijavljeni nalog se promijenio.",
            });
          if (await administrationAccount(pool, user.id)) throw notForThisAccount();
          const attempt = await countAttempt(pool, `account-app-handoff:${user.id}`, startLimit);
          if (!attempt.allowed)
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "RATE_LIMITED",
              message: "Previše pokušaja. Pokušaj za nekoliko minuta.",
            });
          // Spent codes are deleted when exchanged; expired ones go here.
          await pool.query(
            `DELETE FROM auth_verification WHERE identifier LIKE 'app-handoff:%' AND "expiresAt" < now()`,
          );
          const code = randomBytes(32).toString("base64url");
          await context.context.internalAdapter.createVerificationValue({
            identifier: appHandoffIdentifier(code),
            value: JSON.stringify({ userId: user.id, challenge }),
            expiresAt: new Date(Date.now() + appHandoffSeconds * 1000),
          });
          return context.json({ code });
        },
      ),
      exchangeAppHandoff: createAuthEndpoint(
        "/app-handoff/exchange",
        { method: "POST", requireHeaders: true },
        async (context) => {
          const body = (context.body ?? {}) as Record<string, unknown>;
          const { code, verifier } = body;
          if (!appHandoffCode(code) || !appHandoffVerifier(verifier)) throw invalidCode();
          // Spent by the first attempt, right or wrong, and never after it has expired.
          const record = await context.context.internalAdapter.consumeVerificationValue(
            appHandoffIdentifier(code),
          );
          if (!record) throw invalidCode();
          let stored: { userId?: unknown; challenge?: unknown } | null = null;
          try {
            stored = JSON.parse(record.value);
          } catch {}
          if (
            typeof stored?.userId !== "string" ||
            typeof stored.challenge !== "string" ||
            !sameText(pkceChallenge(verifier), stored.challenge)
          )
            throw invalidCode();
          const user = await context.context.internalAdapter.findUserById(stored.userId);
          if (!user) throw invalidCode();
          if (await administrationAccount(pool, user.id)) throw notForThisAccount();
          // The session hook reads approval and email confirmation again, as for any sign-in.
          const session = await context.context.internalAdapter.createSession(user.id, false);
          if (!session)
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Prijava nije dostupna." });
          await setSessionCookie(context, { session, user });
          return context.json({ ok: true });
        },
      ),
    },
  };
}
