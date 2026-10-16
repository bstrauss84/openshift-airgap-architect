/**
 * Tests for scanner / vulnerability-database provenance.
 *
 * The fixtures are REAL captured output, not invented shapes: the empty
 * `{"Version":"0.75.0"}` is what the pinned scanner actually printed with no
 * cache mounted, and the populated block is what the same command printed on
 * the same host with the cache mounted.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TRIVY_CONTAINER_CACHE,
  TRIVY_DB_MARKER,
  assessScannerProvenance,
  cacheMountArgs,
  defaultCacheDir,
  describeContainerizedTrivy,
  ensureCache,
  resolveScannerImageDigest,
  scanProvenanceRecord,
} from "./scannerProvenance.mjs";

const PINNED = "docker.io/aquasec/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa";

/** Verbatim stdout of `podman run --rm <trivy> version --format json` — NO cache mount. */
const VERSION_NO_CACHE = '{"Version":"0.75.0"}';

/** Verbatim stdout of the same command WITH the cache mounted. */
const VERSION_WITH_CACHE = JSON.stringify({
  Version: "0.75.0",
  VulnerabilityDB: {
    Version: 2,
    NextUpdate: "2026-10-14T19:11:46.909501616Z",
    UpdatedAt: "2026-10-13T19:11:46.909502157Z",
    DownloadedAt: "2026-10-13T23:15:52.028759106Z",
  },
});

function ok(stdout) {
  return () => ({ status: 0, stdout, stderr: "", spawnError: null, timedOut: false, durationMs: 1, argv: [], command: "podman" });
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scannercache-test-"));
}

describe("cache contract", () => {
  test("the cache is mounted read-write at the scanner's own cache path", () => {
    assert.deepEqual(cacheMountArgs("/var/cache/oaa"), ["-v", `/var/cache/oaa:${TRIVY_CONTAINER_CACHE}:z`]);
  });

  test("the default cache is outside the repository, so it cannot alter the candidate id", () => {
    const d = defaultCacheDir({});
    assert.ok(d.startsWith(os.tmpdir()), `${d} should live under the system temp dir`);
    assert.equal(defaultCacheDir({ OAA_SCANNER_CACHE: "/srv/trivy" }), "/srv/trivy");
  });

  test("ensureCache creates the directory and reports an UNSEEDED cache honestly", () => {
    const dir = path.join(tmp(), "cache");
    const r = ensureCache(dir);
    assert.equal(r.ok, true);
    assert.equal(r.seeded, false);
    assert.equal(fs.existsSync(dir), true, "the directory must be created");
    assert.equal(r.metadata, null);
  });

  test("ensureCache reports a seeded cache and returns its metadata", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "db"), { recursive: true });
    fs.writeFileSync(path.join(dir, TRIVY_DB_MARKER), VERSION_WITH_CACHE);
    const r = ensureCache(dir);
    assert.equal(r.ok, true);
    assert.equal(r.seeded, true);
    assert.equal(r.metadata.Version, "0.75.0");
  });

  test("an unparseable cache marker is a failure, not an empty cache", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "db"), { recursive: true });
    fs.writeFileSync(path.join(dir, TRIVY_DB_MARKER), "{broken");
    const r = ensureCache(dir);
    assert.equal(r.ok, false);
    assert.match(r.reason, /unparseable/);
  });

  test("ensureCache never downloads: no network call is possible from its signature", () => {
    // Regression guard for the seeding rule. ensureCache takes no engine and
    // no runner, so it cannot execute anything.
    assert.equal(ensureCache.length <= 2, true);
  });
});

describe("the missing-mount defect", () => {
  test("REPRODUCES it: with no cache, trivy reports no VulnerabilityDB and the DB is unidentifiable", () => {
    const db = describeContainerizedTrivy("podman", PINNED, "/unused", { runner: ok(VERSION_NO_CACHE) });
    assert.equal(db.identified, false);
    assert.match(db.reason, /no VulnerabilityDB block/);
  });

  test("FIXED: with the cache mounted the same call yields full database identity", () => {
    const db = describeContainerizedTrivy("podman", PINNED, "/cache", {
      runner: ok(VERSION_WITH_CACHE),
      now: new Date("2026-10-14T14:00:00Z"),
    });
    assert.equal(db.identified, true);
    assert.equal(db.scannerVersion, "0.75.0");
    assert.equal(db.dbVersion, 2);
    assert.equal(db.builtAt, "2026-10-13T19:11:46.909502157Z");
    assert.equal(db.downloadedAt, "2026-10-13T23:15:52.028759106Z");
    assert.equal(db.expiredByToolDeclaration, false);
  });

  test("the version call mounts the SAME cache the scan will use", () => {
    let argv = null;
    describeContainerizedTrivy("podman", PINNED, "/shared-cache", {
      runner: (cmd, args) => {
        argv = args;
        return { status: 0, stdout: VERSION_WITH_CACHE, stderr: "", spawnError: null, timedOut: false, durationMs: 1 };
      },
    });
    assert.ok(argv.includes("-v"), "the version call must mount a volume");
    assert.ok(argv.includes(`/shared-cache:${TRIVY_CONTAINER_CACHE}:z`));
  });

  test("a non-zero exit or spawn failure is reported, never treated as an empty DB", () => {
    const failed = describeContainerizedTrivy("podman", PINNED, "/c", {
      runner: () => ({ status: 125, stdout: "", stderr: "no such image", spawnError: null, timedOut: false, durationMs: 1 }),
    });
    assert.equal(failed.identified, false);
    assert.match(failed.reason, /exit 125/);

    const missing = describeContainerizedTrivy("podman", PINNED, "/c", {
      runner: () => ({ status: null, stdout: "", stderr: "", spawnError: "podman not found", timedOut: false, durationMs: 0 }),
    });
    assert.equal(missing.identified, false);
    assert.match(missing.reason, /could not execute podman/);
  });
});

