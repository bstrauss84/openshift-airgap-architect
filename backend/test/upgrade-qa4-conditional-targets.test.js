/**
 * v2.3.0 owner QA 4 (2026-11-19) — "every 4.22 target is labelled conditional".
 *
 * Verified against the live stable-4.22 amd64 graph (fixture recorded 2026-11-19T16:01:37Z): from
 * 4.20.8 every 4.22 release IS reachable only through a conditional update, because the graph
 * recommends 4.21 → 4.22 only from 4.21.39–4.21.42 and 4.20.8 reaches those only conditionally.
 * The label hid that; and among equally short conditional routes the solver ignored risk.
 * Kept apart now: a release in the channel · a recommended edge · a conditional edge · a target
 * reachable only through conditional edges (with the least-risk hop and whether its risk applies
 * to every cluster) · unreachable.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGraph, classifyTargets, minorGates, solvePath, leastRiskRoutes } from "../../shared/upgradePath.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MINORS = ["4.20", "4.21", "4.22"];
const risk = (name, type) => ({ url: `https://example.invalid/${name}`, name, message: `${name} message`, matchingRules: [{ type, ...(type === "PromQL" ? { promql: { promql: "x" } } : {}) }] });
/** Build a raw Cincinnati body: recommended edges and conditional edges by version. */
const body = (versions, rec, cond = []) => ({
  nodes: versions.map((version) => ({ version, payload: `quay.io/x@sha256:${version.replace(/\D/g, "").padEnd(64, "0").slice(0, 64)}`, metadata: {} })),
  edges: rec.map(([a, b]) => [versions.indexOf(a), versions.indexOf(b)]),
  conditionalEdges: cond.map(([a, b, risks]) => ({ edges: [{ from: a, to: b }], risks }))
});
const graphOf = (b) => normalizeGraph(b, { channel: "stable-4.22", arch: "amd64", supportedMinors: MINORS });

describe("target classification", () => {
  const V = ["4.20.1", "4.20.2", "4.20.3", "4.21.1", "4.21.2", "4.22.1", "4.22.2", "4.22.3"];
  // 4.20.1 → 4.20.2 is conditional (PromQL); everything after 4.20.2 is recommended.
  // 4.20.1 → 4.20.3 → 4.21.1 → 4.22.3 is fully recommended.
  const g = graphOf(body(V,
    [["4.20.2", "4.21.2"], ["4.21.2", "4.22.1"], ["4.21.2", "4.22.2"], ["4.20.1", "4.20.3"], ["4.20.3", "4.21.1"], ["4.21.1", "4.22.3"]],
    [["4.20.1", "4.20.2", [risk("VendorThing", "PromQL")]]]));
  const t = Object.fromEntries(classifyTargets(g, "4.20.1", { supportedMinors: MINORS }).map((x) => [x.version, x]));

  test("a shared conditional prefix makes only the targets behind it conditional-only — never the targets with a recommended route", () => {
    assert.equal(t["4.22.3"].status, "recommended", "an unconditional alternative is not tainted by another route's conditional hop");
    assert.equal(t["4.20.3"].status, "recommended");
    assert.equal(t["4.22.1"].status, "conditional-only");
    assert.equal(t["4.22.2"].status, "conditional-only");
    assert.equal(t["4.20.2"].status, "conditional-only");
  });

  test("a conditional-only target names its conditional hop and whether the risk applies to every cluster", () => {
    assert.deepEqual(t["4.22.1"].via.map((h) => [h.from, h.to, h.risks.map((r) => r.name), h.always]), [["4.20.1", "4.20.2", ["VendorThing"], false]]);
    assert.equal(t["4.22.1"].alwaysRisk, false);
    assert.equal(t["4.22.3"].via, undefined);
  });

  test("minorGates says from which releases the graph recommends the next minor, and which are reachable without a conditional update", () => {
    assert.deepEqual(minorGates(g, "4.20.1", { supportedMinors: MINORS }), [
      { from: "4.20", to: "4.21", recommendedFrom: ["4.20.2", "4.20.3"], reachableRecommended: ["4.20.3"] },
      { from: "4.21", to: "4.22", recommendedFrom: ["4.21.1", "4.21.2"], reachableRecommended: ["4.21.1"] }
    ]);
  });
});

