import { DatabaseConfigurationError } from "./env";

type HealthDatabase = {
  configured(): boolean;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
export type HealthReport = {
  status: 200 | 503;
  body: {
    status: "ok" | "not_ready";
    checks?: { database: "ready" | "unconfigured" | "misconfigured" | "unavailable" };
  };
};

export function liveHealth(): HealthReport {
  return { status: 200, body: { status: "ok" } };
}

export async function readyHealth(database: HealthDatabase): Promise<HealthReport> {
  const unavailable = (state: "unconfigured" | "misconfigured" | "unavailable"): HealthReport => ({
    status: 503,
    body: { status: "not_ready", checks: { database: state } },
  });
  try {
    if (!database.configured()) return unavailable("unconfigured");
    const result = await database.query(
      "SELECT 1 AS ready FROM platform_migrations WHERE version = $1 LIMIT 1",
      ["0056_business_content_erasure.sql"],
    );
    if (result.rows[0]?.ready !== 1) return unavailable("unavailable");
    return { status: 200, body: { status: "ok", checks: { database: "ready" } } };
  } catch (error) {
    return unavailable(
      error instanceof DatabaseConfigurationError ? "misconfigured" : "unavailable",
    );
  }
}

export function healthResponse(report: HealthReport): Response {
  return Response.json(report.body, {
    status: report.status,
    headers: { "Cache-Control": "no-store" },
  });
}
