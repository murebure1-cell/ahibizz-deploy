import assert from "node:assert/strict";
import test from "node:test";
import { MessagingRequestError } from "../src/lib/messaging-client";
import {
  messagingAccessDenied,
  messagingCommandNeedsRecovery,
} from "../src/lib/messaging-command-state";

test("only signed-access denials invalidate an entire same-account private cache", () => {
  for (const status of [401, 403])
    assert.equal(messagingAccessDenied(new MessagingRequestError(status, "DENIED")), true);
  for (const status of [400, 404, 408, 409, 429, 503])
    assert.equal(messagingAccessDenied(new MessagingRequestError(status, "OTHER_FAILURE")), false);
  assert.equal(messagingAccessDenied(new DOMException("Aborted", "AbortError")), false);
});

test("a first definite rejection may release an unacknowledged messaging command", () => {
  for (const status of [400, 401, 403, 404, 409, 413, 415, 429])
    assert.equal(
      messagingCommandNeedsRecovery({}, new MessagingRequestError(status, "REJECTED")),
      false,
      `first ${status}`,
    );
});

test("408, unavailable transport and invalid acknowledgements remain uncertain", () => {
  for (const failure of [
    new MessagingRequestError(408, "TIMEOUT"),
    new MessagingRequestError(500, "UNAVAILABLE"),
    new MessagingRequestError(503, "UNAVAILABLE"),
    new MessagingRequestError(200, "INVALID_RESPONSE"),
    new TypeError("Network lost after commit"),
    new DOMException("Aborted", "AbortError"),
    new Error("unconfirmed_message_action"),
  ])
    assert.equal(messagingCommandNeedsRecovery({}, failure), true);
});

test("a later 4xx cannot erase an earlier unknown outcome or an accepted receipt", () => {
  for (const command of [{ uncertain: true }, { receipt: { threadId: "fixture-thread" } }])
    for (const status of [400, 401, 403, 404, 408, 409, 429, 503])
      assert.equal(
        messagingCommandNeedsRecovery(command, new MessagingRequestError(status, "LATER_FAILURE")),
        true,
        `recovery ${status}`,
      );
});
