/**
 * AXIS: connectivity — runtime connectivity profiles and egress inventory.
 *
 * Replaces the `connectivity` placeholder. Its closure plan set a bar that is
 * easy to state and easy to fake:
 *
 *   "The disconnected profile must be proven by denying egress at the network
 *    layer and asserting no unexpected outbound attempt — not by observing
 *    that generation happens to succeed."
 *
 * Both clauses are implemented, and neither is sufficient alone:
 *
 *   DENY AT THE NETWORK LAYER. The probe suite is executed a second time
 *   inside `unshare -rn` — an unprivileged network namespace whose only
 *   interface is loopback. `lo` is brought up so the suite can reach its own
 *   test server; there is no route to anywhere else, and no environment
 *   variable a code path could consult and ignore. Verified during
 *   development: curl to mirror.openshift.com returns 000 inside it.
 *
 *   ASSERT NO UNEXPECTED ATTEMPT. Denial alone is a weak proof — a swallowed
 *   fetch whose rejection is caught looks identical to code that never calls
 *   out. The suite wraps `globalThis.fetch` and records every non-loopback
 *   attempt, so the claim becomes "the core offline workflow attempts zero
 *   egress", which is checkable and much stronger.
 *
 * WHEN unshare IS UNAVAILABLE the axis reports INCOMPLETE, never PASS. A
 * connected-only run proves the recorder saw nothing; it does not prove the
 * product survives an actually severed network, and those are different
 * claims. Reporting the weaker one as the stronger one is exactly the failure
 * this axis exists to prevent.
 *
 * THE EGRESS INVENTORY IS A SOURCE FACT, NOT A BEHAVIOUR. It is emitted as
 * evidence and checked for growth against the declared set, so a newly added
 * call site in a disconnected-install tool cannot land unnoticed. It is
 * deliberately not the pass/fail criterion — that is what the profiles are.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record, tail, hasTool } from "../lib/exec.mjs";

const ID = "connectivity";
const PROBE_SUITE = "test/connectivity-profile-probes.test.js";

/**
 * Runtime egress sites this product is KNOWN to have, each classified.
 *
 * Inherited from the 8A static read (planned.mjs connectivity.known) and
 * classified here, which is what 8A could not do. `required` would mean the
 * product cannot function without it; nothing is required, which is the
 * property that makes an air-gapped install possible at all.
 */
const DECLARED_EGRESS = Object.freeze([
  {
    host: "api.github.com",
    purpose: "Cincinnati channel list (openshift/cincinnati-graph-data contents API)",
    classification: "connected-only",
    source: "backend/src/cincinnati.js:45",
  },
  {
    host: "raw.githubusercontent.com",
    purpose: "Cincinnati channel YAML (stable-<minor>.yaml)",
    classification: "connected-only",
    source: "backend/src/cincinnati.js:95",
  },
  {
    host: "mirror.openshift.com",
    purpose: "oc / oc-mirror / openshift-install / mirror-registry acquisition and checksum manifests",
    classification: "connected-only",
    source: "backend/src/ocMirrorRuntime.js, backend/src/verifiedDownload.js, backend/src/installer.js, backend/src/openshiftInstaller.js, backend/src/index.js",
  },
  {
    host: "docs.redhat.com",
    purpose: "documentation availability probe for Field Guide citations",
    classification: "discovery-only",
    source: "backend/src/docs.js:16",
  },
  {
    host: "github.com",
    purpose: "feedback submission target and generated-artifact provenance comments (the latter are inert text, not calls)",
    classification: "optional",
    source: "backend/src/feedback.js, backend/src/index.js, backend/src/generate.js (comment text)",
  },
]);

/**
 * Source roots scanned for URL literals, to detect undeclared growth.
 *
 * `backend/src/fieldGuide` is EXCLUDED and the exclusion is load-bearing, not
 * a convenience. That tree is operator-facing guidance text — it names
 * console.redhat.com, quay.io and console-openshift-console.apps inside
 * instructions a human reads and types. Those are documentation references,
 * never call sites, and counting them would make the inventory report egress
 * the product does not perform. Including them would also make this check
 * fire on every Field Guide edit, which trains people to ignore it.
 */
const EGRESS_SCAN_ROOTS = ["backend/src"];
const EGRESS_SCAN_EXCLUDE = new Set(["node_modules", "fieldGuide"]);
const URL_LITERAL = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;

/** Hosts that are never real egress: examples, placeholders, schema ids, loopback. */
const NON_EGRESS_HOST = /^(localhost|127\.0\.0\.1|example\.com|example\.org|example\.net|schemas?\..*|www\.w3\.org|cyclonedx\.org|spdx\.org|registry\.local|.*\.example\.com)$/i;

function scanEgressHosts(repoRoot) {
  const found = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (EGRESS_SCAN_EXCLUDE.has(e.name)) continue;
        walk(full);
      } else if (/\.(js|mjs)$/.test(e.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(URL_LITERAL)) {
          const host = m[1].toLowerCase();
          if (NON_EGRESS_HOST.test(host)) continue;
          if (!found.has(host)) found.set(host, []);
          const rel = path.relative(repoRoot, full);
          if (!found.get(host).includes(rel)) found.get(host).push(rel);
        }
      }
    }
  };
  for (const root of EGRESS_SCAN_ROOTS) walk(path.join(repoRoot, root));
  return found;
}

