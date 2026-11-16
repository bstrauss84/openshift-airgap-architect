/**
 * verify-release-closeout: every check fails closed, judged with a fake
 * `git` / `gh` so no network or real repository is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseCloseout, repoSlugOf, parseSums } from "./verify-release-closeout.mjs";

const HEAD = "1".repeat(40), TAGOBJ = "2".repeat(40), TAGCOMMIT = "3".repeat(40), SHA = (c) => c.repeat(64);

function tree() {
  const root = mkdtempSync(join(tmpdir(), "closeout-"));
  mkdirSync(join(root, "docs/releases"), { recursive: true });
  writeFileSync(join(root, "VERSION"), "9.8.0\n");
  writeFileSync(join(root, "CHANGELOG.md"), "## [9.8.0] - 2026-11-05\n");
  writeFileSync(join(root, "docs/releases/v9.8.0.md"), "# v9.8.0\n");
  writeFileSync(join(root, "README.md"), "- [n](docs/releases/v9.8.0.md)\n| [n](docs/releases/v9.8.0.md) |\n- **v9.8.0** — x\n");
  return root;
}

/** A healthy world; `over` replaces individual answers keyed by a substring of the command. */
function world(over = {}) {
  const runs = (branch) => JSON.stringify(["CI", "Versioned Copy Guard"].map((n, i) => ({ workflowName: n, status: "completed", conclusion: "success", databaseId: i + (branch === "main" ? 10 : 20), attempt: 1, createdAt: "2026-11-05T00:00:00Z" })));
  const assets = [{ name: "a.json", digest: `sha256:${SHA("a")}` }, { name: "b.tar.gz", digest: `sha256:${SHA("b")}` }, { name: "SHA256SUMS", digest: `sha256:${SHA("c")}` }];
  const answers = {
    "git rev-parse HEAD": HEAD,
    "git status --porcelain": "",
    "git rev-parse refs/tags/v9.8.0": TAGOBJ,
    "git rev-parse v9.8.0^{commit}": TAGCOMMIT,
    "git for-each-ref": "2026-11-05",
    "git merge-base --is-ancestor": "",
    "git remote get-url origin": "https://github.com/acme/oaa.git",
    "git remote get-url private": "https://git.example.invalid/acme/private.git",
    "git remote": "origin\nprivate",
    "verify-tag": "",
    "git ls-remote": `${HEAD}\trefs/heads/main\n${HEAD}\trefs/heads/develop\n${TAGOBJ}\trefs/tags/v9.8.0\n`,
    "--branch main": runs("main"),
    "--branch develop": runs("develop"),
    "gh release view": JSON.stringify({ tagName: "v9.8.0", isDraft: false, isPrerelease: false, publishedAt: "x", url: "u", assets }),
    "gh release download": `${SHA("a")}  a.json\n${SHA("b")}  b.tar.gz\n`,
    ...over
  };
  const log = [];
  const run = (cmd, args) => {
    const command = [cmd, ...args].join(" ");
    log.push(command);
    const key = Object.keys(answers).filter((k) => command.includes(k)).sort((a, b) => b.length - a.length)[0];
    const a = key === undefined ? { status: 1, stderr: `unexpected ${command}` } : answers[key];
    return typeof a === "string" ? { status: 0, stdout: a, stderr: "" } : { stdout: "", stderr: "", ...a };
  };
  return { run, log };
}

test("a fully synchronized, published, green release verifies; a non-public remote is recorded without its name", () => {
  const w = world();
  const r = verifyReleaseCloseout({ root: tree(), allowedSigners: "/tmp/allowed", run: w.run });
  assert.deepEqual(r.problems, []);
  assert.equal(r.record.ok, true);
  assert.deepEqual(r.record.remotes.map((x) => x.name), ["origin", "additional-remote-1"]);
  assert.equal(JSON.stringify(r.record).includes("private"), false);
  assert.equal(r.record.ci.length, 4);
  assert.ok(w.log.some((c) => c.includes(`--commit ${HEAD}`)), "CI is looked up for the exact commit");
});

