import assert from "node:assert/strict";
import test from "node:test";
import { addressAtPoint, GEOCODING_ORIGIN, searchLocations } from "../src/lib/geocoding";

function collection(name = "Fixture servis", coordinates = [18.6671, 44.5384]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates },
        properties: {
          osm_type: "N",
          osm_id: 713,
          name,
          street: "Fixture ulica",
          housenumber: "12",
          city: "Tuzla",
          countrycode: "ba",
        },
      },
    ],
  };
}

test("search rejects blank, short and oversized queries before fetch and accepts the upper bound", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("q")?.length, 160);
    return Response.json({ type: "FeatureCollection", features: [] });
  });
  const signal = new AbortController().signal;
  for (const value of ["", "   ", "a", " ab ", "x".repeat(161)]) {
    assert.throws(() => searchLocations(value, signal), /invalid_search/);
  }
  assert.equal(calls, 0);
  assert.deepEqual(await searchLocations(`  ${"x".repeat(160)}  `, signal), []);
  assert.equal(calls, 1);
});

test("Photon search encodes a trimmed query, omits credentials and unsupported language, and maps the real envelope", async (t) => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const caller = new AbortController();
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, GEOCODING_ORIGIN);
    assert.equal(url.origin, "https://photon.komoot.io");
    assert.equal(url.pathname, "/api/");
    assert.deepEqual(
      [...url.searchParams],
      [
        ["q", "Fixture trg & ulica + 12?"],
        ["limit", "5"],
      ],
    );
    assert.equal(url.searchParams.has("lang"), false);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.referrerPolicy, "strict-origin-when-cross-origin");
    assert.ok(init?.signal);
    assert.notEqual(init.signal, caller.signal);
    signals.push(init.signal);
    const payload = collection();
    payload.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [181, 0] },
      properties: {
        ...payload.features[0]?.properties,
        osm_type: "N",
        osm_id: 714,
        name: "Outside coordinate range",
        street: "Fixture",
        housenumber: "1",
        city: "Tuzla",
        countrycode: "ba",
      },
    });
    return Response.json(payload);
  });
  const items = await searchLocations("  Fixture trg & ulica + 12?  ", caller.signal);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: "osm:N:713",
    label: "Fixture servis, Fixture ulica 12, Tuzla",
    addressLine: "Fixture ulica 12",
    city: "Tuzla",
    countryCode: "BA",
    point: { latitude: 44.5384, longitude: 18.6671 },
  });
  assert.deepEqual(
    await searchLocations("Fixture trg & ulica + 12?", new AbortController().signal),
    items,
  );
  assert.equal(calls, 1, "Repeated identical public searches reuse their cached result.");
  caller.abort();
  assert.equal(
    signals[0]?.aborted,
    false,
    "A completed request removes the caller's abort listener.",
  );
});

test("reverse lookup sends the exact zero coordinates and returns null rather than an invented address", async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, GEOCODING_ORIGIN);
    assert.equal(url.pathname, "/reverse");
    assert.equal(url.searchParams.has("lang"), false);
    assert.equal(url.searchParams.has("accuracy"), false);
    assert.equal(init?.credentials, "omit");
    if (url.searchParams.get("lat") === "0") {
      assert.deepEqual(
        [...url.searchParams],
        [
          ["lat", "0"],
          ["lon", "0"],
          ["limit", "1"],
        ],
      );
      return Response.json(collection("Zero fixture", [0, 0]));
    }
    assert.deepEqual(
      [...url.searchParams],
      [
        ["lat", "4"],
        ["lon", "5"],
        ["limit", "1"],
      ],
    );
    return Response.json({ type: "FeatureCollection", features: [] });
  });
  const signal = new AbortController().signal;
  const result = await addressAtPoint({ latitude: 0, longitude: 0, accuracy: 0 }, signal);
  assert.deepEqual(result?.point, { latitude: 0, longitude: 0 });
  assert.equal(result?.label, "Zero fixture, Fixture ulica 12, Tuzla");
  assert.equal(await addressAtPoint({ latitude: 4, longitude: 5 }, signal), null);
  await assert.rejects(addressAtPoint({ latitude: 91, longitude: 0 }, signal), /invalid_point/);
  assert.equal(calls.length, 2);
});

