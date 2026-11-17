export class ReviewsAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Review action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new ReviewsAccessError(status, code);
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    fail(400, "INVALID_REVIEW_INPUT");
  return value.toLowerCase();
}
export function commandInput(input: unknown, action: "save" | "withdraw" | "moderate") {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "INVALID_REVIEW_INPUT");
  const v = input as Record<string, unknown>,
    allowed =
      action === "save"
        ? ["rating", "text", "expectedVersion", "idempotencyKey"]
        : action === "moderate"
          ? ["hidden", "reason", "expectedVersion", "idempotencyKey"]
          : ["expectedVersion", "idempotencyKey"];
  if (
    Object.keys(v).some((key) => !allowed.includes(key)) ||
    !Number.isInteger(v.expectedVersion) ||
    (v.expectedVersion as number) < 0 ||
    (v.expectedVersion as number) > 2147483646
  )
    fail(400, "INVALID_REVIEW_INPUT");
  const idempotencyKey = uuid(v.idempotencyKey),
    expectedVersion = v.expectedVersion as number;
  const clean = (text: unknown, max: number) => {
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > max ||
      /[\p{Cc}\p{Cf}<>]/u.test(text.replace(/[\n\r\t]/g, ""))
    )
      fail(400, "INVALID_REVIEW_INPUT");
    return text.trim();
  };
  if (action === "save") {
    if (!Number.isInteger(v.rating) || (v.rating as number) < 1 || (v.rating as number) > 5)
      fail(400, "INVALID_REVIEW_INPUT");
    return {
      idempotencyKey,
      expectedVersion,
      rating: v.rating as number,
      text: clean(v.text, 2000),
    };
  }
  if (action === "moderate") {
    if (typeof v.hidden !== "boolean" || expectedVersion < 1) fail(400, "INVALID_REVIEW_INPUT");
    return { idempotencyKey, expectedVersion, hidden: v.hidden, reason: clean(v.reason, 500) };
  }
  if (expectedVersion < 1) fail(400, "INVALID_REVIEW_INPUT");
  return { idempotencyKey, expectedVersion };
}
