import assert from "node:assert/strict";
import test from "node:test";
import {
  adminAccountPath,
  adminAccountQuery,
  readAdminAccountDecision,
  readAdminAccountPage,
} from "../src/lib/admin-accounts";

const member = {
  id: "member_1",
  name: "Probni član",
  email: "clan@example.invalid",
  emailVerified: true,
  role: "member",
  approval: "pending",
  locale: "bs",
  appearance: "system",
};
const query = adminAccountQuery("pending", 1);
const page = {
  accounts: [member],
  approval: "pending",
  page: 1,
  hasMore: false,
  limit: 30,
};

test("account search emits bounded, explicit filters and literal encoded user input", () => {
  const next = adminAccountQuery("approved", 2, "  A_% & Ć  ");
  const url = new URL(adminAccountPath(next), "https://app.example.invalid");
  assert.equal(url.pathname, "/api/admin/accounts");
  assert.deepEqual(
    [...url.searchParams],
    [
      ["approval", "approved"],
      ["page", "2"],
      ["q", "A_% & Ć"],
    ],
  );
  assert.equal(new URL(adminAccountPath(query), url).searchParams.has("q"), false);
  for (const value of [0, -1, 1001, 1.5, NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => adminAccountQuery("pending", value));
  for (const value of ["x".repeat(81), "name\u0085other", "name\0other"])
    assert.throws(() => adminAccountQuery("pending", 1, value));
  assert.throws(() => adminAccountQuery("unexpected" as "pending", 1));
});

test("account pages reject foreign filters, unknown statuses, duplicate IDs and hidden extras", () => {
  assert.deepEqual(readAdminAccountPage(page, query), page);
  const owner = { ...member, id: "owner_1", role: "owner" };
  assert.equal(
    readAdminAccountPage({ ...page, accounts: [owner] }, query).accounts[0]?.role,
    "owner",
  );
  for (const value of [
    { ...page, approval: "approved" },
    { ...page, page: 2 },
    { ...page, limit: 100 },
    { ...page, hasMore: "false" },
    { ...page, accounts: [...page.accounts, ...page.accounts] },
    {
      ...page,
      accounts: Array.from({ length: 31 }, (_, index) => ({ ...member, id: `u${index}` })),
    },
    { ...page, accounts: [{ ...member, approval: "approved" }] },
    { ...page, accounts: [{ ...member, approval: "deleted" }] },
    { ...page, accounts: [{ ...member, role: "administrator" }] },
    { ...page, accounts: [{ ...member, token: "private" }] },
    { ...page, accounts: [{ ...member, name: "unsafe\nname" }] },
    { ...page, accounts: [{ ...member, id: "../../someone" }] },
    { ...page, accounts: [{ ...member, emailVerified: 1 }] },
    { ...page, accounts: [{ ...member, locale: { toString: () => "bs" } }] },
    { ...page, privateToken: "private" },
    null,
    [],
  ])
    assert.throws(() => readAdminAccountPage(value, query));
});

test("account decision cannot acknowledge another user, owner or different requested state", () => {
  const account = { ...member, approval: "approved" };
  assert.deepEqual(readAdminAccountDecision({ account }, member.id, "approved"), account);
  for (const value of [
    { account: { ...account, id: "another_member" } },
    { account: { ...account, role: "owner" } },
    { account: { ...account, approval: "suspended" } },
    { account: { ...account, password: "private" } },
    { account, extra: "private" },
    { ok: true },
  ])
    assert.throws(() => readAdminAccountDecision(value, member.id, "approved"));
});
