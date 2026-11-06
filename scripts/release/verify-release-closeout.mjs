#!/usr/bin/env node
/**
 * Release closeout verification — the only sanctioned way to record a
 * published release as closed (docs/CONTRIBUTING.md "Preparing a release").
 *
 *   node scripts/release/verify-release-closeout.mjs [--version X.Y.Z] [--head <sha>]
 *        --allowed-signers <file> [--remotes origin,continuity] [--repo owner/name] [--write [--out <file>]]
 *
 * Checks, live, every condition the closeout step names, and fails closed on
 * any gap or on any tool it cannot run:
 *   1. the post-release documentation check passes on the checked-out tree,
 *      which must be clean and at --head (default: HEAD), with the CHANGELOG
 *      dated with the tag date;
 *   2. tag v<version> exists on every remote with one object id, and its
 *      commit is an ancestor of --head, and the tag's SSH signature verifies
 *      against --allowed-signers (required);
 *   3. `main` and `develop` equal --head on every remote;
 *   4. the required workflows (CI, Versioned Copy Guard) succeeded for --head
 *      on both `main` and `develop`;
 *   5. the GitHub Release is published (not draft, not prerelease) for that
 *      tag, and every asset digest GitHub reports equals the release's own
 *      SHA256SUMS (which must list every other asset).
 * With --write, and only when every check passed, the evidence is written to
 * docs/releases/closeout/v<version>.json. scripts/check-release-doc-status.mjs
 * refuses any document that records a release as closed without that record.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as defaultRun } from "./lib/exec.mjs";
import { normalizeWorkflowRuns, REQUIRED_WORKFLOWS } from "./axes/ci-integrity.mjs";
import { checkReleaseDocStatus, checkCloseoutClaims } from "../check-release-doc-status.mjs";

export const CLOSEOUT_SCHEMA = "oaa.release.closeout/v1";
export const closeoutRecordPath = (root, version) => join(root, "docs", "releases", "closeout", `v${version}.json`);
const SHA_RE = /^[0-9a-f]{40}$/;
const BRANCHES = ["main", "develop"];

/** owner/name from a GitHub remote URL, or null. */
export function repoSlugOf(url) {
  const m = String(url || "").trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Parse `git ls-remote` output into { ref: sha }. */
export function parseLsRemote(text) {
  return Object.fromEntries(String(text || "").split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2 && SHA_RE.test(p[0])).map(([sha, ref]) => [ref, sha]));
}

/** Parse a SHA256SUMS file into { name: sha256 }. */
export function parseSums(text) {
  return Object.fromEntries(String(text || "").split("\n").map((l) => l.match(/^([0-9a-f]{64})\s+\*?(\S+)\s*$/)).filter(Boolean).map((m) => [m[2], m[1]]));
}

/**
 * @param {{ root: string, version?: string, head?: string, remotes?: string[], repo?: string, allowedSigners?: string, run?: Function, now?: () => Date }} opts
 * @returns {{ ok: boolean, problems: string[], record: object }}
 */
