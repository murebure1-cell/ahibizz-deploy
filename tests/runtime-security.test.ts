import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const image = `sha256:${"a".repeat(64)}`;
const source = "b".repeat(40);
const script = path.resolve("scripts/check-runtime-security.mjs");
const layer = `sha256:${"d".repeat(64)}`;
const configuration = {
  architecture: "amd64",
  os: "linux",
  rootfs: { type: "layers", diff_ids: [layer] },
  config: {
    User: "node",
    Cmd: ["node", "scripts/start.mjs"],
    Env: ["NODE_ENV=production"],
    WorkingDir: "/app",
  },
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const configDigest = `sha256:${digest(JSON.stringify(configuration))}`;
function cleanTemporary(directory: string) {
  assert.ok(
    path
      .resolve(directory)
      .startsWith(`${path.resolve(tmpdir())}${path.sep}ahibizz-runtime-security-`),
  );
  rmSync(directory, { recursive: true, force: true });
}
function manifest() {
  return [
    {
      Config: `blobs/sha256/${configDigest.slice(7)}`,
      RepoTags: ["ahibizz:ci"],
      Layers: [`blobs/sha256/${"e".repeat(64)}`],
    },
  ];
}
function inspect() {
  return [
    {
      Id: image,
      Architecture: "amd64",
      Os: "linux",
      RootFS: { Type: "layers", Layers: [layer] },
      Config: structuredClone(configuration.config),
    },
  ];
}

function report(vulnerabilities: unknown[] = []) {
  return {
    SchemaVersion: 2,
    ArtifactType: "container_image",
    Metadata: {
      ImageID: configDigest,
      DiffIDs: [layer],
      ImageConfig: structuredClone(configuration),
      OS: { Family: "alpine" },
    },
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

function scan(
  value: unknown,
  expectedImage = image,
  overrides: { config?: unknown; inspect?: unknown; manifest?: unknown; identity?: unknown } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "ahibizz-runtime-security-"));
  try {
    const input = path.join(directory, "runtime.json");
    const output = path.join(directory, "summary.json");
    writeFileSync(input, JSON.stringify(value));
    const files = [
      "image-inspect.json",
      "archive-manifest.json",
      "archive-config.json",
      "archive-identity.json",
    ].map((name) => path.join(directory, name));
    const archivedManifest = overrides.manifest ?? manifest();
    const values = [
      overrides.inspect ?? inspect(),
      archivedManifest,
      overrides.config ?? configuration,
      overrides.identity ?? {
        archiveSha256: "f".repeat(64),
        configDigest,
        configMember: manifest()[0]?.Config,
        manifestSha256: digest(JSON.stringify(archivedManifest)),
      },
    ];
    for (const [index, filename] of files.entries())
      writeFileSync(filename, JSON.stringify(values[index]));
    const result = spawnSync(
      process.execPath,
      [script, input, expectedImage, source, output, ...files],
      {
        encoding: "utf8",
      },
    );
    return {
      status: result.status,
      error: result.stderr,
      summary: result.stdout.trim() ? JSON.parse(readFileSync(output, "utf8")) : null,
    };
  } finally {
    cleanTemporary(directory);
  }
}

test("archive identity extraction preserves and hashes the original config bytes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ahibizz-runtime-security-"));
  try {
    const input = path.join(directory, "input"),
      output = path.join(directory, "evidence"),
      member = `blobs/sha256/${configDigest.slice(7)}`,
      archive = path.join(directory, "image.tar");
    mkdirSync(path.dirname(path.join(input, member)), { recursive: true });
    writeFileSync(path.join(input, member), JSON.stringify(configuration));
    writeFileSync(path.join(input, "manifest.json"), JSON.stringify(manifest()));
    const pack = spawnSync("tar", ["-cf", archive, "-C", input, "manifest.json", member], {
      encoding: "utf8",
    });
    assert.equal(pack.status, 0, pack.stderr);
    const result = spawnSync(
      process.execPath,
      [script, "--extract-image-identity", archive, output],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const identity = JSON.parse(readFileSync(path.join(output, "archive-identity.json"), "utf8"));
    assert.equal(identity.configDigest, configDigest);
    assert.equal(
      identity.archiveSha256,
      createHash("sha256").update(readFileSync(archive)).digest("hex"),
    );
    assert.equal(
      readFileSync(path.join(output, "archive-config.json"), "utf8"),
      JSON.stringify(configuration),
    );
  } finally {
    cleanTemporary(directory);
  }
});

test("runtime security evidence identifies the scanned image and source", () => {
  const result = scan(report());
  assert.equal(result.status, 0);
  assert.equal(result.summary.passed, true);
  assert.equal(result.summary.imageId, image);
  assert.equal(result.summary.configDigest, configDigest);
  assert.notEqual(result.summary.configDigest, result.summary.imageId);
  assert.equal(result.summary.sourceCommit, source);
  assert.match(result.summary.reportSha256, /^[a-f0-9]{64}$/);
});

test("a saved archive config must hash to the exact scanned config digest", () => {
  assert.equal(scan(report(), image, { config: { ...configuration, os: "other" } }).status, 1);
});

test("scanned root filesystem layers must exactly match Docker inspection", () => {
  const different = inspect();
  const entry = different[0];
  assert.ok(entry);
  entry.RootFS.Layers = [`sha256:${"c".repeat(64)}`];
  assert.equal(scan(report(), image, { inspect: different }).status, 1);
  const changedReport = report();
  changedReport.Metadata.DiffIDs = [`sha256:${"c".repeat(64)}`];
  assert.equal(scan(changedReport).status, 1);
});

test("equal layers cannot authorize another image architecture or runtime configuration", () => {
  for (const field of ["architecture", "runtime"] as const) {
    const different = inspect();
    const entry = different[0];
    assert.ok(entry);
    if (field === "architecture") entry.Architecture = "arm64";
    else entry.Config.User = "root";
    assert.equal(scan(report(), image, { inspect: different }).status, 1);
  }
});

test("archive metadata must select a safe config member for the built runtime tag", () => {
  for (const value of [
    [{ ...manifest()[0], Config: "../../foreign-config.json" }],
    [{ ...manifest()[0], RepoTags: ["another:tag"] }],
    [...manifest(), ...manifest()],
  ])
    assert.equal(scan(report(), image, { manifest: value }).status, 1);
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
