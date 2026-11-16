/**
 * Lightweight release-documentation guards.
 *
 * These exist to catch the obvious ways release prose goes stale — a changelog that
 * claims a version the code does not support, a README supported-minor list that
 * drifts from `SUPPORTED_MINORS`, a broken relative link, a missing version heading.
 *
 * Deliberately small. This is not a documentation framework, and it does not try to
 * check whether the prose is *good* — only whether it still agrees with the code.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

/** The single source of truth every document below must agree with. */
function supportedMinors() {
  const src = read("backend", "src", "versionPolicy.js");
  const m = src.match(/const SUPPORTED_MINORS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(m, "could not read SUPPORTED_MINORS from backend/src/versionPolicy.js");
  return m[1].split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
}

const CHANGELOG = read("CHANGELOG.md");
const README = read("README.md");
const RELEASE_DIR = path.join(REPO, "docs", "releases");

/** Markdown links that point at a repo-relative path (not http, not an anchor). */
function relativeLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    // Strip anchors and cache-busting query strings (`image.png?v=2`).
    .map((m) => m[1].split("#")[0].split("?")[0].trim())
    .filter((t) => t && !/^(https?:|mailto:)/.test(t));
}

describe("release docs — version claims agree with the code", () => {
  test("every supported minor is named in the changelog", () => {
    for (const minor of supportedMinors()) {
      assert.ok(CHANGELOG.includes(minor), `CHANGELOG.md never mentions ${minor}`);
    }
  });

  test("the changelog does not claim support for an unsupported minor", () => {
    // Narrow by design: only "supports X" / "support for X" style claims are checked,
    // because a changelog legitimately mentions older minors in historical entries.
    const supported = supportedMinors();
    const claims = [...CHANGELOG.matchAll(/[Ss]upports?(?: for)?\s+(?:OpenShift\s+)?(4\.\d+)/g)]
      .map((m) => m[1]);
    const bad = [...new Set(claims)].filter((v) => !supported.includes(v));
    assert.deepEqual(bad, [], `changelog claims support for unsupported minor(s): ${bad.join(", ")}`);
  });

  test("the README supported-version list matches the code", () => {
    const supported = supportedMinors();
    for (const minor of supported) {
      assert.ok(README.includes(minor), `README.md never mentions supported minor ${minor}`);
    }
    // The next minor after the newest supported one must not be advertised.
    const newest = [...supported].sort().at(-1);
    const [maj, min] = newest.split(".").map(Number);
    const next = `${maj}.${min + 1}`;
    const advertises = new RegExp(`[Ss]upports?(?: for)?\\s+(?:OpenShift\\s+)?${next.replace(".", "\\.")}`);
    assert.ok(!advertises.test(README), `README advertises support for ${next}, which the code does not support`);
  });
});

