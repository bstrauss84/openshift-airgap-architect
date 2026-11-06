/**
 * v2.3.0 P0b — structural guard for workflow isolation (RFC §18.3, §18.6 #10).
 *
 * Every write of the whole server state must be one of the reviewed forms
 * below, each of which keeps the server-owned slices (Mirroring, Upgrade). A
 * new `setState(...)` call fails this test until it is reviewed and either
 * routed through withServerOwnedSlices() or added here with its reason.
 *
 * Every oc-mirror spawn path goes through startOcMirrorRun, which applies the
 * server-side preflight contract (N4); this test pins that, too.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_OWNED_SLICES, stripServerOwnedSlices, withServerOwnedSlices, workflowOfJobMetadata, planInstallReset } from "../src/workflowSlices.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "src", "index.js"), "utf8");

/** Reviewed whole-state writes and why each keeps the server-owned slices. */
const REVIEWED = new Map([
  ["setState(next);", "ensureState trust defaults: a copy of the existing state"],
  ["setState(initial);", "first boot: there is no slice to keep"],
  ["setState(merged);", "updateState: deep merge into the current state"],
  ["setState(sanitized);", "POST /api/state: patch stripped of every server-owned slice, merged into the current state"],
  ["setState(clone);", "run duplicate: a copy of the current state"],
  ["setState(withServerOwnedSlices(next, ensureState()));", "Install Start Over"],
  ["setState(withServerOwnedSlices(importedInstall, ensureState()));", "Install run import"],
  ["setState({ ...ensureState(), mirroring: normalizeMirroringSlice(slice) });", "Mirroring slice writer"],
  ["setState({ ...ensureState(), upgrade: normalizeUpgradeSlice(slice) });", "Upgrade slice writer"]
]);

test("every whole-state write in index.js is a reviewed, slice-preserving form", () => {
  const calls = [...src.matchAll(/^\s*(setState\(.*\);)\s*$/gm)].map((m) => m[1]);
  assert.ok(calls.length >= 6, "the scan finds the state writes");
  const unknown = calls.filter((c) => !REVIEWED.has(c));
  assert.deepEqual(unknown, [], `unreviewed state writes: ${unknown.join(" | ")}`);
});

test("POST /api/state strips every server-owned slice from the patch", () => {
  assert.match(src, /for \(const key of SERVER_OWNED_SLICES\) delete patch\[key\];/);
});

test("the server-side run contract lives in startOcMirrorRun, the only run entry point", () => {
  const start = src.indexOf("async function startOcMirrorRun(ctx) {");
  const reserve = src.indexOf("reserveOcMirrorRun(getJob, reservationToken)", start);
  const body = src.slice(start, reserve);
  assert.ok(start > 0 && reserve > start);
  assert.match(body, /resolveDestinationAuth\(ctx\.body/);
  assert.match(body, /destinationCredentialProblem\(/);
  assert.match(body, /describeTrust\(\)/);
  assert.match(body, /PREFLIGHT_BLOCKED/);
  // Every route that runs oc-mirror goes through it (no second spawn path for runs).
  const runSpawns = [...src.matchAll(/buildOcMirrorArgs\(/g)].length;
  assert.ok(runSpawns >= 1);
});

test("slice helpers", () => {
  assert.deepEqual([...SERVER_OWNED_SLICES], ["mirroring", "upgrade"]);
  assert.deepEqual(stripServerOwnedSlices({ a: 1, mirroring: 2, upgrade: 3 }), { a: 1 });
  assert.deepEqual(withServerOwnedSlices({ a: 1, upgrade: "intruder" }, { b: 2, mirroring: "m", upgrade: "u" }), { a: 1, mirroring: "m", upgrade: "u" });
  assert.deepEqual(withServerOwnedSlices({ a: 1 }, {}), { a: 1 });
});

test("job ownership is positive: untagged or unknown is never Install", () => {
  assert.equal(workflowOfJobMetadata({}), null);
  assert.equal(workflowOfJobMetadata({ workflow: "something-else" }), null);
  assert.equal(workflowOfJobMetadata({ workflow: "install" }), "install");
  assert.equal(workflowOfJobMetadata({ workflow: "mirroring", owner: { workflow: "upgrade" } }), "upgrade");
  const jobs = [
    { id: "a", type: "oc-mirror-run", status: "running" },
    { id: "b", type: "oc-mirror-run", status: "running" },
    { id: "c", type: "oc-mirror-run", status: "running" },
    { id: "d", type: "operator-scan", status: "running" },
    { id: "e", type: "oc-mirror-run", status: "queued" }
  ];
  const meta = { a: { workflow: "install" }, b: { workflow: "mirroring" }, c: {}, d: { workflow: "install" }, e: { workflow: "install" } };
  const plan = planInstallReset({ jobs, metaOf: (id) => meta[id], state: {}, cancelInstallRuns: true });
  assert.deepEqual(plan.cancel.map((j) => j.id), ["a"]);
  assert.deepEqual(plan.unaffected.map((j) => j.id), ["b"]);
  assert.deepEqual(plan.unclassified.map((j) => j.id), ["c"]);
  assert.deepEqual(plan.keepInstall.map((j) => j.id), ["d"]);
  const keep = planInstallReset({ jobs, metaOf: (id) => meta[id], state: {}, cancelInstallRuns: false });
  assert.deepEqual(keep.cancel, []);
  assert.notEqual(keep.token, plan.token, "the token binds the choice to cancel");
});
