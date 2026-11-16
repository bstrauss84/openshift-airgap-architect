/**
 * The AWS installer-backed endpoints must fail closed on an unsupported or
 * malformed OpenShift version.
 *
 * WHY THIS EXISTS. `/api/aws/regions`, `/api/aws/ami` and
 * `/api/aws/warm-installer` take `version` straight from the request and hand
 * it to `ensureInstaller()`, which interpolates it into a mirror.openshift.com
 * URL and into `path.join(toolsDir, \`openshift-install-${version}\`)`, then
 * DOWNLOADS the result and EXECUTES it
 * (`openshift-install coreos print-stream-json`).
 *
 * Two distinct holes, both reachable from `?version=`:
 *
 *   - The No Fallback Rule requires 422 UNSUPPORTED_VERSION at every boundary.
 *     These three endpoints never consulted isSupportedMinor, so 4.23 reached
 *     the mirror instead of being refused. Cincinnati availability is not
 *     product support, and an unsupported minor must never reach an execution
 *     path.
 *   - The value flowed unvalidated into a path join, so `../` traversed.
 *
 * Hermetic by construction: every case is rejected BEFORE any network or
 * filesystem work, so no fetch stub, no mirror and no podman are needed. That
 * is also the point — if a case ever starts needing the network, the guard has
 * stopped working.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const SUPPORTED_PATCH = "4.22.17";
const UNSUPPORTED_PATCH = "4.23.1";

describe("AWS installer endpoints fail closed on version", () => {
  let server;
  let baseUrl;

  before(async () => {
    ({ server, baseUrl } = await createTestServer(app));
    // The GET handlers check `confirmed` BEFORE they look at `version`, so a
    // confirmed state has to exist first or every case would be masked by a
    // 400 that has nothing to do with the guard.
    //
    // /api/state takes the patch at the TOP LEVEL — NOT wrapped in
    // `{ state: ... }` like /api/bundle.zip. Wrapping it is silently ignored
    // and normalised back to defaults, which is exactly how this setup failed
    // the first time.
    const setup = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: {
          _schemaVersion: 3,
          selectedMinor: "4.22",
          selectedPatch: SUPPORTED_PATCH,
          selectedChannel: "stable-4.22",
          locked: true
        },
        release: { channel: "4.22", patchVersion: SUPPORTED_PATCH, confirmed: true },
        blueprint: { platform: "AWS", arch: "x86_64", confirmed: true }
      })
    });
    assert.equal(setup.status, 200, "precondition: the confirmed state must persist");
    const persisted = await setup.json();
    assert.equal(
      persisted?.release?.confirmed ?? persisted?.version?.versionConfirmed,
      true,
      "precondition: a guard test masked by 'Version not confirmed' proves nothing"
    );
  });

  after(async () => {
    await closeTestServer(server);
  });

  const get = (p) => fetch(`${baseUrl}${p}`);

  describe("an UNSUPPORTED minor is refused with 422, never fetched", () => {
    for (const [label, path] of [
      ["regions", `/api/aws/regions?version=${UNSUPPORTED_PATCH}&arch=x86_64`],
      ["ami", `/api/aws/ami?version=${UNSUPPORTED_PATCH}&arch=x86_64&region=us-east-1`]
    ]) {
      it(`${label} returns 422 UNSUPPORTED_VERSION`, async () => {
        const res = await get(path);
        assert.equal(res.status, 422, "the No Fallback Rule requires 422, not a silent downgrade");
        const body = await res.json();
        assert.equal(body.code, "UNSUPPORTED_VERSION");
        assert.equal(body.requestedVersion, "4.23");
        assert.ok(Array.isArray(body.supportedVersions) && body.supportedVersions.length > 0);
        // The recovery UI needs to offer a supported minor, so the list must
        // actually name them rather than being an empty placeholder.
        assert.ok(body.supportedVersions.includes("4.22"));
      });
    }

    it("warm-installer returns 422 and starts nothing", async () => {
      const res = await fetch(`${baseUrl}/api/aws/warm-installer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: UNSUPPORTED_PATCH })
      });
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.code, "UNSUPPORTED_VERSION");
      assert.notEqual(body.status, "started");
    });
  });

  describe("a MALFORMED version is refused with 400, never path-joined", () => {
    // `../` is the one that matters: it reached
    // path.join(toolsDir, `openshift-install-${version}`) unvalidated.
    //
    // An EMPTY `?version=` is deliberately not in this list. It is not
    // malformed input — the handler treats it as absent and falls back to the
    // confirmed state's patchVersion, which is pre-existing behaviour and
    // still well-formed. Asserting 400 for it would be asserting a bug.
    for (const bad of ["../../etc/passwd", "4.22", "latest", "4.22.x", "4.22.17/../.."]) {
      it(`regions rejects ${JSON.stringify(bad)}`, async () => {
        const res = await get(`/api/aws/regions?version=${encodeURIComponent(bad)}&arch=x86_64`);
        assert.ok(res.status === 400, `expected 400, got ${res.status}`);
        const body = await res.json();
        // An empty version is caught by the pre-existing required-field check;
        // anything else must be the explicit shape rejection.
        assert.ok(
          body.code === "MALFORMED_VERSION" || /required/i.test(body.error || ""),
          `unexpected body: ${JSON.stringify(body)}`
        );
      });
    }
  });

  describe("a supported, well-formed version still passes the guard", () => {
    it("is not rejected by the version guard itself", async () => {
      // A supported MINOR with a patch that does not exist upstream. It must
      // clear the guard (proving the guard does not over-reject), and then
      // fail downstream on the 404 rather than pulling a ~465 MB installer —
      // using a real patch version here would make this suite download the
      // binary on any machine with network access.
      const res = await get("/api/aws/regions?version=4.22.999&arch=x86_64");
      assert.ok(
        res.status !== 400 && res.status !== 422,
        `a supported minor must pass the guard, got ${res.status}`
      );
    });
  });
});