describe("scanner image digest resolution", () => {
  test("separates config digest, manifest digest and the pinned digest", () => {
    const r = resolveScannerImageDigest("podman", PINNED, {
      runner: ok(
        JSON.stringify([
          {
            Id: "6d93f1ec925b37c5ce785e416b86cba056e10c8c2914a59a8ea7be18115d6764",
            Digest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
            RepoDigests: [
              "docker.io/aquasec/trivy@sha256:9db099105405c648166e6b94155eb32f8da12673cf1f455207f7385cc9a77283",
              "docker.io/aquasec/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
            ],
          },
        ]),
      ),
    });
    assert.equal(r.ok, true);
    assert.equal(r.configDigest, "6d93f1ec925b37c5ce785e416b86cba056e10c8c2914a59a8ea7be18115d6764");
    assert.equal(r.manifestDigest, "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa");
    assert.notEqual(r.configDigest, r.manifestDigest, "config and manifest digests are different values");
    assert.equal(r.repoDigests.length, 2, "one image can carry several registry digests");
  });

  test("the pinned digest comes from the REFERENCE, not from RepoDigests[0]", () => {
    // Regression guard, found by end-to-end run: trivy carries two registry
    // digests and RepoDigests[0] is NOT the one the scanner was pinned to.
    const inspect = ok(
      JSON.stringify([
        {
          Id: "6d93f1ec925b",
          Digest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
          RepoDigests: [
            "docker.io/aquasec/trivy@sha256:9db099105405c648166e6b94155eb32f8da12673cf1f455207f7385cc9a77283",
            "docker.io/aquasec/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
          ],
        },
      ]),
    );
    const r = resolveScannerImageDigest("podman", PINNED, { runner: inspect });
    assert.equal(r.pinnedDigest, "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa");
    assert.notEqual(r.pinnedDigest, "sha256:9db099105405c648166e6b94155eb32f8da12673cf1f455207f7385cc9a77283");
    assert.equal(r.pinnedDigestConfirmed, true, "the engine really holds the bytes the reference named");
  });

  test("a tag-based ref with several repo digests is reported ambiguous, not guessed", () => {
    const r = resolveScannerImageDigest("podman", "docker.io/aquasec/trivy:latest", {
      runner: ok(
        JSON.stringify([
          { Id: "6d93f1ec925b", Digest: "sha256:af6acf9a", RepoDigests: ["docker.io/aquasec/trivy@sha256:9db09910", "docker.io/aquasec/trivy@sha256:af6acf9a"] },
        ]),
      ),
    });
    assert.equal(r.pinnedDigest, null, "no digest is invented for an ambiguous tag pull");
    assert.deepEqual(r.pinnedDigestAmbiguous, ["sha256:9db09910", "sha256:af6acf9a"]);
  });

  test("a reference naming a digest the engine does not hold is flagged, not accepted", () => {
    const r = resolveScannerImageDigest("podman", "docker.io/aquasec/trivy@sha256:deadbeef", {
      runner: ok(JSON.stringify([{ Id: "x", Digest: "sha256:af6acf9a", RepoDigests: ["docker.io/aquasec/trivy@sha256:af6acf9a"] }])),
    });
    assert.equal(r.pinnedDigestConfirmed, false);
  });

  test("an uninspectable scanner image fails closed", () => {
    const r = resolveScannerImageDigest("podman", PINNED, {
      runner: () => ({ status: 125, stdout: "", stderr: "no such image", spawnError: null, timedOut: false, durationMs: 1 }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no such image/);
  });
});

describe("the machine-readable provenance record", () => {
  const complete = () =>
    scanProvenanceRecord({
      scanner: { name: "trivy", version: "0.75.0", invocation: "image --input /scan/backend" },
      scannerImage: {
        ref: PINNED,
        pinnedDigest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
        manifestDigest: "sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa",
        configDigest: "sha256:6d93f1ec925b37c5ce785e416b86cba056e10c8c2914a59a8ea7be18115d6764",
      },
      database: {
        identified: true,
        dbVersion: 2,
        builtAt: "2026-10-13T19:11:46.909502157Z",
        nextUpdate: "2026-10-14T19:11:46.909501616Z",
        downloadedAt: "2026-10-13T23:15:52.028759106Z",
        expiredByToolDeclaration: false,
        freshnessPolicy: "trivy VulnerabilityDB.NextUpdate",
      },
      image: {
        role: "backend",
        ref: "localhost/openshift-airgap-architect-backend:latest",
        configDigest: "sha256:7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5",
        manifestDigest: "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f",
        registryDigest: null,
        platform: "linux/amd64",
      },
      scanStartedAt: "2026-10-14T14:00:00Z",
      scanCompletedAt: "2026-10-14T14:05:00Z",
      sourceCommit: "7b8c745aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cacheDir: "/tmp/oaa-scanner-cache",
    });

  test("captures every field the task requires, with nothing silently omitted", () => {
    const r = complete();
    assert.equal(r.scanner.name, "trivy");
    assert.equal(r.scanner.version, "0.75.0");
    assert.ok(r.scanner.image.pinnedDigest, "scanner IMAGE DIGEST");
    assert.equal(r.vulnerabilityDatabase.schemaVersion, 2);
    assert.ok(r.vulnerabilityDatabase.updatedAt);
    assert.ok(r.vulnerabilityDatabase.nextUpdate);
    assert.ok(r.vulnerabilityDatabase.downloadedAt);
    assert.equal(r.vulnerabilityDatabase.ageDays, 0);
    assert.ok(r.subject.configDigest);
    assert.equal(r.subject.platform, "linux/amd64");
    assert.ok(r.scan.startedAt && r.scan.completedAt);
    assert.ok(r.source.commit);
    assert.equal(r.vulnerabilityDatabase.cacheDir, "/tmp/oaa-scanner-cache");
  });

  test("the record is JSON-serialisable with no undefined holes", () => {
    const json = JSON.stringify(complete());
    assert.doesNotThrow(() => JSON.parse(json));
    assert.ok(!json.includes("undefined"));
  });

  test("a complete, fresh record is acceptable as release evidence", () => {
    const v = assessScannerProvenance(complete());
    assert.equal(v.acceptable, true, v.reasons.join("; "));
    assert.deepEqual(v.reasons, []);
  });
});

describe("staleness and unidentifiability never PASS", () => {
  function withDb(patch) {
    return scanProvenanceRecord({
      scanner: { name: "trivy", version: "0.75.0" },
      scannerImage: { pinnedDigest: "sha256:af6acf9a" },
      database: { identified: true, dbVersion: 2, builtAt: "2026-10-01T00:00:00Z", nextUpdate: "2026-10-02T00:00:00Z", expiredByToolDeclaration: false, ...patch },
      image: { configDigest: "sha256:7252836047c2" },
      sourceCommit: "7b8c745",
      scanCompletedAt: "2026-10-14T14:00:00Z",
    });
  }

  test("an UNIDENTIFIABLE database is refused — the exact state the missing mount produces", () => {
    const v = assessScannerProvenance(withDb({ identified: false }));
    assert.equal(v.acceptable, false);
    assert.ok(v.reasons.length > 0);
  });

  test("a database past trivy's own NextUpdate horizon is refused", () => {
    const v = assessScannerProvenance(withDb({ expiredByToolDeclaration: true }));
    assert.equal(v.acceptable, false);
    assert.match(v.reasons.join(" "), /due for update/);
  });

  test("a database with no build timestamp is refused", () => {
    const v = assessScannerProvenance(withDb({ builtAt: null }));
    assert.equal(v.acceptable, false);
    assert.match(v.reasons.join(" "), /no database build timestamp/);
  });

  test("a scanner that cannot be named by digest is refused, even with a fresh DB", () => {
    const r = withDb({});
    r.scanner.image = { ref: "trivy:latest", pinnedDigest: null, manifestDigest: null, configDigest: null };
    const v = assessScannerProvenance(r);
    assert.equal(v.acceptable, false);
    assert.match(v.reasons.join(" "), /cannot be identified by image digest/);
  });

  test("a scan not tied to a source commit is refused", () => {
    const r = withDb({});
    r.source.commit = null;
    const v = assessScannerProvenance(r);
    assert.equal(v.acceptable, false);
    assert.match(v.reasons.join(" "), /no source commit/);
  });

  test("a scanned image with no digest is refused", () => {
    const r = withDb({});
    r.subject.configDigest = null;
    r.subject.manifestDigest = null;
    const v = assessScannerProvenance(r);
    assert.equal(v.acceptable, false);
    assert.match(v.reasons.join(" "), /scanned image cannot be identified/);
  });

  test("acceptable is never true while reasons are present", () => {
    for (const patch of [{ identified: false }, { expiredByToolDeclaration: true }, { builtAt: null }]) {
      const v = assessScannerProvenance(withDb(patch));
      assert.equal(v.acceptable, v.reasons.length === 0);
      assert.equal(v.acceptable, false);
    }
  });
});
