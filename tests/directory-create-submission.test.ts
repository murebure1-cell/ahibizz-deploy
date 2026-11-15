import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDirectoryCreation,
  DirectoryCreationPendingError,
  DirectoryRequestError,
} from "../src/lib/directory-create-submission";
import type { DirectoryService } from "../src/server/directory";
import { DirectoryAccessError, type DirectoryBusiness } from "../src/server/directory/types";
import { businessInput, uuid } from "../src/server/directory/validation";
import { createDirectoryHttpHandler } from "../src/server/directory-http";

const baseURL = "https://create-fixture.ahibizz.invalid";
const fields = {
  title: "Fixture business",
  categoryId: "11111111-1111-4111-8111-111111111111",
  subcategoryId: null,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  addressLine: null,
  city: "Fixture city",
  countryCode: "BA",
  latitude: null,
  longitude: null,
  bookingEnabled: true,
};

test("concurrent authority loss preserves a dispatched create after its later first denial", async () => {
  const creation = createDirectoryCreation();
  const command = creation.begin(fields, false);
  let reject!: (failure: unknown) => void;
  const pending = creation.send(
    command,
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  assert.equal(creation.retainUncertain(), command);
  reject(new DirectoryRequestError("AUTHENTICATION_REQUIRED", 401));
  await assert.rejects(pending);
  assert.equal(creation.intent, command);
  const row = { id: "same-business", version: 1 } as DirectoryBusiness;
  const recovered = await creation.send(command, async (options) => {
    assert.equal(options.body, command.body);
    assert.equal(new Headers(options.headers).get("Idempotency-Key"), command.key);
    return { business: row };
  });
  assert.equal(recovered.id, "same-business");
  assert.equal(creation.intent, null);
});

/** Isolated receipts behind the actual HTTP and input boundaries; no fetch or real database. */
function fixture() {
  const rows = new Map<string, DirectoryBusiness>();
  const receipts = new Map<string, { body: string; id: string }>();
  const calls: { key: string; body: string }[] = [];
  const service = {
    async create(_headers: Headers, input: unknown, requestId: string) {
      const value = businessInput(input, true);
      const key = uuid(requestId);
      const body = JSON.stringify(value);
      const previous = receipts.get(key);
      if (previous) {
        if (previous.body !== body) throw new DirectoryAccessError(409, "IDEMPOTENCY_CONFLICT");
        return rows.get(previous.id);
      }
      const createdAt = "2030-01-01T00:00:00.000Z";
      const business = {
        ...value,
        id: randomUUID(),
        ownerId: "fixture-owner",
        status: "draft",
        version: 1,
        verified: false,
        featured: false,
        createdAt,
        updatedAt: createdAt,
        publishedAt: null,
        archivedAt: null,
      } as DirectoryBusiness;
      rows.set(business.id, business);
      receipts.set(key, { body, id: business.id });
      return business;
    },
  } as DirectoryService;
  const http = createDirectoryHttpHandler({ service, baseURL });
  const request = async (options: RequestInit): Promise<unknown> => {
    const headers = new Headers(options.headers);
    headers.set("origin", baseURL);
    calls.push({ key: headers.get("Idempotency-Key") ?? "", body: String(options.body) });
    const response = await http(
      new Request(`${baseURL}/api/directory/mine`, { ...options, headers }),
    );
    const data = await response.json();
    if (!response.ok) throw new DirectoryRequestError(data.code, response.status);
    return data;
  };
  return { request, calls, rows };
}

test("lost business acknowledgement survives later login failure and preserves one exact create command", async () => {
  const { request, calls, rows } = fixture();
  const creation = createDirectoryCreation();
  const originalFields = { ...fields };
  const intent = creation.begin(originalFields, true);
  await assert.rejects(
    creation.send(intent, async (options) => {
      await request(options);
      throw new TypeError("Lost response after committing the isolated fixture.");
    }),
  );
  originalFields.title = "Changed title";
  originalFields.bookingEnabled = false;
  assert.equal(rows.size, 1);
  assert.equal(intent.fields.title, fields.title);
  assert.equal(intent.fields.bookingEnabled, true);
  assert.equal(intent.publish, true);
  assert.equal(JSON.parse(intent.body).bookingEnabled, undefined);
  await assert.rejects(
    creation.send(intent, async () => {
      throw new DirectoryRequestError("AUTHENTICATION_REQUIRED", 401);
    }),
  );
  assert.equal(creation.intent, intent);
  assert.throws(() => creation.begin(originalFields, false), DirectoryCreationPendingError);
  const recovered = await creation.send(intent, request);
  assert.equal(recovered.id, [...rows.keys()][0]);
  assert.equal(recovered.title, fields.title);
  assert.equal(rows.size, 1);
  assert.equal(new Set(calls.map((call) => call.key)).size, 1);
  assert.equal(new Set(calls.map((call) => call.body)).size, 1);
  assert.equal(creation.intent, null);
  const next = creation.begin(originalFields, false);
  assert.notEqual(next.key, intent.key);
  await creation.send(next, request);
  assert.equal(rows.size, 2);
});

test("initial and later proxy timeouts never release an uncertain business creation", async () => {
  for (const committed of [false, true]) {
    const { request, rows } = fixture();
    const creation = createDirectoryCreation();
    const intent = creation.begin(fields, false);
    await assert.rejects(
      creation.send(intent, async (options) => {
        if (committed) await request(options);
        throw new DirectoryRequestError("DIRECTORY_UNAVAILABLE", committed ? 503 : 408);
      }),
    );
    await assert.rejects(
      creation.send(intent, async () => {
        throw new DirectoryRequestError("DIRECTORY_UNAVAILABLE", 408);
      }),
    );
    assert.equal(creation.intent, intent);
    assert.throws(() => creation.begin(fields, true), DirectoryCreationPendingError);
    await creation.send(intent, request);
    assert.equal(rows.size, 1);
  }
});

test("a definitive first rejection releases the create command without writing a business", async () => {
  const { request, rows } = fixture();
  const creation = createDirectoryCreation();
  const invalid = creation.begin({ ...fields, categoryId: "invalid" }, false);
  await assert.rejects(
    creation.send(invalid, request),
    (failure) => failure instanceof DirectoryRequestError && failure.status === 400,
  );
  assert.equal(creation.intent, null);
  assert.equal(rows.size, 0);
  const corrected = creation.begin(fields, false);
  await creation.send(corrected, request);
  assert.notEqual(corrected.key, invalid.key);
  assert.equal(rows.size, 1);
});

test("in-flight and malformed acknowledgements cannot replace the pending business creation", async () => {
  const { request, rows } = fixture();
  const creation = createDirectoryCreation();
  const intent = creation.begin(fields, false);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = creation.send(intent, async (options) => {
    await request(options);
    await gate;
    return { business: { id: "", version: 0 } };
  });
  assert.throws(() => creation.begin(fields, true), DirectoryCreationPendingError);
  await assert.rejects(creation.send(intent, request), DirectoryCreationPendingError);
  assert.ok(release);
  release();
  await assert.rejects(pending, /unconfirmed_business_creation/);
  assert.equal(creation.intent, intent);
  assert.equal(rows.size, 1);
  await creation.send(intent, request);
  assert.equal(rows.size, 1);
  assert.equal(creation.intent, null);
});
