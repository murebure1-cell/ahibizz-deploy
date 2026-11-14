export type Environment = Readonly<Record<string, string | undefined>>;

export class DatabaseConfigurationError extends Error {
  readonly code = "database_configuration_invalid";
  constructor() {
    super("Database configuration is invalid.");
  }
}

export type DatabaseConfiguration = Readonly<{
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
  max: 5;
  connectionTimeoutMillis: 3000;
  idleTimeoutMillis: 10000;
  query_timeout: 3000;
  statement_timeout: 3000;
  application_name: "ahibizz-next";
}>;

function containsControl(value: string, includeSpace = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= (includeSpace ? 32 : 31) || code === 127) return true;
  }
  return false;
}

/** No fallback database and no secret value is included in an error. */
export function readDatabaseConfiguration(
  env: Environment = process.env,
): DatabaseConfiguration | null {
  const value = env.DATABASE_URL;
  if (value === undefined || value.trim() === "") return null;
  try {
    if (containsControl(value, true)) throw new DatabaseConfigurationError();
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.hash
    )
      throw new DatabaseConfigurationError();
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !/^[A-Za-z0-9_.-]+$/.test(database) ||
      containsControl(decodeURIComponent(url.username) + decodeURIComponent(url.password))
    )
      throw new DatabaseConfigurationError();
    if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))
      throw new DatabaseConfigurationError();
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => key !== "sslmode") || url.searchParams.getAll("sslmode").length > 1)
      throw new DatabaseConfigurationError();
    if (url.searchParams.has("sslmode") && !url.searchParams.get("sslmode"))
      throw new DatabaseConfigurationError();
    const fromUrl = url.searchParams.get("sslmode") || undefined;
    const fromEnv = env.DATABASE_SSL_MODE || undefined;
    if (fromUrl && fromEnv && fromUrl !== fromEnv) throw new DatabaseConfigurationError();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    const mode = fromEnv ?? fromUrl ?? (local ? "disable" : "require");
    if (!["disable", "require", "verify-full"].includes(mode))
      throw new DatabaseConfigurationError();
    // Strip URL TLS options: pg must use the explicit, certificate-verifying setting.
    url.search = "";
    if (!url.port) url.port = "5432";
    const configuration: DatabaseConfiguration = {
      connectionString: url.toString(),
      ssl: mode === "disable" ? false : { rejectUnauthorized: true },
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      query_timeout: 3000,
      statement_timeout: 3000,
      application_name: "ahibizz-next",
    };
    return Object.freeze(configuration);
  } catch {
    throw new DatabaseConfigurationError();
  }
}
