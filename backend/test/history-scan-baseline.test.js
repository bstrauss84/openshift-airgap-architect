/**
 * History-scan baseline reconciliation + current-tree credential-artifact guard.
 *
 * The baseline exists so that a previously resolved, independently verified historical
 * scanner finding does not permanently block the tranche gate. The danger of any such
 * mechanism is that it quietly becomes a blanket amnesty for the file, the path, the
 * detector or the repository.
 *
 * Every negative control below plants something that is ALMOST registered and proves
 * the gate still fails. All fixtures are SYNTHETIC — generated here, named for nothing
 * real — so this suite records no historical identifiers of its own. The one production
 * assertion consumes the shipped baseline opaquely and asserts structure and
 * resolvability without reproducing anything it covers.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  reconcileHistoryScan,
  scanTreeForCredentialArtifacts,
  classifyTrackedFile,
  findingIdentity,
  pathIdentity,
  contentIdentity,
  RESOLVED_STATUS,
  SCAN_RED,
  SCAN_RESOLVED,
  SCAN_PASS,
} from "../../scripts/security/historyScanBaseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/security/history-scan-baseline.json");
const CLI = path.join(REPO_ROOT, "scripts/security/history-scan-baseline-cli.mjs");

/* ------------------------------------------------------------------ */
/* Synthetic fixtures                                                  */
/* ------------------------------------------------------------------ */

const hex40 = (seed) => createHash("sha1").update(`synthetic/${seed}`).digest("hex");

const finding = (seed, rule, file, line) => {
  const commit = hex40(seed);
  return {
    RuleID: rule,
    File: file,
    StartLine: line,
    Commit: commit,
    Fingerprint: `${commit}:${file}:${rule}:${line}`,
  };
};

const FIXTURE_CONTENT = "synthetic fixture content\n";
const FIXTURE_PATH = "fixtures/alpha.yaml";

/** Two findings on one synthetic object, one of them seen twice. */
const syntheticFindings = () => {
  const a = finding("one", "fixture-detector-a", FIXTURE_PATH, 10);
  const b = finding("one", "fixture-detector-b", FIXTURE_PATH, 20);
  return [a, a, b];
};

const syntheticBaseline = (mutate = () => {}) => {
  const [a, , b] = syntheticFindings();
  const baseline = {
    schemaVersion: 1,
    entries: [
      {
        id: "fixture-entry",
        status: RESOLVED_STATUS,
        expectedOccurrenceCount: 3,
        findingIdentities: [
          { identityHash: findingIdentity(a), count: 2 },
          { identityHash: findingIdentity(b), count: 1 },
        ],
        contentIdentityHash: contentIdentity(FIXTURE_CONTENT),
        evidenceClass: "human-attested-lifecycle-invalidation",
        evidenceDigest: contentIdentity("synthetic-evidence"),
      },
    ],
    disallowedPathHashes: [pathIdentity(FIXTURE_PATH)],
  };
  mutate(baseline);
  return baseline;
};

/** Resolver that returns the synthetic object for any synthetic reference. */
const resolveContent = () => FIXTURE_CONTENT;

const run = (findings, baseline, resolver = resolveContent) =>
  reconcileHistoryScan({ findings, baseline, resolveContent: resolver });

/* ------------------------------------------------------------------ */
/* Baseline matching                                                   */
/* ------------------------------------------------------------------ */

