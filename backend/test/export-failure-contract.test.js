/**
 * Export failure contract (v2.1 Tranche 8C, L2 acceptance corrections)
 *
 * L2 made the high-side runtime-package members STREAMED: archiver opens the
 * staged paths itself, after registration returns. That bought bounded memory
 * and introduced a failure mode the eager path did not have — archiver
 * downgrades an unreadable entry source to a `warning`, decrements its entry
 * count, and finalizes a ZIP that is simply missing that member.
 *
 * Without a producer-side guard the client receives HTTP 200 and a
 * structurally valid ZIP that silently lacks a member its own manifest claims.
 * Only a downstream importer would notice. That is the hazard pinned here.
 *
 * The contract these tests enforce:
 *   - a complete response is a complete, internally consistent archive;
 *   - an export that loses a streamed member is terminated, not served;
 *   - termination happens once, from one owner, and never writes an error
 *     string into ZIP bytes or attempts a second HTTP response;
 *   - staging is released on every one of those paths;
 *   - nothing leaks an unhandled rejection, and the next export still works.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { ZipArchive } from "archiver";

import { createIntegrityTracker, MANIFEST_FILENAME, validateArchiveBuffer } from "../src/exportIntegrity.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const TEMP_PREFIX = "airgap-runtime-package-";

const stagingDirs = () =>
  new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TEMP_PREFIX)));

const newStagingDirs = (before) =>
  [...stagingDirs()].filter((n) => !before.has(n));

/** Poll on observable filesystem state, never on a fixed delay. */
const waitFor = async (predicate, description, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const waitForStagingRelease = async (before, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  let leaked = newStagingDirs(before);
  while (leaked.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    leaked = newStagingDirs(before);
  }
  return leaked;
};

const bundleState = () => ({
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
    clusterName: "failure-contract",
    baseDomain: "example.com",
    confirmed: true
  },
  methodology: { method: "Agent-Based Installer" },
  credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB fail@test" },
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
    includeHighSideRuntimePackage: true
  }
});

/**
 * A state whose staged run payload is far larger than any socket buffer and
 * does not compress away.
 *
 * `payloads/imported-run.bundle.json` embeds the sanitized state and is
 * registered BEFORE the image archives. A client that does not read the body
 * therefore stalls archiver under TCP backpressure while it is still inside
 * that member, which is what makes the image archives deletable before
 * archiver reaches them — a state-based stall, not a timed one.
 */
const stallingState = () => {
  const state = bundleState();
  state.exportStallFiller = crypto.randomBytes(6 * 1024 * 1024).toString("base64");
  return state;
};

describe("Tracker reports streamed members that never reached the archive", () => {
  let scratch;

  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l2-failc-"));
  });

  after(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  const build = async (register, { swallowWarnings = true } = {}) => {
    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const tracked = createIntegrityTracker(archive);
    const warnings = [];
    archive.on("data", (c) => chunks.push(c));
    archive.on("warning", (e) => {
      warnings.push(e);
      if (!swallowWarnings) throw e;
    });
    register(tracked);
    archive.append(JSON.stringify({ integrity: { files: tracked.getChecksums() } }), {
      name: MANIFEST_FILENAME
    });
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });
    return { tracked, warnings, buffer: Buffer.concat(chunks) };
  };

  it("reports nothing missing for an archive that completed normally", async () => {
    const filePath = path.join(scratch, "present.bin");
    fs.writeFileSync(filePath, "staged content that stays put");

    const { tracked } = await build((t) => t.streamFile(filePath, { name: "runtime-package/present.bin" }));

    assert.deepEqual(tracked.missingStreamedMembers(), []);
  });

  it("reports a streamed member whose source vanished before consumption", async () => {
    const filePath = path.join(scratch, "vanishing.bin");
    fs.writeFileSync(filePath, "staged content deleted before archiver opens it");

    const { tracked, warnings } = await build((t) => {
      t.streamFile(filePath, { name: "runtime-package/images/vanishing.bin" });
      fs.rmSync(filePath);
    });

    // The underlying archiver behavior: a warning, and a finalized archive.
    assert.ok(warnings.length > 0, "archiver must have reported the unreadable source");
    assert.deepEqual(
      tracked.missingStreamedMembers(),
      ["runtime-package/images/vanishing.bin"],
      "the tracker must be able to name what the archive lost"
    );
    // The manifest still claims it: that asymmetry is exactly why the export
    // has to fail rather than ship.
    assert.ok(tracked.getChecksums()["runtime-package/images/vanishing.bin"]);
  });

  it("does not confuse eagerly appended members with streamed ones", async () => {
    const filePath = path.join(scratch, "eager.bin");
    fs.writeFileSync(filePath, "eagerly buffered, cannot go missing");

    const { tracked } = await build((t) => {
      t.file(filePath, { name: "tools/eager.bin" });
      t.append("inline", { name: "inline.txt" });
      fs.rmSync(filePath);
    });

    // An eager member is already in memory, so deleting its source after
    // registration cannot drop it from the archive and must not be reported.
    assert.deepEqual(tracked.missingStreamedMembers(), []);
  });
});

