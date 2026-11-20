import assert from "node:assert/strict";
import { defaultVisualDesign } from "../../src/lib/visual-design.ts";
import { createVisualDesignStore } from "../../src/server/visual-design-store.ts";

export async function verifyDesignStore({ auth, pool, owner, second, member }) {
  const store = createVisualDesignStore(auth, pool);
  const initial = defaultVisualDesign();
  const draft = {
    ...initial,
    heroTitle: "Moja nova naslovnica",
    heroImage: "cafe",
    rules: {
      "home-title": { mobileDark: { color: "#ffeedd", "font-size": "28px" } },
    },
  };
  await assert.rejects(store.read(member.headers), (error) => error.status === 403);
  await assert.rejects(
    store.write(member.headers, 0, draft, "publish"),
    (error) => error.status === 403,
  );
  const switched = new Headers(owner.headers);
  switched.set("X-AhiBizz-Account-ID", second.user.id);
  await assert.rejects(store.write(switched, 0, draft, "publish"), (error) => error.status === 401);
  assert.equal((await store.read(owner.headers)).state.revision, 0);
  const saves = await Promise.allSettled(
    [owner, second].map((actor) => store.write(actor.headers, 0, draft, "draft")),
  );
  assert.equal(saves.filter((s) => s.status === "fulfilled").length, 1);
  assert.equal(saves.find((s) => s.status === "rejected").reason.status, 409);
  let saved = (await store.read(second.headers)).state;
  assert.deepEqual(saved.draft, draft);
  assert.deepEqual(saved.published, initial);
  await assert.rejects(
    store.write(owner.headers, 1, { ...draft, homeOrder: ["nearby"] }, "publish"),
    (error) => error.status === 400,
  );
  saved = await store.write(owner.headers, 1, draft, "publish");
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.published, draft);
  const following = await store.write(second.headers, 2, initial, "draft");
  assert.deepEqual(following.published, draft);
  assert.deepEqual(following.draft, initial);
  const publicRow = (
    await pool.query(
      "SELECT value->'published' AS appearance FROM platform_settings WHERE key = 'appearance.visual_design'",
    )
  ).rows[0];
  assert.deepEqual(publicRow.appearance, draft);
}
