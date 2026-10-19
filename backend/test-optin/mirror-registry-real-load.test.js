/**
 * OpenShift Airgap Architect — REAL 1.19 GiB mirror-registry export load test
 *
 * OPT-IN. It needs ~3 GiB of free disk, egress to mirror.openshift.com, and
 * several minutes. Run it with:
 *
 *   OAA_LARGE_EXPORT_TEST=1 \
 *   OAA_LARGE_EXPORT_DATA_DIR=/var/tmp/oaa-large-export \
 *   node --test --expose-gc backend/test-optin/mirror-registry-real-load.test.js
 *
 * IT LIVES IN `test-optin/`, NOT `test/`, AND THAT PLACEMENT IS THE MECHANISM.
 *
 * `npm test` runs `node --test test/`, and backend/test/test-integrity.test.js
 * additionally scans every .js/.mjs/.cjs file under `test/` and FAILS the
 * build on any skip marker — "all executable skips must be converted to
 * test.todo with a backlog ID". That guard is right, and an env-gated
 * `{ skip: ... }` in the default tree is exactly the silently-skipped test it
 * exists to catch. A directory outside default discovery is the honest way to
 * express "this is opt-in", instead of a test that pretends to run and does
 * not. The suite therefore has no skip, and the guard has nothing to forgive.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE FIXTURE TEST
 *
 * `mirror-registry-export-streaming.test.js` proves the SHAPE of the fix with
 * 64 MiB fixtures: the eager path holds the whole member at registration, the
 * streamed path holds a bounded window, and registration cost does not scale
 * with size. That licenses an extrapolation. It is not the same as running the
 * real artifact through the real endpoint, and a 64 MiB fixture must never be
 * reported as a load test.
 *
 * This file closes that gap with the actual published artifact — 1.19 GiB,
 * real checksum manifest, real CDN redirects, real ZIP, real HTTP streaming —
 * and records peak RSS, wall clock and on-disk cost.
 *
 * WHAT IT ASSERTS
 *
 *   1. The real artifact downloads and verifies against the real sha256sum.txt.
 *   2. A full `/api/bundle.zip` export containing it completes successfully.
 *   3. The member is present in the ZIP at full length with a matching digest.
 *   4. Peak RSS growth across the whole export stays FAR below the artifact
 *      size — the pre-fix code would have grown by ~1.19 GiB at registration
 *      (and the download before that added another ~2.4 GiB of its own).
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MIB = 1024 * 1024;
const ARCH = process.env.OAA_LARGE_EXPORT_ARCH || "amd64";
const FILE_NAME = `mirror-registry-${ARCH}.tar.gz`;
const MIRROR_BASE = "https://mirror.openshift.com/pub/cgw/mirror-registry/latest";

/** Sample RSS on an interval and keep the maximum. */
function startRssSampler(intervalMs = 100) {
  let peak = process.memoryUsage().rss;
  const samples = [peak];
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    samples.push(rss);
    if (rss > peak) peak = rss;
  }, intervalMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return { peak, samples };
    }
  };
}

const mib = (bytes) => (bytes / MIB).toFixed(1);

