import assert from "node:assert/strict";
import test from "node:test";
import {
  bamToEuroMinor,
  firstAvailablePromotionStart,
  isPromotionDuration,
  isPromotionKind,
  isPromotionReference,
  promotionCapacity,
  promotionDurations,
  promotionKinds,
  promotionMoney,
  promotionPrices,
  promotionStatusLabel,
} from "../src/lib/promotions";
import { readPromotionBank } from "../src/server/promotions/bank";
import { createPromotionsHttpHandler } from "../src/server/promotions/http";
import { createPromotionReference, type PromotionsService } from "../src/server/promotions/service";

const date = (day: number) => new Date(Date.UTC(2030, 0, day)).toISOString();

test("the four promotion kinds have exact capacities, durations and initial KM prices", () => {
  assert.deepEqual(promotionKinds, ["home", "nearby", "category", "banner"]);
  assert.deepEqual(promotionDurations, [7, 14, 30]);
  assert.deepEqual(promotionCapacity, { home: 6, nearby: 3, category: 3, banner: 1 });
  assert.deepEqual(
    promotionKinds.map((kind) =>
      promotionPrices.filter((row) => row.kind === kind).map((row) => row.amountBamMinor),
    ),
    [
      [2500, 4500, 8000],
      [1500, 2500, 4500],
      [1000, 1800, 3000],
      [4000, 7000, 12000],
    ],
  );
  for (const value of ["featured", "credits", "constructor", null, 7])
    assert.equal(isPromotionKind(value), false);
  for (const value of [0, 1, 8, 15, 31, "7", null]) assert.equal(isPromotionDuration(value), false);
});

test("payment references are unique opaque AHI references with exactly 32 lowercase hex characters", () => {
  const references = new Set(Array.from({ length: 256 }, () => createPromotionReference()));
  assert.equal(references.size, 256);
  for (const value of references) assert.equal(isPromotionReference(value), true);
  for (const value of [
    "AHI-",
    `AHI-${"a".repeat(31)}`,
    `AHI-${"a".repeat(33)}`,
    `AHI-${"G".repeat(32)}`,
    `ahi-${"a".repeat(32)}`,
    `${createPromotionReference()}\n`,
    null,
  ])
    assert.equal(isPromotionReference(value), false);
});

test("EUR uses the fixed 1.95583 rate and rounds once to cents", () => {
  for (const [bam, eur] of [
    [0, 0],
    [1, 1],
    [1000, 511],
    [1800, 920],
    [2500, 1278],
    [8000, 4090],
    [12000, 6136],
  ])
    assert.equal(bamToEuroMinor(bam as number), eur);
  assert.equal(promotionMoney(2500), "25,00 KM");
  assert.equal(promotionMoney(1278, "EUR"), "12,78 EUR");
});

test("an empty slot begins on the requested date and exact end boundaries do not overlap", () => {
  assert.deepEqual(firstAvailablePromotionStart([], date(1), 7, 1), {
    available: true,
    firstAvailableAt: date(1),
    capacity: 1,
  });
  assert.equal(
    firstAvailablePromotionStart([{ startsAt: date(1), endsAt: date(8) }], date(8), 7, 1).available,
    true,
  );
  assert.equal(
    firstAvailablePromotionStart([{ startsAt: date(8), endsAt: date(15) }], date(1), 7, 1)
      .available,
    true,
  );
});

test("full periods offer the earliest whole-duration slot, including chains of reservations", () => {
  const reservations = [
    { startsAt: date(1), endsAt: date(8) },
    { startsAt: date(10), endsAt: date(17) },
  ];
  assert.deepEqual(firstAvailablePromotionStart(reservations, date(2), 7, 1), {
    available: false,
    firstAvailableAt: date(17),
    capacity: 1,
  });
  assert.deepEqual(firstAvailablePromotionStart(reservations, date(2), 7, 2), {
    available: true,
    firstAvailableAt: date(2),
    capacity: 2,
  });
});

test("capacity counts simultaneous intervals rather than all orders that intersect the request", () => {
  const reservations = [
    { startsAt: date(1), endsAt: date(3) },
    { startsAt: date(3), endsAt: date(5) },
    { startsAt: date(5), endsAt: date(8) },
  ];
  assert.equal(firstAvailablePromotionStart(reservations, date(1), 7, 2).available, true);
  const full = [...reservations, { startsAt: date(4), endsAt: date(6) }];
  assert.equal(firstAvailablePromotionStart(full, date(1), 7, 2).firstAvailableAt, date(6));
  for (const capacity of [0, -1, 1.5])
    assert.throws(() => firstAvailablePromotionStart([], date(1), 7, capacity));
  assert.throws(() => firstAvailablePromotionStart([], "invalid", 7, 1));
});