function tapCounts(output) {
  const grab = (label) => {
    const m = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  return { tests: grab("tests"), pass: grab("pass"), fail: grab("fail"), skipped: grab("skipped") };
}

/** Pull the structured egress record the probe suite prints on teardown. */
function parseEgressAttempts(output) {
  const m = output.match(/EGRESS-ATTEMPTS (\{.*\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export default {
  id: ID,
  title: "Runtime connectivity profiles and egress inventory",
  required: true,
  reuse: REUSE.NEVER,
  inputs: ["backend/src", "backend/test", "frontend/src"],

  async run({ repoRoot, store }) {
    const backendDir = path.join(repoRoot, "backend");
    const suitePath = path.join(backendDir, PROBE_SUITE);

    if (!fs.existsSync(suitePath)) {
      return incomplete(ID, `probe suite missing: backend/${PROBE_SUITE}`, {
        evidence: { probeSuite: `backend/${PROBE_SUITE}`, present: false },
      });
    }
    if (!fs.existsSync(path.join(backendDir, "node_modules"))) {
      return incomplete(ID, "backend dependencies absent; run `npm ci --prefix backend` first", {
        evidence: { missingDependencies: "backend/node_modules" },
      });
    }

    // ---- Egress inventory (source fact) -----------------------------------
    const scanned = scanEgressHosts(repoRoot);
    const declaredHosts = new Set(DECLARED_EGRESS.map((e) => e.host));
    const undeclared = [...scanned.entries()]
      .filter(([host]) => !declaredHosts.has(host))
      .map(([host, files]) => ({ host, files }));

    // ---- Profile: connected ------------------------------------------------
    const baseEnv = {
      ...process.env,
      NODE_ENV: "test",
      DATA_DIR: process.env.DATA_DIR || "/tmp/airgap-connectivity-connected",
    };
    const connected = run("node", ["--test", "--test-timeout=180000", PROBE_SUITE], {
      cwd: backendDir,
      env: { ...baseEnv, OAA_CONNECTIVITY_PROFILE: "connected" },
      timeoutMs: 10 * 60_000,
    });
    const connectedOut = `${connected.stdout || ""}${connected.stderr || ""}`;
    const connectedCounts = tapCounts(connectedOut);
    const connectedEgress = parseEgressAttempts(connectedOut);

    // ---- Profile: disconnected (network layer denial) ----------------------
    //
    // `unshare -rn` maps the caller to root INSIDE a new user+network
    // namespace, which is how an unprivileged process gets an empty network
    // stack. `ip link set lo up` is needed because a fresh namespace's
    // loopback is DOWN and the suite talks to its own server over it.
    const canUnshare = hasTool("unshare");
    let disconnected = null;
    let disconnectedOut = "";
    let disconnectedCounts = null;
    let disconnectedEgress = null;
    let isolationProof = null;

    if (canUnshare) {
      // Prove the namespace really is severed, in the same shell that then
      // runs the suite. A claim of isolation that is not itself tested is not
      // evidence.
      //
      // curl EXITS NON-ZERO when it cannot connect (exit 7) while still
      // printing `000` via -w. An `||` fallback therefore fires on exactly
      // the outcome we want and concatenates onto the captured output — the
      // first version of this produced the string "000nocurl". So the exit
      // status is ignored deliberately and only the printed code is read.
      const script =
        "ip link set lo up 2>/dev/null; " +
        "if command -v curl >/dev/null 2>&1; then " +
        '  PROBE=$(timeout 5 curl -sS -o /dev/null -w "%{http_code}" https://mirror.openshift.com/ 2>/dev/null); ' +
        '  PROBE=${PROBE:-000}; ' +
        "else PROBE=nocurl; fi; " +
        'echo "ISOLATION-PROBE ${PROBE}"; ' +
        `exec node --test --test-timeout=180000 ${PROBE_SUITE}`;

      disconnected = run("unshare", ["-rn", "sh", "-c", script], {
        cwd: backendDir,
        env: {
          ...baseEnv,
          DATA_DIR: process.env.OAA_DISCONNECTED_DATA_DIR || "/tmp/airgap-connectivity-disconnected",
          OAA_CONNECTIVITY_PROFILE: "disconnected",
        },
        timeoutMs: 10 * 60_000,
      });
      disconnectedOut = `${disconnected.stdout || ""}${disconnected.stderr || ""}`;
      disconnectedCounts = tapCounts(disconnectedOut);
      disconnectedEgress = parseEgressAttempts(disconnectedOut);
      const probeMatch = disconnectedOut.match(/ISOLATION-PROBE (\S+)/);
      isolationProof = probeMatch ? probeMatch[1] : null;
    }

    const profiles = {
      connected: { ran: true, counts: connectedCounts, egressAttempts: connectedEgress?.attempts ?? null, exec: record(connected) },
      disconnected: canUnshare
        ? {
            ran: true,
            method: "unshare -rn (unprivileged network namespace, loopback only)",
            isolationProbe: isolationProof,
            counts: disconnectedCounts,
            egressAttempts: disconnectedEgress?.attempts ?? null,
            exec: record(disconnected),
          }
        : { ran: false, reason: "`unshare` unavailable on this host; network-layer denial cannot be performed" },
      // Profiles that need infrastructure this harness does not provision.
      // Declared so their absence is visible rather than implied.
      notExercised: [
        { profile: "http-proxy", reason: "requires a proxy endpoint; no fixture proxy is provisioned", owner: "PROD-043" },
        { profile: "https-proxy", reason: "requires a proxy endpoint", owner: "PROD-043" },
        { profile: "no-proxy-cidr", reason: "covered by unit tests over NO_PROXY CIDR parsing, not by a live profile run", owner: "PROD-043" },
        { profile: "custom-ca-tls-interception", reason: "requires an intercepting CA and a re-signed chain", owner: "PROD-043" },
        { profile: "restricted-dns", reason: "requires a controlled resolver", owner: "PROD-043" },
      ],
    };

    const artifacts = [
      store.writeArtifact(ID, "connectivity.json", {
        declaredEgress: DECLARED_EGRESS,
        scannedHosts: [...scanned.entries()].map(([host, files]) => ({ host, files })),
        undeclaredHosts: undeclared,
        profiles,
      }),
      store.writeArtifact(ID, "profile-connected.log", connectedOut),
      ...(canUnshare ? [store.writeArtifact(ID, "profile-disconnected.log", disconnectedOut)] : []),
    ];

    const evidence = {
      declaredEgressCount: DECLARED_EGRESS.length,
      undeclaredHosts: undeclared,
      profiles: {
        connected: { counts: connectedCounts, egressAttempts: connectedEgress?.attempts?.length ?? null },
        disconnected: canUnshare
          ? { counts: disconnectedCounts, isolationProbe: isolationProof, egressAttempts: disconnectedEgress?.attempts?.length ?? null }
          : null,
      },
      notExercised: profiles.notExercised.map((p) => p.profile),
    };

    // ---- Verdict -----------------------------------------------------------
    if (undeclared.length) {
      return fail(ID, `${undeclared.length} undeclared egress host(s) in backend/src: ${undeclared.map((u) => u.host).join(", ")}`, {
        evidence,
        artifacts,
      });
    }
    if (connected.status !== 0 || (connectedCounts.fail ?? 0) > 0) {
      return fail(ID, `connected-profile probes failed (${connectedCounts.fail ?? "?"} failing)`, {
        evidence: { ...evidence, tail: tail(connected, 40) },
        artifacts,
      });
    }
    if (!canUnshare) {
      return incomplete(
        ID,
        "connected profile passed, but `unshare` is unavailable so the disconnected profile could not be proven by denying egress",
        { evidence, artifacts }
      );
    }
    if (disconnected.status !== 0 || (disconnectedCounts.fail ?? 0) > 0) {
      return fail(ID, `disconnected-profile probes failed (${disconnectedCounts.fail ?? "?"} failing) under denied egress`, {
        evidence: { ...evidence, tail: tail(disconnected, 40) },
        artifacts,
      });
    }
    if (isolationProof && isolationProof !== "000" && isolationProof !== "nocurl") {
      // The namespace answered an outbound request. Whatever else the suite
      // reported, the isolation this axis depends on did not hold.
      return fail(ID, `network isolation did not hold: outbound probe returned HTTP ${isolationProof} inside the namespace`, {
        evidence,
        artifacts,
      });
    }

    const offlineAttempts = disconnectedEgress?.attempts ?? [];
    // The suite resets its recorder per case; the teardown dump carries only
    // the final case, which is the deliberately connected-only one. The
    // per-case zero-egress assertions are what actually gate the core
    // workflow, and they are inside the suite.
    const note = isolationProof === "nocurl"
      ? " (isolation by namespace construction; curl absent for the direct probe)"
      : "";

    const proven = `connected and disconnected profiles green; core offline workflow attempts ZERO egress under ` +
      `network-layer denial${note}; ${DECLARED_EGRESS.length} declared egress sites, none undeclared`;

    if (profiles.notExercised.length > 0) {
      // The two profiles that can be proven on this host ARE proven, and that
      // is a real advance on the placeholder. It is not the whole axis.
      // PROD-043 names proxy, CA-interception and restricted-DNS profiles
      // too, and none of them has been run — passing here would report four
      // unproven profiles as proven because three proven ones went green.
      return incomplete(
        ID,
        `${proven}. INCOMPLETE because ${profiles.notExercised.length} profile(s) require infrastructure this ` +
          `harness does not provision: ${profiles.notExercised.map((p) => p.profile).join(", ")} (PROD-043)`,
        { evidence: { ...evidence, finalCaseAttempts: offlineAttempts.map((a) => a.host), proven }, artifacts }
      );
    }

    return pass(ID, proven, {
      evidence: { ...evidence, finalCaseAttempts: offlineAttempts.map((a) => a.host) },
      artifacts,
    });
  },
};
