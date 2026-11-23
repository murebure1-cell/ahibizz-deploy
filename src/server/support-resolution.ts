import { AccountAccessError } from "./auth/accounts";

type SupportResolver = { resolve: (headers: Headers, id: string) => Promise<void> };

/** Bind the submitted queue action to the operator who saw the form. */
export async function resolveSupportRequest(
  service: SupportResolver | null,
  requestHeaders: Headers,
  operatorId: unknown,
  requestId: unknown,
) {
  if (typeof operatorId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operatorId))
    throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)
  )
    throw new AccountAccessError(400, "INVALID_REQUEST");
  if (!service) throw new AccountAccessError(503, "SUPPORT_UNAVAILABLE");
  const bound = new Headers(requestHeaders);
  bound.set("X-AhiBizz-Account-ID", operatorId);
  await service.resolve(bound, requestId);
}
