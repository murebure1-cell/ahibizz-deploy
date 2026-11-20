import assert from "node:assert/strict";
import { COMMUNITY_RULES_VERSION } from "../../src/lib/community-rules.ts";
import {
  communityRulesRequest,
  contributionPermission,
  createCommunityRulesService,
} from "../../src/server/community-rules.ts";

export async function verifyCommunityRules({ auth, pool, owner, member, baseURL }) {
  const service = createCommunityRulesService(auth, pool);
  const url = new URL("/api/community-rules", baseURL);
  function request(method, headers = member.headers, options = {}) {
    return new Request(url, { method, headers, ...options });
  }
  function consentHeaders(actor = member) {
    const headers = new Headers(actor.headers);
    headers.set("X-AhiBizz-Community-Rules", COMMUNITY_RULES_VERSION);
    return headers;
  }
  const status = async (actor) =>
    (await communityRulesRequest(request("GET", actor.headers), baseURL, service)).json();
  const consent = (headers, options) =>
    communityRulesRequest(request("POST", headers, options), baseURL, service);
  const permission = (headers) =>
    contributionPermission(request("POST", headers), baseURL, service);
  assert.deepEqual(await status(member), { accepted: false, version: COMMUNITY_RULES_VERSION });
  await pool.query(
    "INSERT INTO community_rules_acceptance(account_id,rules_version) VALUES($1,$2)",
    [member.user.id, "2026-10-01"],
  );
  assert.equal((await permission(member.headers)).status, 428);
  const stale = consentHeaders();
  stale.set("X-AhiBizz-Community-Rules", "2026-10-01");
  assert.equal((await consent(stale)).status, 409);
  const foreign = consentHeaders();
  foreign.set("origin", "https://other.invalid");
  assert.equal((await consent(foreign)).status, 403);
  assert.equal((await permission(foreign)).status, 403);
  const switched = consentHeaders();
  switched.set("X-AhiBizz-Account-ID", owner.user.id);
  assert.equal((await consent(switched)).status, 401);
  assert.equal((await consent(consentHeaders(), { body: "{}" })).status, 409);
  assert.equal((await status(member)).accepted, false);

  const responses = await Promise.all([consent(consentHeaders()), consent(consentHeaders())]);
  assert.deepEqual(
    responses.map((res) => res.status),
    [200, 200],
  );
  const acceptedTimes = async () =>
    (
      await pool.query(
        "SELECT accepted_at::text FROM community_rules_acceptance WHERE account_id=$1 AND rules_version=$2",
        [member.user.id, COMMUNITY_RULES_VERSION],
      )
    ).rows;
  const first = await acceptedTimes();
  assert.equal(first.length, 1);
  assert.equal((await consent(consentHeaders())).status, 200);
  assert.deepEqual(await acceptedTimes(), first);
  assert.equal(await permission(member.headers), null);
  assert.equal((await status(member)).accepted, true);
  assert.equal((await status(owner)).accepted, false);
  assert.equal((await permission(owner.headers)).status, 428);
}
