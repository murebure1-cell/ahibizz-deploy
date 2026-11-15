import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const image = `sha256:${"a".repeat(64)}`;
const source = "b".repeat(40);
const script = path.resolve("scripts/check-runtime-security.mjs");

function report(vulnerabilities: unknown[] = []) {
  return {
    SchemaVersion: 2,
    ArtifactType: "container_image",
    Metadata: { ImageID: image, OS: { Family: "alpine" } },
    Results: [
      {
        Class: "os-pkgs",
        Type: "alpine",
        Target: "runtime (alpine)",
        Packages: [{ Name: "musl" }],
        Vulnerabilities: [],
      },
      {
        Class: "lang-pkgs",
        Type: "node-pkg",
        Target: "Node.js",
        Packages: [{ Name: "next" }],
        Vulnerabilities: vulnerabilities,
      },
    ],
  };
}

function scan(value: unknown, expectedImage = image) {
  const directory = mkdtempSync(path.join(tmpdir(), "ahibizz-runtime-security-"));
  try {
    const input = path.join(directory, "runtime.json");
    const output = path.join(directory, "summary.json");
    writeFileSync(input, JSON.stringify(value));
    const result = spawnSync(process.execPath, [script, input, expectedImage, source, output], {
      encoding: "utf8",
    });
    return {
      status: result.status,
      error: result.stderr,
      summary: result.stdout.trim() ? JSON.parse(readFileSync(output, "utf8")) : null,
    };
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(`${path.resolve(tmpdir())}${path.sep}ahibizz-runtime-security-`),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}

test("runtime security evidence identifies the scanned image and source", () => {
  const result = scan(report());
  assert.equal(result.status, 0);
  assert.equal(result.summary.passed, true);
  assert.equal(result.summary.imageId, image);
  assert.equal(result.summary.sourceCommit, source);
  assert.match(result.summary.reportSha256, /^[a-f0-9]{64}$/);
});

test("a clean scan from another image cannot authorize the runtime", () => {
  const result = scan(report(), `sha256:${"c".repeat(64)}`);
  assert.equal(result.status, 1);
  assert.match(result.error, /Incomplete or mismatched/);
});

test("missing application or operating-system scan results fail closed", () => {
  for (const index of [0, 1]) {
    const incomplete = report();
    incomplete.Results.splice(index, 1);
    const result = scan(incomplete);
    assert.equal(result.status, 1);
    assert.match(result.error, /Incomplete or mismatched/);
  }
});

test("high and critical findings block publication even without an available fix", () => {
  const result = scan(
    report([
      { VulnerabilityID: "CVE-fixture-high", PkgName: "fixture", Severity: "HIGH" },
      { VulnerabilityID: "CVE-fixture-critical", PkgName: "fixture", Severity: "CRITICAL" },
    ]),
  );
  assert.equal(result.status, 1);
  assert.equal(result.summary.passed, false);
  assert.equal(result.summary.high, 1);
  assert.equal(result.summary.critical, 1);
  assert.equal(result.summary.findings[0].fixed, null);
});

test("empty package inventories and suppressed findings cannot pass the gate", () => {
  const empty = report();
  const packages = empty.Results[1];
  assert.ok(packages);
  packages.Packages = [];
  assert.equal(scan(empty).status, 1);
  assert.equal(
    scan({ ...report(), SuppressedFindings: [{ VulnerabilityID: "hidden" }] }).status,
    1,
  );
});

test("lower severity findings remain in the evidence", () => {
  const result = scan(
    report([{ VulnerabilityID: "CVE-fixture-medium", PkgName: "fixture", Severity: "MEDIUM" }]),
  );
  assert.equal(result.status, 0);
  assert.equal(result.summary.findings.length, 1);
  assert.equal(result.summary.findings[0].severity, "MEDIUM");
});
