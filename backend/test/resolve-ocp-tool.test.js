/**
 * Build-time tool resolver (backend/scripts/resolve-ocp-tool.sh), 2026-11-19 regression.
 *
 * Root cause reproduced: mirror.openshift.com `clients/ocp/latest` moved to OpenShift
 * 5.0.1, whose sha256sum.txt lists no oc-mirror artifact on any architecture, so the
 * backend image build failed with "FATAL: no SHA256 for oc-mirror.tar.gz". The image
 * now resolves oc-mirror from latest-<newest supported minor>, through this script.
 *
 * Fixtures mirror the upstream layout and metadata shape (sha256sum.txt lines
 * "<sha>  <file>", including release.txt's own entry; release.txt "Name:  <ver>")
 * for x86_64, aarch64, ppc64le and s390x. The binaries are minimal ELF headers with
 * each architecture's real EI_DATA / e_machine values, so the architecture check is
 * exercised without executing foreign code. Hermetic: OAA_RESOLVE_FIXTURES serves
 * files from a temp directory; checksum verification still applies.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "resolve-ocp-tool.sh");
const ARCHES = {
  x86_64: { data: 1, machine: 0x3e },
  aarch64: { data: 1, machine: 0xb7 },
  ppc64le: { data: 1, machine: 0x15 },
  s390x: { data: 2, machine: 0x16 }
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

let root;
/** A minimal 64-byte ELF64 header for an architecture. */
const elf = (arch) => {
  const { data, machine } = ARCHES[arch];
  const b = Buffer.alloc(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, data, 1], 0);
  if (data === 1) b.writeUInt16LE(machine, 18); else b.writeUInt16BE(machine, 18);
  return b;
};
/** A gzip tarball containing `member` (a regular file, or a symlink). */
const tarball = (dir, member, content, { symlink = false } = {}) => {
  const stage = fs.mkdtempSync(path.join(root, "stage-"));
  if (symlink) fs.symlinkSync("/etc/passwd", path.join(stage, member));
  else { fs.writeFileSync(path.join(stage, member), content); fs.chmodSync(path.join(stage, member), 0o640); }
  const out = path.join(dir, `${member}.tgz.tmp`);
  execFileSync("tar", ["-czf", out, "-C", stage, member]);
  return fs.readFileSync(out);
};
/**
 * Write one channel: release.txt, sha256sum.txt and artifacts.
 * opts.omit: artifact names to leave out of sha256sum.txt; opts.wrongSha: artifact
 * names whose checksum is wrong; opts.releaseShaWrong: corrupt release.txt's entry.
 */
const channel = (arch, name, version, artifacts, opts = {}) => {
  const dir = path.join(root, arch, name);
  fs.mkdirSync(dir, { recursive: true });
  const release = `Client tools for OpenShift\n---------------------------\n\nName:           ${version}\nDigest:         sha256:${"a".repeat(64)}\nCreated:        2026-11-03T15:31:00Z\n`;
  fs.writeFileSync(path.join(dir, "release.txt"), release);
  const lines = [];
  for (const [file, buf] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(dir, file), buf);
    if ((opts.omit || []).includes(file)) continue;
    lines.push(`${(opts.wrongSha || []).includes(file) ? "0".repeat(64) : sha(buf)}  ${file}`);
  }
  // Upstream also lists versioned names and other tools; include a decoy.
  lines.push(`${"1".repeat(64)}  ccoctl-linux.tar.gz`);
  lines.push(`${opts.releaseShaWrong ? "f".repeat(64) : sha(Buffer.from(release))}  release.txt`);
  fs.writeFileSync(path.join(dir, "sha256sum.txt"), lines.sort((a, b) => a.split("  ")[1].localeCompare(b.split("  ")[1])).join("\n") + "\n");
};

