/**
 * OpenShift Airgap Architect - openshift-install host-architecture and integrity
 *
 * Covers two defects in backend/src/installer.js, the module behind
 * GET /api/aws/regions, GET /api/aws/ami and POST /api/aws/warm-installer.
 *
 * DEFECT 1 — the download was architecture-blind.
 *
 * The URL was
 *   https://mirror.openshift.com/pub/openshift-v4/clients/ocp/<version>/openshift-install-linux.tar.gz
 * with no architecture segment. That path is an alias for x86_64. Measured
 * against the live mirror on 2026-10-16 for 4.20.18, the four architectures
 * publish four DIFFERENT binaries under that same file name:
 *
 *   x86_64   8398d94df0070b0180b29323861825754004c908555b68657e6740bf881dcaa0
 *   aarch64  757f344248af4401dc210c7c05ec5995bf8c04a429c8e30daa55c81d42bc105c
 *   ppc64le  25de5bbedd1d579b42c66051553cf380f454c38e39e693e6ae3091f7313e6436
 *   s390x    440b02105c74693e21106de55a7fcd3d37206f0e192171e692b7717b7392b120
 *
 * and the no-arch manifest is byte-identical to the x86_64 one. So on an aarch64
 * host the backend fetched an x86_64 binary and then SPAWNED it
 * (`openshift-install coreos print-stream-json`), which cannot execute. AWS
 * region and AMI lookup were broken on ARM64 hosts, Apple Silicon included.
 *
 * This is the two-axis rule from Tranche 1.5: the binary must match the HOST
 * that runs it, which is not the target cluster architecture that
 * `getAwsRegions(version, arch)` takes.
 *
 * DEFECT 2 — nothing was verified.
 *
 * The tarball was fetched with `curl -fsSL`, extracted, chmod +x and executed.
 * No checksum, no signature, no size floor. `curl` exiting zero was the entire
 * integrity story for a binary this backend then runs as a child process.
 *
 * Both are asserted here against a loopback mirror, so the suite stays hermetic.
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
import { execFileSync } from "node:child_process";

import { ensureInstaller, hostInstallerArchDir, INSTALLER_TARBALL } from "../src/installer.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

describe("openshift-install — host architecture resolution", () => {
  it("maps every supported host architecture to its mirror directory", () => {
    assert.equal(hostInstallerArchDir("x64"), "x86_64");
    assert.equal(hostInstallerArchDir("amd64"), "x86_64");
    assert.equal(hostInstallerArchDir("x86_64"), "x86_64");
    assert.equal(hostInstallerArchDir("arm64"), "aarch64");
    assert.equal(hostInstallerArchDir("aarch64"), "aarch64");
    assert.equal(hostInstallerArchDir("ppc64le"), "ppc64le");
    assert.equal(hostInstallerArchDir("s390x"), "s390x");
  });

  it("returns null for an architecture the mirror does not publish", () => {
    assert.equal(hostInstallerArchDir("riscv64"), null);
    assert.equal(hostInstallerArchDir(""), null);
    assert.equal(hostInstallerArchDir(null), null);
  });

  it("defaults to this process's own architecture when called with no argument", () => {
    // Production calls it with no argument; the default parameter is the whole
    // point of the fix, so assert the default resolves rather than that it is
    // null. `undefined` therefore selects the host, it does not mean "unknown".
    assert.equal(hostInstallerArchDir(), hostInstallerArchDir(process.arch));
    assert.notEqual(hostInstallerArchDir(), null, "the test host must be a supported architecture");
  });
});

describe("openshift-install — acquisition is host-arch correct and verified", () => {
  let server;
  let base;
  let workDir;
  let tarball;
  let requested;
  let manifestBody;
  let artifactBody;

  const VERSION = "4.22.16";

  before(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oaa-installer-"));

    // A real gzipped tar carrying an `openshift-install` member, so the
    // extraction step under test is the genuine `tar -xzf`, not a stub.
    const stageDir = path.join(workDir, "stage");
    await fs.promises.mkdir(stageDir, { recursive: true });
    await fs.promises.writeFile(path.join(stageDir, "openshift-install"), "#!/bin/sh\necho fixture\n");
    await fs.promises.writeFile(path.join(stageDir, "README.md"), "unrelated member\n");
    const tarPath = path.join(workDir, "fixture.tar.gz");
    execFileSync("tar", ["-czf", tarPath, "-C", stageDir, "openshift-install", "README.md"]);
    tarball = await fs.promises.readFile(tarPath);

    artifactBody = tarball;
    manifestBody = `${sha256(tarball)}  ${INSTALLER_TARBALL}\n`;

    server = http.createServer((req, res) => {
      requested.push(req.url);
      if (req.url.endsWith("/sha256sum.txt")) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(manifestBody);
        return;
      }
      if (req.url.endsWith(`/${INSTALLER_TARBALL}`)) {
        res.writeHead(200, { "content-type": "application/gzip" });
        res.end(artifactBody);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  /**
   * Rewrites the live mirror origin onto the loopback fixture, leaving the PATH
   * the production code built intact — the path is what is under test.
   */
  const fixtureFetch = (url, init) =>
    fetch(url.replace("https://mirror.openshift.com", base), init);

  const freshToolsDir = async (label) => {
    const dir = path.join(workDir, `tools-${label}`);
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  };

  it("requests the aarch64 path on an arm64 host, not the x86_64 alias", async () => {
    requested = [];
    const toolsDirOverride = await freshToolsDir("arm64");

    await ensureInstaller(VERSION, {
      fetchImpl: fixtureFetch,
      nodeArch: "arm64",
      toolsDirOverride
    });

    const artifactUrl = requested.find((u) => u.endsWith(`/${INSTALLER_TARBALL}`));
    assert.ok(artifactUrl, "the installer tarball should have been requested");
    assert.equal(
      artifactUrl,
      `/pub/openshift-v4/aarch64/clients/ocp/${VERSION}/${INSTALLER_TARBALL}`,
      "an arm64 host must fetch the aarch64 binary"
    );
    // The precise shape of the old bug: an architecture-free client path.
    assert.ok(
      !requested.some((u) => u.startsWith("/pub/openshift-v4/clients/ocp/")),
      "the architecture-free legacy path must never be used — it always serves x86_64"
    );
  });

  it("requests the x86_64 path on an x64 host", async () => {
    requested = [];
    const toolsDirOverride = await freshToolsDir("x64");

    await ensureInstaller(VERSION, {
      fetchImpl: fixtureFetch,
      nodeArch: "x64",
      toolsDirOverride
    });

    assert.ok(
      requested.includes(`/pub/openshift-v4/x86_64/clients/ocp/${VERSION}/${INSTALLER_TARBALL}`),
      `expected an x86_64 request, saw ${JSON.stringify(requested)}`
    );
  });

  it("fetches the checksum manifest before the artifact", async () => {
    requested = [];
    const toolsDirOverride = await freshToolsDir("order");

    await ensureInstaller(VERSION, {
      fetchImpl: fixtureFetch,
      nodeArch: "x64",
      toolsDirOverride
    });

    const manifestAt = requested.findIndex((u) => u.endsWith("/sha256sum.txt"));
    const artifactAt = requested.findIndex((u) => u.endsWith(`/${INSTALLER_TARBALL}`));
    assert.ok(manifestAt >= 0, "the manifest must be fetched");
    assert.ok(artifactAt >= 0, "the artifact must be fetched");
    assert.ok(manifestAt < artifactAt, "the expected digest must be known before bytes are accepted");
  });

  it("extracts a verified tarball and leaves an executable binary", async () => {
    const toolsDirOverride = await freshToolsDir("extract");
    requested = [];

    const result = await ensureInstaller(VERSION, {
      fetchImpl: fixtureFetch,
      nodeArch: "x64",
      toolsDirOverride
    });

    assert.ok(fs.existsSync(result), "installer binary should exist");
    assert.match(await fs.promises.readFile(result, "utf8"), /fixture/);
    assert.ok((await fs.promises.stat(result)).mode & 0o111, "installer should be executable");
    // The tar also contained README.md; it must not land beside the binary.
    assert.equal(fs.existsSync(path.join(toolsDirOverride, "README.md")), false);
  });

  it("REFUSES a tampered tarball and never produces a binary to execute", async () => {
    const toolsDirOverride = await freshToolsDir("tampered");
    const good = artifactBody;
    artifactBody = Buffer.concat([tarball, Buffer.from("trailing tamper")]);
    requested = [];

    try {
      await assert.rejects(
        () =>
          ensureInstaller(VERSION, {
            fetchImpl: fixtureFetch,
            nodeArch: "x64",
            toolsDirOverride
          }),
        /SHA256 mismatch/
      );
      assert.equal(
        fs.existsSync(path.join(toolsDirOverride, `openshift-install-${VERSION}`)),
        false,
        "a binary that failed verification must not be left where it could be spawned"
      );
    } finally {
      artifactBody = good;
    }
  });

  it("REFUSES when the manifest does not name the installer tarball", async () => {
    const toolsDirOverride = await freshToolsDir("noentry");
    const good = manifestBody;
    manifestBody = `${sha256(tarball)}  something-else.tar.gz\n`;

    try {
      await assert.rejects(
        () =>
          ensureInstaller(VERSION, {
            fetchImpl: fixtureFetch,
            nodeArch: "x64",
            toolsDirOverride
          }),
        /No SHA256 entry for/
      );
    } finally {
      manifestBody = good;
    }
  });

  it("refuses an unsupported host architecture instead of guessing one", async () => {
    const toolsDirOverride = await freshToolsDir("badarch");
    await assert.rejects(
      () =>
        ensureInstaller(VERSION, {
          fetchImpl: fixtureFetch,
          nodeArch: "riscv64",
          toolsDirOverride
        }),
      /Unsupported host architecture/
    );
  });

  it("requires a version rather than constructing a URL with undefined in it", async () => {
    await assert.rejects(() => ensureInstaller("", { fetchImpl: fixtureFetch }), /version is required/);
  });
});
