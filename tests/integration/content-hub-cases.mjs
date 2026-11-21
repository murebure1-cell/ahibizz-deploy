import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createContentHub } from "../../src/server/content-hub.ts";
import { createSupportRequests } from "../../src/server/support-requests.ts";

export async function verifyContentHub({ auth, pool, owner, member }) {
  const hub = createContentHub(auth, pool);
  const support = createSupportRequests(auth, pool);
  const list = { category: null, q: "", page: 1, saved: false };
  const home = await hub.publicPage(list);
  assert.equal(home.featured.slug, "uredi-poslovni-profil");
  assert.equal(home.articles.length, 4);
  assert.deepEqual(
    (await hub.publicPage({ ...list, category: "sigurnost", q: "sumnjivu poruku" })).articles.map(
      (a) => a.slug,
    ),
    ["siguran-razgovor"],
  );
  assert.deepEqual(
    (await hub.publicPage({ ...list, q: "sta tacno nudis" })).articles.map((a) => a.slug),
    ["uredi-poslovni-profil"],
  );
  assert.deepEqual((await hub.publicPage({ ...list, q: "%_" })).articles, []);

  const draft = {
    slug: "test-prica",
    title: "Kako poboljšati ponudu",
    excerpt: "Testni sažetak za izdvojeni članak.",
    body: "Dovoljno dugačak sadržaj za testni članak o djelatnosti.",
    category: "poslovanje",
    revision: 0,
  };
  await assert.rejects(hub.adminPage(member.headers, null, 1), (error) => error.status === 403);
  await assert.rejects(hub.saveArticle(member.headers, draft), (error) => error.status === 403);
  await assert.rejects(
    hub.saveArticle(owner.headers, { ...draft, featured: "yes" }),
    (error) => error.code === "INVALID_ARTICLE",
  );
  await hub.saveArticle(owner.headers, draft);
  const editing = (await hub.adminPage(owner.headers, draft.slug, 1)).editing;
  assert.equal(editing.title, draft.title);
  assert.equal(await hub.publicArticle(draft.slug), null);
  await assert.rejects(
    hub.setBookmark(member.headers, draft.slug, true),
    (error) => error.status === 404,
  );
  await hub.saveArticle(owner.headers, {
    ...draft,
    published: "yes",
    featured: "yes",
    revision: editing.revision,
  });
  await assert.rejects(
    hub.saveArticle(owner.headers, { ...draft, revision: editing.revision }),
    (error) => error.status === 409,
  );
  assert.equal((await hub.publicPage(list)).featured.slug, draft.slug);
  assert.equal((await hub.publicArticle(draft.slug)).title, draft.title);

  const saved = { ...list, saved: true };
  await assert.rejects(hub.publicPage(saved), (error) => error.status === 401);
  const replaced = new Headers(member.headers);
  replaced.set("X-AhiBizz-Account-ID", owner.user.id);
  await assert.rejects(
    hub.setBookmark(replaced, draft.slug, true),
    (error) => error.status === 401,
  );
  await Promise.all([1, 2].map(() => hub.setBookmark(member.headers, draft.slug, true)));
  assert.equal((await hub.favorites(member.headers, draft.slug)).saved, true);
  assert.equal((await hub.publicPage(saved, member.headers)).articles.length, 1);
  assert.deepEqual((await hub.publicPage(saved, owner.headers)).articles, []);
  await hub.setBookmark(member.headers, draft.slug, false);
  assert.deepEqual((await hub.publicPage(saved, member.headers)).articles, []);
  await hub.setBookmark(member.headers, draft.slug, true);
  await hub.saveArticle(owner.headers, { ...draft, revision: editing.revision + 1 });
  assert.equal(await hub.publicArticle(draft.slug), null);
  assert.deepEqual((await hub.publicPage(saved, member.headers)).articles, []);

  const ticket = `nalog--${randomUUID()}`;
  await assert.rejects(
    support.submit(member.headers, "help", "neispravno", "Test"),
    (error) => error.status === 400,
  );
  await assert.rejects(
    support.submit(replaced, "help", ticket, "Pitanje kolegi"),
    (error) => error.status === 401,
  );
  await Promise.all(
    [1, 2].map(() => support.submit(member.headers, "help", ticket, "Pomoć sa prijavom")),
  );
  const help = (await support.pending(owner.headers, 0)).requests.filter(
    (r) => r.subject === "help",
  );
  assert.equal(help.length, 1);
  assert.equal(help[0].email, member.user.email);
  assert.equal(help[0].details, "Pomoć sa prijavom");
  await support.resolve(owner.headers, help[0].id);
  await support.submit(member.headers, "help", ticket, "Pomoć sa prijavom");
  assert.ok(!(await support.pending(owner.headers, 0)).requests.some((r) => r.subject === "help"));
}
