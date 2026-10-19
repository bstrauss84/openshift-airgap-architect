/**
 * OpenShift Airgap Architect — mirror-registry is streamed INTO the ZIP (R1)
 *
 * `verifiedDownload.js` streams the 1.19 GiB mirror-registry tarball to disk
 * instead of buffering it twice. `backend/src/index.js` then handed that file
 * to `tracked.file()`, which is `fs.readFileSync` — so the whole artifact was
 * loaded into one Buffer at bundle-registration time anyway, inside a
 * container with a memory limit. The download-side saving was given straight
 * back.
 *
 * Registration is a single synchronous pass, so these Buffers ACCUMULATE with
 * the other members rather than alternating with archiver's drain. That is the
 * mechanism measured in export-stream-memory.test.js and it applies here at
 * roughly twenty times the size.
 *
 * `tracked.streamFile()` is the bounded path, but it carries a precondition
 * the cache path cannot meet: exclusive ownership, because archiver opens the
 * path later, while the response drains. `dataDir/cache` is shared. The export
 * therefore hard-links the verified inode into a private staging directory and
 * streams THAT, and proves via `expectedSha256` that the inode being archived
 * is the inode that was verified.
 *
 * WHAT IS AND IS NOT PROVEN HERE
 *
 * The bounded-memory assertions use a 64 MiB fixture, which is large enough
 * for the eager path's allocation to be unmistakable and small enough to keep
 * the default suite fast and offline. The claim being tested is that
 * registration cost is INDEPENDENT of member size — the 16/64 MiB scaling case
 * is what establishes that, and it is what licenses the extrapolation to
 * 1.19 GiB. A real 1.19 GiB export is NOT performed here and is not claimed.
 *
 * Hermetic: `globalThis.fetch` is stubbed with a fixture mirror. No egress.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { ZipArchive } from "archiver";

import {
  createIntegrityTracker,
  computeSha256File,
  MANIFEST_FILENAME,
  validateArchiveBuffer
} from "../src/exportIntegrity.js";
import { dataDir } from "../src/db.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const MIB = 1024 * 1024;
const MIRROR_BASE = "https://mirror.openshift.com/pub/cgw/mirror-registry/latest";
const SUPPORTED_ARCHES = ["amd64", "ppc64le", "s390x"];

let scratch;

/** Patterned, non-trivially compressible bytes, written without a giant Buffer. */
const writeFixture = (filePath, sizeMiB) => {
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

/**
 * Entries as the ZIP's own central directory records them.
 *
 * Deliberately independent of the product's manifest: the whole point of the
 * inclusion assertion is to compare what the archive CONTAINS against what the
 * manifest CLAIMS, so it cannot be derived from the manifest.
 */
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
    entries.push({
      name: buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8"),
      compressedSize: buffer.readUInt32LE(pos + 20),
      uncompressedSize: buffer.readUInt32LE(pos + 24)
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

before(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-mr-stream-"));
});

after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ *
 * Tracker level: the helper repair that makes the streamed path safe.
 * ------------------------------------------------------------------------ */

describe("streamFile — expectedSha256 binds the archived inode to the verified one", () => {
  const buildDiscarding = async (register) => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const tracked = createIntegrityTracker(archive);
    archive.pipe(new Writable({ write(_c, _e, cb) { cb(); } }));

    const before = process.memoryUsage().arrayBuffers;
    let thrown = null;
    try {
      register(tracked);
    } catch (err) {
      thrown = err;
    }
    const heldAtRegistration = process.memoryUsage().arrayBuffers - before;

    archive.append("manifest", { name: MANIFEST_FILENAME });
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });
    return { heldAtRegistration, tracked, thrown };
  };

  it("accepts the bare-hex digest verifiedDownload.js returns", () => {
    const filePath = path.join(scratch, "bare-hex.bin");
    fs.writeFileSync(filePath, "verified payload");
    const bare = computeSha256File(filePath).replace(/^sha256:/, "");

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.pipe(new Writable({ write(_c, _e, cb) { cb(); } }));
    const tracked = createIntegrityTracker(archive);

    tracked.streamFile(filePath, { name: "tools/x.tar.gz", expectedSha256: bare });
    assert.equal(tracked.getChecksums()["tools/x.tar.gz"], `sha256:${bare}`);
    archive.finalize();
  });

  it("accepts the sha256:-prefixed form as well", () => {
    const filePath = path.join(scratch, "prefixed.bin");
    fs.writeFileSync(filePath, "verified payload");
    const prefixed = computeSha256File(filePath);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.pipe(new Writable({ write(_c, _e, cb) { cb(); } }));
    const tracked = createIntegrityTracker(archive);

    tracked.streamFile(filePath, { name: "tools/x.tar.gz", expectedSha256: prefixed });
    assert.equal(tracked.getChecksums()["tools/x.tar.gz"], prefixed);
    archive.finalize();
  });

  it("REFUSES bytes that are not the bytes that were verified", async () => {
    const filePath = path.join(scratch, "swapped.bin");
    fs.writeFileSync(filePath, "these are not the verified bytes");

    const { thrown } = await buildDiscarding((t) =>
      t.streamFile(filePath, {
        name: "tools/mirror-registry-amd64.tar.gz",
        expectedSha256: "f".repeat(64)
      })
    );

    assert.ok(thrown, "a digest mismatch must throw");
    assert.match(thrown.message, /not the bytes that were verified/);
  });

  it("leaves the tracker untouched on refusal, so the request stays unfulfilled", async () => {
    // The ordering that matters. If the member were registered and only then
    // rejected, `unfulfilledRequests()` would see a fulfilled request and the
    // export would ship an unverified tool.
    const filePath = path.join(scratch, "ordering.bin");
    fs.writeFileSync(filePath, "unverified");

    const { tracked, thrown } = await buildDiscarding((t) => {
      t.requestDeliverable("includeMirrorRegistry", ["tools/mirror-registry-amd64.tar.gz"]);
      t.streamFile(filePath, {
        name: "tools/mirror-registry-amd64.tar.gz",
        expectedSha256: "a".repeat(64)
      });
    });

    assert.ok(thrown);
    assert.deepEqual(
      tracked.getChecksums(),
      {},
      "a refused member must not appear in the manifest checksums"
    );
    assert.deepEqual(tracked.missingStreamedMembers(), [], "nor be tracked as streamed");
    const unfulfilled = tracked.unfulfilledRequests();
    assert.equal(unfulfilled.length, 1, "the deliverable must remain unfulfilled");
    assert.deepEqual(unfulfilled[0].missing, ["tools/mirror-registry-amd64.tar.gz"]);
  });

  it("does not leak expectedSha256 into the archive entry metadata", async () => {
    const filePath = path.join(scratch, "no-leak.bin");
    fs.writeFileSync(filePath, "payload");
    const digest = computeSha256File(filePath);

    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("data", (c) => chunks.push(c));
    const tracked = createIntegrityTracker(archive);
    tracked.streamFile(filePath, { name: "tools/clean.tar.gz", expectedSha256: digest });
    archive.append("{}", { name: MANIFEST_FILENAME });
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });

    const buffer = Buffer.concat(chunks);
    assert.equal(
      buffer.includes(Buffer.from("expectedSha256")),
      false,
      "the verification hint must not be written into the ZIP"
    );
  });
});

