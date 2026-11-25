import assert from "node:assert/strict";
import test from "node:test";
import { wwwAliasBootstrap } from "../src/lib/origin-alias";

function visit(script: string, href: string) {
  const url = new URL(href);
  const replaced: string[] = [];
  const location = {
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace: (next: string) => replaced.push(next),
  };
  new Function("location", script)(location);
  return replaced;
}

test("the www alias is sent to the same page on the configured address and nothing else moves", () => {
  const script = wwwAliasBootstrap("https://fixture.example.invalid");
  assert.ok(script);
  assert.deepEqual(
    visit(script, "https://www.fixture.example.invalid/prijava?nastavi=%2Fnalog#uredi"),
    ["https://fixture.example.invalid/prijava?nastavi=%2Fnalog#uredi"],
  );
  assert.deepEqual(visit(script, "https://www.fixture.example.invalid/"), [
    "https://fixture.example.invalid/",
  ]);
  for (const href of [
    "https://fixture.example.invalid/prijava",
    "https://www2.fixture.example.invalid/",
    "https://www.fixture.example.invalid.evil.invalid/",
    "https://admin.fixture.example.invalid/",
  ])
    assert.deepEqual(visit(script, href), [], href);
});

test("a missing, unusual or unsafe configured origin produces no script", () => {
  for (const origin of [
    null,
    undefined,
    "",
    "fixture.example.invalid",
    "http://fixture.example.invalid",
    "https://fixture.example.invalid:8443",
    "https://fixture.example.invalid/",
    "https://fixture.example.invalid/path",
    "https://fixture.example.invalid?x=1",
    "https://www.fixture.example.invalid",
    "https://localhost",
    "https://FIXTURE.example.invalid",
    'https://fixture.example.invalid"+alert(1)+"',
    "https://fixture.example.invalid</script>",
  ])
    assert.equal(wwwAliasBootstrap(origin), null, String(origin));
});

test("a broken location never throws into the page", () => {
  const script = wwwAliasBootstrap("https://fixture.example.invalid");
  assert.ok(script);
  assert.doesNotThrow(() => new Function("location", script)(undefined));
});
