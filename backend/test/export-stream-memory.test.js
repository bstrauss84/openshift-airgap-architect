/**
 * Bounded-memory archive members (v2.1 Tranche 8C, finding L2)
 *
 * `createIntegrityTracker.file()` reads a whole member into one Buffer before
 * appending it. Because `buildBundleZip` registers every member in a single
 * synchronous pass, archiver's queue cannot drain in between and those Buffers
 * ACCUMULATE. Measured on the reference host, against a backend pod sized
 * `requests.memory 1Gi` / `limits.memory 4Gi`:
 *
 *   real staged runtime package, 590 MB (podman oci-archive)
 *       eager peak RSS growth 628 MB   streamed 71 MB
 *   synthetic 1280 MB member (the `docker save` size regime, uncompressed)
 *       eager peak RSS growth 1287 MB  streamed 71 MB
 *   two synthetic 512 MB members registered in one pass
 *       eager peak RSS growth 1030 MB — confirming accumulation, not reuse
 *
 * `streamFile()` is the bounded alternative: a 64 KB rolling window computes
 * the digest up front (so the manifest can still be built synchronously and
 * appended last), then archiver opens the path itself while the response
 * drains. Registration allocates nothing proportional to the file.
 *
 * `file()` is deliberately NOT changed. Its eager read is load-bearing: the
 * bytes hashed and the bytes archived are the same Buffer, which is what makes
 * a mid-export mutation unable to desynchronise the manifest from the archive
 * (see the TOCTOU test in export-integrity.test.js). `streamFile()` trades
 * that snapshot for bounded memory and is therefore only valid for files the
 * caller exclusively owns — today, the high-side runtime package staging
 * directory and nothing else.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { ZipArchive } from "archiver";

import {
  createIntegrityTracker,
  computeSha256,
  computeSha256File,
  MANIFEST_FILENAME,
  validateArchiveBuffer
} from "../src/exportIntegrity.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const MIB = 1024 * 1024;

let scratch;

/** Write `sizeMiB` of patterned (non-trivially compressible) bytes. */
const writeFixture = (name, sizeMiB) => {
  const filePath = path.join(scratch, name);
  const chunk = Buffer.allocUnsafe(4 * MIB);
  for (let i = 0; i < chunk.length; i += 1) chunk[i] = (i * 17 + 3) & 0xff;
  const fd = fs.openSync(filePath, "w");
  try {
    for (let i = 0; i < sizeMiB / 4; i += 1) {
      chunk[0] = i & 0xff;
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  return filePath;
};

/** Build a zip through the tracker, discarding bytes, and report allocation. */
const buildDiscarding = async (register) => {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const tracked = createIntegrityTracker(archive);
  archive.pipe(new Writable({ write(_chunk, _enc, cb) { cb(); } }));

  const before = process.memoryUsage().arrayBuffers;
  register(tracked);
  // Buffer memory held at the moment registration returns. This is the number
  // that accumulates across members in the real export, and it is stable to
  // ~0.1 MB across runs, unlike RSS.
  const heldAtRegistration = process.memoryUsage().arrayBuffers - before;

  archive.append("manifest", { name: MANIFEST_FILENAME });
  await new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.finalize();
  });

  return { heldAtRegistration, checksums: tracked.getChecksums() };
};

/** Collect zip entries with their unix mode, from the central directory. */
const readZipEntries = (buffer) => {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  assert.ok(eocd >= 0, "no end-of-central-directory record");
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(pos), 0x02014b50, "bad central directory signature");
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const externalAttrs = buffer.readUInt32LE(pos + 38);
    entries.push({
      name: buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8"),
      unixMode: (externalAttrs >>> 16) & 0o7777
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const collectZip = async (register) => {
  const chunks = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const tracked = createIntegrityTracker(archive);
  archive.on("data", (chunk) => chunks.push(chunk));
  register(tracked);
  const checksums = tracked.getChecksums();
  archive.append(JSON.stringify({ integrity: { files: checksums } }), { name: MANIFEST_FILENAME });
  await new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.finalize();
  });
  return { buffer: Buffer.concat(chunks), checksums };
};

before(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-l2-stream-"));
});

