import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVisualDesign,
  designCss,
  designTargets,
  homeCoverPhotos,
  parseVisualDesign,
} from "../src/lib/visual-design";

test("a published design preserves the actual homepage order, plain text, and independent theme scopes", () => {
  const model = defaultVisualDesign();
  model.homeOrder = [
    "nearby",
    "featured",
    "ad",
    "credits",
    "logos",
    "newest",
    "reels",
    "promotion",
  ];
  model.heroTitle = "Poslovi u Tuzli.";
  model.heroSubtitle = "Pronađi novu uslugu.";
  model.sectionTitles = { nearby: "U blizini" };
  model.rules["home-title"] = {
    base: { color: "#AABBCC" },
    mobile: { "font-size": "24px" },
    dark: { color: "#ffffff" },
    mobileDark: { "backdrop-filter": "blur(8px)" },
  };
  const safe = parseVisualDesign(model);
  assert.deepEqual(safe.homeOrder, model.homeOrder);
  assert.equal(safe.rules["home-title"]?.base?.color, "#aabbcc");
  const css = designCss(safe);
  assert.match(css, /@media\(max-width:760px\).*font-size:24px/);
  assert.ok(css.includes(':root[data-theme="dark"] [data-design="home-title"]{color:#ffffff}'));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce)"));
  assert.deepEqual(parseVisualDesign(defaultVisualDesign()), defaultVisualDesign());
  assert.equal(designCss(defaultVisualDesign()), "");
});

test("both previous homepage schemas read in the current order and retain active style and title customizations", () => {
  const base = defaultVisualDesign();
  const expectedOrder = [
    "ad",
    "reels",
    "newest",
    "nearby",
    "promotion",
    "logos",
    "credits",
    "featured",
  ];
  assert.deepEqual(base.homeOrder, expectedOrder);
  for (const homeOrder of [
    ["nearby", "featured", "ad", "credits", "logos"],
    ["featured", "ad", "categoryFeatured", "nearby", "promotion", "logos", "credits", "community"],
  ]) {
    const stored = {
      ...base,
      homeOrder,
      heroTitle: "Moja naslovna",
      sectionTitles: {
        nearby: "Lokalne usluge",
        categoryFeatured: "Kategorija",
        community: "Zajednica",
      },
      rules: {
        "home-nearby": { mobile: { "background-color": "#112233" } },
        "home-community": { base: { color: "#223344" } },
      },
    };
    const parsed = parseVisualDesign(stored);
    assert.deepEqual(parsed.homeOrder, expectedOrder);
    assert.deepEqual(parsed.sectionTitles, { nearby: "Lokalne usluge" });
    assert.deepEqual(parsed.rules, stored.rules);
    assert.equal(parsed.heroTitle, "Moja naslovna");
    assert.deepEqual(stored.homeOrder, homeOrder);
  }
  assert.ok(designTargets.some(({ id }) => id === "home-reels"));
  assert.ok(designTargets.some(({ id }) => id === "home-newest"));
});

test("the homepage uses only registered photos and retains its original cover for older designs", () => {
  const saved = defaultVisualDesign();
  delete saved.heroImage;
  assert.equal(parseVisualDesign(saved).heroImage, "community");
  for (const id of Object.keys(homeCoverPhotos)) {
    assert.equal(parseVisualDesign({ ...saved, heroImage: id }).heroImage, id);
  }
  for (const value of [
    "",
    "//other.invalid/a.webp",
    "/api/people/me/media/photo",
    "constructor",
    null,
  ]) {
    assert.throws(() => parseVisualDesign({ ...saved, heroImage: value }), /INVALID_VISUAL_DESIGN/);
  }
});

test("only registered selectors, variants, properties and bounded values enter the stylesheet", () => {
  const bad = [
    { "body, a": { base: { color: "#000000" } } },
    { "app-header": { print: {} } },
    { "app-header": { base: { background: "url(https://example.invalid)" } } },
    { "app-header": { base: { color: "#000000;} body{visibility:hidden" } } },
    { "app-header": { base: { "padding-inline": "-1px" } } },
    { "app-header": { base: { "font-size": "73px" } } },
    { "app-header": { dark: { "backdrop-filter": "url(#node)" } } },
    JSON.parse('{"__proto__":{"base":{"color":"#000000"}}}'),
  ];
  for (const rules of bad)
    assert.throws(
      () => parseVisualDesign({ ...defaultVisualDesign(), rules }),
      /INVALID_VISUAL_DESIGN/,
    );
});
test("glass, typography, image alignment and spacing use curated CSS values in the published theme", () => {
  const model = defaultVisualDesign();
  model.rules["directory-card"] = {
    base: { "background-color": "#ffffffbc", "border-width": "2px", gap: "10px" },
  };
  model.rules["home-photo"] = {
    mobileDark: { "object-position": "top right", "object-fit": "contain" },
  };
  model.rules["home-title"] = {
    dark: { "font-family": "Georgia, serif", "text-align": "center", "margin-top": "14px" },
  };
  const css = designCss(model);
  assert.ok(css.includes("--ui-surface:#ffffffbc"));
  assert.ok(css.includes("border-style:solid"));
  assert.ok(css.includes("object-position:top right"));
  assert.ok(css.includes("font-family:Georgia, serif"));
  model.rules["home-title"] = { base: { color: "#ffffff00" } };
  assert.throws(() => designCss(model), /INVALID_VISUAL_DESIGN/);
});

test("disallowed home markup, unknown sections and duplicates cannot be published", () => {
  const base = defaultVisualDesign();
  for (const change of [
    { heroTitle: " " },
    { heroTitle: "</style>" },
    { heroSubtitle: null },
    { sectionTitles: { cart: "Naplati" } },
    { sectionTitles: { nearby: "a".repeat(76) } },
    { homeOrder: ["featured", "ad", "nearby", "logos", "logos"] },
    { homeOrder: ["nearby"] },
    { html: "<i>besplatno</i>" },
  ])
    assert.throws(() => parseVisualDesign({ ...base, ...change }), /INVALID_VISUAL_DESIGN/);
});

test("global content styles share the registered selectors and retain device and theme variants", () => {
  const design = defaultVisualDesign();
  const ids = [
    "app-page",
    "app-headings",
    "app-copy",
    "app-labels",
    "app-fields",
    "app-buttons",
    "app-links",
  ];
  for (const id of ids) {
    const target = designTargets.find((candidate) => candidate.id === id);
    assert.ok(target);
    assert.equal(target.screen, "global");
    assert.ok(target.selector.startsWith(":where(main)"));
    design.rules[id] = { base: { color: "#223344" }, mobileDark: { color: "#abcdef" } };
  }
  design.rules["home-title"] = { base: { color: "#123456" } };
  const css = designCss(design);
  assert.equal((css.match(/color:#abcdef/g) || []).length, ids.length);
  for (const id of ids) {
    const selector = designTargets
      .find((target) => target.id === id)
      ?.selector.replace(":where(main)", "body main:not([hidden])");
    assert.ok(css.includes(`:root ${selector}{color:#223344}`));
    assert.ok(css.includes(`:root:where([data-theme="dark"]) ${selector}{color:#abcdef}`));
  }
  assert.ok(
    css.includes(
      ':root :is([data-design="home-title"],body main:not([hidden]) [data-design="home-title"]){color:#123456}',
    ),
  );
});