describe("exact baseline match", () => {
  test("exactly the registered findings resolve", () => {
    const r = run(syntheticFindings(), syntheticBaseline());
    assert.equal(r.status, SCAN_RESOLVED);
    assert.equal(r.unexpected, 0);
    assert.deepEqual(r.reasons, []);
    assert.deepEqual(r.resolvedEntries, ["fixture-entry"]);
  });

  test("a clean scan against an empty baseline is a plain pass", () => {
    const r = run([], syntheticBaseline((b) => {
      b.entries = [];
    }));
    assert.equal(r.status, SCAN_PASS);
    assert.equal(r.unexpected, 0);
  });

  test("a clean scan against a POPULATED baseline is RED, not a pass", () => {
    // Zero findings where the baseline expects some means history changed or the
    // scanner stopped working. Either way the baseline must be reconciled on purpose
    // rather than silently decaying into a permanent free pass.
    const r = run([], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /baseline is stale/);
  });

  test("identity derivation is stable and distinguishes every component", () => {
    const base = finding("one", "rule-x", "a.yaml", 1);
    const seen = new Set([
      findingIdentity(base),
      findingIdentity({ ...base, RuleID: "rule-y" }),
      findingIdentity({ ...base, File: "b.yaml" }),
      findingIdentity({ ...base, Fingerprint: base.Fingerprint + "x" }),
    ]);
    assert.equal(seen.size, 4, "rule, path and fingerprint must each affect identity");
    assert.equal(findingIdentity(base), findingIdentity({ ...base }));
  });
});

/* ------------------------------------------------------------------ */
/* NEGATIVE CONTROLS — each must stay RED                              */
/* ------------------------------------------------------------------ */

describe("negative controls: the baseline covers nothing else", () => {
  test("1. a NEW finding elsewhere fails", () => {
    const extra = finding("two", "fixture-detector-a", "fixtures/beta.yaml", 5);
    const r = run([...syntheticFindings(), extra], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 1);
  });

  test("2. an UNEXPECTED DETECTOR on the registered object fails", () => {
    const extra = finding("one", "fixture-detector-c", FIXTURE_PATH, 10);
    const r = run([...syntheticFindings(), extra], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 1);
  });

  test("3. CHANGED HISTORICAL CONTENT fails even though identities still match", () => {
    const r = run(syntheticFindings(), syntheticBaseline(), () => "tampered content\n");
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 0, "identities still match; the content check is what fails");
    assert.match(r.reasons.join("\n"), /content identity does not match/);
  });

  test("4. a NEW OCCURRENCE of the SAME known content fails", () => {
    // Same object, reachable from an additional point in history => new identity.
    const copy = finding("three", "fixture-detector-a", FIXTURE_PATH, 10);
    const r = run([...syntheticFindings(), copy], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 1);
  });

  test("5. CHANGED PATH fails", () => {
    const moved = finding("one", "fixture-detector-a", "fixtures/moved.yaml", 10);
    const r = run([...syntheticFindings(), moved], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 1);
  });

  test("6. a CHANGED FINGERPRINT fails", () => {
    const shifted = finding("one", "fixture-detector-a", FIXTURE_PATH, 11);
    const r = run([...syntheticFindings(), shifted], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 1);
  });

  test("7. occurrence-count drift fails — more than registered", () => {
    const [a] = syntheticFindings();
    const r = run([...syntheticFindings(), a], syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /occurrence count drift|occurrence total/);
  });

  test("8. occurrence-count drift fails — fewer than registered", () => {
    const r = run(syntheticFindings().slice(1), syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /occurrence count drift|occurrence total/);
  });

  test("9. a registered identity that disappears marks the baseline stale", () => {
    const r = run(syntheticFindings().slice(0, 2), syntheticBaseline());
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /baseline is stale/);
  });

  test("10. a MISSING baseline entry fails", () => {
    const r = run(syntheticFindings(), syntheticBaseline((b) => {
      b.entries = [];
    }));
    assert.equal(r.status, SCAN_RED);
    assert.equal(r.unexpected, 3);
  });

  test("11. a MALFORMED baseline fails closed", () => {
    for (const mutate of [
      (b) => { b.schemaVersion = 2; },
      (b) => { delete b.schemaVersion; },
      (b) => { b.entries[0].contentIdentityHash = "not-a-digest"; },
      (b) => { b.entries[0].findingIdentities[0].identityHash = "deadbeef"; },
      (b) => { b.entries[0].status = "probably-fine"; },
    ]) {
      assert.equal(run(syntheticFindings(), syntheticBaseline(mutate)).status, SCAN_RED);
    }
  });

  test("12. status other than verified-inactive keeps findings blocking", () => {
    const r = run(syntheticFindings(), syntheticBaseline((b) => {
      b.entries[0].status = "unverified";
    }));
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /remain blocking/);
  });

  test("13. a resolved status without recognised evidence fails", () => {
    for (const mutate of [
      (b) => { delete b.entries[0].evidenceClass; },
      (b) => { b.entries[0].evidenceClass = "because-i-said-so"; },
      (b) => { delete b.entries[0].evidenceDigest; },
      (b) => { b.entries[0].evidenceDigest = "none"; },
    ]) {
      assert.equal(run(syntheticFindings(), syntheticBaseline(mutate)).status, SCAN_RED);
    }
  });

  test("14. an unavailable content resolver fails rather than trusting the baseline", () => {
    const r = reconcileHistoryScan({ findings: syntheticFindings(), baseline: syntheticBaseline() });
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /content verification unavailable/);
  });

  test("15. unresolvable content fails", () => {
    const r = run(syntheticFindings(), syntheticBaseline(), () => null);
    assert.equal(r.status, SCAN_RED);
    assert.match(r.reasons.join("\n"), /could not be resolved/);
  });

  test("16. one identity registered twice fails", () => {
    const r = run(syntheticFindings(), syntheticBaseline((b) => {
      b.entries[0].findingIdentities.push({ ...b.entries[0].findingIdentities[0] });
    }));
    assert.equal(r.status, SCAN_RED);
  });
});

