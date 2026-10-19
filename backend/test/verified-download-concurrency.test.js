/**
 * OpenShift Airgap Architect — concurrent verified downloads (R3)
 *
 * `acquireVerifiedArtifact` stages every transfer in a sibling of its
 * destination before publishing it. Until this change the staging name was
 * `${destPath}.part-${process.pid}`, which is a CONSTANT within one server
 * process: two overlapping acquisitions of the same artifact wrote into one
 * another's staging file, and whichever renamed second failed with
 * `ENOENT ... rename`. That is reachable from the product — `/api/bundle`
 * exports are concurrent by nature, and two browser tabs ticking
 * "include mirror-registry" is all it takes.
 *
 * Three properties are asserted here, and they are deliberately separate:
 *
 *   1. OVERLAP IS SAFE. Concurrent callers for one destination converge on a
 *      single download and all receive the same verified digest.
 *   2. A REJECTED DOWNLOAD IS INERT. The digest is now computed on the staging
 *      file BEFORE publication, so a tampered or truncated transfer is deleted
 *      without the cache path ever being written. It cannot remove another
 *      caller's verified file or that file's sidecar.
 *   3. NOTHING IS LEFT BEHIND. No `.part-*` survives success, failure, or an
 *      abort mid-transfer.
 *
 * Hermetic: a loopback server stands in for the mirror, as in
 * mirror-registry-download.test.js. No egress.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

import { acquireVerifiedArtifact, digestSidecarPath } from "../src/verifiedDownload.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const FILE_NAME = "mirror-registry-amd64.tar.gz";
const PAYLOAD = Buffer.from("stand-in for the 1.19 GiB mirror-registry tarball");

let fixture;
let workDir;

/**
 * Loopback mirror whose artifact route can be made SLOW on purpose.
 *
 * The collision this file pins needs the two transfers to be genuinely in
 * flight at the same time. A body written in two chunks around a timer
 * guarantees the overlap deterministically, rather than hoping the event loop
 * interleaves two instant responses.
 */
function startFixtureMirror() {
  const state = {
    manifest: `${sha256(PAYLOAD)}  ${FILE_NAME}\n`,
    artifact: PAYLOAD,
    delayMs: 0,
    truncate: false,
    requestCount: 0
  };

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/sha256sum.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(state.manifest);
      return;
    }
    if (pathname === `/${FILE_NAME}`) {
      state.requestCount += 1;
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const body = state.artifact;
      const half = Math.floor(body.length / 2);
      res.write(body.subarray(0, half));
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.truncate) {
        // Kill the socket mid-body: the client sees a premature close, which
        // is the interruption case.
        req.destroy();
        return;
      }
      res.end(body.subarray(half));
      return;
    }
    res.writeHead(404).end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const acquire = (destPath) =>
  acquireVerifiedArtifact({
    artifactUrl: `${fixture.base}/${FILE_NAME}`,
    manifestUrl: `${fixture.base}/sha256sum.txt`,
    fileName: FILE_NAME,
    destPath
  });

/** Every `.part-*` staging file currently sitting in the work directory. */
const stagingLeftovers = () =>
  fs.readdirSync(workDir).filter((name) => name.includes(".part-"));

before(async () => {
  fixture = await startFixtureMirror();
  workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oaa-dl-concurrency-"));
});

after(async () => {
  await new Promise((resolve) => fixture.server.close(resolve));
  await fs.promises.rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  fixture.state.manifest = `${sha256(PAYLOAD)}  ${FILE_NAME}\n`;
  fixture.state.artifact = PAYLOAD;
  fixture.state.delayMs = 0;
  fixture.state.truncate = false;
  fixture.state.requestCount = 0;
});

describe("verifiedDownload — overlapping acquisitions of one destination", () => {
  it("serves two concurrent callers one verified artifact, with no rename collision", async () => {
    // The defect reproducer. With a pid-only staging name both calls wrote
    // `<dest>.part-<pid>`; the first rename consumed it and the second threw
    // `ENOENT: no such file or directory, rename`.
    fixture.state.delayMs = 40;
    const dest = path.join(workDir, "concurrent-pair.tar.gz");

    const results = await Promise.all([acquire(dest), acquire(dest)]);

    for (const result of results) {
      assert.equal(result.sha256, sha256(PAYLOAD), "both callers must get the verified digest");
      assert.equal(result.path, dest);
    }
    assert.equal(
      fs.readFileSync(dest).toString(),
      PAYLOAD.toString(),
      "the published artifact must be the verified bytes"
    );
    assert.deepEqual(stagingLeftovers(), [], "no staging file may survive");
  });

  it("de-duplicates in flight rather than fetching the artifact twice", async () => {
    fixture.state.delayMs = 40;
    const dest = path.join(workDir, "dedup.tar.gz");

    await Promise.all([acquire(dest), acquire(dest), acquire(dest)]);

    assert.equal(
      fixture.state.requestCount,
      1,
      "three overlapping callers for one destination must share one transfer"
    );
  });

  it("returns independent result objects, not one shared mutable record", async () => {
    fixture.state.delayMs = 20;
    const dest = path.join(workDir, "independent.tar.gz");

    const [a, b] = await Promise.all([acquire(dest), acquire(dest)]);
    a.sha256 = "mutated";

    assert.equal(b.sha256, sha256(PAYLOAD), "one caller must not be able to corrupt another's result");
  });

  it("refuses two different artifacts aimed at one cache path instead of guessing", async () => {
    fixture.state.delayMs = 40;
    const dest = path.join(workDir, "conflict.tar.gz");

    const first = acquire(dest);
    const second = acquireVerifiedArtifact({
      artifactUrl: `${fixture.base}/some-other-artifact.tar.gz`,
      manifestUrl: `${fixture.base}/sha256sum.txt`,
      fileName: "some-other-artifact.tar.gz",
      destPath: dest
    });

    await assert.rejects(() => second, /already in flight|conflict/i);
    await first;
  });

  it("de-duplication does not outlive the request", async () => {
    const dest = path.join(workDir, "not-sticky.tar.gz");
    const first = await acquire(dest);
    assert.equal(first.cached, false);

    // A second, non-overlapping call must take the cache path, not a stale
    // in-flight entry — proving the map entry is released on settle.
    const second = await acquire(dest);
    assert.equal(second.cached, true, "the second call must re-verify from cache");
  });
});

