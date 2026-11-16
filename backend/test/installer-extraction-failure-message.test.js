/**
 * A failed openshift-install extraction must say what went wrong.
 *
 * Owner QA (2026-10-22) showed the AWS AMI lookup failing with tar's raw
 * stderr: "tar: openshift-install: Wrote only 2048 of 10240 bytes". Reproduced:
 * the data directory sat on a quota-limited tmpfs and the 752 MB binary hit the
 * quota. The message now names the cause and the directory, keeps tar's text,
 * and other failures stay distinguishable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeExtractionFailure } from "../src/installer.js";

describe("describeExtractionFailure", () => {
  for (const stderr of [
    "tar: openshift-install: Wrote only 2048 of 10240 bytes\ntar: Exiting with failure status due to previous errors\n",
    "tar: openshift-install: Cannot write: No space left on device",
    "tar: openshift-install: Cannot write: Disk quota exceeded",
  ]) {
    it(`out-of-space: ${stderr.split("\n")[0]}`, () => {
      const e = describeExtractionFailure(new Error(stderr), "4.22.18", "/data/tools");
      assert.match(e.message, /^Not enough free space to extract openshift-install 4\.22\.18 into \/data\/tools/);
      assert.match(e.message, /the verified download is kept/);
      assert.ok(e.message.includes(stderr.trim()), "original tar text must be preserved for diagnosis");
    });
  }

  it("other failures are not mislabelled as a space problem", () => {
    const e = describeExtractionFailure(new Error("gzip: stdin: not in gzip format"), "4.22.18", "/data/tools");
    assert.equal(e.message, "Extracting openshift-install 4.22.18 failed: gzip: stdin: not in gzip format");
  });
});
