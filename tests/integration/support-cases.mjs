import assert from "node:assert/strict";
import { createSupportRequests } from "../../src/server/support-requests.ts";

export async function verifySupportRequests({ auth, pool, owner, member }) {
  const inbox = createSupportRequests(auth, pool);
  await assert.rejects(inbox.pending(member.headers, 0), (e) => e.status === 403);
  const switched = new Headers(member.headers);
  switched.set("X-AhiBizz-Account-ID", owner.user.id);
  await assert.rejects(inbox.submit(switched, "deletion", "", ""), (e) => e.status === 401);
  await Promise.all([1, 2].map(() => inbox.submit(member.headers, "deletion", "", "")));
  const rows = (await inbox.pending(owner.headers, 0)).requests;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, member.user.email);
  await assert.rejects(inbox.resolve(owner.headers, rows[0].id), (e) => e.status === 409);
  await assert.rejects(inbox.submit(member.headers, "review", "a", "  "), (e) => e.status === 400);
  await Promise.all(
    [1, 2].map(() =>
      inbox.submit(member.headers, "review", "fixture-review", "Prijava iz izolirane probe"),
    ),
  );
  const report = (await inbox.pending(owner.headers, 0)).requests.find(
    (row) => row.subject === "review",
  );
  assert.ok(report);
  await assert.rejects(inbox.resolve(member.headers, report.id), (e) => e.status === 403);
  await inbox.resolve(owner.headers, report.id);
  assert.deepEqual(
    (await inbox.pending(owner.headers, 0)).requests.map((row) => row.subject),
    ["deletion"],
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM auth_user WHERE id=$1", [member.user.id]))
      .rows[0].count,
    1,
  );
}
