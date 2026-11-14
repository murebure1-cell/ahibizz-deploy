import { Pool } from "pg";
import { type DatabaseConfiguration, type Environment, readDatabaseConfiguration } from "./env";

export type DatabaseClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};
export type DatabasePool = {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
  on?(event: "error", listener: () => void): unknown;
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured.");
  }
}

/** Creating the facade (including at build time) never constructs a pool. */
export function createDatabase(
  options: {
    environment?: () => Environment;
    createPool?: (config: DatabaseConfiguration) => DatabasePool;
    onIdleError?: () => void;
  } = {},
) {
  let configuration: DatabaseConfiguration | null | undefined;
  let pool: DatabasePool | undefined;
  let closed = false;
  const config = () => {
    if (configuration === undefined) {
      configuration = readDatabaseConfiguration(options.environment?.() ?? process.env);
    }
    return configuration;
  };
  const getPool = () => {
    if (closed) throw new Error("Database has been closed.");
    const settings = config();
    if (!settings) throw new DatabaseNotConfiguredError();
    if (!pool) {
      pool = options.createPool ? options.createPool(settings) : new Pool(settings);
      pool.on?.(
        "error",
        options.onIdleError ?? (() => console.error("Database pool reported a background error.")),
      );
    }
    return pool;
  };
  return Object.freeze({
    configured: () => config() !== null,
    async query(text: string, values: unknown[] = []) {
      const client = await getPool().connect();
      try {
        return await client.query(text, values);
      } finally {
        client.release();
      }
    },
    async close() {
      closed = true;
      if (pool) await pool.end();
    },
  });
}

export type Database = ReturnType<typeof createDatabase>;
let shared: Database | undefined;
export function getDatabase(): Database {
  if (!shared) shared = createDatabase();
  return shared;
}
