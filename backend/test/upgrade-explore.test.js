/**
 * v2.3.0 (owner decision D-1) — historical exploration: source AND target releases from 4.1 up to
 * the newest supported minor, routed only through real recommended edges of each step's own
 * stable-4.N graph, fetched from the single allowlisted host into a cache planning never reads.
 * Exploration never changes a plan, never synthesizes an edge, and targets above the newest
 * supported minor stay refused (422).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/index.js";
import { _setExploreFetchForTests, readCachedGraph } from "../src/updateGraph.js";
import { db } from "../src/db.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const payload = (i) => `quay.io/openshift-release-dev/ocp-release@sha256:${String(i).padStart(64, "0")}`;
/** A graph body in the exact shape api.openshift.com returns (edges are node indexes). */
const body = (versions, edges, channelsOf = () => "") => ({
  nodes: versions.map((v, i) => ({ version: v, payload: payload(i + 1), metadata: { "io.openshift.upgrades.graph.release.channels": channelsOf(v), url: `https://access.redhat.com/errata/RHBA-2024:${i}` } })),
  edges: edges.map(([a, b]) => [versions.indexOf(a), versions.indexOf(b)]),
  conditionalEdges: []
});
let graphs;
let requests;
const fakeFetch = async (url) => {
  const u = new URL(url);
  requests.push(u);
  const g = graphs[u.searchParams.get("channel")];
  if (g === "fail") throw new Error("network down");
  const text = JSON.stringify(g || { nodes: [], edges: [] });
  return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
};

let server;
let baseUrl;
const api = async (method, url, b) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

before(async () => { ({ server, baseUrl } = await createTestServer(app)); _setExploreFetchForTests(fakeFetch); });
after(async () => { _setExploreFetchForTests(null); await resetUpgradeForTests(); await closeTestServer(server); });
beforeEach(async () => {
  requests = [];
  db.prepare("DELETE FROM cache WHERE key LIKE 'upgrade_graph_v1:explore:%'").run();
  graphs = {
    "stable-4.12": body(["4.11.40", "4.12.10", "4.12.20"], [["4.11.40", "4.12.10"], ["4.12.10", "4.12.20"]], (v) => (v.startsWith("4.12") ? "stable-4.12,eus-4.12" : "stable-4.11")),
    "stable-4.13": body(["4.12.10", "4.12.20", "4.13.8"], [["4.12.20", "4.13.8"]]),
    "stable-4.14": body(["4.13.8", "4.14.5"], [["4.13.8", "4.14.5"]])
  };
  await resetUpgradeForTests();
});

describe("historical exploration", () => {
  test("4.12 → 4.14 uses only real edges, each from the channel the cluster is on for that step, and nothing is planned", async () => {
    const before = (await api("GET", "/api/upgrade")).json;
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.10", target: "4.14.5" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true, JSON.stringify(r.json.reasons));
    assert.equal(r.json.exploration, true);
    assert.deepEqual(r.json.path, ["4.12.10", "4.12.20", "4.13.8", "4.14.5"]);
    assert.deepEqual(r.json.hops.map((h) => [h.channel, h.channelCheck]), [["stable-4.12", "recommended"], ["stable-4.13", "recommended"], ["stable-4.14", "recommended"]]);
    assert.equal(r.json.firstSupported, null, "nothing on this route is in the planning range");
    assert.deepEqual(r.json.docs.map((d) => d.minor), ["4.12", "4.13", "4.14"]);
    assert.ok(r.json.docs.every((d) => d.url.startsWith("https://docs.redhat.com/") && d.humanVerified === false));
    assert.deepEqual(r.json.nodeInfo["4.12.20"].channels.includes("eus-4.12"), true);
    // Only the allowlisted host, only the channels needed.
    assert.ok(requests.every((u) => u.origin === "https://api.openshift.com" && u.pathname === "/api/upgrades_info/v1/graph"));
    assert.deepEqual(requests.map((u) => u.searchParams.get("channel")), ["stable-4.12", "stable-4.13", "stable-4.14"]);
    // Planning is untouched: no plan changed, and no planning cache can see these graphs.
    assert.deepEqual((await api("GET", "/api/upgrade")).json.plans, before.plans);
    assert.equal(readCachedGraph("public", "stable-4.12", "amd64"), null);
    assert.equal(readCachedGraph("explore", "stable-4.12", "amd64"), null, "planning reads never return exploration graphs");
    // A second exploration is served from its own cache (no new requests).
    requests = [];
    assert.equal((await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.10", target: "4.14.5" })).json.ok, true);
    assert.equal(requests.length, 0);
  });

  test("an edge into 4.13 listed only in another channel's graph is never used (no cross-channel invention)", async () => {
    graphs["stable-4.13"] = body(["4.12.20", "4.13.8"], []); // stable-4.13 itself has no 4.12 → 4.13 edge
    graphs["stable-4.14"] = body(["4.12.20", "4.13.8", "4.14.5"], [["4.12.20", "4.13.8"], ["4.13.8", "4.14.5"]]);
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.10", target: "4.14.5" });
    assert.equal(r.json.ok, false);
    assert.ok(r.json.reasons.some((x) => x.code === "NO_RECOMMENDED_PATH"));
    assert.ok(r.json.nextStep);
  });

  test("a release Red Hat no longer lists is explained, with a safe next step", async () => {
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.3", target: "4.14.5" });
    assert.equal(r.json.ok, false);
    assert.equal(r.json.reasons[0].code, "SOURCE_NOT_IN_GRAPHS");
    assert.match(r.json.reasons[0].message, /no longer listed/);
    assert.match(r.json.nextStep, /4\.12/);
  });

  test("a graph that cannot be read is named; nothing is guessed", async () => {
    graphs["stable-4.13"] = "fail";
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.10", target: "4.14.5" });
    assert.equal(r.json.ok, false);
    assert.ok(r.json.reasons.some((x) => x.code === "GRAPH_UNAVAILABLE" && x.message.includes("stable-4.13")));
  });

  test("a route reaching the planning range names the first supported release (the part that can be planned)", async () => {
    graphs = {
      "stable-4.19": body(["4.18.30", "4.19.10", "4.19.20"], [["4.19.10", "4.19.20"]]),
      "stable-4.20": body(["4.19.20", "4.20.14"], [["4.19.20", "4.20.14"]])
    };
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.19.10", target: "4.20.14" });
    assert.equal(r.json.ok, true, JSON.stringify(r.json.reasons));
    assert.equal(r.json.firstSupported, "4.20.14");
    assert.deepEqual(r.json.docs.map((d) => d.minor), ["4.19"], "documentation links only for steps outside the planning range");
  });

  test("targets above the newest supported minor stay refused (422); 4.0 and nonsense are explained", async () => {
    const r = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.12.10", target: "4.23.1" });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "UNSUPPORTED_VERSION");
    assert.equal(requests.length, 0);
    const z = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.0.5", target: "4.12.10" });
    assert.equal(z.json.ok, false);
    assert.equal(z.json.reasons[0].code, "SOURCE_OUT_OF_RANGE");
    const down = await api("POST", "/api/upgrade/explore", { arch: "amd64", source: "4.14.5", target: "4.12.10" });
    assert.equal(down.json.reasons[0].code, "TARGET_NOT_NEWER");
    // Planning itself still refuses older channels.
    assert.equal((await api("POST", "/api/upgrade/graph/refresh", { channel: "stable-4.12", arch: "amd64" })).status, 422);
  });
});