describe("route choice among conditional routes", () => {
  test("of two equally short conditional routes, the one whose risk applies only to matching clusters wins over an Always risk, even against the highest-version convention", () => {
    const V = ["4.21.1", "4.21.2", "4.21.3", "4.22.1"];
    const g = graphOf(body(V, [["4.21.2", "4.22.1"], ["4.21.3", "4.22.1"]], [
      ["4.21.1", "4.21.3", [risk("EveryCluster", "Always")]],
      ["4.21.1", "4.21.2", [risk("SomeClusters", "PromQL")]]
    ]));
    const r = solvePath({ graph: g, source: "4.21.1", target: "4.22.1", supportedMinors: MINORS, includeConditional: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.path, ["4.21.1", "4.21.2", "4.22.1"]);
    assert.equal(r.conditional, true);
    assert.deepEqual(r.alternatives, [["4.21.1", "4.21.3", "4.22.1"]]);
    assert.equal(leastRiskRoutes(g, "4.21.1", { supportedMinors: MINORS }).get("4.22.1").via[0].to, "4.21.2");
  });

  test("a recommended route is never replaced by a conditional one, and without review nothing conditional is offered", () => {
    const V = ["4.21.1", "4.21.2", "4.22.1"];
    const g = graphOf(body(V, [["4.21.1", "4.21.2"], ["4.21.2", "4.22.1"]], [["4.21.1", "4.22.1", [risk("X", "PromQL")]]]));
    const on = solvePath({ graph: g, source: "4.21.1", target: "4.22.1", supportedMinors: MINORS, includeConditional: true });
    assert.equal(on.conditional, false);
    assert.deepEqual(on.path, ["4.21.1", "4.21.2", "4.22.1"]);
    const off = solvePath({ graph: graphOf(body(["4.21.1", "4.22.1"], [], [["4.21.1", "4.22.1", [risk("X", "PromQL")]]])), source: "4.21.1", target: "4.22.1", supportedMinors: MINORS, includeConditional: false });
    assert.equal(off.ok, false);
    assert.equal(off.conditionalAvailable, true);
  });
});

describe("live stable-4.22 amd64 graph, 2026-11-19 (owner's example 4.20.8 → 4.22.22)", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", "stable-4.22-amd64-live-20261119.json"), "utf8"));
  const g = graphOf(fx.body);
  const t = classifyTargets(g, "4.20.8", { supportedMinors: MINORS });

  test("every 4.22 release is conditional-only from 4.20.8, while most of 4.21 is recommended — and the gate explains why", () => {
    const of = (m, s) => t.filter((x) => x.version.startsWith(`${m}.`) && x.status === s).length;
    assert.equal(of("4.22", "recommended"), 0);
    assert.equal(of("4.22", "conditional-only"), 23);
    assert.ok(of("4.21", "recommended") > 20);
    const gate = minorGates(g, "4.20.8", { supportedMinors: MINORS }).find((x) => x.from === "4.21");
    assert.deepEqual(gate.recommendedFrom, ["4.21.39", "4.21.40", "4.21.41", "4.21.42"]);
    assert.deepEqual(gate.reachableRecommended, []);
  });

  test("4.22.22 needs one conditional hop whose only risk applies to matching clusters (vSphere), not to every cluster; some 4.22 targets carry an Always risk", () => {
    const x = t.find((v) => v.version === "4.22.22");
    assert.equal(x.alwaysRisk, false);
    assert.deepEqual([...new Set(x.via.flatMap((h) => h.risks.map((r) => r.name)))], ["VSphereConfigCloudControllerCrash"]);
    assert.ok(t.some((v) => v.version.startsWith("4.22.") && v.alwaysRisk), "e.g. 4.22.1 only via KubeStateMetricsTimezonePanic (Always)");
    const r = solvePath({ graph: g, source: "4.20.8", target: "4.22.22", supportedMinors: MINORS, includeConditional: true });
    assert.equal(r.hops.filter((h) => h.conditional).length, 1);
    assert.deepEqual(r.hops.filter((h) => h.conditional).flatMap((h) => h.risks.map((k) => k.name)), ["VSphereConfigCloudControllerCrash"]);
  });
});