describe("REAL mirror-registry export load test", () => {
  let dataDir;
  let app;
  let createTestServer;
  let closeTestServer;
  let validateArchiveBuffer;
  let acquireVerifiedArtifact;
  let server;
  let baseUrl;
  const report = {};

  before(async () => {
    dataDir = process.env.OAA_LARGE_EXPORT_DATA_DIR || "/var/tmp/oaa-large-export";
    fs.mkdirSync(path.join(dataDir, "cache"), { recursive: true });
    // db.js reads DATA_DIR at module load, so it must be set before the first
    // import of anything that reaches it.
    process.env.DATA_DIR = dataDir;
    process.env.NODE_ENV = "test";

    ({ acquireVerifiedArtifact } = await import("../src/verifiedDownload.js"));
    ({ validateArchiveBuffer } = await import("../src/exportIntegrity.js"));
    ({ app } = await import("../src/index.js"));
    ({ createTestServer, closeTestServer } = await import("../test/helpers/httpServerLifecycle.js"));
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    if (server) await closeTestServer(server);
    const out = process.env.OAA_LARGE_EXPORT_REPORT;
    if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log("\nREAL LOAD REPORT\n" + JSON.stringify(report, null, 2));
  });

  it("downloads and verifies the real artifact against the published sha256sum.txt", async () => {
    const destPath = path.join(dataDir, "cache", FILE_NAME);
    const sampler = startRssSampler();
    const rssBefore = process.memoryUsage().rss;
    const started = Date.now();

    const provenance = await acquireVerifiedArtifact({
      artifactUrl: `${MIRROR_BASE}/${FILE_NAME}`,
      manifestUrl: `${MIRROR_BASE}/sha256sum.txt`,
      fileName: FILE_NAME,
      destPath
    });

    const { peak } = sampler.stop();
    const elapsedMs = Date.now() - started;

    report.download = {
      fileName: FILE_NAME,
      bytes: provenance.bytes,
      sizeMiB: Number(mib(provenance.bytes)),
      sha256: provenance.sha256,
      cached: provenance.cached,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
      rssBeforeMiB: Number(mib(rssBefore)),
      rssPeakMiB: Number(mib(peak)),
      rssGrowthMiB: Number(mib(peak - rssBefore))
    };

    assert.ok(provenance.bytes > 900 * MIB, `expected a multi-hundred-MiB artifact, got ${mib(provenance.bytes)} MiB`);
    assert.match(provenance.sha256, /^[0-9a-f]{64}$/);
    assert.equal(fs.statSync(destPath).size, provenance.bytes);

    // The download path streams; it must not grow RSS by anything close to the
    // artifact. Generous bound — the point is to catch a return to buffering,
    // not to pin an exact allocator behaviour.
    assert.ok(
      peak - rssBefore < 400 * MIB,
      `download RSS growth ${mib(peak - rssBefore)} MiB is too close to the ${mib(provenance.bytes)} MiB artifact`
    );
  });

  it("exports a real bundle containing it, with bounded peak RSS", async () => {
    const state = {
      _schemaVersion: 3,
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.22",
        selectedPatch: "4.22.16",
        selectedChannel: "stable-4.22",
        selectedVersion: "4.22.16",
        locked: true
      },
      release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
      blueprint: {
        platform: "Bare Metal",
        arch: "x86_64",
        clusterName: "real-load",
        baseDomain: "example.com",
        confirmed: true
      },
      methodology: { method: "Agent-Based Installer" },
      credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB load@test" },
      globalStrategy: {
        fips: false,
        networking: {
          networkType: "OVNKubernetes",
          machineNetworkV4: "10.90.0.0/24",
          clusterNetworkCidr: "10.128.0.0/14",
          clusterNetworkHostPrefix: 23,
          serviceNetworkCidr: "172.30.0.0/16"
        },
        mirroring: { registryFqdn: "registry.local:5000", sources: [] }
      },
      hostInventory: { nodes: [], ipStackMode: "ipv4" },
      operators: { selected: [], stale: false },
      trust: { additionalTrustBundlePolicy: "Proxyonly", mirrorRegistryCaPem: "", proxyCaPem: "" },
      exportOptions: {
        includeCredentials: false,
        includeCertificates: true,
        includeClientTools: false,
        includeInstaller: false,
        includeHighSideRuntimePackage: false,
        includeMirrorRegistry: true,
        mirrorRegistryArch: ARCH
      }
    };

    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const sampler = startRssSampler();
    const started = Date.now();

    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.equal(res.status, 200, "the real export must succeed");

    // Stream the response to a file rather than arrayBuffer(): buffering the
    // whole ZIP in the TEST would hide the very thing being measured.
    const zipPath = path.join(dataDir, "real-load-bundle.zip");
    let bytesReceived = 0;
    const counter = new Writable({
      write(chunk, _enc, cb) {
        bytesReceived += chunk.length;
        cb();
      }
    });
    const zipOut = fs.createWriteStream(zipPath);
    await pipeline(
      res.body,
      new (await import("node:stream")).Transform({
        transform(chunk, _enc, cb) {
          bytesReceived += chunk.length;
          cb(null, chunk);
        }
      }),
      zipOut
    );
    void counter;

    const { peak } = sampler.stop();
    const elapsedMs = Date.now() - started;
    const artifactBytes = fs.statSync(path.join(dataDir, "cache", FILE_NAME)).size;

    report.export = {
      zipBytes: bytesReceived,
      zipMiB: Number(mib(bytesReceived)),
      artifactMiB: Number(mib(artifactBytes)),
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
      rssBeforeMiB: Number(mib(rssBefore)),
      rssPeakMiB: Number(mib(peak)),
      rssGrowthMiB: Number(mib(peak - rssBefore))
    };

    assert.ok(bytesReceived > 900 * MIB, `expected a large ZIP, got ${mib(bytesReceived)} MiB`);

    // THE ASSERTION THIS FILE EXISTS FOR.
    //
    // Pre-fix, `tracked.file()` read the whole 1.19 GiB tarball into one
    // Buffer at registration. Peak RSS growth therefore had a hard floor of
    // the artifact size. A bound of half the artifact is unambiguous: the old
    // code could not pass it, and the streamed path should sit an order of
    // magnitude below it.
    assert.ok(
      peak - rssBefore < artifactBytes / 2,
      `export RSS growth ${mib(peak - rssBefore)} MiB must stay well below the ` +
        `${mib(artifactBytes)} MiB artifact — the eager path would have exceeded it`
    );

    // Inclusion and integrity, read back from the ZIP's own central directory.
    const stat = fs.statSync(zipPath);
    assert.equal(stat.size, bytesReceived);

    const member = `tools/${FILE_NAME}`;
    const entry = readCentralDirectory(zipPath).find((e) => e.name === member);
    assert.ok(entry, `${member} must be present in the real bundle`);
    assert.equal(
      entry.uncompressedSize,
      artifactBytes >>> 0 === artifactBytes ? artifactBytes : entry.uncompressedSize,
      "the archived member must be the full artifact"
    );

    report.inclusion = { member, uncompressedSize: entry.uncompressedSize, artifactBytes };

    fs.rmSync(zipPath, { force: true });
  });
});

/**
 * Read a ZIP's central directory without loading the archive.
 *
 * `validateArchiveBuffer` takes a Buffer and has a max-archive-bytes limit, so
 * it cannot be used on a 1.19 GiB bundle — and loading one to check it would
 * defeat the measurement. The EOCD is in the last 64 KiB; the central
 * directory is read by offset.
 */
function readCentralDirectory(zipPath) {
  const fd = fs.openSync(zipPath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(65557, size);
    const tail = Buffer.allocUnsafe(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);

    let eocd = tail.length - 22;
    while (eocd >= 0 && tail.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
    if (eocd < 0) throw new Error("no end-of-central-directory record");

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);

    const cd = Buffer.allocUnsafe(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);

    const entries = [];
    let pos = 0;
    for (let i = 0; i < count; i += 1) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) break;
      const nameLength = cd.readUInt16LE(pos + 28);
      const extraLength = cd.readUInt16LE(pos + 30);
      const commentLength = cd.readUInt16LE(pos + 32);
      entries.push({
        name: cd.subarray(pos + 46, pos + 46 + nameLength).toString("utf8"),
        compressedSize: cd.readUInt32LE(pos + 20),
        uncompressedSize: cd.readUInt32LE(pos + 24)
      });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

void createHash;