describe("release docs — structure", () => {
  test("a detailed release note exists for each 2.x changelog heading", () => {
    const headings = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    assert.ok(headings.length > 0, "no version headings found in CHANGELOG.md");
    for (const v of headings.filter((x) => x.startsWith("2."))) {
      const file = path.join(RELEASE_DIR, `v${v}.md`);
      assert.ok(fs.existsSync(file), `missing detailed release note docs/releases/v${v}.md`);
    }
  });

  test("each release note names its own version in a top-level heading", () => {
    for (const f of fs.readdirSync(RELEASE_DIR).filter((x) => x.endsWith(".md"))) {
      const version = f.replace(/^v|\.md$/g, "");
      const body = read("docs", "releases", f);
      const h1 = body.match(/^# .*$/m);
      assert.ok(h1, `${f} has no top-level heading`);
      assert.ok(h1[0].includes(version), `${f} heading does not name ${version}: ${h1[0]}`);
    }
  });

  test("the changelog links to each detailed release note", () => {
    for (const f of fs.readdirSync(RELEASE_DIR).filter((x) => x.endsWith(".md"))) {
      assert.ok(
        CHANGELOG.includes(`docs/releases/${f}`),
        `CHANGELOG.md does not link docs/releases/${f}`
      );
    }
  });
});

describe("release docs — relative links resolve", () => {
  const targets = [
    ["CHANGELOG.md", CHANGELOG, REPO],
    ["README.md", README, REPO],
    ...fs
      .readdirSync(RELEASE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => [`docs/releases/${f}`, read("docs", "releases", f), RELEASE_DIR]),
  ];

  for (const [label, body, base] of targets) {
    test(`${label} has no broken repo-relative links`, () => {
      const broken = relativeLinks(body).filter((t) => !fs.existsSync(path.resolve(base, t)));
      assert.deepEqual(broken, [], `${label} broken link(s): ${broken.join(", ")}`);
    });
  }
});

/**
 * SBOM discoverability is a release-notes requirement, not an optional extra:
 * a user asking "where is the SBOM?" must reach an honest answer from the
 * permanent navigation. These pin the honesty, not the prose — the page may say
 * anything it likes so long as it does not claim a published artifact that does
 * not exist.
 */
describe("SBOM and provenance page", () => {
  const SBOM_PATH = path.join(REPO, "docs", "security", "SBOM_AND_PROVENANCE.md");

  test("the page exists", () => {
    assert.ok(fs.existsSync(SBOM_PATH), "docs/security/SBOM_AND_PROVENANCE.md is missing");
  });

  test("the permanent release-history section links it", () => {
    const history = README.slice(README.indexOf('<a id="release-history"></a>'));
    assert.ok(
      history.includes("docs/security/SBOM_AND_PROVENANCE.md"),
      "the permanent release-history navigation must link the SBOM page"
    );
  });

  test("the v2.1 release note links it", () => {
    const body = read("docs", "releases", "v2.1.0.md");
    assert.ok(
      body.includes("../security/SBOM_AND_PROVENANCE.md"),
      "docs/releases/v2.1.0.md must link the SBOM page"
    );
  });

  // This replaced a guard that REQUIRED the page to say "not published yet".
  //
  // That guard enforced a point-in-time status as though it were an invariant,
  // and it was the mechanism by which a false statement would have been frozen
  // into the release: the docs are tagged with the commit, so the moment the
  // GitHub Release went live the tagged page would have insisted no release
  // existed — and the test would have held it there.
  //
  // The durable property is not "unpublished". It is: the page tells you WHERE
  // the evidence is and HOW to verify it, and it never overclaims. Those are
  // true before and after publication, so they are what is pinned.
  test("it points at the evidence and says how to verify it", () => {
    const body = fs.readFileSync(SBOM_PATH, "utf8");
    assert.match(body, /\/releases\b/, "the page must point at the Releases page");
    assert.match(body, /sha256sum -c SHA256SUMS/, "the page must give the verification command");
    assert.match(body, /SHA256SUMS/, "the page must name the checksum asset");
  });

  test("it names each asset the release is expected to carry", () => {
    const body = fs.readFileSync(SBOM_PATH, "utf8");
    // Exactly the allowlist the publishing script uploads. If one is renamed in
    // the script and not here, the page sends people looking for a file that
    // does not exist.
    for (const asset of [
      "sbom-backend.cyclonedx.json",
      "sbom-frontend.cyclonedx.json",
      "offline-inventory.cdx.json",
      "external-binaries.json",
      "vulnerabilities-backend.json",
      "vulnerabilities-frontend.json",
      "vendor-risk-disposition.json",
      "certification-summary.json",
    ]) {
      assert.ok(body.includes(asset), `the SBOM page must name the asset ${asset}`);
    }
  });

  test("it does not claim signing, a clean scan, or that findings are absent", () => {
    const body = fs.readFileSync(SBOM_PATH, "utf8");
    // These remain false regardless of publication state, so unlike the status
    // line they ARE invariants worth pinning.
    for (const [label, re] of [
      ["signed images", /\bimages are signed\b/i],
      ["a clean scan", /\bno known vulnerabilities\b|\bscan(s|ned)? clean\b/i],
      ["that signing exists", /\bsignatures? (are|is) (available|published|provided)\b/i],
    ]) {
      assert.doesNotMatch(body, re, `the SBOM page must not claim ${label}`);
    }
    // And it must keep saying the scan fails, because it does.
    assert.match(body, /\bFAIL/, "the page must keep reporting the failing vulnerability axis");
  });
});

describe("release docs — unverified claims stay marked unverified", () => {
  test("restricted-v2 SCC compatibility is never asserted without qualification", () => {
    // PROD-039 is open: no live admission test has been performed. Any surface
    // that mentions restricted-v2 must qualify it rather than assert compatibility.
    for (const [label, body] of [["README.md", README], ["CHANGELOG.md", CHANGELOG]]) {
      const lines = body.split("\n");
      lines.forEach((line, i) => {
        if (!/restricted-v2/i.test(line)) return;
        const context = lines.slice(Math.max(0, i - 2), i + 12).join("\n");
        assert.match(
          context,
          /unverified|never been tested|not independently verified|PROD-039|unlikely to be admitted|assigns/i,
          `${label}:${i + 1} mentions restricted-v2 without a nearby qualification: ${line.trim()}`
        );
      });
    }
  });
});

describe("release docs — the temporary README notice stays honest", () => {
  const NOTICE = "## 🚀 Major v2.x update available";

  test("if the notice is present it carries its removal instruction", () => {
    if (!README.includes(NOTICE)) return; // removing it later is expected and fine
    assert.match(
      README,
      /TEMPORARY RELEASE NOTICE/,
      "the notice must keep the maintainer comment marking it temporary"
    );
    assert.match(README, /CHANGELOG\.md/, "the notice must point at the changelog");
  });

  test("the permanent release-history section exists whether or not the notice does", () => {
    assert.match(README, /<a id="release-history"><\/a>/);
    assert.match(README, /^## Release history$/m);
  });
});

/**
 * The temporary v2.x release notice is a first-class, human-specified release
 * requirement, not ordinary README prose. It has been partially lost once
 * already, so each element the maintainer asked for is pinned individually:
 * an explicit apology for the delay, the solo/spare-time context, the work and
 * TESTING that went in, thanks to the community, links to the changelog, both
 * sets of release notes and the v1 -> v2 migration guide, and a maintainer
 * comment recording that the block is temporary while the PERMANENT release
 * history stays.
 *
 * These assert substance, not exact wording, so the tone can still be edited.
 */
describe("README temporary v2.x release notice", () => {
  const NOTICE_HEADING = "## 🚀 Major v2.x update available";

  /** The notice runs from its heading to the next top-level section. */
  function notice() {
    const start = README.indexOf(NOTICE_HEADING);
    assert.ok(start > -1, "the temporary v2.x update notice heading is missing from README.md");
    const rest = README.slice(start + NOTICE_HEADING.length);
    const end = rest.indexOf("\n## ");
    return end === -1 ? rest : rest.slice(0, end);
  }

  test("appears near the top, before the table of contents", () => {
    const noticeIdx = README.indexOf(NOTICE_HEADING);
    const tocIdx = README.indexOf("## Table of contents");
    assert.ok(noticeIdx > -1 && tocIdx > -1);
    assert.ok(noticeIdx < tocIdx, "the notice must stay above the table of contents");
  });

  test("explicitly apologises for the delay and thanks the community", () => {
    const body = notice();
    assert.match(body, /\b(sorry|apolog\w*)\b/i, "the notice must contain an explicit apology");
    assert.match(body, /\blonger than expected\b/i, "the notice must say the update took longer than expected");
    assert.match(body, /\bthank you\b/i, "the notice must thank users");
    assert.match(body, /\bpatience\b/i);
  });

  test("states the solo spare-time maintenance and the work and testing involved", () => {
    const body = notice();
    assert.match(body, /\bone person\b/i, "the notice must say it is maintained by one person");
    assert.match(body, /\bspare time\b/i);
    assert.match(body, /\bmonths\b/i, "the notice must convey the scale of work");
    assert.match(body, /\btesting\b/i, "the notice must mention testing, not only building");
  });

  test("keeps the changelog, both release notes and the migration guide links", () => {
    const body = notice();
    for (const target of [
      "CHANGELOG.md",
      "docs/releases/v2.1.0.md",
      "docs/releases/v2.0.0.md",
      "docs/MIGRATION_GUIDE_v1_to_v2.md"
    ]) {
      assert.ok(body.includes(target), `the notice must keep its link to ${target}`);
    }
  });

  // This previously required the notice to say v2.1 was "not yet released".
  //
  // That is a point-in-time status, not an invariant, and pinning it in a test
  // is the mechanism by which a false statement gets frozen into a tag: the
  // README is tagged with the commit, so the moment v2.1.0 is published the
  // tagged README would have insisted it was not — and this test would have
  // held it there. The same defect was found and removed from the SBOM page's
  // guard; it is the same mistake in a second place.
  //
  // What IS invariant: the notice must not overclaim, and it must send readers
  // to the authoritative place rather than asserting a status inline.
  test("does not overclaim certification or GA", () => {
    const body = notice();
    assert.doesNotMatch(body, /\bcertified\b/i, "the notice must not claim certification");
    assert.doesNotMatch(body, /\bgenerally available\b|\bnow GA\b/i);
    assert.doesNotMatch(body, /\bproduction[- ]ready\b/i, "the notice must not claim production readiness");
    assert.ok(
      body.includes("#release-history"),
      "the notice must point at Release history rather than asserting a release status inline"
    );
  });

  test("records that the block is temporary while release history is permanent", () => {
    const start = README.indexOf(NOTICE_HEADING);
    const preamble = README.slice(0, start);
    assert.match(preamble, /TEMPORARY RELEASE NOTICE/i, "the maintainer retirement comment must stay");
    assert.match(preamble, /PERMANENT/i, "the comment must record that release history is permanent");
    assert.ok(
      README.includes('<a id="release-history"></a>'),
      "the permanent release-history section must remain"
    );
  });
});

/**
 * Narrow regressions for specific false facts that were found in the release
 * documentation and corrected.
 *
 * Each one is a sentence that was WRONG, not a status that happened to be true
 * on the day. That distinction is the whole point of this block: two earlier
 * guards in this file pinned point-in-time statuses ("not published yet", "not
 * yet released") and would therefore have held a false sentence in place from
 * the moment the tag was cut. Nothing here asserts a release state; every
 * assertion stays true before and after publication.
 */
describe("release docs — corrected false facts stay corrected", () => {
  const CHANGELOG_BODY = () => read("CHANGELOG.md");
  const V21 = () => read("docs", "releases", "v2.1.0.md");
  const EVIDENCE = () => read("docs", "releases", "evidence", "README.md");

  test("v1.7.1 is not described as the current head of main", () => {
    // main is promoted separately and may already have moved; v1.7.1 is the
    // preserved legacy line either way.
    assert.doesNotMatch(
      README,
      /v1\.7\.1[\s\S]{0,160}?current head of `?main`?/i,
      "v1.7.1 is the preserved legacy v1.x head, not necessarily what main points at"
    );
  });

  test("no document hardcodes an oc / oc-mirror z-stream as the shipped pin", () => {
    // CLAUDE.md: both tools are resolved from their channel and verified against
    // that channel's own sha256sum.txt. A fixed z-stream in prose goes stale and
    // contradicts the documented policy.
    for (const [label, body] of [["README.md", README], ["docs/releases/v2.1.0.md", V21()]]) {
      assert.doesNotMatch(
        body,
        /oc[\/ -]?(?:mirror)?[^.\n]{0,40}pinned to (?:OCP )?\d+\.\d+\.\d+/i,
        `${label} must not claim a hardcoded oc/oc-mirror z-stream pin`
      );
    }
  });

  test("the release notes do not assert a tag that may not exist yet", () => {
    // "Version: 2.1.0" is a fact about the tree. "Tag: v2.1.0" is a claim about
    // the repository that is false until the tag is pushed.
    assert.doesNotMatch(
      V21(),
      /^\*\*Tag:\*\*/m,
      "state the version, and point at the Releases page for what is tagged"
    );
  });

  test("the release notes do not call the version identity a development one", () => {
    // VERSION is 2.1.0; prose saying otherwise contradicts the tree it ships with.
    assert.doesNotMatch(V21(), /version identity in this branch is a development one/i);
    assert.doesNotMatch(V21(), /2\.1\.0-dev/);
  });

  test("no document asserts that release assets ARE attached", () => {
    // Attachment is verifiable on the Releases page; asserting it in a frozen
    // document is a claim the document cannot keep.
    for (const [label, body] of [
      ["CHANGELOG.md", CHANGELOG_BODY()],
      ["docs/releases/v2.1.0.md", V21()],
    ]) {
      assert.doesNotMatch(
        body,
        /\b(?:are|is) attached to the (?:release|GitHub Release)\b/i,
        `${label} must direct readers to verify publication, not assert it`
      );
    }
  });

  test("vulnerability counts are labelled as a dated measurement, not a final result", () => {
    // Counts move with the scanner database AND with the commit scanned, so any
    // number quoted in a frozen document must say which candidate it came from.
    for (const [label, body] of [
      ["CHANGELOG.md", CHANGELOG_BODY()],
      ["docs/releases/v2.1.0.md", V21()],
    ]) {
      const quotesCounts = /\d+\s+critical\s*\/\s*\d+\s+high/i.test(body);
      if (!quotesCounts) continue;
      assert.match(
        body,
        /earlier candidate|historical evidence|not certified counts/i,
        `${label} quotes scan counts, so it must say they are a dated measurement of a named candidate`
      );
    }
  });

  test("the vendor share is never described as untriaged", () => {
    // vendorRiskDisposition emits a per-artifact acceptance; saying nothing has
    // been triaged contradicts the evidence the release ships.
    assert.doesNotMatch(
      V21(),
      /no finding has been triaged/i,
      "the vendor share carries a per-artifact inherited-risk disposition"
    );
  });

  test("the raw scanner FAIL and the inherited-risk framing both survive", () => {
    // The corrections above must not have softened the result into a pass.
    const v = V21();
    assert.match(v, /\bFAIL/, "the failing vulnerability axis must still be stated");
    assert.match(v, /inherited risk/i, "the vendor attribution must still be stated");
    assert.match(v, /no-fix/i, "the UBI no-fix classification must still be stated");
    assert.match(v, /source|Compose/i, "the source + Compose delivery scope must still be stated");
  });

  test("human QA is not described as entirely outstanding", () => {
    // A browser-level smoke pass was performed; claiming none was is as
    // inaccurate as claiming full platform coverage.
    assert.doesNotMatch(
      V21(),
      /Human QA is not complete/i,
      "a local Compose smoke pass was performed; scope it rather than denying it"
    );
  });

  test("the live-cluster obligation is not recast as a release blocker in public notes", () => {
    // It belongs in docs/BACKLOG_STATUS.md. The notes may say cluster deployment
    // is outside the source/Compose scope; they may not relitigate it here.
    assert.doesNotMatch(
      V21(),
      /unexercised on a cluster|live[- ]verification status|not been (?:tested|exercised) on a cluster/i,
      "the live-cluster acceptance obligation is tracked in docs/BACKLOG_STATUS.md"
    );
  });

  test("the commit-coverage counts are marked as pinned, not live branch status", () => {
    const e = EVIDENCE();
    assert.match(e, /PINNED HISTORICAL CALCULATIONS|pinned SHAs/i,
      "the ranges stop describing the branches once develop or main moves");
    assert.match(e, /missing/, "the open coverage rows must stay visible");
    assert.match(e, /needs verification/, "the needs-verification row must stay visible");
    assert.doesNotMatch(e, /all (?:coverage )?rows (?:are )?(?:now )?(?:closed|represented)/i,
      "the 7 missing and 1 needs-verification rows must not be described as closed");
  });
});