test("HTTP, network, oversized and malformed responses fail without caching a false success", async (t) => {
  let attempts = 0;
  let oversized: Response | undefined;
  const offline = new TypeError("Fixture network unavailable");
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const q = new URL(String(input)).searchParams.get("q");
    if (q === "fixture HTTP retry") {
      attempts++;
      return attempts === 1
        ? new Response("Unavailable", { status: 503 })
        : Response.json(collection());
    }
    if (q === "fixture oversized") {
      oversized = Response.json(collection(), { headers: { "content-length": "250001" } });
      return oversized;
    }
    if (q === "fixture malformed")
      return new Response("{invalid", { headers: { "content-type": "application/json" } });
    if (q === "fixture offline") throw offline;
    throw new Error("Unexpected mocked request");
  });
  const signal = new AbortController().signal;
  await assert.rejects(searchLocations("fixture HTTP retry", signal), /geocoding_unavailable/);
  assert.equal((await searchLocations("fixture HTTP retry", signal)).length, 1);
  assert.equal(attempts, 2);
  await assert.rejects(
    searchLocations("fixture oversized", signal),
    /geocoding_response_too_large/,
  );
  assert.equal(
    oversized?.bodyUsed,
    false,
    "An oversized declared body is rejected before reading.",
  );
  await assert.rejects(searchLocations("fixture malformed", signal), SyntaxError);
  await assert.rejects(
    searchLocations("fixture offline", signal),
    (error: unknown) => error === offline,
  );
});

test("caller cancellation aborts the linked fetch and an aborted search can be retried", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.signal);
    signals.push(init.signal);
    if (signals.length > 1) return Response.json(collection("Retried fixture"));
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Fixture cancelled", "AbortError")),
        { once: true },
      );
    });
  });
  const caller = new AbortController();
  const pending = searchLocations("fixture cancelled request", caller.signal);
  caller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(signals[0]?.aborted, true);
  assert.equal(
    (await searchLocations("fixture cancelled request", new AbortController().signal))[0]?.label,
    "Retried fixture, Fixture ulica 12, Tuzla",
  );
  assert.equal(signals.length, 2);
});

test("an already aborted uncached request rejects before fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("Fixture already cancelled", "AbortError");
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(searchLocations("fixture pre-aborted request", controller.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
});

test("a chunked body without content length is capped, cancelled and unlocked", async (t) => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        if (pulls <= 2) controller.enqueue(new Uint8Array(125000).fill(32));
        else if (pulls === 3) controller.enqueue(new Uint8Array([32]));
        else throw new Error("The response should not be read beyond the byte cap.");
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = new Response(stream, { headers: { "content-type": "application/json" } });
  assert.equal(response.headers.has("content-length"), false);
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(
    searchLocations("fixture chunked oversized", new AbortController().signal),
    /geocoding_response_too_large/,
  );
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
  assert.equal(response.body?.locked, false);
});

test("a valid chunked JSON body at the byte limit still parses", async (t) => {
  const bytes = new Uint8Array(250000).fill(32);
  bytes.set(new TextEncoder().encode(JSON.stringify(collection("Ž fixture boundary"))));
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 125000));
        controller.enqueue(bytes.subarray(125000));
        controller.close();
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  assert.equal(response.headers.has("content-length"), false);
  t.mock.method(globalThis, "fetch", async () => response);
  assert.equal(
    (await searchLocations("fixture exact byte boundary", new AbortController().signal))[0]?.label,
    "Ž fixture boundary, Fixture ulica 12, Tuzla",
  );
  assert.equal(response.body?.locked, false);
});

test("an aborted caller cannot receive a previously cached result", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(collection("Cached fixture"));
  });
  assert.equal(
    (await searchLocations("fixture cached abort", new AbortController().signal)).length,
    1,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(searchLocations("fixture cached abort", controller.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 1, "The aborted cache hit neither returns data nor starts another request.");
});