after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("Bounded-memory archive members (streamFile)", () => {
  it("computes the same digest as the eager path, byte for byte", () => {
    const filePath = path.join(scratch, "digest-parity.bin");
    const content = Buffer.from("runtime package payload \u0000ÿ binary-ish bytes".repeat(500));
    fs.writeFileSync(filePath, content);

    assert.equal(computeSha256File(filePath), computeSha256(content));
  });

  it("digests a file larger than its read window correctly", () => {
    // 64 KB window: this file is several windows plus a partial trailing one,
    // which is where an off-by-one in the read loop would show up.
    const filePath = path.join(scratch, "multi-window.bin");
    const content = Buffer.allocUnsafe(64 * 1024 * 3 + 1234);
    for (let i = 0; i < content.length; i += 1) content[i] = (i * 7 + 11) & 0xff;
    fs.writeFileSync(filePath, content);

    assert.equal(computeSha256File(filePath), computeSha256(content));
  });

  it("digests an empty file correctly", () => {
    const filePath = path.join(scratch, "empty.bin");
    fs.writeFileSync(filePath, "");
    assert.equal(computeSha256File(filePath), computeSha256(""));
  });

  it("archives identical bytes, names and modes as the eager path", async () => {
    const filePath = path.join(scratch, "parity.sh");
    fs.writeFileSync(filePath, "#!/usr/bin/env bash\necho hello\n");
    fs.chmodSync(filePath, 0o755);

    const eager = await collectZip((t) => t.file(filePath, { name: "launch/run.sh" }));
    const streamed = await collectZip((t) => t.streamFile(filePath, { name: "launch/run.sh" }));

    assert.deepEqual(
      streamed.checksums,
      eager.checksums,
      "streamed member must carry the same manifest checksum"
    );

    const eagerEntry = readZipEntries(eager.buffer).find((e) => e.name === "launch/run.sh");
    const streamedEntry = readZipEntries(streamed.buffer).find((e) => e.name === "launch/run.sh");
    assert.ok(eagerEntry && streamedEntry, "both archives must contain the entry");
    assert.equal(streamedEntry.unixMode, eagerEntry.unixMode, "mode must be preserved");
    assert.equal(streamedEntry.unixMode, 0o755, "executable bit must survive streaming");
  });

  it("holds the whole member in memory on the eager path (control)", async () => {
    const sizeMiB = 64;
    const filePath = writeFixture("eager-control.bin", sizeMiB);

    const { heldAtRegistration } = await buildDiscarding((t) =>
      t.file(filePath, { name: "images/control.bin" })
    );

    assert.ok(
      heldAtRegistration >= sizeMiB * MIB * 0.8,
      `expected the eager path to hold ~${sizeMiB} MiB at registration, held ${(heldAtRegistration / MIB).toFixed(1)} MiB`
    );
  });

  it("holds no proportional memory on the streamed path", async () => {
    const sizeMiB = 64;
    const filePath = writeFixture("streamed.bin", sizeMiB);

    const { heldAtRegistration, checksums } = await buildDiscarding((t) =>
      t.streamFile(filePath, { name: "images/streamed.bin" })
    );

    assert.ok(
      heldAtRegistration < 4 * MIB,
      `expected bounded allocation, held ${(heldAtRegistration / MIB).toFixed(1)} MiB for a ${sizeMiB} MiB member`
    );
    assert.equal(checksums["images/streamed.bin"], computeSha256File(filePath));
  });

  it("registration cost does not grow with member size", async () => {
    const small = writeFixture("scale-small.bin", 16);
    const large = writeFixture("scale-large.bin", 64);

    const a = await buildDiscarding((t) => t.streamFile(small, { name: "images/a.bin" }));
    const b = await buildDiscarding((t) => t.streamFile(large, { name: "images/b.bin" }));

    // A 4x larger member must not cost meaningfully more to register. Compared
    // against an absolute floor so that two near-zero values cannot produce a
    // misleading ratio.
    assert.ok(
      b.heldAtRegistration < a.heldAtRegistration + 4 * MIB,
      `registration grew with size: ${(a.heldAtRegistration / MIB).toFixed(1)} MiB -> ${(b.heldAtRegistration / MIB).toFixed(1)} MiB`
    );
  });

  it("fails closed when a streamed source disappears before it is consumed", async () => {
    // This is exactly what premature staging cleanup would look like. It must
    // produce a bundle that import validation rejects, never a quietly
    // incomplete one that passes.
    const filePath = path.join(scratch, "vanishing.bin");
    fs.writeFileSync(filePath, "staged content that gets deleted too early");

    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const tracked = createIntegrityTracker(archive);
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("warning", () => {}); // archiver reports a missing source as a warning

    tracked.streamFile(filePath, { name: "runtime-package/images/vanishing.bin" });
    fs.rmSync(filePath);

    archive.append(JSON.stringify({ integrity: { files: tracked.getChecksums() } }), {
      name: MANIFEST_FILENAME
    });
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });

    const names = readZipEntries(Buffer.concat(chunks)).map((e) => e.name);
    assert.ok(
      !names.includes("runtime-package/images/vanishing.bin"),
      "archiver silently omits a member whose source vanished — this is the hazard being pinned"
    );
    assert.ok(
      tracked.getChecksums()["runtime-package/images/vanishing.bin"],
      "the manifest still claims the member, so the mismatch is detectable"
    );
  });
});