const run = (args, env = {}) => spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, OAA_RESOLVE_FIXTURES: root, ...env } });
const resolve = (arch, chan, dest, extra = []) => run(["--arch-dir", arch, "--channel", chan, "--artifact", "oc-mirror.tar.gz", "--member", "oc-mirror", "--dest", dest, ...extra]);

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-resolve-"));
  for (const arch of Object.keys(ARCHES)) {
    const tmp = path.join(root, `${arch}-build`);
    fs.mkdirSync(tmp, { recursive: true });
    const ocm = tarball(tmp, "oc-mirror", elf(arch));
    const oc = tarball(tmp, "oc", elf(arch));
    // The supported channel: 4.22.22 with oc-mirror (both upstream names).
    channel(arch, "latest-4.22", "4.22.22", { "oc-mirror.tar.gz": ocm, "oc-mirror.rhel9.tar.gz": ocm, "openshift-client-linux.tar.gz": oc });
    // Upstream today: the global channel is OpenShift 5.0.1 and lists NO oc-mirror.
    channel(arch, "latest", "5.0.1", { "openshift-client-linux.tar.gz": oc });
  }
  const t = path.join(root, "neg-build");
  fs.mkdirSync(t);
  const good = tarball(t, "oc-mirror", elf("x86_64"));
  channel("x86_64", "missing-sha-4.22", "4.22.22", { "oc-mirror.tar.gz": good }, { omit: ["oc-mirror.tar.gz"] });
  channel("x86_64", "mismatch-4.22", "4.22.22", { "oc-mirror.tar.gz": good }, { wrongSha: ["oc-mirror.tar.gz"] });
  channel("x86_64", "relmismatch-4.22", "4.22.22", { "oc-mirror.tar.gz": good }, { releaseShaWrong: true });
  channel("x86_64", "latest-4.21", "4.22.22", { "oc-mirror.tar.gz": good });
  channel("x86_64", "wrongarch-4.22", "4.22.22", { "oc-mirror.tar.gz": tarball(t, "oc-mirror", elf("s390x")) });
  channel("x86_64", "nomember-4.22", "4.22.22", { "oc-mirror.tar.gz": tarball(t, "other-tool", elf("x86_64")) });
  channel("x86_64", "symlink-4.22", "4.22.22", { "oc-mirror.tar.gz": tarball(t, "oc-mirror", null, { symlink: true }) });
  channel("x86_64", "notelf-4.22", "4.22.22", { "oc-mirror.tar.gz": tarball(t, "oc-mirror", "#!/bin/sh\necho hi\n") });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolve-ocp-tool.sh — supported channel, every architecture", () => {
  for (const arch of Object.keys(ARCHES)) {
    test(`${arch}: latest-4.22 resolves oc-mirror 4.22.22, verified, regular file, mode 0755, matching ELF architecture`, () => {
      const dest = path.join(root, `out-${arch}`);
      const r = resolve(arch, "latest-4.22", dest);
      assert.equal(r.status, 0, r.stderr);
      const prov = Object.fromEntries(r.stdout.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
      assert.equal(prov.VERSION, "4.22.22");
      assert.equal(prov.CHANNEL, "latest-4.22");
      assert.equal(prov.ARCH, arch);
      assert.match(prov.SHA256, /^[0-9a-f]{64}$/);
      assert.equal(prov.URL, `https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/latest-4.22/oc-mirror.tar.gz`);
      const st = fs.statSync(dest);
      assert.ok(st.isFile());
      assert.equal(st.mode & 0o777, 0o755, "installed 0755 even though the archive stores 0640");
      assert.deepEqual(fs.readFileSync(dest), elf(arch));
    });
  }
});

