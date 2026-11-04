/**
 * v2.2.0 M5 — parsing oc-mirror's `list operators --package/--channel` output.
 *
 * Every input here is the exact stdout/stderr captured from oc-mirror 4.22.19
 * (sha256 55b55cf1…) against a synthetic File-Based Catalog in a disposable
 * registry (fixtures/operator-package-lookup/list-operators-fixtures.json),
 * not a hand-written approximation.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePackageListing,
  parseChannelVersions,
  classifyLookupFailure,
  compareBundleVersions,
  versionsInRange,
  judgeOperator
} from "../src/operatorPackageLookup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(here, "fixtures/operator-package-lookup/list-operators-fixtures.json"), "utf8"));
const C = fixtures.cases;

describe("fixture provenance", () => {
  test("captured from the exact binary", () => {
    assert.equal(fixtures.binary.sha256, "55b55cf1627426dca1910c71c177e3696e0984616ef36f9543fde269ae924a3a");
  });
});

describe("parsePackageListing", () => {
  test("package row and its channels (sorted by name, HEAD is a bundle name)", () => {
    assert.deepEqual(parsePackageListing(C.b_package.stdout), {
      name: "demo-op",
      displayName: "Demo Operator",
      defaultChannel: "stable",
      channels: [{ name: "fast", head: "demo-op.v1.1.0" }, { name: "stable", head: "demo-op.v1.0.1" }]
    });
  });
  test("the same answer for a catalog referenced by digest", () => {
    assert.deepEqual(parsePackageListing(C.g_package_by_digest.stdout), parsePackageListing(C.b_package.stdout));
  });
  test("a second package parses too", () => {
    const other = parsePackageListing(C.b2_package_other.stdout);
    assert.equal(other.name, "other-op");
    assert.deepEqual(other.channels.map((c) => c.name), ["alpha"]);
  });
  test("an empty display name does not shift the default channel", () => {
    const out = "NAME     DISPLAY NAME  DEFAULT CHANNEL\nbare-op  stable\n\nPACKAGE  CHANNEL  HEAD\nbare-op  stable   bare-op.v1\n";
    const parsed = parsePackageListing(out);
    assert.equal(parsed.displayName, "");
    assert.equal(parsed.defaultChannel, "stable");
  });
  test("anything else is refused rather than guessed", () => {
    assert.equal(parsePackageListing(C.a_catalog.stdout), null, "the whole-catalog table has no channel table");
    assert.equal(parsePackageListing(""), null);
    assert.equal(parsePackageListing(C.c_channel_stable.stdout), null);
  });
});

describe("parseChannelVersions", () => {
  test("VERSIONS then one per line", () => {
    assert.deepEqual(parseChannelVersions(C.c_channel_stable.stdout), ["1.0.0", "1.0.1"]);
    assert.deepEqual(parseChannelVersions(C.c_channel_fast.stdout), ["1.1.0"]);
    assert.equal(parseChannelVersions(C.b_package.stdout), null);
  });
});

describe("classifyLookupFailure", () => {
  test("definitive catalog facts", () => {
    assert.equal(classifyLookupFailure(C.d_package_missing).kind, "package-not-found");
    assert.match(classifyLookupFailure(C.d_package_missing).message, /operator "does-not-exist" not found in catalog/);
    assert.equal(classifyLookupFailure(C.e_channel_missing).kind, "channel-not-found");
  });
  test("could-not-check outcomes are never definitive", () => {
    assert.equal(classifyLookupFailure(C.f_unreachable).kind, "unreachable");
    assert.equal(classifyLookupFailure(C.f2_unreachable_retry1).kind, "unreachable");
    assert.equal(classifyLookupFailure(C.f3_dns_nxdomain).kind, "unreachable");
    assert.equal(classifyLookupFailure({ ...C.f4_blackhole_accept_no_reply, timedOut: true }).kind, "timeout");
    assert.equal(classifyLookupFailure({ stderr: "Error: unauthorized: authentication required", exitCode: 1 }).kind, "credentials");
    assert.equal(classifyLookupFailure(C.h_channel_without_package).kind, "error");
  });
  test("messages carry no colour codes", () => {
    for (const c of [C.d_package_missing, C.e_channel_missing, C.f2_unreachable_retry1]) assert.doesNotMatch(classifyLookupFailure(c).message, /\x1b/);
  });
});

describe("bundle version ordering (Masterminds semver)", () => {
  test("numeric, pre-release lower than release, build ignored, missing parts are 0", () => {
    assert.equal(compareBundleVersions("1.0.1", "1.0.0"), 1);
    assert.equal(compareBundleVersions("1.10.0", "1.9.0"), 1);
    assert.equal(compareBundleVersions("1.0.0-rc.1", "1.0.0"), -1);
    assert.equal(compareBundleVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
    assert.equal(compareBundleVersions("1.0.0-alpha", "1.0.0-1"), 1);
    assert.equal(compareBundleVersions("1.0.0+build.5", "1.0.0"), 0);
    assert.equal(compareBundleVersions("v2", "2.0.0"), 0);
    assert.equal(compareBundleVersions("not-a-version", "1.0.0"), null);
  });
  test("range filtering", () => {
    assert.deepEqual(versionsInRange(["1.0.0", "1.0.1", "1.1.0"], "1.0.1", null), ["1.0.1", "1.1.0"]);
    assert.deepEqual(versionsInRange(["1.0.0", "1.0.1", "1.1.0"], null, "1.0.1"), ["1.0.0", "1.0.1"]);
    assert.deepEqual(versionsInRange(["1.0.0", "1.0.1"], "2.0.0", null), []);
  });
});

describe("judgeOperator", () => {
  const listing = parsePackageListing(C.b_package.stdout);
  const op = (extra = {}) => ({ name: "demo-op", catalogImage: "registry.example.invalid/idx:v4.22", defaultChannel: "stable", ...extra });
  test("verified, with the versions in range counted", () => {
    assert.equal(judgeOperator(op(), { listing }).status, "verified");
    const r = judgeOperator(op({ minVersion: "1.0.1" }), { listing, versions: ["1.0.0", "1.0.1"] });
    assert.equal(r.status, "verified");
    assert.equal(r.versionsInRange, 1);
  });
  test("a channel the package does not have, from the listing", () => {
    const r = judgeOperator(op({ defaultChannel: "beta" }), { listing });
    assert.equal(r.status, "channel-not-found");
    assert.match(r.message, /Channels listed: fast, stable/);
  });
  test("an empty range states what the catalog lists", () => {
    const r = judgeOperator(op({ minVersion: "2.0.0" }), { listing, versions: ["1.0.0", "1.0.1"] });
    assert.equal(r.status, "range-empty");
    assert.match(r.message, /\(1\.0\.0, 1\.0\.1\)/);
  });
  test("failures: definitive misses vs unverified", () => {
    assert.equal(judgeOperator(op(), { failure: classifyLookupFailure(C.d_package_missing) }).status, "package-not-found");
    assert.equal(judgeOperator(op(), { failure: classifyLookupFailure(C.e_channel_missing) }).status, "channel-not-found");
    const offline = judgeOperator(op(), { failure: classifyLookupFailure(C.f2_unreachable_retry1) });
    assert.equal(offline.status, "unverified");
    assert.match(offline.message, /could not be reached/);
  });
});
