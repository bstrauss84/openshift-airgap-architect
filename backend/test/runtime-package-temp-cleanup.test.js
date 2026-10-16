/**
 * Runtime package staging-directory lifecycle (v2.1 Tranche 8C, finding L1)
 *
 * `createRuntimePackageArtifacts` stages the high-side runtime package in a
 * fresh `os.tmpdir()/airgap-runtime-package-*` directory. In real (non-fixture)
 * mode that directory holds `podman save` / `docker save` output for both
 * runtime images — measured at 1.32 GB (backend) + 347 MB (frontend) ≈ 1.7 GB
 * per export on the reference host. Before L1 it was never removed, on any
 * path.
 *
 * OWNERSHIP CONTRACT PINNED HERE
 *
 * Revised by L2. Runtime-package members are now registered with
 * `tracked.streamFile()`, so archiver opens the staged paths itself while the
 * response drains; the files must outlive registration. Staging is therefore
 * released after the archive stream settles, in the `finally` around
 * `await archiveDone` in `buildBundleZip` — not at registration time, which is
 * where L1 originally put it while members were still buffered eagerly.
 *
 * Two consequences are asserted below, and both must keep holding:
 *   1. staging is released once the export's stream has settled — on
 *      completion and on client disconnect alike. Because the client can hold
 *      the last byte before the server's stream promise settles, this is
 *      asserted with a bounded wait rather than instantaneously; and
 *   2. the bundle validates in full — every runtime-package entry is present,
 *      CRC-correct and covered by its manifest sha256.
 *
 * (2) is the proof that (1) is not premature. Under streaming, a staging
 * directory released too early makes archiver drop the member with an ENOENT
 * `warning` and ship a quietly incomplete bundle; `validateArchiveBuffer` then
 * fails here with MISSING_FILE instead of letting it through.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRuntimePackageArtifacts } from "../src/runtimePackage.js";
import { validateArchiveBuffer } from "../src/exportIntegrity.js";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const TEMP_PREFIX = "airgap-runtime-package-";

/**
 * Staging directories present right now, by name. Compared as a set difference
 * so that directories left on the host by other work are never asserted on and
 * never removed by this suite — these tests only ever judge directories they
 * can prove they created.
 */
const stagingDirs = () =>
  new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)));

const newStagingDirs = (before) =>
  [...stagingDirs()].filter((name) => !before.has(name));

/** Poll until no staging directory created since `before` survives. */
const waitForStagingRelease = async (before, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  let leaked = newStagingDirs(before);
  while (leaked.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    leaked = newStagingDirs(before);
  }
  return leaked;
};

const runPayloadFor = (state) => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  sourceProfile: "connected-authoring",
  state,
  version: "4.22"
});

