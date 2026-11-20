import assert from "node:assert/strict";
import test from "node:test";
import { isContribution } from "../src/server/community-rules";

test("Play rules govern publishing, uploads and direct messages, while reading and safety actions remain available", () => {
  for (const [method, path] of [
    ["PATCH", "/api/people/me"],
    ["PUT", "/api/people/me/photo"],
    ["PUT", "/api/business-media/mine/eden/gallery"],
    ["PUT", "/api/reviews/businesses/eden/own"],
    ["POST", "/api/messaging/threads/abc/messages"],
    ["POST", "/api/directory/mine"],
    ["POST", "/api/directory/mine/eden/publish"],
    ["POST", "/api/stays/owner/eden"],
    ["POST", "/api/rentals/owner/eden"],
  ] as const)
    assert.equal(isContribution(method, path), true, path);
  for (const [method, path] of [
    ["GET", "/api/messaging/threads/abc/messages"],
    ["DELETE", "/api/reviews/businesses/eden/own"],
    ["DELETE", "/api/people/me/photo"],
    ["POST", "/api/support-requests"],
    ["POST", "/api/connections/abc/block"],
    ["POST", "/api/messaging/threads/abc/read"],
    ["POST", "/api/booking/mine/abc/cancel"],
    ["POST", "/api/directory/mine/eden/archive"],
    ["POST", "/api/reviews/businesses/eden/withdraw"],
    ["PATCH", "/api/directory/review/eden"],
  ] as const)
    assert.equal(isContribution(method, path), false, path);
});
