import { type DatabaseConfiguration, type Environment, readDatabaseConfiguration } from "../env";
import { type AuthIngressConfiguration, readAuthIngressConfiguration } from "./ingress";

export class AuthConfigurationError extends Error {
  readonly code = "auth_configuration_invalid";
  constructor() {
    super("Authentication configuration is invalid.");
  }
}

export type SmtpConfiguration = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}>;
export type AuthConfiguration = Readonly<{
  baseURL: string;
  secret: string;
  production: boolean;
  database: DatabaseConfiguration;
  smtp: SmtpConfiguration;
  ingress: AuthIngressConfiguration | null;
  /** Google sign-in; null until both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
  google: GoogleConfiguration | null;
}>;
export type GoogleConfiguration = Readonly<{ clientId: string; clientSecret: string }>;

/**
 * An incomplete or malformed pair turns Google sign-in off instead of failing every sign-in, so a
 * typo in the hosting settings cannot lock out email and password users.
 */
export function readGoogleConfiguration(env: Environment): GoogleConfiguration | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (
    !/^\d{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/.test(clientId) ||
    clientSecret.length < 16 ||
    clientSecret.length > 200 ||
    /\s/.test(clientSecret) ||
    hasControl(clientSecret)
  )
    return null;
  return Object.freeze({ clientId, clientSecret });
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function authOrigin(value: string, production: boolean): string {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      hasControl(value) ||
      value !== value.trim() ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "") ||
      (url.protocol !== "https:" && (production || !local || url.protocol !== "http:"))
    )
      throw new AuthConfigurationError();
    return url.origin;
  } catch {
    throw new AuthConfigurationError();
  }
}

export function authSecret(value: string): string {
  if (value.length < 32 || value.length > 512 || hasControl(value) || value !== value.trim()) {
    throw new AuthConfigurationError();
  }
  return value;
}

/** No connection, SMTP transport, secret logging or request-derived origin. */
export function readAuthConfiguration(env: Environment = process.env): AuthConfiguration | null {
  const keys = [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ] as const;
  if (keys.some((key) => !env[key]?.trim())) return null;
  try {
    const production = env.NODE_ENV === "production";
    const baseURL = authOrigin(env.BETTER_AUTH_URL ?? "", production);
    const secret = authSecret(env.BETTER_AUTH_SECRET ?? "");
    const database = readDatabaseConfiguration(env);
    if (!database) return null;
    const host = env.SMTP_HOST ?? "";
    const portText = env.SMTP_PORT ?? "";
    const user = env.SMTP_USER ?? "";
    const password = env.SMTP_PASSWORD ?? "";
    const from = env.SMTP_FROM ?? "";
    if (
      !/^[a-zA-Z0-9.-]+$/.test(host) ||
      !/^\d+$/.test(portText) ||
      Number(portText) < 1 ||
      Number(portText) > 65535 ||
      hasControl(user + password + from) ||
      !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
    ) {
      throw new AuthConfigurationError();
    }
    if (env.SMTP_SECURE !== undefined && !["true", "false"].includes(env.SMTP_SECURE))
      throw new AuthConfigurationError();
    const secure =
      env.SMTP_SECURE === undefined ? Number(portText) === 465 : env.SMTP_SECURE === "true";
    return Object.freeze({
      baseURL,
      secret,
      production,
      database,
      smtp: Object.freeze({ host, port: Number(portText), secure, user, password, from }),
      ingress: readAuthIngressConfiguration(env, baseURL),
      google: readGoogleConfiguration(env),
    });
  } catch {
    throw new AuthConfigurationError();
  }
}
