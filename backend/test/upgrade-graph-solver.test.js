/**
 * v2.3.0 P1 — update-graph normalization and path solving (shared/upgradePath.js)
 * and the graph client's safety rules (backend/src/updateGraph.js).
 *
 * Fixtures are verbatim captures of the public OpenShift Update Service graph
 * API (backend/test/fixtures/upgrade-graph/*.json carry source URL, fetch
 * time and body SHA-256). They are test data, not a support statement.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGraph, solvePath, classifyTargets, validateRoute, buildHops, ARCH_ALIASES } from "../../shared/upgradePath.js";
import { refreshPublicGraph, importGraph, validateGraphBody, assertGraphRequest, describeGraphEntry, GRAPH_ENDPOINT, GRAPH_MAX_BYTES, UpdateGraphError } from "../src/updateGraph.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SM = ["4.20", "4.21", "4.22"];
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8"));
const load = (channel, arch = "amd64") => normalizeGraph(fixture(`${channel}-${arch}`).body, { channel, arch, supportedMinors: SM });

const G = {
  s22: load("stable-4.22"), s21: load("stable-4.21"), s20: load("stable-4.20"), e22: load("eus-4.22"), f22: load("fast-4.22"), s22arm: load("stable-4.22", "arm64")
};
const STEP = { "stable-4.20": G.s20, "stable-4.21": G.s21, "stable-4.22": G.s22 };

describe("fixtures keep their provenance", () => {
  test("every fixture records its exact source URL, time and body checksum", () => {
    for (const f of fs.readdirSync(path.join(here, "fixtures", "upgrade-graph"))) {
      const { source, body } = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", f), "utf8"));
      assert.ok(source.url.startsWith(`${GRAPH_ENDPOINT}?channel=`), f);
      assert.ok(!Number.isNaN(Date.parse(source.fetchedAt)), f);
      assert.match(source.bodySha256, /^[a-f0-9]{64}$/);
      assert.ok(Array.isArray(body.nodes) && Array.isArray(body.edges), f);
    }
  });
});

describe("normalization", () => {
  test("only supported minors survive; older minors are counted, not used", () => {
    assert.ok(G.s20.excludedUnsupported > 0, "stable-4.20 carries 4.18/4.19 nodes");
    assert.ok(G.s20.versions.every((v) => v.startsWith("4.20.")));
    assert.ok(G.s22.versions.every((v) => /^4\.2[012]\.\d+$/.test(v)));
  });
  test("conditional edges are separate from recommended edges and keep their risks", () => {
    assert.ok(G.s22.conditional.length > 0);
    const keys = new Set(G.s22.edges.map(([a, b]) => `${a}>${b}`));
    for (const c of G.s22.conditional) {
      assert.equal(keys.has(`${c.from}>${c.to}`), false, "a conditional edge is never also recommended");
      assert.ok(c.risks.length > 0 && c.risks.every((r) => r.name));
    }
  });
  test("there is no direct 4.20 → 4.22 edge in the live graphs (no minor is skipped)", () => {
    for (const g of [G.s22, G.e22, G.f22]) {
      assert.equal(g.edges.some(([a, b]) => a.startsWith("4.20.") && b.startsWith("4.22.")), false);
    }
  });
  test("hostile input: bad versions, pre-releases, unsafe URLs, out-of-range edges are dropped", () => {
    const body = {
      nodes: [
        { version: "4.21.1", payload: "quay.io/openshift-release-dev/ocp-release@sha256:" + "a".repeat(64), metadata: { url: "javascript:alert(1)" } },
        { version: "4.22.0-rc.1", payload: "x", metadata: {} },
        { version: "4.21.2", payload: "not a digest", metadata: { url: "https://access.redhat.com/errata/RHSA-1" } },
        { version: "4.19.9", metadata: {} }
      ],
      edges: [[0, 2], [2, 0], [0, 1], [3, 0], [0, 0]],
      conditionalEdges: [{ edges: [{ from: "4.21.1", to: "4.21.2" }], risks: [{ name: "R", url: "http://insecure", message: "m", matchingRules: [{ type: "Always" }] }] }]
    };
    const g = normalizeGraph(body, { channel: "stable-4.21", arch: "amd64", supportedMinors: SM });
    assert.deepEqual(g.versions, ["4.21.1", "4.21.2"]);
    assert.equal(g.invalidNodes, 1);
    assert.equal(g.excludedUnsupported, 1);
    assert.equal(g.nodes["4.21.1"].errataUrl, null);
    assert.equal(g.nodes["4.21.2"].payload, null);
    assert.deepEqual(g.edges, [], "the only real edge is conditional, and downgrades/self-loops are dropped");
    assert.equal(g.conditional[0].risks[0].url, null);
    assert.deepEqual(g.conditional[0].risks[0].ruleTypes, ["Always"]);
  });
});

describe("solver", () => {
  test("4.20.14 → 4.22.22 matches the recommended head-of-channel route and validates each hop in its own channel", () => {
    const r = solvePath({ graph: G.s22, source: "4.20.14", target: "4.22.22", supportedMinors: SM, stepGraphs: STEP });
    assert.equal(r.ok, true);
    assert.deepEqual(r.path, ["4.20.14", "4.20.44", "4.21.40", "4.22.22"]);
    assert.deepEqual(r.hops.map((h) => h.channel), ["stable-4.20", "stable-4.21", "stable-4.22"]);
    assert.deepEqual(r.hops.map((h) => h.channelCheck), ["recommended", "recommended", "recommended"]);
    assert.deepEqual(r.hops.map((h) => h.kind), ["z-stream", "minor", "minor"]);
    assert.ok(r.hops.every((h) => /@sha256:[a-f0-9]{64}$/.test(h.payload)), "every hop carries the payload digest");
    assert.equal(r.selectedBy, "default-convention");
    assert.ok(r.alternativesTotal > 0 && r.alternatives.length <= 10, "equal-length alternatives are offered");
    for (const alt of r.alternatives) assert.equal(validateRoute({ graph: G.s22, route: alt, supportedMinors: SM }).ok, true);
  });
  test("4.20.14 cannot go straight to 4.21 on a recommended edge (those edges carry a risk), so a z-stream step comes first", () => {
    const direct = G.s22.conditional.filter((c) => c.from === "4.20.14" && c.to.startsWith("4.21."));
    assert.ok(direct.length > 0);
    assert.equal(G.s22.edges.some(([a, b]) => a === "4.20.14" && b.startsWith("4.21.")), false);
  });
  test("determinism: the same answer whatever the input order", () => {
    const body = fixture("stable-4.22-amd64").body;
    const order = body.nodes.map((_, i) => i).reverse();
    const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
    const shuffled = { ...body, nodes: order.map((i) => body.nodes[i]), edges: [...body.edges].reverse().map(([a, b]) => [remap.get(a), remap.get(b)]), conditionalEdges: [...body.conditionalEdges].reverse() };
    const g2 = normalizeGraph(shuffled, { channel: "stable-4.22", arch: "amd64", supportedMinors: SM });
    const a = solvePath({ graph: G.s22, source: "4.20.14", target: "4.22.22", supportedMinors: SM });
    const b = solvePath({ graph: g2, source: "4.20.14", target: "4.22.22", supportedMinors: SM });
    assert.deepEqual(b.path, a.path);
    assert.deepEqual(b.alternatives, a.alternatives);
  });
  test("refusals carry deterministic reason codes", () => {
    const code = (o) => solvePath({ graph: G.s22, supportedMinors: SM, ...o }).reasons[0].code;
    assert.equal(code({ source: "4.22.22", target: "4.22.22" }), "SAME_VERSION");
    assert.equal(code({ source: "4.22.22", target: "4.21.40" }), "DOWNGRADE");
    assert.equal(code({ source: "4.19.53", target: "4.22.22" }), "SOURCE_UNSUPPORTED");
    assert.equal(code({ source: "4.22.1", target: "4.23.1" }), "TARGET_UNSUPPORTED");
    assert.equal(code({ source: "4.22.0-rc.1", target: "4.22.22" }), "SOURCE_INVALID");
    assert.equal(code({ source: "4.20.99", target: "4.22.22" }), "SOURCE_NOT_IN_GRAPH");
    assert.equal(solvePath({ graph: G.s21, source: "4.20.14", target: "4.22.22", supportedMinors: SM }).reasons[0].code, "TARGET_NOT_IN_GRAPH");
  });
  test("no recommended route: refused with whether a conditional route exists; conditional only on explicit review", () => {
    const cond = G.s22.conditional[0];
    const g = { ...G.s22, edges: G.s22.edges.filter(([a]) => a !== cond.from) };
    const plain = solvePath({ graph: g, source: cond.from, target: cond.to, supportedMinors: SM });
    assert.equal(plain.ok, false);
    assert.equal(plain.reasons[0].code, "NO_RECOMMENDED_PATH");
    assert.equal(plain.conditionalAvailable, true);
    const reviewed = solvePath({ graph: g, source: cond.from, target: cond.to, supportedMinors: SM, includeConditional: true });
    assert.equal(reviewed.conditional, true);
    assert.ok(reviewed.hops.some((h) => h.conditional && h.risks.length));
  });
  test("an edge missing from the channel the cluster is on for that hop blocks the route", () => {
    const broken = { ...G.s21, edges: G.s21.edges.filter(([a, b]) => !(a === "4.20.44" && b === "4.21.40")), conditional: [] };
    const r = solvePath({ graph: G.s22, source: "4.20.14", target: "4.22.22", supportedMinors: SM, stepGraphs: { ...STEP, "stable-4.21": broken } });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.code === "EDGE_NOT_IN_STEP_CHANNEL"));
  });
  test("Control Plane Only: eus-4.22 only, 4.20 → 4.22 only, and the 4.21 hop is marked", () => {
    const r = solvePath({ graph: G.e22, source: "4.20.14", target: "4.22.22", supportedMinors: SM, strategy: "cpo" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.hops.map((h) => Boolean(h.controlPlaneOnly)), [false, true, false]);
    assert.ok(r.hops.every((h) => h.channel === "eus-4.22"));
    assert.equal(solvePath({ graph: G.s22, source: "4.20.14", target: "4.22.22", supportedMinors: SM, strategy: "cpo" }).reasons[0].code, "CPO_NOT_ELIGIBLE");
    assert.equal(solvePath({ graph: G.e22, source: "4.21.40", target: "4.22.22", supportedMinors: SM, strategy: "cpo" }).reasons[0].code, "CPO_NOT_ELIGIBLE");
  });
  test("target classification and route validation", () => {
    const cls = classifyTargets(G.s22, "4.20.14", { supportedMinors: SM });
    assert.ok(cls.find((c) => c.version === "4.22.22").status === "recommended");
    assert.ok(cls.some((c) => c.status === "conditional-only"));
    assert.equal(validateRoute({ graph: G.s22, route: ["4.20.14", "4.22.22"], supportedMinors: SM }).reason, "ROUTE_MINOR_SKIP");
    const cond = G.s22.conditional.find((c) => c.from === "4.20.14");
    assert.equal(validateRoute({ graph: G.s22, route: [cond.from, cond.to], supportedMinors: SM }).reason, "ROUTE_CONDITIONAL");
    assert.equal(validateRoute({ graph: G.s22, route: [cond.from, cond.to], supportedMinors: SM, allowConditional: true }).ok, true);
    const hops = buildHops({ graph: G.s22, versions: [cond.from, cond.to] });
    assert.equal(hops[0].conditional, true);
  });
  test("architecture names: the UI's x86_64/aarch64 map to the API's amd64/arm64", () => {
    assert.equal(ARCH_ALIASES.x86_64, "amd64");
    assert.equal(ARCH_ALIASES.aarch64, "arm64");
    assert.ok(G.s22arm.versions.length > 0);
  });
});

describe("graph client safety", () => {
  const okResponse = (text) => new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  const fixtureText = JSON.stringify(fixture("stable-4.21-amd64").body);

  test("allowlist: only stable/fast/eus channels of supported minors and API architecture names", () => {
    for (const [ch, arch, code] of [["candidate-4.22", "amd64", "GRAPH_CHANNEL_INVALID"], ["stable-4.23", "amd64", "UNSUPPORTED_VERSION"], ["stable-4.19", "amd64", "UNSUPPORTED_VERSION"], ["stable-4.22", "x86_64", "GRAPH_ARCH_INVALID"], ["stable-4.22&arch=s390x", "amd64", "GRAPH_CHANNEL_INVALID"]]) {
      assert.throws(() => assertGraphRequest(ch, arch), (e) => e instanceof UpdateGraphError && e.code === code, `${ch} ${arch}`);
    }
  });
  test("requests go to the one fixed endpoint, with no redirects", async () => {
    let seen;
    await refreshPublicGraph("stable-4.21", "amd64", { fetchImpl: async (url, opts) => { seen = { url, opts }; return okResponse(fixtureText); } });
    assert.equal(seen.url, `${GRAPH_ENDPOINT}?channel=stable-4.21&arch=amd64`);
    assert.equal(seen.opts.redirect, "error");
  });
  test("refused: redirects, HTTP errors, oversize bodies, empty graphs, malformed JSON, unreachable", async () => {
    const run = (impl) => refreshPublicGraph("stable-4.21", "amd64", { fetchImpl: impl });
    await assert.rejects(run(async () => new Response("", { status: 302, headers: { location: "https://evil.example" } })), { code: "GRAPH_REDIRECT_REFUSED" });
    await assert.rejects(run(async () => new Response("no", { status: 500 })), { code: "GRAPH_HTTP_ERROR" });
    await assert.rejects(run(async () => okResponse("x".repeat(GRAPH_MAX_BYTES + 10))), { code: "GRAPH_TOO_LARGE" });
    await assert.rejects(run(async () => okResponse(JSON.stringify({ nodes: [], edges: [], conditionalEdges: [] }))), { code: "GRAPH_EMPTY" });
    await assert.rejects(run(async () => okResponse("{not json")), { code: "GRAPH_INVALID" });
    await assert.rejects(run(async () => okResponse(JSON.stringify({ nodes: [{ version: "4.21.1" }], edges: [[0, 9]] }))), { code: "GRAPH_INVALID" });
    await assert.rejects(run(async () => { throw new TypeError("fetch failed"); }), { code: "GRAPH_UNREACHABLE" });
  });
  test("a fetched entry records its exact provenance; checksums are described as integrity only", async () => {
    const entry = await refreshPublicGraph("stable-4.21", "amd64", { fetchImpl: async () => okResponse(fixtureText), now: () => Date.parse("2026-11-06T12:00:00Z") });
    assert.equal(entry.bodySha256, crypto.createHash("sha256").update(fixtureText).digest("hex"));
    const d = describeGraphEntry(entry, Date.parse("2026-11-08T12:00:00Z"));
    assert.equal(d.stale, true, "older than a day is shown 'as of', not as current");
    assert.match(d.integrity, /not signed/);
  });
  test("imports are validated identically and always labelled with their origin", () => {
    const entry = importGraph({ channel: "stable-4.21", arch: "amd64", text: fixtureText, origin: "customer-osus", sourceUrl: "https://osus.apps.example.internal/api/upgrades_info/v1/graph" });
    const d = describeGraphEntry(entry);
    assert.equal(d.origin, "customer-osus");
    assert.equal(d.stale, true, "an imported graph is never presented as live");
    assert.equal(d.capturedAtKnown, false);
    assert.throws(() => importGraph({ channel: "stable-4.21", arch: "amd64", text: "{}", origin: "customer-osus" }), { code: "GRAPH_INVALID" });
    assert.throws(() => validateGraphBody(JSON.stringify({ nodes: [], edges: [] })), { code: "GRAPH_EMPTY" });
  });
});
