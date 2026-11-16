/**
 * OpenShift Airgap Architect - Verified external artifact acquisition
 *
 * Covers backend/src/verifiedDownload.js, which is the acquisition path for
 * mirror-registry (bundle export) and openshift-install (bundle export and the
 * AWS region/AMI lookups).
 *
 * WHY THIS FILE LOOKS NOTHING LIKE ITS PREDECESSOR
 *
 * It used to download the real 1.19 GiB mirror-registry artifact from
 * mirror.openshift.com on every backend test run. That was wrong in four
 * separate ways, and all four are fixed here rather than papered over:
 *
 *   1. It was FLAKY. It passed in isolation (70 s) and failed inside the full
 *      suite with `ENOENT ... open .../tmp/mirror-registry-test/...`, which is
 *      how it was found: the suite was red at HEAD f9d59e3 while the continuity
 *      record claimed backend green. The precise interference mechanism was
 *      never proven, and is deliberately not guessed at here — the test is gone.
 *   2. It wrote into the REPOSITORY ROOT `tmp/`, which was not gitignored. A
 *      test that can leave a file in the work tree can change the release
 *      candidate id and invalidate the certification evidence bound to it.
 *   3. It tested NOTHING in the product. It re-implemented `fetch` ->
 *      `arrayBuffer()` -> `writeFileSync` inline, so it asserted against its own
 *      copy of the logic. It would have passed unchanged no matter what
 *      index.js did, including the 2.4 GiB double-buffer it was mirroring.
 *   4. Its second case created a 0-byte file, deleted it, and asserted it was
 *      gone. That exercises `fs`, not this application.
 *
 * These tests are hermetic: a loopback HTTP server stands in for the mirror, so
 * they are fast, deterministic, and run with no egress — which is the minimum
 * bar for the test suite of a disconnected-install tool. The real-mirror check
 * is preserved but opt-in, behind OAA_NETWORK_TESTS=1, so it can never again
 * make the default suite depend on the internet.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

import {
  parseSha256Manifest,
  sha256OfFile,
  acquireVerifiedArtifact,
  digestSidecarPath
} from "../src/verifiedDownload.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Loopback stand-in for the mirror.
 *
 * `routes` maps a pathname to { status, body } and is mutated per test, so a
 * single server covers the serve / tamper / 404 / malformed-manifest cases.
 */