const cases = {
  "a remote whose develop lags": [{ "git ls-remote": `${HEAD}\trefs/heads/main\n${"9".repeat(40)}\trefs/heads/develop\n${TAGOBJ}\trefs/tags/v9.8.0\n` }, /develop is 9{40}, not 1{40}/],
  "a remote without the tag": [{ "git ls-remote": `${HEAD}\trefs/heads/main\n${HEAD}\trefs/heads/develop\n` }, /has v9\.8\.0 at nothing/],
  "CI still running on develop": [{ "--branch develop": JSON.stringify([{ workflowName: "CI", status: "in_progress" }, { workflowName: "Versioned Copy Guard", status: "completed", conclusion: "success" }]) }, /CI on develop .*PENDING/],
  "a failed workflow on main": [{ "--branch main": JSON.stringify([{ workflowName: "CI", status: "completed", conclusion: "failure" }, { workflowName: "Versioned Copy Guard", status: "completed", conclusion: "success" }]) }, /CI on main .*FAIL/],
  "a draft release": [{ "gh release view": JSON.stringify({ tagName: "v9.8.0", isDraft: true, isPrerelease: false, assets: [{ name: "SHA256SUMS", digest: "" }] }) }, /still a draft/],
  "an asset whose digest differs from SHA256SUMS": [{ "gh release download": `${SHA("a")}  a.json\n${SHA("f")}  b.tar.gz\n` }, /b\.tar\.gz: GitHub digest .* does not match/],
  "an asset missing from SHA256SUMS": [{ "gh release download": `${SHA("a")}  a.json\n` }, /b\.tar\.gz is not listed/],
  "a tree that is not at the recorded head": [{ "git rev-parse HEAD": "4".repeat(40) }, /checked-out tree is at 4{40}/],
  "uncommitted changes": [{ "git status --porcelain": " M README.md\n" }, /uncommitted changes/],
  "a lightweight tag": [{ "git rev-parse refs/tags/v9.8.0": TAGCOMMIT }, /lightweight tag/],
  "a tag that is not an ancestor": [{ "git merge-base --is-ancestor": { status: 1 } }, /not an ancestor/],
  "gh not installed": [{ "--branch main": { spawnError: "ENOENT gh" }, "--branch develop": { spawnError: "ENOENT gh" } }, /gh is not available/]
};
for (const [name, [over, re]] of Object.entries(cases)) {
  test(`refused: ${name}`, () => {
    const r = verifyReleaseCloseout({ root: tree(), head: HEAD, allowedSigners: "/tmp/allowed", run: world(over).run });
    assert.equal(r.ok, false);
    assert.match(r.problems.join("\n"), re);
  });
}

test("refused: stale release docs (the post-release documentation check runs)", () => {
  const root = tree();
  writeFileSync(join(root, "CHANGELOG.md"), "## [9.8.0] - Unreleased\n");
  assert.match(verifyReleaseCloseout({ root, allowedSigners: "/tmp/allowed", run: world().run }).problems.join("\n"), /release docs: .*not dated/);
});

test("refused: a version other than the tree's VERSION", () => {
  assert.match(verifyReleaseCloseout({ root: tree(), version: "9.7.0", allowedSigners: "/tmp/allowed", run: world().run }).problems.join("\n"), /VERSION is 9\.8\.0, not 9\.7\.0/);
});

test("helpers", () => {
  assert.equal(repoSlugOf("https://github.com/acme/oaa.git"), "acme/oaa");
  assert.equal(repoSlugOf("git@github.com:acme/oaa.git"), "acme/oaa");
  assert.equal(repoSlugOf("https://example.invalid/x/y"), null);
  assert.deepEqual(parseSums(`${SHA("a")}  x\nnoise\n`), { x: SHA("a") });
});

test("refused: no allowed-signers file (the tag signature is mandatory)", () => {
  const r = verifyReleaseCloseout({ root: tree(), run: world().run });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /--allowed-signers <file> is required/);
  assert.equal(r.record.tag.signature, "not checked");
});

test("refused: a tag signature that does not verify", () => {
  const r = verifyReleaseCloseout({ root: tree(), allowedSigners: "/tmp/allowed", run: world({ "verify-tag": { status: 1, stderr: "Could not verify signature." } }).run });
  assert.match(r.problems.join("\n"), /signature did not verify/);
});
