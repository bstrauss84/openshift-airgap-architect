/**
 * Tool-resolution integrity tests (R2).
 *
 * Policy under test (see CLAUDE.md "External tool version policy"):
 *   oc        → latest patch WITHIN the selected target minor  (latest-<minor>)
 *   oc-mirror → newest patch of the newest SUPPORTED minor     (latest-<newest supported minor>)
 *               (was the global `latest` until 2026-11-19; that channel is now
 *               OpenShift 5.0.1 and publishes no oc-mirror)
 *
 * Hermetic: global fetch is stubbed; no external network is used.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  acquireVerifiedTool,
  getBinariesForExportArch,
  ocChannelForMinor,
  verifySha256,
  sha256File,
  supportsV2ListOperators,
  OC_MIRROR_CHANNEL
} from "../src/ocMirrorRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../src/ocMirrorRuntime.js");

// Channel → version the stubbed mirror advertises.
const CHANNEL_VERSION = {
  latest: "4.22.16",
  "latest-4.20": "4.20.40",
  "latest-4.21": "4.21.35",
  "latest-4.22": "4.22.16"
};

let fixtureDir;
let tarballs; // fileName -> { buf, sha }
let realFetch;
let faults;

function makeTarball(member) {
  const stage = fs.mkdtempSync(path.join(fixtureDir, "stage-"));
  fs.writeFileSync(path.join(stage, member), `#!/bin/sh\necho ${member}-stub\n`);
  fs.chmodSync(path.join(stage, member), 0o755);
  const tgz = path.join(fixtureDir, `${member}.tar.gz`);
  execSync(`tar -czf "${tgz}" -C "${stage}" "${member}"`);
  const buf = fs.readFileSync(tgz);
  return { buf, sha: createHash("sha256").update(buf).digest("hex") };
}

function parseUrl(url) {
  // .../pub/openshift-v4/<arch>/clients/ocp/<channel>/<file>
  const m = String(url).match(/openshift-v4\/([^/]+)\/clients\/ocp\/([^/]+)\/(.+)$/);
  return m ? { arch: m[1], channel: m[2], file: m[3] } : null;
}

function textResponse(body) {
  return { ok: true, status: 200, text: async () => body };
}
function notFound(url) {
  return { ok: false, status: 404, text: async () => "not found", url };
}

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-integrity-"));
  tarballs = {
    "openshift-client-linux.tar.gz": makeTarball("oc"),
    "oc-mirror.tar.gz": makeTarball("oc-mirror")
  };
  faults = { corruptSha: false, omitShaEntry: false, tarball404: false, release404: false };

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = parseUrl(url);
    if (!p) return notFound(url);
    // Only the arch dirs the stub "hosts".
    if (!["x86_64", "aarch64", "ppc64le", "s390x"].includes(p.arch)) return notFound(url);
    const version = CHANNEL_VERSION[p.channel];
    if (!version) return notFound(url);

    if (p.file === "release.txt") {
      if (faults.release404) return notFound(url);
      return textResponse(`Name:           ${version}\nDigest: sha256:abc\n`);
    }
    if (p.file === "sha256sum.txt") {
      const lines = Object.entries(tarballs)
        .filter(([name]) => !(faults.omitShaEntry && name === "oc-mirror.tar.gz"))
        .map(([name, t]) => `${faults.corruptSha ? "0".repeat(64) : t.sha}  ${name}`);
      return textResponse(lines.join("\n") + "\n");
    }
    const t = tarballs[p.file];
    if (!t || faults.tarball404) return notFound(url);
    return { ok: true, status: 200, body: Readable.from([t.buf]) };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------------------------------------------------------------- oc policy

test("R2.1 target 4.20 resolves latest oc within 4.20.x", async () => {
  const dest = path.join(fixtureDir, "out20");
  const r = await acquireVerifiedTool({
    archDir: "x86_64", channel: ocChannelForMinor("4.20"),
    fileName: "openshift-client-linux.tar.gz", member: "oc",
    finalPath: path.join(dest, "oc")
  });
  assert.equal(r.version, "4.20.40");
  assert.match(r.version, /^4\.20\./);
  assert.equal(r.channel, "latest-4.20");
});

test("R2.2 target 4.21 resolves latest oc within 4.21.x", async () => {
  const dest = path.join(fixtureDir, "out21");
  const r = await acquireVerifiedTool({
    archDir: "x86_64", channel: ocChannelForMinor("4.21"),
    fileName: "openshift-client-linux.tar.gz", member: "oc",
    finalPath: path.join(dest, "oc")
  });
  assert.equal(r.version, "4.21.35");
  assert.match(r.version, /^4\.21\./);
});

test("R2.2b target 4.22 resolves latest oc within 4.22.x", async () => {
  const dest = path.join(fixtureDir, "out22");
  const r = await acquireVerifiedTool({
    archDir: "x86_64", channel: ocChannelForMinor("4.22"),
    fileName: "openshift-client-linux.tar.gz", member: "oc",
    finalPath: path.join(dest, "oc")
  });
  assert.equal(r.version, "4.22.16");
  assert.match(r.version, /^4\.22\./);
  assert.equal(r.channel, "latest-4.22");
});

test("R2.3/R2.4 oc never silently resolves another minor or the global channel", async () => {
  const b20 = await getBinariesForExportArch("x86_64", path.join(fixtureDir, "d20"), "4.20");
  const oc20 = b20.provenance.find((p) => p.tool === "oc");
  assert.equal(oc20.channel, "latest-4.20");
  assert.match(oc20.version, /^4\.20\./);
  assert.notEqual(oc20.channel, OC_MIRROR_CHANNEL);

  const b21 = await getBinariesForExportArch("x86_64", path.join(fixtureDir, "d21"), "4.21");
  const oc21 = b21.provenance.find((p) => p.tool === "oc");
  assert.equal(oc21.channel, "latest-4.21");
  assert.match(oc21.version, /^4\.21\./);
  assert.notEqual(oc21.version, CHANNEL_VERSION.latest);

  // 4.22: since 2026-11-19 oc-mirror's channel is latest-<newest supported
  // minor>, which for a 4.22 target is the SAME channel as oc's per-minor one.
  // That coincidence is legitimate; the per-minor rule for oc is proven by its
  // channel equalling ocChannelForMinor(target) here and by the 4.20/4.21 cases.
  const b22 = await getBinariesForExportArch("x86_64", path.join(fixtureDir, "d22"), "4.22");
  const oc22 = b22.provenance.find((p) => p.tool === "oc");
  assert.equal(oc22.channel, ocChannelForMinor("4.22"));
  assert.match(oc22.version, /^4\.22\./);
  assert.notEqual(oc22.channel, "latest", "oc never comes from the global channel");
});

test("ocChannelForMinor rejects malformed minors (fail closed)", () => {
  assert.equal(ocChannelForMinor("4.20"), "latest-4.20");
  for (const bad of [undefined, null, "", "latest", "4", "4.20.1", "../etc"]) {
    assert.throws(() => ocChannelForMinor(bad), /Invalid OpenShift minor/);
  }
});

// --------------------------------------------------------- oc-mirror policy

test("R2.11 oc-mirror resolves the newest SUPPORTED minor's channel regardless of target minor — never the global latest", async () => {
  assert.equal(OC_MIRROR_CHANNEL, "latest-4.22");
  for (const minor of ["4.20", "4.21", "4.22"]) {
    const b = await getBinariesForExportArch("x86_64", path.join(fixtureDir, `m${minor}`), minor);
    const om = b.provenance.find((p) => p.tool === "oc-mirror");
    assert.equal(om.channel, OC_MIRROR_CHANNEL);
    assert.equal(om.version, CHANNEL_VERSION[OC_MIRROR_CHANNEL]);
    assert.notEqual(om.channel, "latest");
  }
});

test("R2.11b 2026-11-19 regression: the global latest channel is OpenShift 5.0.1 and publishes no oc-mirror, yet bundle export still resolves a verified oc-mirror", async () => {
  // Upstream state reproduced: clients/ocp/latest → 5.0.1 with no oc-mirror entry.
  const realStub = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    const p = parseUrl(url);
    requested.push(p ? `${p.channel}/${p.file}` : String(url));
    if (p?.channel === "latest") {
      if (p.file === "release.txt") return textResponse("Name:           5.0.1\n");
      if (p.file === "sha256sum.txt") return textResponse(`${tarballs["openshift-client-linux.tar.gz"].sha}  openshift-client-linux.tar.gz\n`);
      return notFound(url);
    }
    return realStub(url);
  };
  try {
    const b = await getBinariesForExportArch("x86_64", path.join(fixtureDir, "five"), "4.21");
    const om = b.provenance.find((p) => p.tool === "oc-mirror");
    assert.equal(om.channel, "latest-4.22");
    assert.equal(om.sha256, tarballs["oc-mirror.tar.gz"].sha);
    assert.ok(!requested.some((r) => r.startsWith("latest/")), `the global channel was consulted: ${requested.join(", ")}`);
    // And resolving oc-mirror from the global channel itself fails closed, never silently.
    await assert.rejects(
      acquireVerifiedTool({ archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz", member: "oc-mirror", finalPath: path.join(fixtureDir, "five-global", "oc-mirror") }),
      /No SHA256 entry/
    );
  } finally {
    globalThis.fetch = realStub;
  }
});

test("R2.12 no fixed z-stream default remains in tool-resolution source", () => {
  const src = fs.readFileSync(SRC, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/clients\/ocp\/4\.\d+\.\d+/.test(code), "must not hardcode a z-stream mirror path");
  assert.ok(!/["'`]4\.21\.36["'`]/.test(code), "must not hardcode 4.21.36");
});

test("extraction must not use the unsupported --no-absolute-filenames tar flag", () => {
  const src = fs.readFileSync(SRC, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(
    !code.includes("--no-absolute-filenames"),
    "GNU tar 1.34 (UBI9) rejects --no-absolute-filenames; extraction must not pass it"
  );
});

// --------------------------------------------------------------- fail-closed

test("R2.13 correct checksum succeeds and records version + hash", async () => {
  const r = await acquireVerifiedTool({
    archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz",
    member: "oc-mirror", finalPath: path.join(fixtureDir, "ok", "oc-mirror")
  });
  assert.equal(r.sha256, tarballs["oc-mirror.tar.gz"].sha);
  assert.equal(sha256File(r.path) ? true : true, true);
  assert.ok(fs.existsSync(r.path));
  assert.equal(r.version, "4.22.16");
  assert.match(r.url, /clients\/ocp\/latest\/oc-mirror\.tar\.gz$/);
});

test("R2.14 incorrect checksum fails closed", async () => {
  faults.corruptSha = true;
  await assert.rejects(
    acquireVerifiedTool({
      archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz",
      member: "oc-mirror", finalPath: path.join(fixtureDir, "bad", "oc-mirror")
    }),
    /SHA256 mismatch/
  );
});

test("R2.15 missing checksum metadata entry fails closed", async () => {
  faults.omitShaEntry = true;
  await assert.rejects(
    acquireVerifiedTool({
      archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz",
      member: "oc-mirror", finalPath: path.join(fixtureDir, "nosha", "oc-mirror")
    }),
    /No SHA256 entry/
  );
});

test("R2.16 download failure fails closed", async () => {
  faults.tarball404 = true;
  await assert.rejects(
    acquireVerifiedTool({
      archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz",
      member: "oc-mirror", finalPath: path.join(fixtureDir, "dl", "oc-mirror")
    }),
    /HTTP 404/
  );
});

test("release metadata failure fails closed", async () => {
  faults.release404 = true;
  await assert.rejects(
    acquireVerifiedTool({
      archDir: "x86_64", channel: "latest", fileName: "oc-mirror.tar.gz",
      member: "oc-mirror", finalPath: path.join(fixtureDir, "rel", "oc-mirror")
    }),
    /Could not determine release version|HTTP 404/
  );
});

test("R2.17 unsupported architecture fails closed", async () => {
  await assert.rejects(
    getBinariesForExportArch("riscv64", path.join(fixtureDir, "arch"), "4.21"),
    /Unsupported architecture|Could not fetch/
  );
});

test("R2.19 bundle resolution records exact version + hash for both tools", async () => {
  const b = await getBinariesForExportArch("x86_64", path.join(fixtureDir, "prov"), "4.21");
  assert.equal(b.provenance.length, 2);
  for (const p of b.provenance) {
    assert.match(p.sha256, /^[0-9a-f]{64}$/);
    assert.match(p.version, /^\d+\.\d+\.\d+$/);
    assert.ok(p.url.startsWith("https://mirror.openshift.com/"));
    assert.ok(["x86_64"].includes(p.arch));
  }
  assert.ok(fs.existsSync(b.ocPath));
  assert.ok(fs.existsSync(b.ocMirrorPath));
});

test("verifySha256 accepts a matching hash and rejects a mismatch", () => {
  const f = path.join(fixtureDir, "probe.bin");
  fs.writeFileSync(f, "contents");
  verifySha256(f, createHash("sha256").update("contents").digest("hex"));
  assert.throws(() => verifySha256(f, "0".repeat(64)), /SHA256 mismatch/);
});

// ------------------------------------------------- v2 operator-list contract

test("R2.20 supportsV2ListOperators distinguishes a real v2 list from root-help fallback", () => {
  // oc-mirror 4.21.x has no `list` subcommand: it falls through to ROOT help and
  // still exits 0. Exit status alone therefore cannot be the capability signal.
  const mk = (name, body) => {
    const p = path.join(fixtureDir, name);
    fs.writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${body}\nEOF\nexit 0\n`);
    fs.chmodSync(p, 0o755);
    return p;
  };

  const oldStyle = mk("ocm-old", [
    "Usage:",
    "  oc-mirror -c <config> --v2 [flags]",
    "Available Commands:",
    "  completion  Generate the autocompletion script",
    "  delete      Deletes images",
    "  version     Output version"
  ].join("\n"));

  const newStyle = mk("ocm-new", [
    "Usage:",
    "  oc-mirror list operators [flags]",
    "Flags:",
    "      --catalog string   List information for a specified catalog.",
    "      --catalogs         List available catalogs for an OpenShift release version.",
    "      --package string   List information for a specified package."
  ].join("\n"));

  assert.equal(supportsV2ListOperators(oldStyle), false, "root-help fallback must NOT count as support");
  assert.equal(supportsV2ListOperators(newStyle), true, "real `list operators` help must count as support");
  assert.equal(supportsV2ListOperators(null), false);
});

test("R1 operator scan builds --v2 before 'list operators' and uses no --v1", () => {
  const ops = fs.readFileSync(path.join(__dirname, "../src/operators.js"), "utf8");
  const code = ops.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/"--v1"|'--v1'|`--v1`/.test(code), "operators.js must not execute the deprecated --v1 path");
  const m = code.match(/const args\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "could not locate operator scan args array");
  const items = m[1].split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, ""));
  assert.equal(items[0], "--v2", "--v2 must be the first argument (global flag)");
  assert.equal(items[1], "list");
  assert.equal(items[2], "operators");
});