/** A complete, confirmed 4.22 state that requests the high-side runtime package. */
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
    clusterName: "cleanup-cluster",
    baseDomain: "example.com",
    confirmed: true
  },
  methodology: { method: "Agent-Based Installer" },
  credentials: { sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB cleanup@test" },
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

describe("Runtime package staging directory lifecycle", () => {
  before(() => {
    process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
  });

  after(() => {
    delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  });

  const stage = (overrides = {}) => {
    const state = bundleState();
    return createRuntimePackageArtifacts({
      state,
      exportOptions: state.exportOptions,
      runPayload: runPayloadFor(state),
      dataDir: os.tmpdir(),
      ...overrides
    });
  };

  it("names the staging directory it owns, and cleanup releases exactly that one", () => {
    const before = stagingDirs();
    const result = stage();

    assert.equal(result.included, true, "fixture mode should produce a complete package");
    assert.equal(typeof result.stagingRoot, "string", "caller must be able to identify the staging root");
    assert.equal(
      path.dirname(result.stagingRoot),
      os.tmpdir(),
      "staging root must sit directly under the temp dir"
    );
    assert.ok(
      path.basename(result.stagingRoot).startsWith(TEMP_PREFIX),
      `unexpected staging root name: ${result.stagingRoot}`
    );
    assert.ok(fs.existsSync(result.stagingRoot), "staging root must exist before cleanup");

    // Identity, not just a count: the one new directory IS this result's root,
    // and every staged entry really lives inside it.
    assert.deepEqual(
      newStagingDirs(before),
      [path.basename(result.stagingRoot)],
      "exactly the identified staging directory should be new"
    );
    for (const entry of result.entries) {
      assert.ok(
        entry.absolutePath.startsWith(`${result.stagingRoot}${path.sep}`),
        `entry escaped the staging root: ${entry.absolutePath}`
      );
    }

    // Artifacts must still be readable before cleanup: the caller reads them
    // out of this directory, so an eager release inside the function would
    // break the export.
    const guide = result.entries.find((e) => e.relativePath === "HIGH_SIDE_STARTUP_GUIDE.md");
    assert.ok(guide && fs.existsSync(guide.absolutePath), "artifacts must survive until cleanup");

    const release = result.cleanup();
    assert.equal(release.released, true, "cleanup must report success");
    assert.equal(release.stagingRoot, result.stagingRoot, "cleanup must report which root it released");
    assert.equal(release.error, null);
    assert.equal(fs.existsSync(result.stagingRoot), false, "staging root must be gone");
    assert.deepEqual(newStagingDirs(before), []);
  });

  it("cleanup is idempotent and keeps reporting success", () => {
    const before = stagingDirs();
    const result = stage();

    assert.equal(result.cleanup().released, true);
    assert.deepEqual(result.cleanup(), { released: true, stagingRoot: result.stagingRoot, error: null });
    assert.deepEqual(result.cleanup(), { released: true, stagingRoot: result.stagingRoot, error: null });
    assert.deepEqual(newStagingDirs(before), []);
  });

  it("reports a failed removal instead of latching it as released, and a retry still works", (t) => {
    // Removal is forced to fail by making the staging root itself unwritable,
    // so unlinking its children raises EACCES. root ignores the mode bits.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("cannot provoke EACCES as root");
      return;
    }

    const before = stagingDirs();
    const result = stage();
    const stagingRoot = result.stagingRoot;

    fs.chmodSync(stagingRoot, 0o500);
    let failed;
    try {
      failed = result.cleanup();
    } finally {
      fs.chmodSync(stagingRoot, 0o700);
    }

    assert.equal(failed.released, false, "a removal that did not happen must not report success");
    assert.ok(failed.error, "the failure must be reported, not swallowed");
    assert.equal(failed.error.code, "EACCES");
    assert.equal(failed.stagingRoot, stagingRoot);
    assert.ok(fs.existsSync(stagingRoot), "precondition: the directory really did survive");

    // Not latched: the handle is still usable once the obstruction is gone.
    const retried = result.cleanup();
    assert.equal(retried.released, true, "a retry after a failed removal must succeed");
    assert.equal(fs.existsSync(stagingRoot), false);
    assert.deepEqual(newStagingDirs(before), []);
  });

  it("releases staging when the package cannot be completed", () => {
    const before = stagingDirs();
    const savedMode = process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
    const savedPath = process.env.PATH;

    let result;
    try {
      // Force the real engine-detection path with no engine reachable: the
      // production "podman/docker missing" failure branch, not a mock.
      delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
      process.env.PATH = path.join(os.tmpdir(), "oaa-no-engine-on-path");
      result = stage();
    } finally {
      process.env.PATH = savedPath;
      process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = savedMode;
    }

    assert.equal(result.included, false, "no container engine must fail closed");
    assert.ok(result.notes.length > 0, "failure must be explained in notes");

    assert.equal(result.cleanup().released, true, "failure path must also release");
    assert.deepEqual(newStagingDirs(before), [], "failed package must not leave staging behind");
  });

  it("releases staging when artifact creation throws", () => {
    const before = stagingDirs();
    const state = bundleState();
    // A BigInt makes JSON.stringify throw while the run payload is being
    // written — after the staging directory exists and before the caller can
    // ever receive a cleanup handle. The module itself owns that path.
    const poisoned = { ...runPayloadFor(state), unserializable: 1n };

    assert.throws(
      () =>
        createRuntimePackageArtifacts({
          state,
          exportOptions: state.exportOptions,
          runPayload: poisoned,
          dataDir: os.tmpdir()
        }),
      TypeError
    );

    assert.deepEqual(newStagingDirs(before), [], "a throw must not strand the staging directory");
  });

  it("returns a releasable handle even when no package was requested", () => {
    const before = stagingDirs();
    const state = bundleState();
    state.exportOptions.includeHighSideRuntimePackage = false;

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: state.exportOptions,
      runPayload: runPayloadFor(state),
      dataDir: os.tmpdir()
    });

    assert.equal(result.requested, false);
    assert.equal(result.included, false);
    // Callers release unconditionally, so this must be safe and truthful.
    assert.deepEqual(result.cleanup(), { released: true, stagingRoot: null, error: null });
    assert.deepEqual(newStagingDirs(before), [], "nothing should have been staged at all");
  });
});