describe("Export failure contract over HTTP", () => {
  let server;
  let baseUrl;
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);

  before(async () => {
    process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
    process.on("unhandledRejection", onUnhandled);
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    await closeTestServer(server);
    process.off("unhandledRejection", onUnhandled);
    delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  });

  const postBundle = (state, init = {}) =>
    fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
      ...init
    });

  const expectHealthyExport = async () => {
    const res = await postBundle(bundleState());
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const validated = validateArchiveBuffer(bytes);
    assert.equal(validated.valid, true);
    return validated;
  };

  it("a losable streamed member terminates the transfer instead of serving a short archive", async () => {
    unhandled.length = 0;
    const before = stagingDirs();

    const res = await postBundle(stallingState());
    // Headers are already committed by the time anything can go wrong, so the
    // only honest failure left is a terminated transfer.
    assert.equal(res.status, 200);

    // Deliberately do not read the body: archiver is now blocked writing the
    // oversized run payload, which is registered before the image archives.
    const stagingRoot = await waitFor(() => {
      const created = newStagingDirs(before);
      return created.length === 1 ? path.join(os.tmpdir(), created[0]) : null;
    }, "the staging directory to appear");

    const imagesDir = path.join(stagingRoot, "runtime-package", "images");
    const images = await waitFor(() => {
      if (!fs.existsSync(imagesDir)) return null;
      const found = fs.readdirSync(imagesDir);
      return found.length === 2 ? found : null;
    }, "both staged image archives to exist");

    // Precondition, asserted rather than assumed: archiver has not finished
    // with these yet, because the client has not read a byte.
    for (const name of images) {
      assert.ok(fs.existsSync(path.join(imagesDir, name)), `${name} should still be staged`);
      fs.rmSync(path.join(imagesDir, name));
    }

    // Now let the response drain. The transfer itself must fail.
    //
    // This assertion is deliberately strict. "The bytes would not have passed
    // a validator" is NOT good enough and would pass without the producer-side
    // guard: the companion tracker test above proves archiver happily
    // finalizes a complete, well-formed archive that is merely missing the
    // member, and the manifest mismatch would only be caught by whoever
    // imports it later. The export operation itself has to signal failure.
    let body = null;
    let transferError = null;
    try {
      body = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      transferError = err;
    }

    assert.ok(
      transferError,
      `the export must terminate the transfer; instead it completed with ${body?.length} bytes`
    );

    assert.deepEqual(
      await waitForStagingRelease(before),
      [],
      "a failed export must still release its staging"
    );
    assert.deepEqual(
      unhandled.map((r) => String(r?.message || r)),
      [],
      "failure handling must not leak an unhandled rejection"
    );

    // And the server is still healthy afterwards.
    await expectHealthyExport();
  });

  it("a client disconnect mid-transfer releases staging and never hangs", async () => {
    unhandled.length = 0;
    const before = stagingDirs();
    const controller = new AbortController();

    const res = await postBundle(stallingState(), { signal: controller.signal });
    assert.equal(res.status, 200);

    // Disconnect while the server is still streaming (the body is unread and
    // large, so it provably has not finished).
    controller.abort();

    await assert.rejects(
      res.arrayBuffer(),
      (err) => err?.name === "AbortError" || /abort|terminated/i.test(String(err?.message))
    );

    assert.deepEqual(
      await waitForStagingRelease(before),
      [],
      "a disconnected export must release its staging"
    );
    assert.deepEqual(unhandled.map((r) => String(r?.message || r)), []);

    await expectHealthyExport();
  });

  it("a successful export is unchanged: complete, valid and fully covered", async () => {
    unhandled.length = 0;
    const before = stagingDirs();

    const validated = await expectHealthyExport();
    const runtimeEntries = Object.keys(validated.entries).filter((n) =>
      n.startsWith("runtime-package/")
    );
    assert.ok(runtimeEntries.some((n) => n.startsWith("runtime-package/images/")));
    for (const name of runtimeEntries) {
      assert.ok(validated.manifest.integrity.files[name], `${name} lost manifest coverage`);
    }

    assert.deepEqual(await waitForStagingRelease(before), []);
    assert.deepEqual(unhandled.map((r) => String(r?.message || r)), []);
  });

  it("appends no error text to a partially delivered body", async () => {
    // The pre-L2 handler answered every archive error with
    // `res.status(500).end(String(err))`, which on a committed response writes
    // the error text into the ZIP byte stream. Here the client has already
    // received real archive bytes before the failure, so anything appended
    // afterwards would be observable.
    const before = stagingDirs();
    const res = await postBundle(stallingState());
    assert.equal(res.status, 200);

    const reader = res.body.getReader();
    const received = [];
    const first = await reader.read();
    assert.ok(first.value?.length > 0, "expected real archive bytes before the failure");
    received.push(Buffer.from(first.value));

    const stagingRoot = await waitFor(() => {
      const created = newStagingDirs(before);
      return created.length === 1 ? path.join(os.tmpdir(), created[0]) : null;
    }, "the staging directory to appear");
    const imagesDir = path.join(stagingRoot, "runtime-package", "images");
    await waitFor(
      () => (fs.existsSync(imagesDir) && fs.readdirSync(imagesDir).length === 2 ? true : null),
      "both staged image archives to exist"
    );
    fs.rmSync(imagesDir, { recursive: true, force: true });

    let terminated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(Buffer.from(value));
      }
    } catch {
      terminated = true;
    }

    const body = Buffer.concat(received);
    assert.ok(terminated, "the partial transfer must end in failure, not completion");
    assert.equal(body[0], 0x50, "delivered bytes must still be ZIP data");
    assert.equal(body[1], 0x4b, "delivered bytes must still be ZIP data");
    assert.ok(
      !/Error:|simulated|ENOENT/i.test(body.subarray(Math.max(0, body.length - 8192)).toString("latin1")),
      "an error string must never be appended to ZIP output"
    );

    assert.deepEqual(await waitForStagingRelease(before), []);
  });
});

