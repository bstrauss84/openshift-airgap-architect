/**
 * Field Guide FIPS wording (FQ-TC-1, 2026-11-03): no unsupported FIPS claim for
 * oc-mirror. Red Hat documents a FIPS-capable installation program
 * (openshift-install-fips, from the openshift-install-rhel9-<arch> download)
 * and, for oc-mirror, only that the binary must match the host's RHEL version;
 * it publishes no separate FIPS oc-mirror. The three supported guides agree.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fipsPrereqs as v420 } from "../src/fieldGuide/v4.20/global.js";
import { fipsPrereqs as v421 } from "../src/fieldGuide/v4.21/global.js";
import { fipsPrereqs as v422 } from "../src/fieldGuide/v4.22/global.js";

const texts = (g) => g.items.map((i) => i.text);

for (const [minor, guide] of [["4.20", v420], ["4.21", v421], ["4.22", v422]]) {
  test(`${minor}: oc-mirror is never called FIPS-capable; the installer guidance names openshift-install-fips`, () => {
    const all = texts(guide).join("\n");
    assert.doesNotMatch(all, /oc-mirror[^.]*FIPS-capable builds/i);
    assert.doesNotMatch(all, /Red Hat distributed binaries are/);
    const item = texts(guide).find((t) => /openshift-install-fips/.test(t));
    assert.ok(item, "installer guidance present");
    assert.match(item, /openshift-install-rhel9-<arch>/);
    assert.match(item, /no separate FIPS oc-mirror and makes no FIPS statement for it/);
    assert.match(item, /binary for the RHEL version you use/);
  });
}

test("the three guides carry the same wording", () => {
  const pick = (g) => texts(g).find((t) => /openshift-install-fips/.test(t));
  assert.equal(pick(v420), pick(v422));
  assert.equal(pick(v421), pick(v422));
});
