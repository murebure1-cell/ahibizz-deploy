import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [reportFile, expectedImage, sourceCommit, summaryFile] = process.argv.slice(2);
if (
  !reportFile ||
  !/^sha256:[a-f0-9]{64}$/.test(expectedImage ?? "") ||
  !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") ||
  !summaryFile
) {
  throw new Error("Usage: check-runtime-security.mjs REPORT IMAGE_ID SOURCE_COMMIT SUMMARY");
}

const raw = readFileSync(reportFile);
const report = JSON.parse(raw.toString("utf8"));
if (
  report.SchemaVersion !== 2 ||
  report.ArtifactType !== "container_image" ||
  report.Metadata?.ImageID !== expectedImage ||
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
