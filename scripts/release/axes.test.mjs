/**
 * Deterministic tests for the AXIS registry and each axis's pure logic.
 *
 * Nothing here runs a container, a scanner or a network call: the testable
 * core of every axis is factored into exported pure functions, and that is
 * what is exercised.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AXES, AXIS_IDS, REQUIRED_AXIS_IDS, NON_WAIVABLE_AXIS_IDS, CONTAINER_AXES, axisById } from "./axes/index.mjs";
import { INCOMPLETE } from "./lib/status.mjs";
import { REUSE } from "./lib/evidence.mjs";
import { shippedInstallScope } from "./axes/dependencies.mjs";
import { repoSlug } from "./axes/docs.mjs";
import { normalizeWorkflowRuns, REQUIRED_WORKFLOWS } from "./axes/ci-integrity.mjs";
import { provesPrivilegeDrop, stripShellComments } from "./axes/containers.mjs";
import { normaliseTrivy, normaliseGrype, selectStrategy } from "./axes/image-vulnerabilities.mjs";
import { selectGenerator, parseToolProvenance, REQUIRED_TOOL_FIELDS } from "./axes/sbom.mjs";
import plannedAxes from "./axes/planned.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("axis registry", () => {
  test("axis ids are unique", () => {
    assert.equal(new Set(AXIS_IDS).size, AXIS_IDS.length);
  });

  test("every axis declares the full contract", () => {
    for (const a of AXES) {
      assert.equal(typeof a.id, "string", "id");
      assert.ok(a.id.length, `${a.id}: non-empty id`);
      assert.equal(typeof a.title, "string", `${a.id}: title`);
      assert.ok(Array.isArray(a.inputs), `${a.id}: inputs array`);
      assert.equal(typeof a.run, "function", `${a.id}: run()`);
      assert.ok(Object.values(REUSE).includes(a.reuse), `${a.id}: must declare a reuse class`);
      assert.equal(typeof a.required, "boolean", `${a.id}: must declare required`);
    }
  });

  test("a context-bound axis supplies a context key", () => {
    for (const a of AXES.filter((x) => x.reuse === REUSE.CONTEXT)) {
      assert.equal(typeof a.contextKey, "function", `${a.id}: CONTEXT reuse requires contextKey()`);
    }
  });

  test("every Tranche 8 certification axis is represented", () => {
    for (const required of [
      "identity", "repo-hygiene", "docs", "dependencies-shipped", "dependencies-builder",
      "secrets", "tests", "ci-integrity", "containers", "image-vulnerabilities",
      "component-inventory", "lifecycle", "compatibility", "connectivity", "artifacts",
    ]) {
      assert.ok(axisById(required), `axis "${required}" must be registered`);
    }
  });

  test("shipped and builder dependency surfaces are SEPARATE axes", () => {
    // A single axis that passes on clean shipped deps while merely mentioning
    // builder criticals cannot keep them out of a GREEN release.
    assert.ok(axisById("dependencies-shipped"));
    assert.ok(axisById("dependencies-builder"));
    assert.ok(REQUIRED_AXIS_IDS.includes("dependencies-builder"), "builder findings must be release-owned");
  });

  test("the container-scan and SBOM blockers are NON-WAIVABLE", () => {
    assert.deepEqual([...NON_WAIVABLE_AXIS_IDS].sort(), ["component-inventory", "image-vulnerabilities"]);
    for (const id of NON_WAIVABLE_AXIS_IDS) {
      assert.ok(axisById(id).nonWaivableReason, `${id} must record why it cannot be waived`);
    }
  });

  test("every registered axis is required, so none can be quietly dropped", () => {
    assert.deepEqual([...REQUIRED_AXIS_IDS].sort(), [...AXIS_IDS].sort());
  });

  test("declared container axes exist", () => {
    for (const id of CONTAINER_AXES) assert.ok(axisById(id), `${id} must exist`);
  });

  test("planned axes report INCOMPLETE with an owner and a closure plan", async () => {
    for (const axis of plannedAxes) {
      const r = await axis.run();
      assert.equal(r.status, INCOMPLETE, `${axis.id} must not claim a status it has not proven`);
      assert.ok(r.evidence.backlogItem, `${axis.id} must name its canonical backlog item`);
      assert.ok(r.evidence.closesIn, `${axis.id} must name the tranche that closes it`);
      assert.ok(r.evidence.closure.length, `${axis.id} must carry concrete closure steps`);
    }
  });
});

describe("shipped-vs-builder dependency scope", () => {
  // The v2.1 Tranche 7C bug in both directions: counting a builder install as
  // shipped, and ignoring a real shipped install.
  test("a single stage with a bare npm ci ships its dev tree", () => {
    assert.equal(shippedInstallScope('FROM node\nRUN npm ci\nCMD ["node"]\n'), "all");
  });

  test("a single stage with --omit=dev ships production only", () => {
    assert.equal(shippedInstallScope('FROM node\nRUN npm ci --omit=dev\nCMD ["node"]\n'), "prod");
  });

  test("a builder stage's full install is not counted as shipped", () => {
    const cf = ["FROM node AS builder", "RUN npm ci", "RUN npm run build", "", "FROM nginx", "COPY --from=builder /build/dist /usr/share/nginx/html", ""].join("\n");
    assert.equal(shippedInstallScope(cf), "none");
  });

  test("a final stage that copies node_modules in does ship them", () => {
    const cf = ["FROM node AS builder", "RUN npm ci", "", "FROM node", "COPY --from=builder /app/node_modules /app/node_modules", ""].join("\n");
    assert.equal(shippedInstallScope(cf), "all");
  });

  test("a commented-out install is not mistaken for a real one", () => {
    assert.equal(shippedInstallScope('FROM nginx\n# RUN npm ci\nCMD ["nginx"]\n'), "none");
  });

  test("the repository's real Containerfiles classify as expected", () => {
    const backend = fs.readFileSync(path.join(REPO_ROOT, "backend", "Containerfile"), "utf8");
    const frontend = fs.readFileSync(path.join(REPO_ROOT, "frontend", "Containerfile"), "utf8");
    assert.equal(shippedInstallScope(backend), "prod", "backend installs --omit=dev in its single stage");
    assert.equal(shippedInstallScope(frontend), "none", "frontend ships nginx and static assets only (PROD-026)");
  });
});

describe("CI workflow normalisation", () => {
  const mk = (workflowName, conclusion, extra = {}) => ({
    workflowName, conclusion, status: "completed", createdAt: "2026-10-12T00:00:00Z", attempt: 1, databaseId: 1, ...extra,
  });

  test("all required workflows green is a clean result", () => {
    const n = normalizeWorkflowRuns([mk("CI", "success"), mk("Versioned Copy Guard", "success")]);
    assert.deepEqual(n.failing, []);
    assert.deepEqual(n.missing, []);
    assert.deepEqual(n.pending, []);
  });

  test("A REQUIRED WORKFLOW THAT NEVER RAN IS MISSING, not silently fine", () => {
    const n = normalizeWorkflowRuns([mk("CI", "success")]);
    assert.deepEqual(n.missing, ["Versioned Copy Guard"]);
  });

  test("an irrelevant green workflow is not counted as release proof", () => {
    const n = normalizeWorkflowRuns([mk("Some Other Workflow", "success")]);
    assert.deepEqual(n.missing, [...REQUIRED_WORKFLOWS]);
    assert.equal(n.extra.length, 1);
  });

  test("A SUCCESSFUL RERUN SUPERSEDES THE FAILED ATTEMPT IT REPLACED", () => {
    const runs = [
      mk("CI", "failure", { attempt: 1, databaseId: 10 }),
      mk("CI", "success", { attempt: 2, databaseId: 10 }),
      mk("Versioned Copy Guard", "success"),
    ];
    const n = normalizeWorkflowRuns(runs);
    assert.deepEqual(n.failing, [], "the later attempt is the current truth");
    assert.equal(n.perWorkflow.find((w) => w.workflow === "CI").attempt, 2);
  });

  test("a failing rerun of a previously green run is a failure", () => {
    const runs = [
      mk("CI", "success", { attempt: 1, databaseId: 10 }),
      mk("CI", "failure", { attempt: 2, databaseId: 10 }),
      mk("Versioned Copy Guard", "success"),
    ];
    assert.equal(normalizeWorkflowRuns(runs).failing.length, 1);
  });

  test("a newer run supersedes an older one at the same attempt number", () => {
    const runs = [
      mk("CI", "failure", { createdAt: "2026-10-11T00:00:00Z", databaseId: 1 }),
      mk("CI", "success", { createdAt: "2026-10-12T00:00:00Z", databaseId: 2 }),
      mk("Versioned Copy Guard", "success"),
    ];
    assert.deepEqual(normalizeWorkflowRuns(runs).failing, []);
  });

  test("a pending required workflow is pending, not success", () => {
    const n = normalizeWorkflowRuns([mk("CI", null, { status: "in_progress" }), mk("Versioned Copy Guard", "success")]);
    assert.deepEqual(n.pending, ["CI"]);
  });

  test("skipped and cancelled are not success", () => {
    for (const c of ["skipped", "cancelled", "timed_out", "startup_failure", "action_required"]) {
      const n = normalizeWorkflowRuns([mk("CI", c), mk("Versioned Copy Guard", "success")]);
      assert.equal(n.failing.length, 1, `${c} must not read as success`);
    }
  });

  test("an unrecognised conclusion is never treated as success", () => {
    const n = normalizeWorkflowRuns([mk("CI", "something_new"), mk("Versioned Copy Guard", "success")]);
    assert.ok(n.pending.includes("CI"));
  });

  test("ci-integrity never reuses evidence", () => {
    assert.equal(axisById("ci-integrity").reuse, REUSE.NEVER);
  });
});

describe("container privilege-drop proof", () => {
  test("A COMMENT MENTIONING runuser PROVES NOTHING", () => {
    // The 8A weakness: the regex ran against raw text, so the entrypoint's own
    // explanatory header could have satisfied it.
    const text = "#!/bin/sh\n# Run as root, then hand off via runuser to UID 1001\nnode src/index.js\n";
    assert.equal(provesPrivilegeDrop(text), false);
  });

  test("a real exec handoff proves the drop", () => {
    const text = '#!/bin/sh\nchown -R 1001:0 "$DATA_DIR"\nexec runuser -u appuser -- /bin/sh -c "node src/index.js"\n';
    assert.equal(provesPrivilegeDrop(text), true);
  });

  test("gosu, su-exec and setpriv are accepted in exec position", () => {
    for (const tool of ["gosu", "su-exec", "setpriv"]) {
      assert.equal(provesPrivilegeDrop(`#!/bin/sh\nexec ${tool} appuser node app.js\n`), true, tool);
    }
  });

  test("a mention outside executable position does not count", () => {
    assert.equal(provesPrivilegeDrop('#!/bin/sh\necho "we could use runuser here"\nnode app.js\n'), false);
    assert.equal(provesPrivilegeDrop("#!/bin/sh\nRUNUSER_DOC=runuser\nnode app.js\n"), false);
  });

  test("an exec drop inside a conditional branch still counts", () => {
    assert.equal(provesPrivilegeDrop('#!/bin/sh\nif [ "$(id -u)" = 0 ]; then exec runuser -u appuser -- node app.js; fi\n'), true);
  });

  test("comment stripping respects quoting", () => {
    assert.equal(stripShellComments('echo "a # b" # trailing').trim(), 'echo "a # b"');
    assert.equal(stripShellComments("echo 'a # b'").trim(), "echo 'a # b'");
  });

  test("the repository's real backend entrypoint satisfies the proof", () => {
    const ep = fs.readFileSync(path.join(REPO_ROOT, "backend", "scripts", "entrypoint.sh"), "utf8");
    assert.equal(provesPrivilegeDrop(ep), true);
  });
});

describe("scanner and SBOM generator selection", () => {
  test("no tool available is INCOMPLETE-shaped, never a silent skip", () => {
    const s = selectStrategy({ nativeTrivy: false, nativeGrype: false, engine: null });
    assert.equal(s.kind, null);
    assert.ok(s.reason, "must explain why no proof is possible");
  });

  test("AN ENGINE ALONE IS NOT ENOUGH WHILE THE SCANNER IMAGE IS UNPINNED", () => {
    // An unpinned floating tag would make every run scan with whatever was
    // published most recently. 8A.1 also found the tag 8A named did not exist.
    assert.equal(selectStrategy({ nativeTrivy: false, nativeGrype: false, engine: "podman" }).kind, null);
    assert.equal(selectGenerator({ nativeSyft: false, engine: "podman" }).kind, null);
  });

  test("native scanners are preferred in a deterministic order", () => {
    assert.equal(selectStrategy({ nativeTrivy: true, nativeGrype: true }).kind, "native-trivy");
    assert.equal(selectStrategy({ nativeTrivy: false, nativeGrype: true }).kind, "native-grype");
    assert.equal(selectGenerator({ nativeSyft: true }).kind, "native-syft");
  });

  test("trivy and grype output normalise to one severity tally", () => {
    const t = normaliseTrivy({ Results: [{ Vulnerabilities: [{ Severity: "CRITICAL", VulnerabilityID: "CVE-1", PkgName: "p" }, { Severity: "low" }] }] });
    assert.equal(t.tally.CRITICAL, 1);
    assert.equal(t.tally.LOW, 1);
    assert.equal(t.findings.length, 1, "only blocking severities are enumerated");

    const g = normaliseGrype({ matches: [{ vulnerability: { severity: "High", id: "CVE-2" }, artifact: { name: "q", version: "1" } }] });
    assert.equal(g.tally.HIGH, 1);
    assert.equal(g.findings[0].id, "CVE-2");
  });

  test("empty scanner output is zero findings, not a crash", () => {
    assert.equal(normaliseTrivy({}).findings.length, 0);
    assert.equal(normaliseGrype({}).findings.length, 0);
  });
});

describe("component inventory: external binaries", () => {
  const complete = [
    "OC_RESOLVED_VERSION=4.22.3",
    "OC_RESOLVED_SHA256=abc123",
    "OC_RESOLVED_CHANNEL=latest-4.22",
    "OC_MIRROR_RESOLVED_VERSION=4.22.1",
    "OC_MIRROR_RESOLVED_SHA256=def456",
    "OC_MIRROR_RESOLVED_CHANNEL=latest",
    "TOOLS_RESOLVED_ARCH=x86_64",
  ].join("\n");

  test("a complete provenance file yields oc and oc-mirror components", () => {
    const r = parseToolProvenance(complete);
    assert.equal(r.ok, true);
    assert.deepEqual(r.components.map((c) => c.name), ["oc", "oc-mirror"]);
    assert.equal(r.components[0].version, "4.22.3");
    assert.equal(r.components[0].checksum.value, "abc123");
    assert.equal(r.components[1].checksum.algorithm, "SHA256");
  });

  test("MISSING EXTERNAL-BINARY PROVENANCE IS NOT OK", () => {
    // Attaching a sidecar file was never proof the binaries were inventoried.
    for (const field of REQUIRED_TOOL_FIELDS) {
      const text = complete.split("\n").filter((l) => !l.startsWith(`${field}=`)).join("\n");
      const r = parseToolProvenance(text);
      assert.equal(r.ok, false, `${field} must be required`);
      assert.ok(r.missing.includes(field));
    }
  });

  test("an empty provenance file is not ok", () => {
    assert.equal(parseToolProvenance("").ok, false);
    assert.equal(parseToolProvenance(null).ok, false);
  });

  test("the axis is named for what it actually produces", () => {
    const axis = axisById("component-inventory");
    assert.match(axis.title, /external binaries/i);
    assert.ok(!axisById("sbom"), "the overstated 'sbom' id is gone");
  });
});

describe("repository metadata parsing", () => {
  test("owner/name is extracted from every URL form", () => {
    assert.equal(repoSlug("https://github.com/o/n.git"), "o/n");
    assert.equal(repoSlug("git@github.com:o/n.git"), "o/n");
    assert.equal(repoSlug("https://github.com/o/n"), "o/n");
    assert.equal(repoSlug("https://gitlab.com/o/n.git"), null);
    assert.equal(repoSlug(null), null);
  });
});
