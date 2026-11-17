import assert from "node:assert/strict";
import test from "node:test";
import { AdminRequestError } from "../src/components/admin/responses";
import {
  importActor,
  importJournalKey,
  loadImportJournal,
  parseBusinessImport,
  retireCompletedImport,
} from "../src/lib/business-import";
import { businessImportClient } from "../src/lib/business-import-client";
import { browserImportLock } from "../src/lib/business-import-lock";
import { previewBusinessImport, runBusinessImport } from "../src/lib/business-import-runner";
import {
  encodeFixture,
  fixtureAccount,
  fixtureActor,
  ImportMemoryApi,
  ImportMemoryStorage,
  importFixture,
  importFixtureData,
  secondSource,
} from "./fixtures/business-import-memory";

function setup() {
  const api = new ImportMemoryApi(),
    storage = new ImportMemoryStorage();
  return { api, storage, actor: fixtureActor, signal: new AbortController().signal };
}
function code(wanted: string) {
  return (error: unknown) => error instanceof Error && error.message === wanted;
}

test("only bounded reviewed public data is accepted; personal, account and benefit fields never reach writes", async () => {
  const source = await importFixtureData();
  const parsed = await parseBusinessImport(encodeFixture(source));
  assert.equal(parsed.records[0]?.business.latitude, null);
  assert.equal(parsed.records[0]?.business.addressLine, null);
  for (const [target, field] of [
    ["root", "password"],
    ["record", "owner"],
    ["record", "consents"],
    ["record", "status"],
    ["record", "benefits"],
    ["business", "bookingEnabled"],
    ["business", "verified"],
    ["business", "ownerId"],
    ["business", "dateOfBirth"],
  ]) {
    const input = structuredClone(source),
      row = input.records[0];
    assert.ok(row);
    Object.assign(target === "root" ? input : target === "record" ? row : row.business, {
      [field as string]: "private",
    });
    await assert.rejects(parseBusinessImport(encodeFixture(input)), code("INVALID_FILE"));
  }
  const duplicates = { ...source, records: [...source.records, ...source.records] };
  await assert.rejects(parseBusinessImport(encodeFixture(duplicates)), code("DUPLICATE_RECORD"));
  const unpaired = structuredClone(source);
  assert.ok(unpaired.records[0]);
  unpaired.records[0].business.latitude = 44 as unknown as null;
  await assert.rejects(parseBusinessImport(encodeFixture(unpaired)), code("INVALID_FILE"));
  const oversize = new Uint8Array(12 * 1024 * 1024 + 1);
  await assert.rejects(parseBusinessImport(oversize), code("FILE_TOO_LARGE"));
});
test("supplied logo bytes are hash and MIME checked without storing them in journal", async () => {
  const source = await importFixtureData({ logo: true }),
    row = source.records[0];
  assert.ok(row?.logo);
  const file = await parseBusinessImport(encodeFixture(source));
  assert.ok(file.records[0]?.logo?.bytes.length);
  row.logo.sha256 = "0".repeat(64);
  await assert.rejects(parseBusinessImport(encodeFixture(source)), code("INVALID_IMAGE"));
  row.logo.contentType = "image/jpeg";
  await assert.rejects(parseBusinessImport(encodeFixture(source)), code("INVALID_IMAGE"));
  const env = setup();
  await runBusinessImport({ ...env, file });
  const raw = env.storage.getItem(importJournalKey(fixtureActor));
  assert.ok(raw);
  assert.equal(raw.includes("base64"), false);
  assert.equal(raw.includes("servis@example.invalid"), false);
  assert.equal(raw.includes("bytes"), false);
});
test("complete non-archived and archived inventory preserves existing public/draft/archived matches", async () => {
  const env = setup(),
    one = await importFixtureData(),
    two = await importFixtureData({ sourceId: secondSource, title: "Drugi servis" });
  const file = await parseBusinessImport(
    encodeFixture({ ...one, records: [...one.records, ...two.records] }),
  );
  const fields = {
    ...file.records[0]?.business,
    categoryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    subcategoryId: null,
  };
  const row = await env.api.create(fields as Parameters<ImportMemoryApi["create"]>[0], "existing");
  env.api.rows.set(row.id, { ...row, status: "archived" });
  const before = structuredClone(env.api.rows.get(row.id));
  env.api.calls = [];
  const preview = await previewBusinessImport(env.api, fixtureActor, file);
  assert.equal(preview.existing.length, 1);
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows[0]?.stage, "existing");
  assert.equal(result.rows[1]?.stage, "done");
  assert.deepEqual(env.api.rows.get(row.id), before);
  assert.equal(env.api.calls.filter((c) => c.kind === "create").length, 1);
  assert.ok(
    env.api.calls.some(
      (c) => c.kind === "inventory" && (c.value as { archived: boolean }).archived,
    ),
  );
});
test("actor and exact file identity are mandatory for partial resume; storage failure blocks all writes", async () => {
  const env = setup(),
    file = await importFixture();
  env.storage.failAt = 1;
  await assert.rejects(runBusinessImport({ ...env, file }), code("STORAGE_UNAVAILABLE"));
  assert.equal(
    env.api.calls.some((c) => ["create", "category", "publish", "logo"].includes(c.kind)),
    false,
  );
  env.storage.failAt = Infinity;
  env.api.lost = "create";
  await assert.rejects(runBusinessImport({ ...env, file }));
  const changed = await importFixture({ title: "Promijenjen servis" });
  assert.throws(
    () => loadImportJournal(env.storage, fixtureActor, changed),
    code("DIFFERENT_IMPORT"),
  );
  env.api.actor = { ...fixtureAccount, id: "other-owner" };
  const count = env.api.calls.length;
  await assert.rejects(runBusinessImport({ ...env, file }), code("ACTOR_CHANGED"));
  assert.equal(env.api.calls.length, count);
  assert.equal(importActor({ ...fixtureAccount, role: "member" }, fixtureActor), false);
  assert.equal(importActor({ ...fixtureAccount, emailVerified: false }, fixtureActor), false);
});
test("lost create and media acknowledgements replay identical actor-bound receipts without duplicates", async () => {
  for (const kind of ["create", "logo"] as const) {
    const env = setup(),
      file = await importFixture({ logo: true });
    env.api.lost = kind;
    await assert.rejects(runBusinessImport({ ...env, file }));
    assert.equal(env.api.rows.size, 1);
    const result = await runBusinessImport({ ...env, file });
    assert.equal(result.rows[0]?.stage, "done");
    assert.equal(env.api.rows.size, 1);
    const sent = env.api.calls.filter((c) => c.kind === kind).map((c) => c.value);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
    assert.equal(env.api.calls.filter((c) => c.kind === "publish").length, 1);
  }
});
test("unknown publish first reads fresh state and retries only its exact CAS intent after no commit", async () => {
  for (const committed of [true, false]) {
    const env = setup(),
      file = await importFixture();
    const publish = env.api.publish.bind(env.api);
    let first = true;
    env.api.publish = async (id, version) => {
      if (first) {
        first = false;
        env.api.noCommit = !committed;
        env.api.lost = "publish";
      }
      try {
        return await publish(id, version);
      } finally {
        env.api.noCommit = false;
      }
    };
    await assert.rejects(runBusinessImport({ ...env, file }));
    const result = await runBusinessImport({ ...env, file });
    assert.equal(result.rows[0]?.stage, "done");
    assert.equal(result.rows[0]?.version, 2);
    const writes = env.api.calls.filter((c) => c.kind === "publish");
    assert.equal(writes.length, committed ? 1 : 2);
    if (!committed) assert.deepEqual(writes[0]?.value, writes[1]?.value);
  }
});
test("unknown root and child category creation reconcile reads and never blindly post again", async () => {
  for (const committed of [true, false]) {
    const env = setup(),
      file = await importFixture({
        category: "Nova kategorija",
        subcategory: "Nova podkategorija",
      });
    env.api.lost = "category";
    env.api.noCommit = !committed;
    if (committed) {
      const result = await runBusinessImport({ ...env, file });
      assert.equal(result.rows[0]?.stage, "done");
      assert.equal(env.api.calls.filter((c) => c.kind === "category").length, 2);
    } else {
      await assert.rejects(runBusinessImport({ ...env, file }));
      env.api.noCommit = false;
      const result = await runBusinessImport({ ...env, file });
      assert.equal(result.rows[0]?.stage, "done");
      const writes = env.api.calls.filter((c) => c.kind === "category");
      assert.equal(writes.length, 3);
      assert.deepEqual(writes[0]?.value, writes[1]?.value);
    }
  }
});
test("failed acknowledgement persistence retains the dispatched intent and safely resumes", async () => {
  const env = setup(),
    file = await importFixture();
  env.storage.failAt = 3;
  await assert.rejects(runBusinessImport({ ...env, file }), code("STORAGE_UNAVAILABLE"));
  assert.equal(env.api.rows.size, 1);
  const stored = loadImportJournal(env.storage, fixtureActor, file);
  assert.equal(stored?.pending?.kind, "create");
  env.storage.failAt = Infinity;
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows[0]?.stage, "done");
  assert.equal(env.api.rows.size, 1);
});
test("partial batches keep confirmed rows and reject external draft edits or archived IDs", async () => {
  const env = setup(),
    file = await importFixture({ logo: true });
  env.api.lost = "logo";
  await assert.rejects(runBusinessImport({ ...env, file }));
  const row = [...env.api.rows.values()][0];
  assert.ok(row);
  env.api.rows.set(row.id, { ...row, status: "archived", version: row.version + 1 });
  await assert.rejects(runBusinessImport({ ...env, file }), code("BUSINESS_CHANGED"));
  assert.equal(env.api.calls.filter((c) => c.kind === "publish").length, 0);
  const saved = JSON.parse(env.storage.getItem(importJournalKey(fixtureActor)) as string);
  saved.rows[0].id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  env.storage.values.set(importJournalKey(fixtureActor), JSON.stringify(saved));
  await assert.rejects(runBusinessImport({ ...env, file }), code("BUSINESS_CHANGED"));
});
test("partial batches resume only unfinished records without recreating a confirmed published row", async () => {
  const env = setup(),
    one = await importFixtureData(),
    two = await importFixtureData({ sourceId: secondSource, title: "Drugi servis" });
  const file = await parseBusinessImport(
    encodeFixture({ ...one, records: [...one.records, ...two.records] }),
  );
  const create = env.api.create.bind(env.api);
  let lose = true;
  env.api.create = async (fields, key) => {
    if (key === secondSource && lose) {
      lose = false;
      env.api.lost = "create";
    }
    return create(fields, key);
  };
  await assert.rejects(runBusinessImport({ ...env, file }));
  const saved = loadImportJournal(env.storage, fixtureActor, file);
  assert.equal(saved?.rows[0]?.stage, "done");
  assert.equal(saved?.rows[1]?.stage, "todo");
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows.filter((r) => r.stage === "done").length, 2);
  assert.equal(env.api.rows.size, 2);
  const creates = env.api.calls
    .filter((c) => c.kind === "create")
    .map((c) => (c.value as { key: string }).key);
  assert.equal(creates.filter((key) => key === file.records[0]?.sourceId).length, 1);
  assert.equal(creates.filter((key) => key === secondSource).length, 2);
});
test("an abort after dispatched create retains the original receipt intent and accepts no stale completion", async () => {
  const env = setup(),
    file = await importFixture(),
    controller = new AbortController(),
    create = env.api.create.bind(env.api);
  env.api.create = async (fields, key) => {
    const result = await create(fields, key);
    controller.abort();
    return result;
  };
  await assert.rejects(
    runBusinessImport({ ...env, file, signal: controller.signal }),
    code("STOPPED"),
  );
  assert.equal(loadImportJournal(env.storage, fixtureActor, file)?.pending?.kind, "create");
  assert.equal(env.api.rows.size, 1);
  assert.equal(env.api.calls.filter((c) => c.kind === "publish").length, 0);
  env.api.create = create;
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows[0]?.stage, "done");
  assert.equal(env.api.rows.size, 1);
});
test("unknown child category creation retries only its original parent and unique slug after a fresh absent read", async () => {
  const env = setup(),
    file = await importFixture({ subcategory: "Novi servis" });
  env.api.lost = "category";
  env.api.noCommit = true;
  await assert.rejects(runBusinessImport({ ...env, file }));
  const pending = loadImportJournal(env.storage, fixtureActor, file)?.pending;
  assert.equal(pending?.kind, "category");
  assert.equal(
    pending?.kind === "category" ? pending.parentId : null,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  env.api.noCommit = false;
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows[0]?.stage, "done");
  const sent = env.api.calls.filter((c) => c.kind === "category");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]?.value, sent[1]?.value);
});
test("native immediate browser locks omit incompatible signal options and stop on contention or abort", async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let held = false,
    requests = 0,
    actions = 0;
  const controller = new AbortController();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(
          name: string,
          options: Record<string, unknown>,
          callback: (value: object | null) => Promise<void>,
        ) {
          requests++;
          assert.equal(name, `ahibizz-business-import:${fixtureActor}`);
          assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
          return callback(held ? null : {});
        },
      },
    },
  });
  try {
    await browserImportLock(fixtureActor, controller.signal, async () => {
      actions++;
    });
    assert.equal(actions, 1);
    held = true;
    await assert.rejects(
      browserImportLock(fixtureActor, controller.signal, async () => {
        actions++;
      }),
      code("IMPORT_RUNNING"),
    );
    assert.equal(actions, 1);
    controller.abort();
    await assert.rejects(
      browserImportLock(fixtureActor, controller.signal, async () => {
        actions++;
      }),
      code("STOPPED"),
    );
    assert.equal(requests, 2);
  } finally {
    if (before) Object.defineProperty(globalThis, "navigator", before);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
test("a retry CAS conflict reconciles a late first commit without publishing twice", async () => {
  const env = setup(),
    file = await importFixture(),
    publish = env.api.publish.bind(env.api);
  let attempt = 0;
  env.api.publish = async (id, version) => {
    if (++attempt === 1) {
      env.api.noCommit = true;
      env.api.lost = "publish";
      try {
        return await publish(id, version);
      } finally {
        env.api.noCommit = false;
      }
    }
    await publish(id, version);
    throw new AdminRequestError(409, "BUSINESS_CHANGED");
  };
  await assert.rejects(runBusinessImport({ ...env, file }));
  const result = await runBusinessImport({ ...env, file });
  assert.equal(result.rows[0]?.stage, "done");
  assert.equal(result.rows[0]?.version, 2);
  assert.equal(attempt, 2);
});
test("only a fully terminal exact-file journal can be explicitly retired for another import", async () => {
  const env = setup(),
    file = await importFixture(),
    other = await importFixture({ title: "Novi uvoz" });
  env.api.lost = "create";
  await assert.rejects(runBusinessImport({ ...env, file }));
  const original = env.storage.getItem(importJournalKey(fixtureActor));
  assert.throws(
    () => retireCompletedImport(env.storage, fixtureActor, file),
    code("IMPORT_INCOMPLETE"),
  );
  assert.equal(env.storage.getItem(importJournalKey(fixtureActor)), original);
  await runBusinessImport({ ...env, file });
  assert.throws(
    () => retireCompletedImport(env.storage, fixtureActor, other),
    code("DIFFERENT_IMPORT"),
  );
  env.storage.values.set("unrelated", "preserved");
  retireCompletedImport(env.storage, fixtureActor, file);
  assert.equal(env.storage.getItem(importJournalKey(fixtureActor)), null);
  assert.equal(env.storage.getItem("unrelated"), "preserved");
});
test("malformed enum arrays and duplicate inventory IDs are rejected before mutation", async () => {
  const env = setup(),
    file = await importFixture();
  env.api.lost = "create";
  await assert.rejects(runBusinessImport({ ...env, file }));
  const original = env.storage.getItem(importJournalKey(fixtureActor)) as string;
  for (const mutation of [
    (j: { rows: [{ stage: unknown }]; pending: { kind: unknown } }) => {
      j.rows[0].stage = ["todo"];
    },
    (j: { rows: [{ stage: unknown }]; pending: { kind: unknown } }) => {
      j.pending.kind = ["create"];
    },
  ]) {
    const malformed = JSON.parse(original);
    mutation(malformed);
    env.storage.values.set(importJournalKey(fixtureActor), JSON.stringify(malformed));
    assert.throws(
      () => loadImportJournal(env.storage, fixtureActor, file),
      code("INVALID_JOURNAL"),
    );
  }
  env.storage.values.set(importJournalKey(fixtureActor), original);
  const read = env.api.inventory.bind(env.api);
  env.api.inventory = async (page, archived) => {
    const result = await read(page, archived);
    return result.items.length ? { ...result, items: [...result.items, ...result.items] } : result;
  };
  const count = env.api.calls.filter((c) => c.kind === "create").length;
  await assert.rejects(runBusinessImport({ ...env, file }), code("INVENTORY_CHANGED"));
  assert.equal(env.api.calls.filter((c) => c.kind === "create").length, count);
});
test("actual HTTP adapter closes paths, carries actor/receipt headers, and uses no cache or extracted credentials", async () => {
  const file = await importFixture(),
    calls: { path: string; init: RequestInit }[] = [];
  const memory = new ImportMemoryApi(),
    fields = {
      ...file.records[0]?.business,
      categoryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subcategoryId: null,
    } as Parameters<ImportMemoryApi["create"]>[0];
  const row = await memory.create(fields, "fixture");
  const client = businessImportClient(
    fixtureActor,
    new AbortController().signal,
    async (path, init = {}) => {
      calls.push({ path, init });
      return Response.json({ business: row });
    },
  );
  await client.create(fields, file.records[0]?.sourceId as string);
  const sent = calls[0];
  assert.ok(sent);
  assert.equal(sent.path, "/api/directory/mine");
  assert.equal(sent.init.credentials, "same-origin");
  assert.equal(sent.init.mode, "same-origin");
  assert.equal(sent.init.redirect, "error");
  assert.equal(sent.init.cache, "no-store");
  assert.equal(new Headers(sent.init.headers).get("X-AhiBizz-Account-ID"), fixtureActor);
  assert.equal(new Headers(sent.init.headers).get("Idempotency-Key"), file.records[0]?.sourceId);
  await assert.rejects(client.read("../../other"));
  assert.equal(calls.length, 1);
});
