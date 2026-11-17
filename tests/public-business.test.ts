import assert from "node:assert/strict";
import test from "node:test";
import {
  businessContactLinks,
  businessDirections,
  businessLocationLabel,
  type PublicBusinessView,
  publicBusinessPoint,
} from "../src/lib/public-business";
import { publicBusinessView } from "../src/server/directory/public-view";

function business(patch: Partial<PublicBusinessView> = {}): PublicBusinessView {
  return {
    id: "fixture-business",
    title: "Fixture business",
    categoryName: null,
    subcategoryName: null,
    description: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    addressLine: null,
    city: null,
    countryCode: null,
    latitude: null,
    longitude: null,
    verified: false,
    ...patch,
  };
}

test("contact actions use only the explicit business contacts, with safe normalized links", () => {
  const view = business({
    contactPhone: " +387 (61) 123-456 ",
    contactEmail: " kontakt@fixture.invalid ",
    websiteUrl: "https://fixture.invalid/posao?lang=bs#kontakt",
  });
  assert.deepEqual(businessContactLinks(view), {
    phone: "tel:+38761123456",
    email: "mailto:kontakt%40fixture.invalid",
    website: "https://fixture.invalid/posao?lang=bs#kontakt",
  });
  assert.deepEqual(businessContactLinks(business()), { phone: null, email: null, website: null });
});

test("website actions reject executable/custom schemes, credentials and control-character URLs", () => {
  for (const websiteUrl of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>bad</script>",
    "vbscript:bad",
    "file:///private",
    "intent://fixture.invalid",
    "mailto:a@fixture.invalid",
    "http://fixture.invalid",
    "//fixture.invalid",
    "https://user:secret@fixture.invalid/",
    "https://user@fixture.invalid/",
    "https://fixture.invalid/with space",
    "https://fixture.invalid/\npath",
    "not a URL",
  ])
    assert.equal(businessContactLinks(business({ websiteUrl })).website, null, websiteUrl);
  assert.equal(
    businessContactLinks(business({ websiteUrl: "https://fixture.invalid/with%20space" })).website,
    "https://fixture.invalid/with%20space",
  );
});

test("email links reject malformed/multiple contacts and encode URI delimiters rather than headers", () => {
  for (const contactEmail of [
    "not-an-email",
    "a@fixture",
    "a@@fixture.invalid",
    "a b@fixture.invalid",
    "a@fixture.invalid,b@fixture.invalid",
    "a@fixture.invalid;b@fixture.invalid",
    "<a@fixture.invalid>",
    "a@fixture.invalid\r\nBcc:other@fixture.invalid",
    `${"a".repeat(250)}@fixture.invalid`,
  ])
    assert.equal(businessContactLinks(business({ contactEmail })).email, null);
  // Special characters in a valid local part must not become mailto query/header fields.
  const contactEmail = "a+tag?subject=hello&cc=other#fragment@fixture.invalid";
  const link = businessContactLinks(business({ contactEmail })).email;
  assert.ok(link);
  const url = new URL(link);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  assert.equal(decodeURIComponent(url.pathname), contactEmail);
});

test("phone links reject commands, extra pluses, injection and formatting with no number", () => {
  for (const contactPhone of [
    "javascript:alert(1)",
    "call 123456",
    "tel:+38761123456",
    "+387+61123456",
    "+38761123456?x=1",
    "+38761123456\r\nother",
    "+---",
    "+...",
    "+ ( )",
    "1".repeat(41),
  ])
    assert.equal(businessContactLinks(business({ contactPhone })).phone, null, contactPhone);
});

test("public points preserve zero and coordinate boundaries without creating missing coordinates", () => {
  for (const [latitude, longitude] of [
    [0, 0],
    [-90, -180],
    [90, 180],
    [44.5384, 18.6671],
  ]) {
    assert.deepEqual(publicBusinessPoint(business({ latitude, longitude })), {
      latitude,
      longitude,
    });
  }
  for (const [latitude, longitude] of [
    [null, 0],
    [0, null],
    [91, 0],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])
    assert.equal(publicBusinessPoint(business({ latitude, longitude })), null);
  assert.equal(publicBusinessPoint(business()), null);
});