describe("Pipeline rejection that lands before the final await", () => {
  /**
   * MECHANISM TEST, not a route test — and deliberately labelled as such.
   *
   * In `buildBundleZip` the window between `pipeline(archive, res)` and
   * `await archiveDone` is only non-empty when an export option that performs
   * a download is set (`includeClientTools`, `includeInstaller`,
   * `includeMirrorRegistry` are the only awaits in between). Those take real
   * network latency, which this suite must not depend on, so the production
   * window itself is not reachable offline. What is reachable, and what this
   * pins, is the promise lifecycle the fix relies on: a pipeline that rejects
   * while unrelated work is still being awaited must not raise an unhandled
   * rejection, and must still deliver its outcome to the later await.
   */
  it("is observed immediately and still surfaces at the later await", async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const http = await import("node:http");
    const { pipeline } = await import("node:stream/promises");

    const deferred = () => {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      return { promise, resolve };
    };
    const streaming = deferred();      // server has started writing
    const disconnected = deferred();   // server has seen the client go away
    const preparation = deferred();    // stand-in for the download awaits
    let outcome = null;

    const server = http.createServer(async (req, res) => {
      const archive = new ZipArchive({ zlib: { level: 1 } });
      archive.on("error", () => {});
      const archiveDone = pipeline(archive, res);
      archiveDone.catch(() => {}); // the fix: observed the moment it exists
      res.on("close", disconnected.resolve);

      archive.append("x".repeat(1024), { name: "a.txt" });
      archive.finalize().catch(() => {});
      res.on("drain", streaming.resolve);
      streaming.resolve();

      // The test, not a timer, decides when this completes — after the client
      // has provably disconnected.
      await preparation.promise;

      try {
        await archiveDone;
        outcome = "resolved";
      } catch (err) {
        outcome = `rejected:${err.code}`;
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      const controller = new AbortController();
      const request = fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
        .then((r) => r.arrayBuffer())
        .catch(() => {});

      // Abort only once the handler is actually streaming, otherwise the
      // request can be cancelled before the server ever sees it.
      await streaming.promise;
      controller.abort();
      await request;
      await disconnected.promise;    // the rejection has now happened...

      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        unhandled.map((r) => String(r?.message || r)),
        [],
        "a rejection before the final await must already be observed"
      );

      preparation.resolve();         // ...and only now do we reach the await
      await waitFor(() => outcome, "the handler to finish");

      assert.equal(
        outcome,
        "rejected:ERR_STREAM_PREMATURE_CLOSE",
        "observing the rejection early must not consume it"
      );
      assert.deepEqual(unhandled.map((r) => String(r?.message || r)), []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("Archive error before the response is committed", () => {
  it("still reports a server error rather than a partial body", async () => {
    // Reached directly, because an archiver-level failure before the first
    // flush is not reachable through the HTTP route: install-config is
    // appended and flushed before any streamed member is registered. This
    // pins the pre-commit branch's behavior — one response, a 500 status, and
    // no ZIP bytes.
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const tracked = createIntegrityTracker(archive);

    let statusCode = null;
    let ended = null;
    let endCalls = 0;
    const res = Object.assign(sink, {
      headersSent: false,
      status(code) { statusCode = code; return this; },
      end(payload) { endCalls += 1; ended = payload; return this; }
    });

    // The production shape: a single owner decides how to terminate.
    const failures = [];
    archive.on("error", (err) => {
      failures.push(err);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        res.status(500).end(String(err));
      }
    });

    tracked.append("content", { name: "install-config.yaml" });
    archive.emit("error", Object.assign(new Error("simulated archive failure"), { code: "EFAIL" }));

    assert.equal(statusCode, 500, "a pre-commit failure must answer with 500");
    assert.equal(endCalls, 1, "exactly one response may be sent");
    assert.match(String(ended), /simulated archive failure/);
  });
});
