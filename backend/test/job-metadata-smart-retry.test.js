/**
 * OpenShift Airgap Architect - Job metadata reads (oc-mirror smart retry)
 *
 * `getJob(id)` returns the raw SQLite row. That row carries `metadata_json` as
 * a STRING; it has no `metadata` property. Four call sites in index.js read
 * `getJob(id)?.metadata`, so all four silently saw `undefined`:
 *
 *   - the signature smart-retry resolved its ImageSetConfig path from it. For a
 *     GENERATED config — the default path, where the file is written to a temp
 *     location and recorded only in metadata — `originalBody.configPath` is
 *     absent, so the retry fell through to "Cannot retry: no config path
 *     available" every time. The feature never worked.
 *   - retry duration was measured against `metadata.startedAt`, so it was
 *     always 0 ms.
 *   - two updates spread `...getJob(id)?.metadata` intending to merge, and
 *     merged nothing.
 *
 * `getJobMetadata` parses the column `updateJobMetadata` already writes. These
 * tests pin the read, and pin the constraint that fixing the read must NOT
 * reintroduce plaintext credential storage — the defect closed in e0944b5.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createJob, getJob, getJobMetadata, updateJobMetadata } from "../src/utils.js";
import { sanitizeCredentialFields } from "../src/stateSanitizer.js";
import { db } from "../src/db.js";

describe("getJobMetadata — the read the smart retry depends on", () => {
  it("returns the parsed object that updateJobMetadata wrote", () => {
    const id = createJob("oc-mirror-run", "metadata round-trip");
    updateJobMetadata(id, {
      configPath: "/data/tmp/imageset-config.yaml",
      startedAt: 1760000000000,
      mode: "mirrorToDisk"
    });

    const meta = getJobMetadata(id);
    assert.equal(meta.configPath, "/data/tmp/imageset-config.yaml");
    assert.equal(meta.startedAt, 1760000000000);
    assert.equal(meta.mode, "mirrorToDisk");
  });

  it("documents the raw row shape that made the old read always undefined", () => {
    const id = createJob("oc-mirror-run", "raw row shape");
    updateJobMetadata(id, { configPath: "/data/tmp/x.yaml" });

    const row = getJob(id);
    assert.equal(row.metadata, undefined, "the raw row has no parsed metadata property");
    assert.equal(typeof row.metadata_json, "string", "it carries metadata_json as a string");
    // The exact expression the retry used to evaluate.
    assert.equal(getJob(id)?.metadata?.configPath, undefined);
    // What it evaluates to now.
    assert.equal(getJobMetadata(id).configPath, "/data/tmp/x.yaml");
  });

  it("resolves a generated config path when the request body carried none", () => {
    // The case that made the retry inert: configSourceType "generated", so the
    // caller never supplies configPath and only metadata knows where it is.
    const id = createJob("oc-mirror-run", "generated config");
    updateJobMetadata(id, { configSourceType: "generated", configPath: "/data/tmp/gen.yaml" });

    const originalBody = { mode: "mirrorToDisk" }; // no configPath
    const resolved = originalBody.configPath || getJobMetadata(id).configPath;
    assert.equal(resolved, "/data/tmp/gen.yaml", "the retry must find the generated config");
  });

  it("merges rather than replaces, which is what the spread intended", () => {
    const id = createJob("oc-mirror-run", "merge");
    updateJobMetadata(id, { mode: "mirrorToDisk", configPath: "/data/tmp/a.yaml" });

    const merged = { ...getJobMetadata(id), finishedAt: 42 };
    assert.equal(merged.mode, "mirrorToDisk", "pre-existing keys survive the merge");
    assert.equal(merged.configPath, "/data/tmp/a.yaml");
    assert.equal(merged.finishedAt, 42);
  });

  it("yields a real elapsed time instead of the constant zero", () => {
    const id = createJob("oc-mirror-run", "duration");
    const startedAt = Date.now() - 5000;
    updateJobMetadata(id, { startedAt });

    const finishedAt = startedAt + 5000;
    const duration = finishedAt - (getJobMetadata(id).startedAt || finishedAt);
    assert.equal(duration, 5000);
    assert.notEqual(duration, 0, "the old expression always produced 0");
  });

  it("returns {} for an unknown job, a job with no metadata, and unparseable JSON", () => {
    assert.deepEqual(getJobMetadata("no-such-job-id"), {});

    const bare = createJob("oc-mirror-run", "no metadata yet");
    assert.deepEqual(getJobMetadata(bare), {});

    const broken = createJob("oc-mirror-run", "corrupt metadata");
    updateJobMetadata(broken, { ok: true });
    // Write non-JSON directly, the shape a partial write would leave.
    db.prepare("UPDATE jobs SET metadata_json = ? WHERE id = ?").run("{not json", broken);
    assert.deepEqual(getJobMetadata(broken), {}, "a parse failure must not throw into the retry path");
  });

  it("never exposes credentials, because the writer strips them first", () => {
    const id = createJob("oc-mirror-run", "credential stripping");
    // Canaries are the placeholders already triaged in .gitleaks.toml's
    // exact-value allowlist ("test:test" and "mirror:test"). That file's policy
    // is allowlist-only and requires a negative control for any new entry, so a
    // test asserting that credentials are stripped must not itself introduce a
    // literal that needs exempting — which an earlier draft of this test did.
    const RH_CANARY = "dGVzdDp0ZXN0";
    const MIRROR_CANARY = "bWlycm9yOnRlc3Q=";
    const body = {
      mode: "mirrorToDisk",
      rhPullSecret: `{"auths":{"registry.redhat.io":{"auth":"${RH_CANARY}"}}}`,
      mirrorPullSecret: `{"auths":{"mirror.local":{"auth":"${MIRROR_CANARY}"}}}`,
      registryUrl: "mirror.local:8443"
    };
    updateJobMetadata(id, { requestBody: sanitizeCredentialFields(body) });

    const serialised = JSON.stringify(getJobMetadata(id));
    assert.ok(!serialised.includes(RH_CANARY), "rhPullSecret must not survive");
    assert.ok(!serialised.includes(MIRROR_CANARY), "mirrorPullSecret must not survive");
    assert.ok(serialised.includes("mirror.local:8443"), "non-credential fields are still recorded");
  });
});