describe("Bundle export releases runtime package staging", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
    ({ server, baseUrl } = await createTestServer(app));
  });

  after(async () => {
    await closeTestServer(server);
    delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  });

  const postBundle = (state, init = {}) =>
    fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
      ...init
    });

  it("releases staging once the export stream settles, with the bundle intact", async () => {
    const before = stagingDirs();

    const res = await postBundle(bundleState());
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());

    // Bounded wait, not instantaneous: the release is anchored to the server's
    // stream promise, which can settle fractionally after the client has the
    // final byte. Asserting it with no wait would pass on timing luck.
    assert.deepEqual(
      await waitForStagingRelease(before),
      [],
      "staging must be released once the export stream has settled"
    );

    // ...and nothing was released too early. validateArchiveBuffer parses the
    // central directory, inflates every entry, checks each CRC32, requires
    // manifest/archive name coverage in both directions, and verifies every
    // entry's sha256 against the manifest — so a staged member deleted before
    // archiver read it cannot pass here.
    const validated = validateArchiveBuffer(bytes);
    assert.equal(validated.valid, true);
    assert.equal(validated.selectedMinor, "4.22");

    const runtimeEntries = Object.keys(validated.entries).filter((n) => n.startsWith("runtime-package/"));
    assert.ok(
      runtimeEntries.includes("runtime-package/HIGH_SIDE_STARTUP_GUIDE.md"),
      `runtime package missing from bundle; got: ${runtimeEntries.join(", ")}`
    );
    assert.ok(runtimeEntries.includes("runtime-package/SHA256SUMS.txt"));
    assert.ok(
      runtimeEntries.some((n) => n.startsWith("runtime-package/images/")),
      "image archives must be in the bundle"
    );
    for (const name of runtimeEntries) {
      assert.ok(
        validated.manifest.integrity.files[name],
        `runtime package entry ${name} is not covered by a manifest checksum`
      );
      assert.ok(validated.entries[name].length > 0, `runtime package entry ${name} is empty`);
    }
  });

  it("repeated exports do not accumulate staging directories", async () => {
    const before = stagingDirs();

    for (let i = 0; i < 3; i += 1) {
      const res = await postBundle(bundleState());
      assert.equal(res.status, 200);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(validateArchiveBuffer(bytes).valid, true, `export ${i + 1} produced an invalid bundle`);
      assert.deepEqual(
        await waitForStagingRelease(before),
        [],
        `export ${i + 1} left staging behind`
      );
    }
  });

  it("a client disconnect releases staging and leaves the server healthy", async () => {
    const before = stagingDirs();
    const controller = new AbortController();

    await assert.rejects(
      (async () => {
        const res = await postBundle(bundleState(), { signal: controller.signal });
        controller.abort();
        await res.arrayBuffer();
      })(),
      (err) => err?.name === "AbortError" || /abort/i.test(String(err?.message))
    );

    // The server-side export is mid-flight at abort time, so unlike the
    // completed case this one is genuinely asynchronous.
    assert.deepEqual(
      await waitForStagingRelease(before),
      [],
      "an aborted download must not leave staging behind"
    );

    // The disconnect must not have wedged, corrupted or killed anything.
    const after = await postBundle(bundleState());
    assert.equal(after.status, 200, "server must still serve bundles after a disconnect");
    const bytes = Buffer.from(await after.arrayBuffer());
    assert.equal(validateArchiveBuffer(bytes).valid, true, "the export after a disconnect must be valid");
    assert.deepEqual(newStagingDirs(before), []);
  });
});