describe("Bundle export resource hygiene under streaming", () => {
  let server;
  let baseUrl;
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);

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
      clusterName: "stream-cluster",
      baseDomain: "example.com",
      confirmed: true
    },
    methodology: { method: "Agent-Based Installer" },
    credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB stream@test" },
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

  const postBundle = (init = {}) =>
    fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: bundleState() }),
      ...init
    });

  const openFdCount = () => {
    try {
      return fs.readdirSync("/proc/self/fd").length;
    } catch {
      return null; // not Linux
    }
  };

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

  it("streamed runtime-package members survive until archiver reads them", async () => {
    const res = await postBundle();
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());

    // The members are now opened by archiver after registration returns, so a
    // bundle that validates end to end is proof the staging directory was not
    // released early: every runtime-package entry is present, CRC-correct and
    // matches its manifest sha256.
    const validated = validateArchiveBuffer(bytes);
    assert.equal(validated.valid, true);

    const runtimeEntries = Object.keys(validated.entries).filter((n) =>
      n.startsWith("runtime-package/")
    );
    assert.ok(runtimeEntries.length >= 7, `expected the full package, got ${runtimeEntries.length} entries`);
    assert.ok(runtimeEntries.some((n) => n.startsWith("runtime-package/images/")));
    for (const name of runtimeEntries) {
      assert.ok(validated.entries[name].length > 0, `${name} streamed in empty`);
      assert.ok(validated.manifest.integrity.files[name], `${name} lost its checksum`);
    }
  });

  it("repeated exports leak no file descriptors", async () => {
    // Warm up first: the first request through a route allocates sockets and
    // lazily-opened resources that are not per-export.
    await (await postBundle()).arrayBuffer();

    const before = openFdCount();
    if (before === null) {
      // /proc is unavailable; the rest of this assertion has no meaning here.
      return;
    }

    for (let i = 0; i < 5; i += 1) {
      const res = await postBundle();
      assert.equal(res.status, 200);
      await res.arrayBuffer();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = openFdCount();
    assert.ok(
      after <= before + 4,
      `file descriptors grew across 5 exports: ${before} -> ${after}`
    );
  });

  it("concurrent exports own their staging independently", async () => {
    const stagingPrefix = "airgap-runtime-package-";
    const listStaging = () =>
      new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(stagingPrefix)));
    const before = listStaging();

    // Both in flight at once: each must stream its own staging directory and
    // release only its own, with neither bundle losing or borrowing a member.
    const [a, b] = await Promise.all([postBundle(), postBundle()]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const [bytesA, bytesB] = await Promise.all([
      a.arrayBuffer().then(Buffer.from),
      b.arrayBuffer().then(Buffer.from)
    ]);

    for (const [label, bytes] of [["first", bytesA], ["second", bytesB]]) {
      const validated = validateArchiveBuffer(bytes);
      assert.equal(validated.valid, true, `${label} concurrent bundle failed validation`);
      assert.ok(
        Object.keys(validated.entries).some((n) => n.startsWith("runtime-package/images/")),
        `${label} concurrent bundle lost its streamed image members`
      );
    }

    const deadline = Date.now() + 5000;
    let leaked = [...listStaging()].filter((n) => !before.has(n));
    while (leaked.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      leaked = [...listStaging()].filter((n) => !before.has(n));
    }
    assert.deepEqual(leaked, [], "concurrent exports must each release their own staging");
  });

  it("a disconnected export raises no unhandled rejection and does not wedge the next one", async () => {
    unhandled.length = 0;
    const controller = new AbortController();

    await assert.rejects(
      (async () => {
        const res = await postBundle({ signal: controller.signal });
        controller.abort();
        await res.arrayBuffer();
      })(),
      (err) => err?.name === "AbortError" || /abort/i.test(String(err?.message))
    );

    // The archive-stream anchor rejects on disconnect; if that rejection were
    // not awaited, or finalize()'s were left dangling, it would surface here.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(
      unhandled.map((r) => String(r?.message || r)),
      [],
      "client disconnect must not produce an unhandled rejection"
    );

    const after = await postBundle();
    assert.equal(after.status, 200);
    assert.equal(validateArchiveBuffer(Buffer.from(await after.arrayBuffer())).valid, true);
    assert.deepEqual(unhandled.map((r) => String(r?.message || r)), []);
  });
});