test("status labels distinguish pending, scheduled, active, finished and cancelled", () => {
  const order = { startsAt: date(3), endsAt: date(10), status: "active" as const };
  assert.equal(promotionStatusLabel(order, Date.parse(date(1))), "Zakazano");
  assert.equal(promotionStatusLabel(order, Date.parse(date(3))), "Aktivno");
  assert.equal(promotionStatusLabel(order, Date.parse(date(10))), "Završeno");
  assert.equal(
    promotionStatusLabel({ ...order, status: "pending" }, Date.parse(date(3))),
    "Na čekanju",
  );
  assert.equal(
    promotionStatusLabel({ ...order, status: "cancelled" }, Date.parse(date(3))),
    "Otkazano",
  );
  assert.equal(
    promotionStatusLabel({ ...order, status: "completed" }, Date.parse(date(3))),
    "Završeno",
  );
});

// Public SWIFT IBAN format example. Never production receiving instructions.
const bankInput = (recipient: string) =>
  JSON.stringify({
    enabled: true,
    commercialConfirmed: true,
    recipient,
    bank: {
      id: "fixture",
      label: "Probni račun",
      name: "Fixture bank",
      currency: "EUR",
      iban: "GB82 WEST 1234 5698 7654 32",
    },
  });
test("bank configuration uses the new key first, falls back to the existing key, and otherwise closes purchases", () => {
  assert.equal(readPromotionBank({}), null);
  assert.equal(
    readPromotionBank({ AHIBIZZ_CREDIT_BANK_TRANSFER: bankInput("Stari ključ") })?.recipient,
    "Stari ključ",
  );
  assert.equal(
    readPromotionBank({
      AHIBIZZ_BANK_TRANSFER: bankInput("Novi ključ"),
      AHIBIZZ_CREDIT_BANK_TRANSFER: bankInput("Stari ključ"),
    })?.recipient,
    "Novi ključ",
  );
  assert.equal(
    readPromotionBank({
      AHIBIZZ_BANK_TRANSFER: "broken",
      AHIBIZZ_CREDIT_BANK_TRANSFER: bankInput("Stari ključ"),
    }),
    null,
  );
  assert.equal(
    readPromotionBank({
      AHIBIZZ_BANK_TRANSFER: bankInput("Test").replace(
        '"commercialConfirmed":true',
        '"commercialConfirmed":false',
      ),
    }),
    null,
  );
});

test("Play rejects every purchase API without invoking a service, while public banner images remain readable", async () => {
  const invoked: string[] = [];
  const service = new Proxy(
    {},
    {
      get: (_target, key) => async () => {
        invoked.push(String(key));
        return new Uint8Array([1, 2]);
      },
    },
  ) as PromotionsService;
  const http = createPromotionsHttpHandler({
    service,
    baseURL: "https://fixture.invalid",
    play: true,
  });
  for (const [method, path] of [
    ["GET", "/api/promotions"],
    ["POST", "/api/promotions"],
    ["GET", "/api/promotions/availability"],
    ["POST", "/api/admin/promotions/manual"],
    ["PUT", "/api/admin/promotions/prices"],
    ["PUT", "/api/promotions/11111111-1111-4111-8111-111111111111/image"],
    ["POST", "/api/promotions/11111111-1111-4111-8111-111111111111/cancel"],
  ]) {
    const result = await http(new Request(`https://fixture.invalid${path}`, { method }));
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(invoked, []);
  const image = await http(
    new Request(
      "https://fixture.invalid/api/promotions/11111111-1111-4111-8111-111111111111/image",
    ),
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(invoked, ["image"]);
});

test("web writes reject foreign origins, unsupported image types and unexpected JSON before dispatch", async () => {
  let writes = 0;
  const http = createPromotionsHttpHandler({
    service: {
      create: async () => {
        writes++;
      },
    } as unknown as PromotionsService,
    baseURL: "https://fixture.invalid",
    play: false,
  });
  assert.equal(
    (
      await http(
        new Request("https://fixture.invalid/api/promotions", {
          method: "POST",
          headers: { origin: "https://other.invalid" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        new Request(
          "https://fixture.invalid/api/promotions/11111111-1111-4111-8111-111111111111/image",
          {
            method: "PUT",
            headers: { origin: "https://fixture.invalid", "content-type": "image/svg+xml" },
            body: "<svg/>",
          },
        ),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await http(
        new Request("https://fixture.invalid/api/promotions", {
          method: "POST",
          headers: { origin: "https://fixture.invalid", "content-type": "application/json" },
          body: "{",
        }),
      )
    ).status,
    400,
  );
  assert.equal(writes, 0);
});
