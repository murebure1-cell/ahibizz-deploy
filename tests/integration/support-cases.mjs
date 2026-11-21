import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSupportRequests } from "../../src/server/support-requests.ts";
import { verifyContentHub } from "./content-hub-cases.mjs";

export async function verifySupportRequests({ auth, pool, owner, member, other }) {
  const inbox = createSupportRequests(auth, pool);
  await verifyContentHub({ auth, pool, owner, member });
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

  const comment = "Prijava iz izolirane probe";
  const unavailable = (error) => error.status === 404 && error.code === "REPORT_TARGET_UNAVAILABLE";
  await assert.rejects(
    inbox.submit(member.headers, "review", "fixture-review", comment),
    unavailable,
  );
  await assert.rejects(
    inbox.submit(member.headers, "business", randomUUID(), comment),
    unavailable,
  );
  await pool.query("INSERT INTO personal_profile(user_id,version,is_public) VALUES($1,1,false)", [
    other.user.id,
  ]);
  await assert.rejects(inbox.submit(member.headers, "person", other.user.id, comment), unavailable);
  await pool.query(
    "UPDATE personal_profile SET is_public=true,version=version+1 WHERE user_id=$1",
    [other.user.id],
  );
  await inbox.submit(member.headers, "person", other.user.id, comment);

  const categoryId = randomUUID(),
    businessId = randomUUID(),
    reviewId = randomUUID(),
    threadId = randomUUID();
  await pool.query("INSERT INTO directory_category(id,name,slug) VALUES($1,'Report fixture',$2)", [
    categoryId,
    `report-fixture-${categoryId}`,
  ]);
  await pool.query(
    "INSERT INTO directory_business(id,owner_user_id,title,category_id) VALUES($1,$2,'Report fixture',$3)",
    [businessId, owner.user.id, categoryId],
  );
  await assert.rejects(inbox.submit(member.headers, "business", businessId, comment), unavailable);
  await pool.query(
    "UPDATE directory_business SET status='published',published_at=now() WHERE id=$1",
    [businessId],
  );
  await inbox.submit(member.headers, "business", businessId, comment);
  await pool.query(
    "INSERT INTO business_review(id,business_id,author_user_id,rating,body,version) VALUES($1,$2,$3,4,'Isolated review',1)",
    [reviewId, businessId, other.user.id],
  );
  await Promise.all(
    [reviewId, reviewId.toUpperCase()].map((reference) =>
      inbox.submit(member.headers, "review", reference, comment),
    ),
  );
  await pool.query("UPDATE business_review SET hidden=true,version=version+1 WHERE id=$1", [
    reviewId,
  ]);
  await assert.rejects(inbox.submit(other.headers, "review", reviewId, comment), unavailable);
  await inbox.submit(member.headers, "review", reviewId.toUpperCase(), comment);

  await pool.query(
    "INSERT INTO message_thread(id,kind,left_user_id,right_user_id,business_id,created_by_user_id) VALUES($1,'business',$2,$3,$4,$2)",
    [threadId, member.user.id, owner.user.id, businessId],
  );
  await pool.query(
    "INSERT INTO message_thread_member(thread_id,user_id,blocked) VALUES($1,$2,true),($1,$3,false)",
    [threadId, member.user.id, owner.user.id],
  );
  await assert.rejects(inbox.submit(other.headers, "conversation", threadId, comment), unavailable);
  await inbox.submit(member.headers, "conversation", threadId, comment);
  await pool.query("UPDATE directory_business SET owner_user_id=$2,version=version+1 WHERE id=$1", [
    businessId,
    other.user.id,
  ]);
  await assert.rejects(inbox.submit(owner.headers, "conversation", threadId, comment), unavailable);
  await inbox.submit(member.headers, "conversation", threadId, comment);

  const reports = (await inbox.pending(owner.headers, 0)).requests.filter(
    (row) => row.subject !== "deletion",
  );
  assert.deepEqual(reports.map((row) => [row.subject, row.reference]).sort(), [
    ["business", businessId],
    ["conversation", threadId],
    ["person", other.user.id],
    ["review", reviewId],
  ]);
  await assert.rejects(inbox.resolve(member.headers, reports[0].id), (e) => e.status === 403);
  for (const report of reports) await inbox.resolve(owner.headers, report.id);
  assert.deepEqual(
    (await inbox.pending(owner.headers, 0)).requests.map((row) => row.subject),
    ["deletion"],
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM auth_user WHERE id=$1", [member.user.id]))
      .rows[0].count,
    1,
  );
  await pool.query("DELETE FROM message_thread_member WHERE thread_id=$1", [threadId]);
  await pool.query("DELETE FROM message_thread WHERE id=$1", [threadId]);
  await pool.query("DELETE FROM business_review WHERE id=$1", [reviewId]);
  await pool.query("DELETE FROM directory_business WHERE id=$1", [businessId]);
  await pool.query("DELETE FROM directory_category WHERE id=$1", [categoryId]);
  await pool.query("DELETE FROM personal_profile WHERE user_id=$1", [other.user.id]);
}