describe("verifiedDownload — a rejected transfer cannot damage a good one", () => {
  it("leaves another destination's verified file and sidecar untouched when a sibling fails", async () => {
    const good = path.join(workDir, "good.tar.gz");
    const verified = await acquire(good);
    assert.equal(verified.sha256, sha256(PAYLOAD));
    const goodSidecar = digestSidecarPath(good);
    assert.ok(fs.existsSync(goodSidecar), "precondition: the good artifact has a sidecar");

    // Now a concurrent acquisition that will fail verification.
    fixture.state.artifact = Buffer.from("tampered bytes that do not match the manifest");
    fixture.state.delayMs = 20;
    const bad = path.join(workDir, "bad.tar.gz");

    await assert.rejects(() => acquire(bad), /SHA256 mismatch/);

    assert.ok(fs.existsSync(good), "the unrelated verified artifact must survive");
    assert.ok(fs.existsSync(goodSidecar), "the unrelated sidecar must survive");
    assert.equal(fs.readFileSync(good).toString(), PAYLOAD.toString());
    assert.deepEqual(stagingLeftovers(), []);
  });

  it("never publishes unverified bytes to the cache path, even transiently", async () => {
    fixture.state.artifact = Buffer.from("tampered");
    const dest = path.join(workDir, "never-published.tar.gz");

    await assert.rejects(() => acquire(dest), /SHA256 mismatch/);

    assert.equal(
      fs.existsSync(dest),
      false,
      "a mismatching download must be discarded from staging, never written to the cache path"
    );
    assert.equal(fs.existsSync(digestSidecarPath(dest)), false);
    assert.deepEqual(stagingLeftovers(), []);
  });

  it("does not delete a previously verified artifact when a later download mismatches", async () => {
    const dest = path.join(workDir, "survivor.tar.gz");
    await acquire(dest);
    const sidecar = digestSidecarPath(dest);

    // Corrupt the sidecar so the cache path is not taken, then make the mirror
    // serve bad bytes. The re-download must fail WITHOUT destroying the file
    // that is still on disk.
    fs.writeFileSync(sidecar, `${"0".repeat(64)}\n`);
    fixture.state.artifact = Buffer.from("tampered");

    await assert.rejects(() => acquire(dest), /SHA256 mismatch/);

    assert.ok(fs.existsSync(dest), "the existing file must not be collateral damage");
    assert.equal(fs.readFileSync(dest).toString(), PAYLOAD.toString());
    assert.deepEqual(stagingLeftovers(), []);
  });

  it("fails both concurrent callers when the artifact itself is bad, and cleans up once", async () => {
    fixture.state.artifact = Buffer.from("tampered");
    fixture.state.delayMs = 30;
    const dest = path.join(workDir, "both-fail.tar.gz");

    const settled = await Promise.allSettled([acquire(dest), acquire(dest)]);

    assert.equal(settled.length, 2);
    for (const outcome of settled) {
      assert.equal(outcome.status, "rejected");
      assert.match(outcome.reason.message, /SHA256 mismatch/);
    }
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(stagingLeftovers(), []);
  });
});

describe("verifiedDownload — interruption and hostile destinations", () => {
  it("removes its staging file when the transfer is cut mid-body", async () => {
    fixture.state.truncate = true;
    fixture.state.delayMs = 10;
    const dest = path.join(workDir, "interrupted.tar.gz");

    await assert.rejects(() => acquire(dest));

    assert.equal(fs.existsSync(dest), false, "an interrupted transfer must not publish");
    assert.deepEqual(stagingLeftovers(), [], "an interrupted transfer must not leak staging");
  });

  it("refuses a cache destination that is a symlink rather than writing through it", async () => {
    const outside = path.join(workDir, "outside-target.bin");
    fs.writeFileSync(outside, "operator data that must not be clobbered");
    const dest = path.join(workDir, "symlinked.tar.gz");
    fs.symlinkSync(outside, dest);

    await assert.rejects(() => acquire(dest), /not a regular file/i);

    assert.equal(
      fs.readFileSync(outside).toString(),
      "operator data that must not be clobbered",
      "the symlink target must be untouched"
    );
    fs.unlinkSync(dest);
  });

  it("refuses a cache destination that is a directory", async () => {
    const dest = path.join(workDir, "a-directory.tar.gz");
    fs.mkdirSync(dest);

    await assert.rejects(() => acquire(dest), /not a regular file/i);

    fs.rmdirSync(dest);
  });
});