export function verifyReleaseCloseout(opts) {
  const { root, allowedSigners = null, run = defaultRun, now = () => new Date() } = opts;
  const problems = [];
  const sh = (cmd, args) => {
    const r = run(cmd, args, { cwd: root });
    if (r.spawnError) throw new Error(`${cmd} is not available: ${r.spawnError}`);
    return r;
  };
  const out = (cmd, args, what) => {
    const r = sh(cmd, args);
    if (r.status !== 0) { problems.push(`${what}: \`${[cmd, ...args].join(" ")}\` failed (${(r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.status}`})`); return null; }
    return r.stdout;
  };
  const treeVersion = readFileSync(join(root, "VERSION"), "utf8").trim();
  const version = opts.version || treeVersion;
  if (version !== treeVersion) problems.push(`the checked-out tree's VERSION is ${treeVersion}, not ${version}; close a release from its own post-release commit`);
  const tag = `v${version}`;
  const record = { schema: CLOSEOUT_SCHEMA, version, tag: { name: tag }, checkedAt: now().toISOString(), remotes: [], ci: [], release: null, docs: null, ok: false };
  try {
    // 1. The checked-out tree: clean, at head, post-release docs pass.
    const localHead = (out("git", ["rev-parse", "HEAD"], "local HEAD") || "").trim();
    const head = opts.head || localHead;
    record.head = head;
    if (!SHA_RE.test(head)) problems.push(`--head must be a full 40-character commit id (got ${JSON.stringify(head)})`);
    if (localHead && head !== localHead) problems.push(`the checked-out tree is at ${localHead}, not ${head}; check out ${head} so the documentation check reads the commit being recorded`);
    const dirty = out("git", ["status", "--porcelain", "--untracked-files=no"], "working tree");
    if (dirty && dirty.trim()) problems.push("the working tree has uncommitted changes to tracked files; the documentation check must read exactly the recorded commit");

    // 2. The tag.
    const tagObject = (out("git", ["rev-parse", `refs/tags/${tag}`], `local tag ${tag}`) || "").trim();
    const tagCommit = (out("git", ["rev-parse", `${tag}^{commit}`], `commit of ${tag}`) || "").trim();
    const tagDate = (out("git", ["for-each-ref", "--format=%(taggerdate:short)", `refs/tags/${tag}`], `date of ${tag}`) || "").trim();
    record.tag = { name: tag, object: tagObject || null, commit: tagCommit || null, date: tagDate || null };
    if (tagObject && tagCommit && tagObject === tagCommit) problems.push(`${tag} is a lightweight tag; releases use annotated, signed tags`);
    if (tagCommit && SHA_RE.test(head) && sh("git", ["merge-base", "--is-ancestor", tagCommit, head]).status !== 0) problems.push(`${tag} (${tagCommit}) is not an ancestor of ${head}`);
    // A closeout without a verified tag signature is not a closeout: the file is required.
    if (!allowedSigners) {
      record.tag.signature = "not checked";
      problems.push(`--allowed-signers <file> is required: ${tag}'s SSH signature must verify against the release's allowed-signers file`);
    } else {
      const v = sh("git", ["-c", `gpg.ssh.allowedSignersFile=${resolve(allowedSigners)}`, "verify-tag", tag]);
      record.tag.signature = v.status === 0 ? "verified" : "failed";
      if (v.status !== 0) problems.push(`${tag}: signature did not verify against ${allowedSigners}`);
    }
    // Closure claims are judged against the record this run writes; every other version's must already hold.
    const docs = checkReleaseDocStatus(root, { phase: "post", tagDate: tagDate || null, closeoutClaims: false });
    docs.errors.push(...checkCloseoutClaims(root).errors.filter((e) => !e.includes(` records v${version} as closed, `)));
    docs.ok = docs.errors.length === 0;
    record.docs = { phase: "post", ok: docs.ok, errors: docs.errors };
    if (!docs.ok) problems.push(...docs.errors.map((e) => `release docs: ${e}`));

    // 3. Every remote: tag object, main and develop.
    const remotes = opts.remotes?.length ? opts.remotes : (out("git", ["remote"], "remotes") || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!remotes.length) problems.push("no git remotes to check");
    const repo = opts.repo || repoSlugOf((out("git", ["remote", "get-url", remotes.includes("origin") ? "origin" : remotes[0]], "GitHub repository") || ""));
    record.repo = repo;
    let extra = 0;
    for (const name of remotes) {
      const refs = parseLsRemote(out("git", ["ls-remote", name, "refs/heads/main", "refs/heads/develop", `refs/tags/${tag}`], `remote ${name}`));
      // The record is published with the repository: a remote that is not the public GitHub
      // repository is recorded without its name (the private/public boundary).
      const isPublic = repo && repoSlugOf((sh("git", ["remote", "get-url", name]).stdout || "").trim()) === repo;
      const entry = { name: isPublic ? name : `additional-remote-${++extra}`, main: refs["refs/heads/main"] || null, develop: refs["refs/heads/develop"] || null, tag: refs[`refs/tags/${tag}`] || null };
      record.remotes.push(entry);
      for (const b of BRANCHES) if (entry[b] !== head) problems.push(`${name}/${b} is ${entry[b] || "missing"}, not ${head}`);
      if (entry.tag !== tagObject) problems.push(`${name} has ${tag} at ${entry.tag || "nothing"}, not ${tagObject || "(no local tag)"}`);
    }

    // 4. CI on both branches for exactly this commit.
    if (!repo) problems.push("cannot tell the GitHub repository; pass --repo owner/name");
    if (repo && SHA_RE.test(head)) {
      for (const branch of BRANCHES) {
        const raw = out("gh", ["run", "list", "-R", repo, "--commit", head, "--branch", branch, "--event", "push", "--limit", "50", "--json", "workflowName,status,conclusion,databaseId,attempt,createdAt"], `CI on ${branch}`);
        let runs = [];
        try { runs = raw ? JSON.parse(raw) : []; } catch { problems.push(`CI on ${branch}: unreadable gh output`); }
        const v = normalizeWorkflowRuns(runs, REQUIRED_WORKFLOWS);
        for (const w of v.perWorkflow) {
          record.ci.push({ branch, workflow: w.workflow, state: w.state, runId: w.runId ?? null });
          if (w.state !== "SUCCESS") problems.push(`${w.workflow} on ${branch} for ${head.slice(0, 12)}: ${w.state}${w.conclusion ? ` (${w.conclusion})` : ""}`);
        }
      }

      // 5. The published release and its assets.
      const rel = out("gh", ["release", "view", tag, "-R", repo, "--json", "tagName,isDraft,isPrerelease,publishedAt,url,assets"], `GitHub Release ${tag}`);
      if (rel) {
        let r = null;
        try { r = JSON.parse(rel); } catch { problems.push(`GitHub Release ${tag}: unreadable gh output`); }
        if (r) {
          const assets = (r.assets || []).map((a) => ({ name: a.name, digest: String(a.digest || "").replace(/^sha256:/, "") }));
          record.release = { url: r.url, tagName: r.tagName, draft: r.isDraft, prerelease: r.isPrerelease, publishedAt: r.publishedAt, assets: assets.length };
          if (r.tagName !== tag) problems.push(`the GitHub Release is for ${r.tagName}, not ${tag}`);
          if (r.isDraft) problems.push(`the GitHub Release ${tag} is still a draft`);
          if (r.isPrerelease) problems.push(`the GitHub Release ${tag} is marked prerelease`);
          const sumsAsset = assets.find((a) => a.name === "SHA256SUMS");
          if (!sumsAsset) problems.push(`the GitHub Release ${tag} has no SHA256SUMS asset`);
          else {
            const sums = parseSums(out("gh", ["release", "download", tag, "-R", repo, "-p", "SHA256SUMS", "-O", "-"], "SHA256SUMS asset"));
            record.release.sha256sumsDigest = sumsAsset.digest || null;
            for (const a of assets.filter((x) => x.name !== "SHA256SUMS")) {
              if (!sums[a.name]) problems.push(`release asset ${a.name} is not listed in SHA256SUMS`);
              else if (!/^[0-9a-f]{64}$/.test(a.digest)) problems.push(`GitHub reports no SHA-256 digest for ${a.name}`);
              else if (sums[a.name] !== a.digest) problems.push(`release asset ${a.name}: GitHub digest ${a.digest} does not match SHA256SUMS ${sums[a.name]}`);
            }
            for (const n of Object.keys(sums)) if (!assets.some((a) => a.name === n)) problems.push(`SHA256SUMS lists ${n}, which is not a release asset`);
          }
        }
      }
    }
  } catch (err) {
    problems.push(String(err?.message || err));
  }
  record.ok = problems.length === 0;
  return { ok: record.ok, problems, record };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const root = resolve(arg("--root") ?? join(fileURLToPath(import.meta.url), "..", "..", ".."));
  const result = verifyReleaseCloseout({
    root, version: arg("--version"), head: arg("--head"), repo: arg("--repo"), allowedSigners: arg("--allowed-signers"),
    remotes: arg("--remotes") ? arg("--remotes").split(",").map((s) => s.trim()).filter(Boolean) : null
  });
  for (const p of result.problems) console.error(`FAIL: ${p}`);
  if (!result.ok) {
    console.error(`release closeout NOT verified for ${result.record.version}; nothing written`);
    process.exit(1);
  }
  console.log(`release closeout verified for ${result.record.version}: head ${result.record.head}, ${result.record.remotes.length} remote(s), ${result.record.ci.length} workflow result(s), ${result.record.release?.assets} asset(s)`);
  if (args.includes("--write")) {
    // --out: write the record into another checkout (the branch that will carry it), never over an existing one.
    const file = arg("--out") ? resolve(arg("--out")) : closeoutRecordPath(root, result.record.version);
    if (existsSync(file)) { console.error(`${file} already exists; a closeout record is written once`); process.exit(1); }
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(result.record, null, 2)}\n`);
    console.log(`wrote ${file}`);
  }
}