test("location labels retain supplied address/city, remove duplicates and do not infer a city from the title", () => {
  assert.equal(
    businessLocationLabel(business({ addressLine: "  Fixture ulica 12  ", city: " Tuzla " })),
    "Fixture ulica 12, Tuzla",
  );
  assert.equal(businessLocationLabel(business({ addressLine: "TUZLA", city: "Tuzla" })), "Tuzla");
  assert.equal(businessLocationLabel(business({ city: "Tuzla" })), "Tuzla");
  assert.equal(
    businessLocationLabel(business({ title: "Tuzla restaurant", addressLine: "  ", city: " " })),
    "Lokacija nije unesena.",
  );
  assert.equal(
    businessLocationLabel(business({ countryCode: "invalid" })),
    "Lokacija nije unesena.",
  );
  const country = new Intl.DisplayNames(["bs"], { type: "region" }).of("BA");
  assert.equal(businessLocationLabel(business({ countryCode: " ba " })), country);
});

test("Google directions use the business destination, a closed mode and no origin/GPS query", () => {
  const view = business({
    latitude: 44.5384,
    longitude: 18.6671,
    addressLine: "Not used as a coordinate",
  });
  for (const mode of ["driving", "walking"] as const) {
    const link = businessDirections(view, mode);
    assert.ok(link);
    const url = new URL(link);
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/maps/dir/");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["api", "destination", "travelmode"]);
    assert.equal(url.searchParams.get("api"), "1");
    assert.equal(url.searchParams.get("destination"), "44.5384,18.6671");
    assert.equal(url.searchParams.get("travelmode"), mode);
    assert.equal(url.searchParams.has("origin"), false);
    assert.equal(url.username, "");
    assert.equal(url.password, "");
  }
  const zero = businessDirections(business({ latitude: 0, longitude: 0 }), "walking");
  assert.ok(zero);
  assert.equal(new URL(zero).searchParams.get("destination"), "0,0");
});

test("unknown/invalid coordinates never become a directions link or a guessed address destination", () => {
  for (const [latitude, longitude] of [
    [null, null],
    [0, null],
    [null, 0],
    [91, 0],
    [0, Number.NaN],
  ]) {
    assert.equal(
      businessDirections(
        business({ latitude, longitude, addressLine: "Known street", city: "Tuzla" }),
        "driving",
      ),
      null,
    );
  }
  assert.equal(
    businessDirections(business({ latitude: 0, longitude: 0 }), "transit" as "walking"),
    null,
  );
});

test("public business formatting never changes the supplied view", () => {
  const view = business({
    latitude: 0,
    longitude: 0,
    city: "Tuzla",
    contactPhone: "+38761123456",
    websiteUrl: "https://fixture.invalid",
  });
  const before = structuredClone(view);
  businessContactLinks(view);
  businessLocationLabel(view);
  publicBusinessPoint(view);
  businessDirections(view, "driving");
  assert.deepEqual(view, before);
});

test("directory projection exposes only public fields and resolves the supplied category names", () => {
  const row = {
    id: "actual-business",
    title: "Supplied business title",
    categoryId: "actual-category",
    subcategoryId: "actual-subcategory",
    description: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    addressLine: null,
    city: null,
    countryCode: null,
    latitude: 0,
    longitude: 0,
    verified: false,
    featured: true,
    createdAt: "2026-11-13T10:00:00.000Z",
    publishedAt: "2026-11-13T11:00:00.000Z",
    ownerId: "private-owner",
    role: "owner",
    status: "published",
    version: 7,
    sessionToken: "private-fixture-token",
    image: { src: "/preview-only-image.jpg", alt: "Not a directory image" },
    logo: { src: "/preview-only-logo.jpg", alt: "Not a directory logo" },
  };
  const categories = [
    { id: "unrelated-category", name: "Not a fallback", slug: "other", parentId: null },
    { id: "actual-category", name: "Stvarna kategorija", slug: "actual", parentId: null },
    {
      id: "actual-subcategory",
      name: "Stvarna potkategorija",
      slug: "actual-child",
      parentId: "actual-category",
    },
  ];
  assert.deepEqual(
    publicBusinessView(row, categories),
    business({
      id: row.id,
      title: row.title,
      categoryName: "Stvarna kategorija",
      subcategoryName: "Stvarna potkategorija",
      latitude: 0,
      longitude: 0,
      details: null,
      reviews: { count: 0, sum: 0 },
    }),
  );
  // Missing taxonomy and contacts stay unknown; verification comes from the actual row only.
  assert.deepEqual(
    publicBusinessView({ ...row, verified: true }, []),
    business({
      id: row.id,
      title: row.title,
      latitude: 0,
      longitude: 0,
      verified: true,
      details: null,
      reviews: { count: 0, sum: 0 },
    }),
  );
});
