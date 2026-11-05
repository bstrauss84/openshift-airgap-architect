import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReleaseDocStatus } from "./check-release-doc-status.mjs";

function fixture({ changelog, readme, guide = "Mirroring is new in v9.8.0.\n", notes = true }) {
  const root = mkdtempSync(join(tmpdir(), "release-doc-status-"));
  mkdirSync(join(root, "docs/releases"), { recursive: true });
  writeFileSync(join(root, "VERSION"), "9.8.0\n");
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  writeFileSync(join(root, "README.md"), readme);
  writeFileSync(join(root, "docs/GUIDE.md"), guide);
  if (notes) writeFileSync(join(root, "docs/releases/v9.8.0.md"), "# v9.8.0\n");
  // Historical records may keep old wording and must not be scanned.
  writeFileSync(join(root, "docs/releases/v9.7.0.md"), "v9.8.0 is not yet released.\n");
  writeFileSync(join(root, "docs/BACKLOG_STATUS.md"), "v9.8.0 unreleased work\n");
  return root;
}

const PRE = {
  changelog: "## [9.8.0] - Unreleased *(not yet released)*\n\n## [9.7.0] - 2026-01-01\n",
  readme: "### Coming in v9.8.0 — Thing (pre-release, in testing)\n\n**Status:** not yet released.\n",
  guide: "Thing is new in v9.8.0, which is in pre-release testing.\n",
};
const POST = {
  changelog: "## [9.8.0] - 2026-11-05\n\n## [9.7.0] - 2026-01-01\n",
  readme: "### New in v9.8.0 — Thing\n\n**Status:** released in v9.8.0 (2026-11-05).\n\n" +
    "- [v9.8.0 release notes](docs/releases/v9.8.0.md) — minor\n\n| [v9.8.0 release notes](docs/releases/v9.8.0.md) | x |\n\n" +
    "- **v9.8.0** — Minor release.\n",
};

test("pre phase accepts legitimate pre-release wording and reports what the closeout must switch", () => {
  const r = checkReleaseDocStatus(fixture(PRE), { phase: "pre" });
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.ok(r.pending.some((p) => p.startsWith("README.md:1:")));
  assert.ok(r.pending.some((p) => p.startsWith("docs/GUIDE.md:1:")));
  assert.ok(r.pending.some((p) => p.includes("is not dated")));
});

test("post phase fails on every stale pre-release statement about the current version", () => {
  const r = checkReleaseDocStatus(fixture(PRE), { phase: "post" });
  assert.equal(r.ok, false);
  for (const needle of ["README.md:1:", "docs/GUIDE.md:1:", "is not dated", "Status:** not yet released", "At a glance"]) {
    assert.ok(r.errors.some((e) => e.includes(needle)), `expected an error mentioning ${needle}`);
  }
  assert.ok(!r.errors.some((e) => e.includes("docs/releases/v9.7.0.md") || e.includes("BACKLOG_STATUS")), "historical records are not scanned");
});

test("post phase passes after the closeout and checks the CHANGELOG date against the tag", () => {
  const root = fixture(POST);
  assert.equal(checkReleaseDocStatus(root, { phase: "post", tagDate: "2026-11-05" }).ok, true);
  const wrong = checkReleaseDocStatus(root, { phase: "post", tagDate: "2026-11-06" });
  assert.equal(wrong.ok, false);
  assert.match(wrong.errors.join("\n"), /dated 2026-11-05, but the tag is dated 2026-11-06/);
});

test("both phases require the release notes and a CHANGELOG section", () => {
  const root = fixture({ ...POST, changelog: "## [9.7.0] - 2026-01-01\n", notes: false });
  for (const phase of ["pre", "post"]) {
    const r = checkReleaseDocStatus(root, { phase });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /docs\/releases\/v9\.8\.0\.md is missing/);
    assert.match(r.errors.join("\n"), /no "## \[9\.8\.0\]" section/);
  }
});