function startFixtureMirror(routes) {
  const server = http.createServer((req, res) => {
    const route = routes[new URL(req.url, "http://localhost").pathname];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, { "content-type": "application/octet-stream" });
    res.end(route.body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe("verifiedDownload — checksum manifest parsing", () => {
  it("parses the two coreutils shapes the mirror publishes", () => {
    const digest = "a".repeat(64);
    const parsed = parseSha256Manifest(
      `${digest}  text-mode.tar.gz\n${"b".repeat(64)} *binary-mode.tar.gz\n`
    );
    assert.equal(parsed.get("text-mode.tar.gz"), digest);
    assert.equal(parsed.get("binary-mode.tar.gz"), "b".repeat(64));
  });

  it("ignores lines that are not checksum entries rather than guessing", () => {
    const digest = "c".repeat(64);
    const parsed = parseSha256Manifest(
      `# a comment\n\nnot-a-digest  thing.tar.gz\n${digest}  real.tar.gz\n`
    );
    assert.equal(parsed.size, 1);
    assert.equal(parsed.get("real.tar.gz"), digest);
  });

  it("normalises digest case so an upper-case manifest still matches", () => {
    const parsed = parseSha256Manifest(`${"D".repeat(64)}  thing.tar.gz\n`);
    assert.equal(parsed.get("thing.tar.gz"), "d".repeat(64));
  });
});

describe("verifiedDownload — acquisition is fail-closed", () => {
  let fixture;
  let workDir;
  const routes = {};
  const payload = Buffer.from("pretend this is a 1.19 GiB mirror-registry tarball");
  const fileName = "mirror-registry-amd64.tar.gz";

  before(async () => {
    fixture = await startFixtureMirror(routes);
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oaa-verified-dl-"));
  });

  after(async () => {
    await new Promise((resolve) => fixture.server.close(resolve));
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  const reset = (manifestBody, artifactBody) => {
    routes["/sha256sum.txt"] = manifestBody === null ? undefined : { body: manifestBody };
    routes[`/${fileName}`] = artifactBody === null ? undefined : { body: artifactBody };
    if (manifestBody === null) delete routes["/sha256sum.txt"];
    if (artifactBody === null) delete routes[`/${fileName}`];
  };

  const acquire = (destPath) =>
    acquireVerifiedArtifact({
      artifactUrl: `${fixture.base}/${fileName}`,
      manifestUrl: `${fixture.base}/sha256sum.txt`,
      fileName,
      destPath
    });

  it("accepts an artifact whose digest matches the published manifest", async () => {
    reset(`${sha256(payload)}  ${fileName}\n`, payload);
    const dest = path.join(workDir, "ok.tar.gz");
    const result = await acquire(dest);

    assert.equal(result.sha256, sha256(payload));
    assert.equal(result.cached, false);
    assert.equal(result.bytes, payload.length);
    assert.deepEqual(await fs.promises.readFile(dest), payload);
  });

  it("REJECTS a tampered artifact and leaves nothing on disk", async () => {
    // The manifest advertises the real payload; the mirror serves something else.
    // The old `size > 0` check accepted exactly this.
    const tampered = Buffer.from("malicious replacement with a perfectly fine size");
    reset(`${sha256(payload)}  ${fileName}\n`, tampered);
    const dest = path.join(workDir, "tampered.tar.gz");

    await assert.rejects(() => acquire(dest), /SHA256 mismatch/);
    assert.equal(fs.existsSync(dest), false, "a failed artifact must not survive on disk");
  });

  it("refuses when the manifest names no entry for the requested file", async () => {
    reset(`${sha256(payload)}  some-other-file.tar.gz\n`, payload);
    const dest = path.join(workDir, "no-entry.tar.gz");

    await assert.rejects(() => acquire(dest), /No SHA256 entry for/);
    assert.equal(fs.existsSync(dest), false, "nothing may be downloaded without an expected digest");
  });

  it("refuses when the manifest is unreachable", async () => {
    reset(null, payload);
    const dest = path.join(workDir, "no-manifest.tar.gz");

    await assert.rejects(() => acquire(dest), /Could not fetch checksum manifest/);
    assert.equal(fs.existsSync(dest), false);
  });

  it("refuses when the manifest parses to no usable entries", async () => {
    reset("<html>captive portal login</html>", payload);
    const dest = path.join(workDir, "junk-manifest.tar.gz");

    await assert.rejects(() => acquire(dest), /no usable SHA256 entries/);
  });

  it("refuses when the artifact itself is unreachable", async () => {
    reset(`${sha256(payload)}  ${fileName}\n`, null);
    const dest = path.join(workDir, "no-artifact.tar.gz");

    await assert.rejects(() => acquire(dest), /Download failed/);
  });
});

describe("verifiedDownload — cache reuse proves the bytes, not just the path", () => {
  let fixture;
  let workDir;
  const routes = {};
  const payload = Buffer.from("cacheable artifact bytes");
  const fileName = "artifact.tar.gz";

  before(async () => {
    routes["/sha256sum.txt"] = { body: `${sha256(payload)}  ${fileName}\n` };
    routes[`/${fileName}`] = { body: payload };
    fixture = await startFixtureMirror(routes);
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oaa-verified-cache-"));
  });

  after(async () => {
    await new Promise((resolve) => fixture.server.close(resolve));
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  const acquire = (destPath) =>
    acquireVerifiedArtifact({
      artifactUrl: `${fixture.base}/${fileName}`,
      manifestUrl: `${fixture.base}/sha256sum.txt`,
      fileName,
      destPath
    });

  it("reuses a cached artifact without re-fetching, and says that it did", async () => {
    const dest = path.join(workDir, "cached.tar.gz");
    const first = await acquire(dest);
    assert.equal(first.cached, false);

    // Take the mirror away entirely. A genuine cache hit must not need it —
    // this is an airgap tool and the bytes were verified when they arrived.
    await new Promise((resolve) => fixture.server.close(resolve));

    const second = await acquire(dest);
    assert.equal(second.cached, true, "reuse must be reported, never silent");
    assert.equal(second.sha256, first.sha256);

    fixture = await startFixtureMirror(routes); // restore for later tests
  });

  it("re-downloads when the cached bytes no longer match their recorded digest", async () => {
    const dest = path.join(workDir, "corrupted.tar.gz");
    await acquire(dest);

    // Simulate on-disk corruption: the sidecar still claims the good digest.
    await fs.promises.writeFile(dest, "corrupted on disk");
    assert.notEqual(await sha256OfFile(dest), sha256(payload));

    const result = await acquire(dest);
    assert.equal(result.cached, false, "corrupt cache must not be reused");
    assert.deepEqual(await fs.promises.readFile(dest), payload);
  });

  it("does not treat an artifact with no recorded digest as verified", async () => {
    const dest = path.join(workDir, "unrecorded.tar.gz");
    // Bytes planted with no sidecar — the shape left behind by any pre-existing
    // cache written before verification existed.
    await fs.promises.writeFile(dest, payload);
    assert.equal(fs.existsSync(digestSidecarPath(dest)), false);

    const result = await acquire(dest);
    assert.equal(result.cached, false, "unverified bytes must be re-acquired, not trusted");
    assert.equal(fs.existsSync(digestSidecarPath(dest)), true);
  });

  it("leaves no .part file behind after a successful transfer", async () => {
    const dest = path.join(workDir, "clean.tar.gz");
    await acquire(dest);
    const leftovers = (await fs.promises.readdir(workDir)).filter((n) => n.includes(".part-"));
    assert.deepEqual(leftovers, []);
  });
});

describe("verifiedDownload — streaming digest", () => {
  it("hashes a file identically to a one-shot hash of the same bytes", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oaa-sha-"));
    try {
      // Larger than one stream chunk, so this exercises the incremental path
      // that replaced readFileSync for the 1.19 GiB artifact.
      const body = Buffer.alloc(3 * 1024 * 1024, "x");
      const file = path.join(dir, "big.bin");
      await fs.promises.writeFile(file, body);
      assert.equal(await sha256OfFile(file), sha256(body));
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});

// The real-mirror contract check lives OUTSIDE this suite, as
// `scripts/security/verify-mirror-artifact-contract.mjs`.
//
// It was briefly a conditionally-skipped describe block here. That is
// forbidden, and correctly so: `backend/test/test-integrity.test.js` fails any
// executable skip in backend/test, because a skip that depends on the
// environment is a test that silently does not run. Making the backend suite
// hermetic and then smuggling a network call back in behind an env var would
// have defeated the point of this whole file. Run the script directly.