describe("mirror-registry sized member — registration cost is independent of size", () => {
  const buildDiscarding = async (register) => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const tracked = createIntegrityTracker(archive);
    archive.pipe(new Writable({ write(_c, _e, cb) { cb(); } }));
    const before = process.memoryUsage().arrayBuffers;
    register(tracked);
    const heldAtRegistration = process.memoryUsage().arrayBuffers - before;
    archive.append("manifest", { name: MANIFEST_FILENAME });
    await new Promise((resolve, reject) => {
      archive.on("end", resolve);
      archive.on("error", reject);
      archive.finalize();
    });
    return { heldAtRegistration, checksums: tracked.getChecksums() };
  };

  it("CONTROL: the old tracked.file() path holds the whole tarball at registration", async () => {
    const sizeMiB = 64;
    const filePath = writeFixture(path.join(scratch, "mr-eager.tar.gz"), sizeMiB);

    const { heldAtRegistration } = await buildDiscarding((t) =>
      t.file(filePath, { name: "tools/mirror-registry-amd64.tar.gz" })
    );

    assert.ok(
      heldAtRegistration >= sizeMiB * MIB * 0.8,
      `the defect: expected ~${sizeMiB} MiB held, saw ${(heldAtRegistration / MIB).toFixed(1)} MiB. ` +
        `At the real 1.19 GiB this is the allocation that was happening.`
    );
  });

  it("the streamed path holds nothing proportional to the tarball", async () => {
    const sizeMiB = 64;
    const filePath = writeFixture(path.join(scratch, "mr-streamed.tar.gz"), sizeMiB);

    const { heldAtRegistration, checksums } = await buildDiscarding((t) =>
      t.streamFile(filePath, {
        name: "tools/mirror-registry-amd64.tar.gz",
        expectedSha256: computeSha256File(filePath)
      })
    );

    assert.ok(
      heldAtRegistration < 4 * MIB,
      `expected bounded allocation, held ${(heldAtRegistration / MIB).toFixed(1)} MiB ` +
        `for a ${sizeMiB} MiB member`
    );
    assert.equal(
      checksums["tools/mirror-registry-amd64.tar.gz"],
      computeSha256File(filePath),
      "the manifest must still carry the member's digest"
    );
  });

  it("scaling: quadrupling the tarball does not change registration cost", async () => {
    // This is the assertion that licenses the extrapolation from a 64 MiB
    // fixture to the real 1.19 GiB artifact. A size-dependent cost would show
    // up as a 4x difference here.
    const small = writeFixture(path.join(scratch, "mr-scale-16.tar.gz"), 16);
    const large = writeFixture(path.join(scratch, "mr-scale-64.tar.gz"), 64);

    const a = await buildDiscarding((t) =>
      t.streamFile(small, { name: "tools/small.tar.gz" })
    );
    const b = await buildDiscarding((t) =>
      t.streamFile(large, { name: "tools/large.tar.gz" })
    );

    assert.ok(a.heldAtRegistration < 4 * MIB);
    assert.ok(b.heldAtRegistration < 4 * MIB);
    assert.ok(
      Math.abs(b.heldAtRegistration - a.heldAtRegistration) < 4 * MIB,
      `registration cost must not scale with size: 16 MiB held ` +
        `${(a.heldAtRegistration / MIB).toFixed(1)} MiB, 64 MiB held ` +
        `${(b.heldAtRegistration / MIB).toFixed(1)} MiB`
    );
  });
});

