/**
 * Upgrade handoff package: where the destination side obtains oc-mirror (2026-11-19 regression).
 *
 * Without a recorded oc-mirror build, the package pointed at the global
 * `clients/ocp/latest/` directory. That channel moved to OpenShift 5.0.1 and publishes
 * no oc-mirror, so the instruction led nowhere. The fallback now uses the runtime's own
 * oc-mirror channel (latest-<newest supported minor>); a recorded build still wins.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolAcquisition } from "../src/upgradePackage.js";
import { OC_MIRROR_CHANNEL } from "../src/ocMirrorRuntime.js";

test("without a recorded build, oc-mirror comes from latest-<newest supported minor>, never the global latest", () => {
  for (const arch of ["amd64", "arm64", "ppc64le", "s390x"]) {
    const t = toolAcquisition({ arch, target: "4.21.40" }, null);
    assert.equal(OC_MIRROR_CHANNEL, "latest-4.22");
    assert.match(t.ocMirror.directory, new RegExp(`/clients/ocp/${OC_MIRROR_CHANNEL}/$`));
    assert.doesNotMatch(t.ocMirror.directory, /\/clients\/ocp\/latest\/$/);
    assert.equal(t.ocMirror.exact, false);
    assert.match(t.ocMirror.policy, /newest supported minor \(latest-4\.22\)/);
    // oc keeps following the target minor.
    assert.match(t.oc.directory, /\/clients\/ocp\/latest-4\.21\/$/);
  }
});

test("a recorded oc-mirror build is still used exactly (versioned directory)", () => {
  const t = toolAcquisition({ arch: "amd64", target: "4.22.22" }, { channelRelease: "4.22.19", arch: "amd64", version: "4.22.0-x", sha256: "a".repeat(64), tarballSha256: "b".repeat(64) });
  assert.equal(t.ocMirror.exact, true);
  assert.match(t.ocMirror.directory, /\/clients\/ocp\/4\.22\.19\/$/);
});
