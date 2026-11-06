/**
 * Upgrade plan package (v2.3.0, RFC §9.3) and tool acquisition guidance
 * (RFC §9.5, owner decision R4).
 *
 * The package is small: the plan, the graph snapshots it was computed from
 * (raw bodies + provenance), each stage's validated ImageSetConfiguration,
 * instructions, readiness and templates. It never contains mirrored archives
 * (those move with the existing verified transfer format) or any credential.
 *
 * Integrity, not authenticity: `contentSha256` and SHA256SUMS show the files
 * were not changed after Architect wrote them. They do not prove who wrote
 * them — anyone can recompute a checksum. The package is not signed.
 *
 * Tools: binary redistribution in Mirroring/Upgrade is not enabled (pending
 * the third-party notice assessment, N5/R4). The package instead says
 * exactly where to obtain oc and oc-mirror on the destination side and how
 * to check them — using the exact versioned directory and SHA-256 of the
 * oc-mirror build the stages actually ran, when that was recorded.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";
import { SUPPORTED_MINORS } from "./versionPolicy.js";
import { versionedSourceUrl } from "./ocMirrorIdentity.js";
import { gaVersion, PLANNING_CHANNEL_RE, GRAPH_ARCHES } from "../../shared/upgradePath.js";
import { getMinorVersion } from "../../shared/versionUtils.js";

export const PACKAGE_SCHEMA = "oaa.upgrade.package/v1";
export const PACKAGE_MAX_BYTES = 24 * 1024 * 1024;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Deterministic JSON (sorted keys) so the content hash is reproducible. */
export const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

const MIRROR_ARCH_DIR = { amd64: "x86_64", arm64: "aarch64", s390x: "s390x", ppc64le: "ppc64le" };

/**
 * Where to obtain verified client tools on the destination side.
 * @param {object} plan
 * @param {object|null} recordedOcMirror - recordedToolIdentity() of the oc-mirror build a stage ran, if any
 */
export const toolAcquisition = (plan, recordedOcMirror) => {
  const arch = MIRROR_ARCH_DIR[plan.arch] || "x86_64";
  const targetMinor = plan.target ? getMinorVersion(plan.target) : null;
  const ocDir = targetMinor ? `https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/latest-${targetMinor}/` : null;
  const exactOcMirror = recordedOcMirror ? versionedSourceUrl(recordedOcMirror) : null;
  return {
    redistribution: "not-included",
    reason: "Architect does not package oc or oc-mirror into Mirroring or Upgrade outputs until their third-party notices are assessed and approved. Obtain them from Red Hat on the destination side and verify them as below.",
    oc: ocDir ? {
      policy: `oc: the latest patch of the target minor (${targetMinor}), matching the cluster you update to.`,
      directory: ocDir,
      files: ["openshift-client-linux.tar.gz (or the -rhel8/-rhel9 variant for your host)", "sha256sum.txt", "release.txt"],
      verify: "sha256sum --ignore-missing -c sha256sum.txt"
    } : null,
    ocMirror: {
      policy: "oc-mirror v2: the build the stages ran (so disk-to-mirror uses the same tool); otherwise the latest release.",
      directory: exactOcMirror || `https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/latest/`,
      exact: Boolean(exactOcMirror),
      ...(recordedOcMirror ? { recorded: { version: recordedOcMirror.version || null, binarySha256: recordedOcMirror.sha256 || null, tarballSha256: recordedOcMirror.tarballSha256 || null } } : {}),
      files: ["oc-mirror.tar.gz (or oc-mirror.rhel9.tar.gz)", "sha256sum.txt"],
      verify: "sha256sum --ignore-missing -c sha256sum.txt"
    },
    fips: "Red Hat publishes no FIPS-specific oc-mirror build; a checksum match is not a FIPS statement."
  };
};

/** Readiness as exported: an attestation's free-text note never leaves the server. */
export const exportableReadiness = (readiness) => ({
  summary: readiness.summary,
  checks: readiness.checks.map((c) => ({ id: c.id, state: c.state, title: c.title, detail: c.state === "ATTESTED" ? "Stated by the administrator on the connected side (administrator judgment, not verified; the note is not exported)." : c.detail }))
});

const sanitizePlan = (plan) => {
  // No inventory (environment detail) and no attestation notes leave the server.
  const { inventory: _i, readiness: _r, ...rest } = plan;
  return { ...rest, readiness: { attested: Object.keys(plan.readiness?.attestations || {}) } };
};

export const buildPackageDocument = ({ plan, snapshots, stages, instructions, readiness, tools, architect, now = () => Date.now() }) => {
  const content = {
    plan: sanitizePlan(plan),
    snapshots: snapshots.map((s) => ({ channel: s.channel, arch: s.arch, source: s.source, origin: s.origin, sourceUrl: s.sourceUrl || null, fetchedAt: s.fetchedAt, bodySha256: s.bodySha256, rawText: s.rawText })),
    stages: stages.map((s) => ({ id: s.id, release: s.release, minor: s.minor, originProfileId: s.profileId, imagesetConfig: s.imagesetConfig, configSha256: s.imagesetConfig ? sha256(s.imagesetConfig) : null, transfers: s.transfers || [] })),
    readiness: readiness ? exportableReadiness(readiness) : null,
    instructionsStatus: instructions?.status || null,
    tools
  };
  return {
    _schema: PACKAGE_SCHEMA,
    createdAt: new Date(now()).toISOString(),
    architect,
    integrity: "contentSha256 covers every field of `content` (canonical JSON). It shows the content was not changed after it was written; it does not authenticate who wrote it.",
    contentSha256: sha256(canonicalJson(content)),
    content
  };
};