/* ------------------------------------------------------------------------ *
 * End to end: the real /api/bundle.zip path, with a fixture mirror.
 * ------------------------------------------------------------------------ */

const bundleState = (exportOptions) => ({
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
    clusterName: "mr-stream",
    baseDomain: "example.com",
    confirmed: true
  },
  methodology: { method: "Agent-Based Installer" },
  credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB mr@test" },
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
    ...exportOptions
  }
});

describe("mirror-registry export over HTTP — selection and inclusion", () => {
  let server;
  let baseUrl;
  const realFetch = globalThis.fetch;
  const cacheDir = path.join(dataDir, "cache");

  // 8 MiB: big enough that a buffered read is visible against the rest of the
  // bundle, small enough that three architectures stay quick. The bounded
  // -memory claim is carried by the 64 MiB cases above; this suite exists to
  // prove SELECTION and INCLUSION end to end.
  const FIXTURE_MIB = 8;
  const payloads = new Map();
  let manifestBody;
  const fetched = [];

  before(async () => {
    let manifestLines = "";
    for (const arch of SUPPORTED_ARCHES) {
      const fileName = `mirror-registry-${arch}.tar.gz`;
      const filePath = writeFixture(path.join(scratch, `fixture-${fileName}`), FIXTURE_MIB);
      const bytes = fs.readFileSync(filePath);
      payloads.set(fileName, bytes);
      manifestLines += `${createHash("sha256").update(bytes).digest("hex")}  ${fileName}\n`;
    }
    manifestBody = manifestLines;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? input);
      if (url.startsWith(MIRROR_BASE)) {
        fetched.push(url);
        const name = url.slice(MIRROR_BASE.length + 1);
        if (name === "sha256sum.txt") {
          return { ok: true, status: 200, text: async () => manifestBody };
        }
        const bytes = payloads.get(name);
        if (!bytes) return { ok: false, status: 404, text: async () => "not found" };
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              // Chunked on purpose: a single enqueue would not exercise the
              // streaming write path the way the real CDN does.
              for (let off = 0; off < bytes.length; off += 1 * MIB) {
                controller.enqueue(new Uint8Array(bytes.subarray(off, off + 1 * MIB)));
              }
              controller.close();
            }
          })
        };
      }
      if (url.includes("mirror.openshift.com") || url.includes("api.openshift.com")) {
        throw new Error(`offline: unexpected egress to ${url}`);
      }
      return realFetch(input, init);
    };

    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await closeTestServer(server);
    // Never leave a multi-megabyte cache artifact behind.
    for (const arch of SUPPORTED_ARCHES) {
      for (const suffix of ["", ".sha256"]) {
        fs.rmSync(path.join(cacheDir, `mirror-registry-${arch}.tar.gz${suffix}`), { force: true });
      }
    }
    for (const name of fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []) {
      if (name.startsWith("export-mirror-registry-")) {
        fs.rmSync(path.join(cacheDir, name), { recursive: true, force: true });
      }
    }
  });

  const post = (exportOptions) =>
    realFetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: bundleState(exportOptions) })
    });

  for (const arch of SUPPORTED_ARCHES) {
    it(`includes tools/mirror-registry-${arch}.tar.gz, intact and checksum-matched`, async () => {
      const res = await post({ includeMirrorRegistry: true, mirrorRegistryArch: arch });
      assert.equal(res.status, 200, `export must succeed for ${arch}`);

      const bytes = Buffer.from(await res.arrayBuffer());
      const validated = validateArchiveBuffer(bytes);
      assert.equal(validated.valid, true, `archive must validate: ${JSON.stringify(validated.errors)}`);

      const member = `tools/mirror-registry-${arch}.tar.gz`;
      const expected = payloads.get(`mirror-registry-${arch}.tar.gz`);
      const recorded = validated.manifest.integrity.files[member];

      assert.ok(recorded, `the manifest must record ${member}`);
      assert.equal(
        recorded,
        `sha256:${createHash("sha256").update(expected).digest("hex")}`,
        "the recorded digest must be the digest of the verified artifact"
      );

      // SELECTION: only the requested architecture, never a sibling.
      for (const other of SUPPORTED_ARCHES.filter((a) => a !== arch)) {
        assert.equal(
          validated.manifest.integrity.files[`tools/mirror-registry-${other}.tar.gz`],
          undefined,
          `requesting ${arch} must not include ${other}`
        );
      }

      // INCLUSION: read the ZIP's own central directory. A streamed member
      // that archiver dropped (it downgrades an unreadable source to a
      // `warning` and omits the entry) would be absent HERE while the
      // manifest above still claimed it — which is precisely the failure the
      // manifest alone cannot detect.
      const entry = readZipEntries(bytes).find((e) => e.name === member);
      assert.ok(entry, `${member} must be present in the archive, not only in the manifest`);
      assert.equal(
        entry.uncompressedSize,
        expected.length,
        "the archived member must be the full artifact, not a truncated one"
      );

      const delivery = validated.manifest.delivery.requested.find(
        (r) => r.option === "includeMirrorRegistry"
      );
      assert.ok(delivery, "the deliverable must be declared");
      assert.equal(delivery.fulfilled, true, "and recorded as fulfilled");
      assert.deepEqual(delivery.included, [member]);
    });
  }

  it("reuses the verified cache on a second export without re-downloading", async () => {
    fetched.length = 0;
    const res = await post({ includeMirrorRegistry: true, mirrorRegistryArch: "amd64" });
    assert.equal(res.status, 200);
    await res.arrayBuffer();

    assert.equal(
      fetched.filter((u) => u.endsWith("mirror-registry-amd64.tar.gz")).length,
      0,
      "a cached, still-matching artifact must not be downloaded again"
    );
  });

  it("releases its export staging directory, keeping the verified cache", async () => {
    const res = await post({ includeMirrorRegistry: true, mirrorRegistryArch: "amd64" });
    assert.equal(res.status, 200);
    await res.arrayBuffer();

    const leaked = fs
      .readdirSync(cacheDir)
      .filter((n) => n.startsWith("export-mirror-registry-"));
    assert.deepEqual(leaked, [], "the hard-link staging directory must be removed");
    assert.ok(
      fs.existsSync(path.join(cacheDir, "mirror-registry-amd64.tar.gz")),
      "the verified cache entry itself must survive — the next export depends on it"
    );
  });

  it("rejects an unsupported architecture instead of silently using amd64", async () => {
    // Red Hat publishes no ARM build: arm64 and aarch64 both 404 on the real
    // mirror. Falling back to amd64 would ship an unusable registry across an
    // air gap, where it cannot be replaced.
    const res = await post({ includeMirrorRegistry: true, mirrorRegistryArch: "arm64" });

    if (res.status === 200) {
      const bytes = Buffer.from(await res.arrayBuffer());
      const validated = validateArchiveBuffer(bytes);
      assert.equal(
        validated.valid && validated.manifest.integrity.files["tools/mirror-registry-amd64.tar.gz"],
        undefined,
        "an unsupported architecture must never be fulfilled with the amd64 build"
      );
      assert.fail(`expected the export to fail, got a complete archive`);
    } else {
      assert.ok(res.status >= 500 || res.status === 400, `got ${res.status}`);
    }
  });

  it("does not include the tarball when the option is off", async () => {
    const res = await post({ includeMirrorRegistry: false });
    assert.equal(res.status, 200);
    const validated = validateArchiveBuffer(Buffer.from(await res.arrayBuffer()));
    assert.equal(validated.valid, true);
    for (const arch of SUPPORTED_ARCHES) {
      assert.equal(
        validated.manifest.integrity.files[`tools/mirror-registry-${arch}.tar.gz`],
        undefined
      );
    }
  });

  it("fails the export when the mirror serves bytes that fail verification", async () => {
    // No partial, unverified or missing member may pass as success.
    const arch = "s390x";
    const fileName = `mirror-registry-${arch}.tar.gz`;
    fs.rmSync(path.join(cacheDir, fileName), { force: true });
    fs.rmSync(path.join(cacheDir, `${fileName}.sha256`), { force: true });
    const good = payloads.get(fileName);
    payloads.set(fileName, Buffer.concat([good.subarray(0, good.length - 16), Buffer.alloc(16)]));

    try {
      // Headers are committed before the tool blocks run, so a clean 5xx is
      // not available at this point: the honest ending is a torn-down
      // exchange, which surfaces when the BODY is read, not at the request.
      // Both shapes are failures. What is never acceptable — and is what the
      // pre-fix code did — is a complete, manifest-valid 200.
      let bytes = null;
      try {
        const res = await post({ includeMirrorRegistry: true, mirrorRegistryArch: arch });
        if (res.status !== 200) {
          assert.ok(res.status >= 400, `got ${res.status}`);
          return;
        }
        bytes = Buffer.from(await res.arrayBuffer());
      } catch {
        return; // exchange torn down — an acceptable failure shape
      }

      let validated;
      try {
        validated = validateArchiveBuffer(bytes);
      } catch {
        return; // structurally incomplete archive — also a failure
      }
      assert.equal(
        validated.valid && !!validated.manifest.integrity.files[`tools/${fileName}`],
        false,
        "a tampered artifact must never be delivered inside a complete, valid bundle"
      );
    } finally {
      payloads.set(fileName, good);
      fs.rmSync(path.join(cacheDir, fileName), { force: true });
      fs.rmSync(path.join(cacheDir, `${fileName}.sha256`), { force: true });
    }
  });
});
