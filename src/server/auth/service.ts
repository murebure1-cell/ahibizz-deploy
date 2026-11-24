import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";
import { authOrigin, authSecret, type GoogleConfiguration, readAuthConfiguration } from "./config";
import { type AuthIngressConfiguration, authIpAddressHeaders } from "./ingress";
import { type AuthEmailSender, createSmtpSender, guardedAuthEmailSender } from "./mail";

export { AuthConfigurationError, readAuthConfiguration } from "./config";
export type { AuthEmail, AuthEmailSender } from "./mail";
export type AccountRole = "member" | "owner";
export type AccountApproval = "pending" | "approved" | "suspended";
export type CurrentAuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AccountRole;
  approval: AccountApproval;
};

/** Read the current database row; never authorize from browser fields or a cached user snapshot. */
export async function readCurrentAuthUser(pool: Pool, id: string): Promise<CurrentAuthUser | null> {
  if (typeof id !== "string" || id.length < 1 || id.length > 128) return null;
  const result = await pool.query<CurrentAuthUser>(
    'SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id = $1 LIMIT 1',
    [id],
  );
  const user = result.rows[0];
  if (
    !user ||
    typeof user.emailVerified !== "boolean" ||
    !["member", "owner"].includes(user.role) ||
    !["pending", "approved", "suspended"].includes(user.approval)
  )
    return null;
  return user;
}

/** The provider of an OAuth callback; Better Auth reports the path as a pattern or as sent. */
export function oauthCallbackProvider(
  context: { path?: string; params?: Record<string, unknown> } | null | undefined,
): string | null {
  const path = context?.path;
  if (!path?.startsWith("/callback/")) return null;
  const id = context?.params?.id ?? path.slice("/callback/".length);
  return typeof id === "string" && id !== ":id" ? id : null;
}

export function createAuthService(options: {
  pool: Pool;
  baseURL: string;
  secret: string;
  sendEmail: AuthEmailSender;
  production?: boolean;
  ingress?: AuthIngressConfiguration | null;
  /**
   * Raise the per-path limits when no client IP is trusted. Without one, Better Auth keeps a
   * single bucket per path for everybody, so ten sign-ins a minute would lock out the whole
   * platform. Only for callers that also enforce per-address limits (handleAuthRequest).
   */
  sharedBucketCeilings?: boolean;
  /** Google sign-in; accounts it creates still wait for administrator approval. */
  google?: GoogleConfiguration | null;
}) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const baseURL = authOrigin(options.baseURL, production);
  const secret = authSecret(options.secret);
  const ipAddressHeaders = authIpAddressHeaders(options.ingress);
  const shared = Boolean(options.sharedBucketCeilings) && ipAddressHeaders.length === 0;
  const sendEmail = guardedAuthEmailSender(baseURL, options.sendEmail);
  const google = options.google ?? null;
  return betterAuth({
    appName: "AhiBizz",
    baseURL,
    basePath: "/api/auth",
    secret,
    ...(google
      ? {
          socialProviders: {
            google: {
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              prompt: "select_account" as const,
            },
          },
        }
      : {}),
    database: options.pool,
    trustedOrigins: [baseURL],
    logger: { disabled: true },
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendEmail({ kind: "password-reset", to: user.email, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail({ kind: "verification", to: user.email, url }),
    },
    user: {
      modelName: "auth_user",
      additionalFields: {
        role: { type: ["member", "owner"], required: true, defaultValue: "member", input: false },
        approval: {
          type: ["pending", "approved", "suspended"],
          required: true,
          defaultValue: "pending",
          input: false,
        },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: "auth_session",
      cookieCache: { enabled: false },
      expiresIn: 30 * 86400,
      updateAge: 86400,
    },
    account: {
      modelName: "auth_account",
      // Only Google may join an existing account, and only when that account's own email was
      // confirmed here first (requireLocalEmailVerified) and Google confirmed the same address.
      accountLinking: google
        ? { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: true }
        : { enabled: false },
    },
    verification: { modelName: "auth_verification" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: shared ? 600 : 100,
      // With a trusted client IP these are per-visitor limits. Without one they are platform-wide
      // flood ceilings, and createEmailRateLimiter limits each address instead.
      customRules: {
        "/sign-in/email": { window: 60, max: shared ? 120 : 10 },
        "/sign-up/email": { window: 60, max: shared ? 30 : 5 },
        "/request-password-reset": { window: 60, max: shared ? 30 : 5 },
        "/send-verification-email": { window: 60, max: shared ? 30 : 5 },
        // Starting Google sign-in sends no password; the provider limits its own attempts.
        "/sign-in/social": { window: 60, max: shared ? 120 : 10 },
      },
    },
    advanced: {
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, secure: production, sameSite: "lax", path: "/" },
      trustedProxyHeaders: false,
      ipAddress: { ipAddressHeaders, disableIpTracking: false },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (
          ["/sign-up/email", "/update-user"].includes(context.path) &&
          context.body &&
          ["role", "approval", "emailVerified"].some((key) => Object.hasOwn(context.body, key))
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "UNEXPECTED_FIELD",
            message: "Ova polja naloga nije moguće mijenjati.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Every new account waits for approval. Only an account created in the Google callback
          // keeps the address Google itself confirmed; email sign-ups confirm by link.
          before: async (user, context) => ({
            data: {
              role: "member",
              approval: "pending",
              emailVerified:
                Boolean(google) &&
                oauthCallbackProvider(context) === "google" &&
                user.emailVerified === true,
            },
          }),
        },
        update: {
          before: async (user) => {
            if (Object.hasOwn(user, "role") || Object.hasOwn(user, "approval")) {
              throw new APIError("FORBIDDEN", { message: "Promjena pristupa nije dostupna." });
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            let user: CurrentAuthUser | null;
            try {
              user = await readCurrentAuthUser(options.pool, session.userId);
            } catch {
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "Prijava trenutno nije dostupna.",
              });
            }
            if (!user?.emailVerified || user.approval !== "approved") {
              const code =
                user?.approval === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_PENDING_APPROVAL";
              throw new APIError("FORBIDDEN", {
                code,
                message: "Prijava nije dostupna za ovaj nalog.",
              });
            }
          },
        },
      },
    },
  });
}

export type AuthService = ReturnType<typeof createAuthService>;
let service: AuthService | undefined;
let servicePool: Pool | undefined;

/** No database, auth instance or SMTP transport is created during module import/build. */
export function getAuthService(): AuthService | null {
  if (service) return service;
  const configuration = readAuthConfiguration();
  if (!configuration) return null;
  const pool = new Pool(configuration.database);
  pool.on("error", () => console.error("Authentication database reported a background error."));
  service = createAuthService({
    pool,
    ...configuration,
    sendEmail: createSmtpSender(configuration.smtp),
    // handleAuthRequest adds per-address limits on every sign-in, sign-up and email request.
    sharedBucketCeilings: true,
  });
  servicePool = pool;
  return service;
}

/** Internal shared pool for the server-side account service; never a new connection per request. */
export function getAuthDatabasePool(): Pool | null {
  return getAuthService() ? (servicePool ?? null) : null;
}
