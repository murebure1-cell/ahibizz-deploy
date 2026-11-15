import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const isDigest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
function archiveEntry(raw) {
  const entries = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(entries) || entries.length !== 1) throw Error("Ambiguous runtime archive");
  const entry = entries[0];
  if (
    typeof entry?.Config !== "string" ||
    !/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(entry.Config) ||
    !Array.isArray(entry.RepoTags) ||
    !entry.RepoTags.includes("ahibizz:ci") ||
    !Array.isArray(entry.Layers) ||
    entry.Layers.length === 0 ||
    entry.Layers.some(
      (member) =>
        typeof member !== "string" ||
        !/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\/layer\.tar)$/.test(member),
    )
  )
    throw Error("Invalid runtime archive members");
  return entry;
}
function memberDigest(member) {
  return `sha256:${member.startsWith("blobs/") ? member.slice(13) : member.slice(0, -5)}`;
}
if (process.argv[2] === "--extract-image-identity") {
  const [, , , archiveFile, evidenceDirectory] = process.argv;
  if (!archiveFile || !evidenceDirectory) throw Error("Missing runtime archive paths");
  const extract = (member) =>
    execFileSync("tar", ["-xOf", archiveFile, member], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30000,
    });
  // Stream selected members to stdout; never extract archive paths into the filesystem.
  const manifest = extract("manifest.json"),
    entry = archiveEntry(manifest),
    config = extract(entry.Config),
    configDigest = digest(config);
  JSON.parse(config.toString("utf8"));
  if (configDigest !== memberDigest(entry.Config)) throw Error("Runtime config digest mismatch");
  const archiveHash = createHash("sha256");
  for await (const chunk of createReadStream(archiveFile)) archiveHash.update(chunk);
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(path.join(evidenceDirectory, "archive-manifest.json"), manifest);
  writeFileSync(path.join(evidenceDirectory, "archive-config.json"), config);
  writeFileSync(
    path.join(evidenceDirectory, "archive-identity.json"),
    `${JSON.stringify({ archiveSha256: archiveHash.digest("hex"), configDigest, configMember: entry.Config, manifestSha256: digest(manifest).slice(7) }, null, 2)}\n`,
  );
  process.exit(0);
}

const [
  reportFile,
  expectedImage,
  sourceCommit,
  summaryFile,
  inspectFile,
  manifestFile,
  configFile,
  identityFile,
] = process.argv.slice(2);
if (
  !reportFile ||
  !isDigest(expectedImage) ||
  !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") ||
  !summaryFile ||
  !inspectFile ||
  !manifestFile ||
  !configFile ||
  !identityFile
) {
  throw new Error(
    "Usage: check-runtime-security.mjs REPORT IMAGE_ID SOURCE_COMMIT SUMMARY INSPECT MANIFEST CONFIG IDENTITY",
  );
}

const raw = readFileSync(reportFile);
const report = JSON.parse(raw.toString("utf8"));
const inspected = JSON.parse(readFileSync(inspectFile, "utf8"));
const manifestRaw = readFileSync(manifestFile),
  manifest = archiveEntry(manifestRaw),
  configRaw = readFileSync(configFile),
  config = JSON.parse(configRaw.toString("utf8")),
  configDigest = digest(configRaw),
  identity = JSON.parse(readFileSync(identityFile, "utf8"));
const image = Array.isArray(inspected) && inspected.length === 1 ? inspected[0] : null;
const layers = config.rootfs?.diff_ids;
if (
  !image ||
  image.Id !== expectedImage ||
  identity.configDigest !== configDigest ||
  identity.configMember !== manifest.Config ||
  identity.manifestSha256 !== digest(manifestRaw).slice(7) ||
  !/^[a-f0-9]{64}$/.test(identity.archiveSha256 ?? "") ||
  memberDigest(manifest.Config) !== configDigest ||
  image.Architecture !== "amd64" ||
  config.architecture !== image.Architecture ||
  image.Os !== "linux" ||
  config.os !== image.Os ||
  config.rootfs?.type !== "layers" ||
  image.RootFS?.Type !== "layers" ||
  !Array.isArray(layers) ||
  layers.length === 0 ||
  layers.some((layer) => !isDigest(layer)) ||
  layers.length !== manifest.Layers.length ||
  !isDeepStrictEqual(layers, image.RootFS.Layers) ||
  !isDeepStrictEqual(config.config, image.Config) ||
  report.SchemaVersion !== 2 ||
  report.ArtifactType !== "container_image" ||
  report.Metadata?.ImageID !== configDigest ||
  !isDeepStrictEqual(report.Metadata?.DiffIDs, layers) ||
  report.Metadata?.ImageConfig?.architecture !== config.architecture ||
  report.Metadata?.ImageConfig?.os !== config.os ||
  !isDeepStrictEqual(report.Metadata?.ImageConfig?.config, config.config) ||
  !isDeepStrictEqual(report.Metadata?.ImageConfig?.rootfs, config.rootfs) ||
  report.Metadata?.OS?.Family !== "alpine" ||
  !Array.isArray(report.Results) ||
  !report.Results.some(
    (result) =>
      result.Class === "os-pkgs" &&
      result.Type === "alpine" &&
      Array.isArray(result.Packages) &&
      result.Packages.length > 0,
  ) ||
  !report.Results.some(
    (result) =>
      result.Class === "lang-pkgs" &&
      result.Type === "node-pkg" &&
      Array.isArray(result.Packages) &&
      result.Packages.length > 0,
  ) ||
  report.Results.some((result) => result.SuppressedFindings?.length) ||
  report.SuppressedFindings?.length
) {
  throw new Error("Incomplete or mismatched runtime image scan");
}

const findings = report.Results.flatMap((result) =>
  (result.Vulnerabilities ?? []).map((finding) => ({
    target: result.Target,
    id: finding.VulnerabilityID,
    package: finding.PkgName,
    installed: finding.InstalledVersion,
    fixed: finding.FixedVersion ?? null,
    severity: finding.Severity,
  })),
);
const blocking = findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity));
const summary = {
  sourceCommit,
  imageId: expectedImage,
  configDigest,
  archiveSha256: identity.archiveSha256,
  manifestSha256: identity.manifestSha256,
  checkedUtc: new Date().toISOString(),
  reportSha256: createHash("sha256").update(raw).digest("hex"),
  high: blocking.filter((finding) => finding.severity === "HIGH").length,
  critical: blocking.filter((finding) => finding.severity === "CRITICAL").length,
  passed: blocking.length === 0,
  findings,
};
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (!summary.passed) process.exitCode = 1;