/* ------------------------------------------------------------------ */
/* Current-tree guard                                                  */
/* ------------------------------------------------------------------ */

describe("current-tree credential-artifact guard", () => {
  // Built at runtime so no credential-shaped literal is committed.
  const jwt = () => {
    const seg = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${seg({ alg: "RS256", kid: "synthetic" })}.${seg({ sub: "system:serviceaccount:fixture:fixture" })}.${"s".repeat(40)}`;
  };
  const kubeconfig = () =>
    Buffer.from(
      [
        "apiVersion: v1",
        "kind: Config",
        "clusters:",
        "- cluster: {server: https://fixture.invalid:6443}",
        "users:",
        `- user: {token: ${jwt()}}`,
      ].join("\n")
    ).toString("base64");

  const importManifest = () =>
    [
      "apiVersion: v1",
      "kind: Secret",
      "metadata:",
      "  name: bootstrap-hub-kubeconfig",
      "data:",
      `  kubeconfig: ${kubeconfig()}`,
    ].join("\n");

  test("blocks a credential-bearing cluster-import manifest under any name", () => {
    const { detected, reasons } = classifyTrackedFile("deploy/fixture-cluster-manifest.yaml", importManifest());
    assert.equal(detected, true);
    assert.match(reasons.join(), /credential material|bearer token/);
  });

  test("blocks an embedded kubeconfig carrying a private key", () => {
    const kc = Buffer.from(
      [
        "kind: Config",
        "clusters:",
        "- cluster: {}",
        "users:",
        "- user:",
        `    client-key-data: ${"QUJDRA".repeat(30)}`,
      ].join("\n")
    ).toString("base64");
    assert.equal(classifyTrackedFile("fixtures/x.yaml", `data:\n  kubeconfig: ${kc}\n`).detected, true);
  });

  test("ALLOWS an ordinary credential-free Kubernetes Secret template", () => {
    const template = [
      "apiVersion: v1",
      "kind: Secret",
      "metadata:",
      "  name: mirror-registry-pull-secret",
      "stringData:",
      "  .dockerconfigjson: '{\"auths\":{\"registry.example.com\":{\"auth\":\"<BASE64_USER_PASS>\"}}}'",
    ].join("\n");
    assert.equal(classifyTrackedFile("docs/e2e-examples/pull-secret.yaml", template).detected, false);
  });

  test("ALLOWS documentation that merely describes cluster-import resources", () => {
    const doc = "# Importing a managed cluster\n\nApply the manifest; `kind: Klusterlet` is created in\n`open-cluster-management-agent`.\n";
    assert.equal(classifyTrackedFile("docs/FIXTURE.md", doc).detected, false);
  });

  test("blocks a baseline-registered path by opaque digest, with no plaintext constant", () => {
    const baseline = { disallowedPathHashes: [pathIdentity("fixtures/blocked.yaml")] };
    assert.equal(classifyTrackedFile("fixtures/blocked.yaml", "# emptied\n", baseline).detected, true);
    assert.equal(classifyTrackedFile("fixtures/other.yaml", "# emptied\n", baseline).detected, false);
  });

  test("sweeps a file set and reports every offender", () => {
    const files = { "a.md": "clean", "b/c.yaml": importManifest() };
    const r = scanTreeForCredentialArtifacts({ files: Object.keys(files), readText: (p) => files[p] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings.map((x) => x.path), ["b/c.yaml"]);
  });

  test("the REAL current tree is clean under the shipped baseline", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    const files = execFileSync("git", ["-C", REPO_ROOT, "ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const r = scanTreeForCredentialArtifacts({
      files,
      baseline,
      readText: (p) => {
        try {
          const abs = path.join(REPO_ROOT, p);
          if (fs.statSync(abs).size > 4 * 1024 * 1024) return null;
          return fs.readFileSync(abs, "utf8");
        } catch {
          return null;
        }
      },
    });
    assert.deepEqual(r.findings, []);
  });
});

/* ------------------------------------------------------------------ */
/* The shipped baseline, consumed opaquely                             */
/* ------------------------------------------------------------------ */

describe("shipped baseline", () => {
  const baseline = () => JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const DIGEST = /^sha256:[0-9a-f]{64}$/;

  test("resolves, is schema 1, and is internally consistent", () => {
    const b = baseline();
    assert.equal(b.schemaVersion, 1);
    assert.ok(Array.isArray(b.entries) && b.entries.length > 0);
    for (const entry of b.entries) {
      assert.equal(entry.status, RESOLVED_STATUS);
      assert.match(entry.contentIdentityHash, DIGEST);
      assert.match(entry.evidenceDigest, DIGEST);
      assert.ok(entry.evidenceClass);
      const sum = entry.findingIdentities.reduce((n, i) => n + i.count, 0);
      assert.equal(entry.expectedOccurrenceCount, sum);
      for (const i of entry.findingIdentities) assert.match(i.identityHash, DIGEST);
    }
    for (const h of b.disallowedPathHashes ?? []) assert.match(h, DIGEST);
  });

  test("the registered content identity resolves to a real object in this repository", () => {
    // Proves the baseline points at content that genuinely exists and is unchanged,
    // WITHOUT naming a path or a commit: every blob is hashed and the digest looked up.
    const names = execFileSync(
      "git",
      ["-C", REPO_ROOT, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"],
      { encoding: "utf8", maxBuffer: 1 << 28 }
    )
      .split("\n")
      .filter((l) => l.endsWith(" blob"))
      .map((l) => l.split(" ")[0]);

    const stream = execFileSync("git", ["-C", REPO_ROOT, "cat-file", "--batch"], {
      input: names.join("\n") + "\n",
      maxBuffer: 1 << 30,
    });

    const digests = new Set();
    let i = 0;
    while (i < stream.length) {
      const nl = stream.indexOf(0x0a, i);
      if (nl < 0) break;
      const size = Number.parseInt(stream.toString("utf8", i, nl).split(" ")[2], 10);
      const start = nl + 1;
      digests.add(contentIdentity(stream.subarray(start, start + size)));
      i = start + size + 1;
    }

    for (const entry of baseline().entries) {
      assert.ok(digests.has(entry.contentIdentityHash), `entry ${entry.id}: content identity unresolved`);
    }
  });

  test("carries no plaintext descriptive metadata about what it covers", () => {
    // Everything outside the documented prose block must be a digest, a small integer,
    // an enum or a structural key. A path, detector name or commit id must not appear.
    const b = baseline();
    const walk = (node) => {
      if (typeof node === "string") return [node];
      if (Array.isArray(node)) return node.flatMap(walk);
      if (node && typeof node === "object") {
        return Object.entries(node)
          .filter(([k]) => k !== "$comment")
          .flatMap(([, v]) => walk(v));
      }
      return [];
    };
    const allowed = new Set([
      "verified-inactive",
      "unverified",
      "human-attested-lifecycle-invalidation",
      "machine-verified-signing-key-absence",
      "administratively-revoked",
    ]);
    for (const value of walk(b)) {
      const ok = DIGEST.test(value) || allowed.has(value) || /^baseline-\d+$/.test(value);
      assert.ok(ok, "baseline contains a non-opaque value");
      assert.ok(!/\.ya?ml$/.test(value), "baseline must not contain a path");
      assert.ok(!/^[0-9a-f]{40}$/.test(value), "baseline must not contain a git object id");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Report output minimization                                          */
/* ------------------------------------------------------------------ */

describe("reconciliation output does not publish baseline identity", () => {
  test("a resolved match prints a status and nothing identifying", () => {
    // Uses a real, innocuous object so content resolution genuinely succeeds.
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const file = "package.json";
    const content = execFileSync("git", ["-C", REPO_ROOT, "cat-file", "blob", `${head}:${file}`], {
      maxBuffer: 1 << 26,
    });
    const f = {
      RuleID: "fixture-detector",
      File: file,
      StartLine: 1,
      Commit: head,
      Fingerprint: `${head}:${file}:fixture-detector:1`,
    };
    const b = {
      schemaVersion: 1,
      entries: [
        {
          id: "baseline-001",
          status: RESOLVED_STATUS,
          expectedOccurrenceCount: 1,
          findingIdentities: [{ identityHash: findingIdentity(f), count: 1 }],
          contentIdentityHash: contentIdentity(content),
          evidenceClass: "administratively-revoked",
          evidenceDigest: contentIdentity("fixture"),
        },
      ],
    };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-baseline-cli-"));
    const reportPath = path.join(dir, "report.json");
    const baselinePath = path.join(dir, "baseline.json");
    fs.writeFileSync(reportPath, JSON.stringify([f]));
    fs.writeFileSync(baselinePath, JSON.stringify(b));

    const out = execFileSync("node", [CLI, "history", reportPath, baselinePath], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });

    assert.match(out, /STATUS=PASS_WITH_RESOLVED_BASELINE/);
    assert.match(out, /UNEXPECTED=0/);
    assert.ok(!out.includes("sha256:"), "must not print digests");
    assert.ok(!out.includes(file), "must not print a path");
    assert.ok(!out.includes(head), "must not print a commit id");
    assert.ok(!out.includes("fixture-detector"), "must not print a detector name");
  });

  test("an unexpected finding DOES get safe diagnostic metadata", () => {
    const f = finding("rogue", "fixture-detector", "fixtures/rogue.yaml", 3);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-baseline-cli-"));
    const reportPath = path.join(dir, "report.json");
    const baselinePath = path.join(dir, "baseline.json");
    fs.writeFileSync(reportPath, JSON.stringify([f]));
    fs.writeFileSync(baselinePath, JSON.stringify({ schemaVersion: 1, entries: [] }));

    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", [CLI, "history", reportPath, baselinePath], { encoding: "utf8" });
    } catch (err) {
      out = err.stdout?.toString() ?? "";
      code = err.status;
    }
    fs.rmSync(dir, { recursive: true, force: true });

    assert.equal(code, 1, "an unregistered finding must exit nonzero");
    assert.match(out, /STATUS=RED/);
    assert.match(out, /UNEXPECTED rule=fixture-detector path=fixtures\/rogue\.yaml/);
  });
});