describe("resolve-ocp-tool.sh — fails closed, with the reason", () => {
  test("the 2026-11-19 upstream state: global latest (5.0.1) lists no oc-mirror → FATAL naming the channel, release and remedy", () => {
    for (const arch of Object.keys(ARCHES)) {
      const r = resolve(arch, "latest", path.join(root, `never-${arch}`));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /FATAL: no SHA256 for oc-mirror\.tar\.gz/);
      assert.match(r.stderr, new RegExp(`latest channel \\(${arch}\\) resolves to OpenShift 5\\.0\\.1`));
      assert.match(r.stderr, /OC_MIRROR_CHANNEL=latest-<newest supported 4\.x minor>/);
      assert.equal(fs.existsSync(path.join(root, `never-${arch}`)), false, "nothing installed");
    }
  });

  test("the oc client is still available from the 5.0.1 channel; only oc-mirror is absent", () => {
    const r = run(["--arch-dir", "x86_64", "--channel", "latest", "--artifact", "openshift-client-linux.tar.gz", "--member", "oc", "--dest", path.join(root, "oc-50")]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^VERSION=5\.0\.1$/m);
  });

  const cases = [
    ["missing checksum entry", "missing-sha-4.22", /no SHA256 for oc-mirror\.tar\.gz/],
    ["mismatched checksum", "mismatch-4.22", /failed SHA-256 verification/],
    ["release.txt not matching its own sha256sum.txt entry (channel changed mid-build)", "relmismatch-4.22", /release\.txt does not match its sha256sum\.txt entry/],
    ["a version outside the channel's minor", "latest-4.21", /latest-4\.21 resolved to 4\.22\.22, which is not a 4\.21 release/],
    ["a binary for another architecture", "wrongarch-4.22", /built for ELF machine 0x1600, not x86_64/],
    ["an archive without the member", "nomember-4.22", /does not contain oc-mirror/],
    ["the member as a symlink", "symlink-4.22", /is not a regular file/],
    ["a non-ELF member", "notelf-4.22", /is not an ELF executable/]
  ];
  for (const [label, chan, rx] of cases) {
    test(label, () => {
      const dest = path.join(root, `neg-${chan}`);
      const r = resolve("x86_64", chan, dest);
      assert.notEqual(r.status, 0, `expected failure for ${chan}`);
      assert.match(r.stderr, rx);
      assert.equal(fs.existsSync(dest), false, "nothing installed on failure");
    });
  }

  test("a SHA256 override that does not match fails; a malformed override is refused", () => {
    let r = resolve("x86_64", "latest-4.22", path.join(root, "ov1"), ["--sha", "0".repeat(64)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /failed SHA-256 verification/);
    r = resolve("x86_64", "latest-4.22", path.join(root, "ov2"), ["--sha", "NOT-A-SHA"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not 64 lowercase hex digits/);
  });

  test("a URL override without a SHA256 override is refused before any download", () => {
    const r = resolve("x86_64", "latest-4.22", path.join(root, "ov3"), ["--url", "https://example.invalid/oc-mirror.tar.gz"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /URL override for oc-mirror\.tar\.gz requires a SHA256 override/);
  });

  test("unsupported architectures and unsafe names are refused", () => {
    assert.match(resolve("riscv64", "latest-4.22", path.join(root, "x")).stderr, /unsupported architecture directory riscv64/);
    assert.match(resolve("x86_64", "../latest", path.join(root, "x")).stderr, /invalid channel name/);
    assert.match(run(["--arch-dir", "x86_64", "--channel", "latest-4.22", "--artifact", "../oc-mirror.tar.gz", "--member", "oc-mirror", "--dest", path.join(root, "x")]).stderr, /plain file names/);
  });
});

describe("resolve-ocp-tool.sh — script hygiene", () => {
  test("parses with sh -n and bash -n", () => {
    assert.equal(spawnSync("sh", ["-n", SCRIPT]).status, 0);
    assert.equal(spawnSync("bash", ["-n", SCRIPT]).status, 0);
  });
  test("never disables TLS verification or skips checksum verification", () => {
    const code = fs.readFileSync(SCRIPT, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /(^|\s)(-k|--insecure)(\s|$)/);
    assert.match(code, /--proto '=https'/);
    assert.equal((code.match(/sha256sum --check --strict/g) || []).length, 2);
  });
});
