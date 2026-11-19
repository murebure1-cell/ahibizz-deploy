import assert from "node:assert/strict";
import test from "node:test";
import { loadPayPalCardSdk, type Sdk } from "../src/lib/paypal-card-sdk";

class Script extends EventTarget {
  src = "";
  async = false;
  removed = false;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  remove() {
    this.removed = true;
  }
}
function fakeBrowser() {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const scripts: Script[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const win: Record<string, unknown> = {
    setTimeout(callback: () => void, delay: number) {
      assert.equal(delay, 15000);
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  const doc = {
    createElement(tag: string) {
      assert.equal(tag, "script");
      return new Script();
    },
    head: {
      appendChild(script: Script) {
        scripts.push(script);
      },
    },
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  const sdk: Sdk = {
    createInstance: async () => ({
      findEligibleMethods: async () => ({ isEligible: () => true }),
      createPayPalGuestOneTimePaymentSession: () => ({ start: async () => {}, destroy: () => {} }),
    }),
  };
  return {
    scripts,
    timers,
    sdk,
    load(script: Script, value: unknown = sdk) {
      const namespace = script.attributes.get("data-namespace");
      assert.ok(namespace);
      win[namespace] = value;
      script.dispatchEvent(new Event("load"));
    },
    restore() {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
      else Reflect.deleteProperty(globalThis, "document");
    },
  };
}
async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

test("SDK loader validates ID and abort before touching browser", async () => {
  const controller = new AbortController();
  for (const invalid of ["", "abc&secret=x", "https://evil.invalid", "x".repeat(257)])
    await assert.rejects(loadPayPalCardSdk(invalid, controller.signal), /INVALID_CLIENT_ID/);
  controller.abort();
  await assert.rejects(loadPayPalCardSdk("publicFixture", controller.signal), {
    name: "AbortError",
  });
});
test("SDK deduplicates configuration and loads only the official v6 core", async () => {
  const browser = fakeBrowser();
  try {
    const first = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    const second = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    await tick();
    assert.equal(browser.scripts.length, 1);
    const script = browser.scripts[0];
    assert.ok(script);
    assert.equal(script.src, "https://www.paypal.com/web-sdk/v6/core");
    assert.equal(script.async, true);
    assert.ok(script.attributes.get("data-namespace")?.startsWith("ahiPayPalCard_"));
    browser.load(script);
    assert.equal(await first, browser.sdk);
    assert.equal(await second, browser.sdk);
    assert.equal(
      await loadPayPalCardSdk("publicFixture", new AbortController().signal),
      browser.sdk,
    );
    assert.equal(browser.scripts.length, 1);
    assert.equal(browser.timers.size, 0);
    assert.equal(script.removed, false);
  } finally {
    browser.restore();
  }
});
test("sandbox and live core scripts use separate namespaces and exact provider origins", async () => {
  const browser = fakeBrowser();
  try {
    const first = loadPayPalCardSdk("merchantOne", new AbortController().signal, "sandbox");
    const second = loadPayPalCardSdk("merchantTwo", new AbortController().signal);
    await tick();
    const a = browser.scripts[0],
      b = browser.scripts[1];
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.src, "https://www.sandbox.paypal.com/web-sdk/v6/core");
    assert.equal(b.src, "https://www.paypal.com/web-sdk/v6/core");
    assert.notEqual(a.attributes.get("data-namespace"), b.attributes.get("data-namespace"));
    browser.load(a);
    browser.load(b);
    await Promise.all([first, second]);
  } finally {
    browser.restore();
  }
});
test("abort detaches one subscriber without harming shared SDK or another subscriber", async () => {
  const browser = fakeBrowser();
  try {
    const controller = new AbortController();
    const first = loadPayPalCardSdk("publicFixture", controller.signal);
    const rejected = assert.rejects(first, { name: "AbortError" });
    const second = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    await tick();
    controller.abort();
    await rejected;
    const script = browser.scripts[0];
    assert.ok(script);
    assert.equal(script.removed, false);
    browser.load(script);
    assert.equal(await second, browser.sdk);
  } finally {
    browser.restore();
  }
});
test("failed load removes script and permits retry using fresh namespace", async () => {
  const browser = fakeBrowser();
  try {
    const first = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    const rejected = assert.rejects(first, /LOAD_FAILED/);
    await tick();
    const old = browser.scripts[0];
    assert.ok(old);
    old.dispatchEvent(new Event("error"));
    await rejected;
    assert.equal(old.removed, true);
    assert.equal(browser.timers.size, 0);
    const next = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    await tick();
    const current = browser.scripts[1];
    assert.ok(current);
    assert.notEqual(old.attributes.get("data-namespace"), current.attributes.get("data-namespace"));
    browser.load(old, { invalid: true });
    browser.load(current);
    assert.equal(await next, browser.sdk);
  } finally {
    browser.restore();
  }
});
test("timeout and invalid SDK shape fail closed and can retry", async () => {
  const browser = fakeBrowser();
  try {
    const first = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    const timeout = assert.rejects(first, /TIMEOUT/);
    await tick();
    for (const callback of [...browser.timers.values()]) callback();
    await timeout;
    assert.equal(browser.scripts[0]?.removed, true);
    const retry = loadPayPalCardSdk("publicFixture", new AbortController().signal);
    const invalid = assert.rejects(retry, /INVALID/);
    await tick();
    const script = browser.scripts[1];
    assert.ok(script);
    browser.load(script, { createInstance: true });
    await invalid;
    assert.equal(script.removed, true);
  } finally {
    browser.restore();
  }
});
