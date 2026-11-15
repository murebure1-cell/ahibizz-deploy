import { MessagingRequestError } from "./messaging-client";

export function messagingAccessDenied(failure: unknown): boolean {
  return (
    failure instanceof MessagingRequestError && (failure.status === 401 || failure.status === 403)
  );
}

/** A later rejection cannot prove that an earlier request did not commit. */
export function messagingCommandNeedsRecovery(
  command: { uncertain?: boolean; receipt?: unknown },
  failure: unknown,
): boolean {
  if (command.uncertain || command.receipt) return true;
  return !(
    failure instanceof MessagingRequestError &&
    failure.status >= 400 &&
    failure.status < 500 &&
    failure.status !== 408
  );
}