export class PackageError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

/** Verify a package document's integrity and boundaries before anything is imported. */
export const verifyPackageDocument = (text) => {
  if (typeof text !== "string" || Buffer.byteLength(text) > PACKAGE_MAX_BYTES) throw new PackageError("PACKAGE_TOO_LARGE", "The package file is too large.", 413);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new PackageError("PACKAGE_INVALID", "This is not an Architect upgrade package (oaa-upgrade-package.json)."); }
  if (doc?._schema !== PACKAGE_SCHEMA) throw new PackageError(doc?._schema && String(doc._schema).startsWith("oaa.upgrade.package/") ? "PACKAGE_SCHEMA_UNKNOWN" : "PACKAGE_INVALID", doc?._schema ? `Unsupported package schema ${String(doc._schema).slice(0, 40)}; it may come from a newer Architect.` : "This is not an Architect upgrade package.");
  const c = doc.content;
  if (!c || typeof c !== "object") throw new PackageError("PACKAGE_INVALID", "The package has no content.");
  if (sha256(canonicalJson(c)) !== doc.contentSha256) throw new PackageError("PACKAGE_TAMPERED", "The package content does not match its recorded checksum: it was changed after it was written. Nothing was imported.");
  for (const s of c.snapshots || []) {
    if (!PLANNING_CHANNEL_RE.test(s.channel || "") || !GRAPH_ARCHES.includes(s.arch)) throw new PackageError("PACKAGE_INVALID", "A graph snapshot names an unknown channel or architecture.");
    if (sha256(String(s.rawText || "")) !== s.bodySha256) throw new PackageError("PACKAGE_TAMPERED", `The ${s.channel} snapshot does not match its checksum.`);
  }
  for (const st of c.stages || []) {
    if (!gaVersion(st.release) || !SUPPORTED_MINORS.includes(getMinorVersion(st.release))) throw new PackageError("UNSUPPORTED_VERSION", `Stage release ${String(st.release).slice(0, 20)} is outside the supported minors.`, 422);
    if (st.imagesetConfig && sha256(st.imagesetConfig) !== st.configSha256) throw new PackageError("PACKAGE_TAMPERED", `Stage ${st.id} configuration does not match its checksum.`);
  }
  const p = c.plan || {};
  for (const v of [p.current, p.target]) if (v && (!gaVersion(v) || !SUPPORTED_MINORS.includes(getMinorVersion(v)))) throw new PackageError("UNSUPPORTED_VERSION", "The plan's versions are outside the supported minors.", 422);
  return doc;
};

/** Human-readable instructions as Markdown (one file per method). */
export const instructionsMarkdown = (ins, method) => {
  const m = ins.methods[method];
  const lines = [`# ${method === "osus" ? "OpenShift Update Service (recommended)" : method === "cli" ? "CLI without the OpenShift Update Service" : "Web console"}: ${ins.route.join(" → ")}`, "", `> ${ins.status.message}`, `> Cluster readiness: ${ins.status.clusterReadiness}.`, `> ${ins.tieBreakNote}`, "", m.note, ""];
  const step = (s, n) => {
    lines.push(`### ${n}. ${s.title}`, "");
    if (s.body) lines.push(s.body, "");
    if (s.requires?.length) lines.push(`Run only after these checks are confirmed: ${s.requires.join(", ")}.`, "");
    for (const r of s.risks || []) lines.push(`- Risk **${r.name}**: ${r.message}${r.url ? ` (${r.url})` : ""}`);
    if (s.risks?.length) lines.push("");
    for (const c of s.commands || []) lines.push(`${c.label}:`, "", "```", c.text, "```", "");
    if (s.doc) lines.push(`Documentation: [${s.doc.title}](${s.doc.url})`, "");
  };
  lines.push("## Setup", "");
  m.setup.forEach((s, i) => step(s, i + 1));
  if (m.cpo) lines.push(`> Control Plane Only: ${m.cpo.message}`, "");
  m.before.forEach((s, i) => step(s, `B${i + 1}`));
  for (const hop of m.hops) {
    lines.push(`## Step ${hop.index + 1}: ${hop.from} → ${hop.to} (channel ${hop.channel})${hop.conditional ? " — conditional update" : ""}`, "");
    hop.steps.forEach((s, i) => step(s, `${hop.index + 1}.${i + 1}`));
  }
  m.after.forEach((s, i) => step(s, `A${i + 1}`));
  lines.push("", `Never used by these instructions: ${ins.never.join(", ")}.`, "");
  return lines.join("\n");
};
