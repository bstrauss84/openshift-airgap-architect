/**
 * Field Guide v4.22 — SOURCE-TREE tests (v2.1 Tranche 2)
 *
 * 4.22 IS STILL UNSUPPORTED AND FAIL-CLOSED. These assertions are deliberately
 * limited to the source tree: structural completeness, copy classification and
 * provenance. Runtime compartment certification needs
 * getAuthoritativeExport("4.22") and a supported-minor flip, which belong to the
 * later atomic enablement tranche — so this file also asserts that 4.22 is NOT
 * reachable through any runtime path yet.
 *
 * Proves:
 *   1. the v4.22 module family matches the v4.21 family, file for file and
 *      compartment for compartment;
 *   2. every v4.22 compartment declares version "4.22";
 *   3. ZERO unclassified raw "4.21" statements survive in the v4.22 tree;
 *   4. the Class-C cross-version allowlist is EXACT — every allowed statement is
 *      actually present, so a stale entry cannot silently widen the guard;
 *   5. every OCP documentation reference carries 4.22 provenance, and none
 *      points at a book path that does not exist at 4.22;
 *   6. the templated binary-download contract was copied VERBATIM and oc-mirror
 *      is NOT pinned to the target minor (gap list GAP-08);
 *   7. the deliberate 4.22 content decisions are present;
 *   8. 4.22 remains unreachable from assembler.js, versionResolution.js and
 *      provenance.js.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v422 } from "../src/fieldGuide/v4.22/index.js";
import { FIELD_GUIDE_SUPPORTED_MINORS } from "../src/fieldGuide/versionResolution.js";
import { getAuthoritativeExport } from "../src/fieldGuide/provenance.js";
import { selectAndOrder } from "../src/fieldGuide/assembler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FG_DIR = join(__dirname, "..", "src", "fieldGuide");
const V421_DIR = join(FG_DIR, "v4.21");
const V422_DIR = join(FG_DIR, "v4.22");

const sourceFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
const readModule = (dir, f) => readFileSync(join(dir, f), "utf8");

/**
 * The ONLY statements permitted to say "4.21" inside the v4.22 tree.
 *
 * Each is a semantic cross-version claim whose minor is part of its meaning: an
 * introduction floor, or a deprecation tracker naming the prior status. A
 * mechanical bump would make each of them false. This list is held to the tree
 * in BOTH directions — an entry that no longer matches anything fails too.
 */
const CLASS_C_CROSS_VERSION_ALLOWLIST = [
  {
    file: "baremetal.js",
    text: 'title: "BMC CA Certificate Verification (4.21+)"',
    rationale:
      "platform.baremetal.bmcVerifyCA was introduced at 4.21. The introduction minor does not move when a later minor ships.",
  },
  {
    file: "baremetal.js",
    text: "platform.baremetal.bmcVerifyCA is available in OpenShift 4.21 and later.",
    rationale: "Availability window. True at 4.22; bumping it would withdraw a correct claim about 4.21.",
  },
  {
    file: "azure.js",
    text: "Configurations requiring multiple node subnets must use OpenShift 4.21 or later.",
    rationale: "platform.azure.subnets[] multi-node-subnet support was introduced at 4.21. Capability floor, not a current-minor claim.",
  },
  {
    file: "mirror.js",
    text: "it was generally available at 4.20 and 4.21",
    rationale: "Deprecation tracker: `oc adm release mirror` was GA at 4.20/4.21 and is Deprecated at 4.22.",
  },
  {
    file: "mirror.js",
    text: "it was deprecated at 4.20 and 4.21",
    rationale: "Deprecation tracker: Red Hat Marketplace was Deprecated at 4.20/4.21 and is Removed at 4.22.",
  },
];

/** Book paths that do not exist at 4.22 and must never be cited from v4.22. */
const DEAD_BOOK_PATHS = [
  "/html/installing/",
  "/html/disconnected_installation_mirroring/",
  "/html/post-installation_configuration/",
];

describe("Field Guide v4.22 — source tree (Tranche 2; 4.22 still unsupported)", () => {
  describe("structural completeness", () => {
    it("the v4.22 module family matches the v4.21 family file for file", () => {
      assert.deepEqual(sourceFiles(V422_DIR), sourceFiles(V421_DIR));
    });

    it("exports compartments_v422 with the same compartment count as v4.21", () => {
      assert.ok(Array.isArray(compartments_v422));
      assert.equal(compartments_v422.length, compartments_v421.length);
    });

    it("compartment ids and ordering match v4.21 exactly", () => {
      assert.deepEqual(
        compartments_v422.map((c) => c.id),
        compartments_v421.map((c) => c.id)
      );
      assert.deepEqual(
        compartments_v422.map((c) => c.order),
        compartments_v421.map((c) => c.order)
      );
    });

    it("every v4.22 compartment declares version 4.22", () => {
      const wrong = compartments_v422.filter((c) => c.version !== "4.22").map((c) => `${c.id}=${c.version}`);
      assert.deepEqual(wrong, []);
    });

    it("every v4.22 compartment carries a title, conditions and at least one item", () => {
      for (const c of compartments_v422) {
        assert.ok(c.title, `${c.id} missing title`);
        assert.ok(c.conditions && typeof c.conditions === "object", `${c.id} missing conditions`);
        assert.ok(Array.isArray(c.items) && c.items.length > 0, `${c.id} has no items`);
      }
    });
  });

  describe("no unclassified 4.21 copy survives", () => {
    it("every remaining 4.21 statement is on the Class-C allowlist", () => {
      const unclassified = [];
      for (const file of sourceFiles(V422_DIR)) {
        readModule(V422_DIR, file)
          .split("\n")
          .forEach((line, i) => {
            if (!line.includes("4.21")) return;
            const allowed = CLASS_C_CROSS_VERSION_ALLOWLIST.some((a) => a.file === file && line.includes(a.text));
            if (!allowed) unclassified.push(`${file}:${i + 1}: ${line.trim()}`);
          });
      }
      assert.deepEqual(unclassified, [], `Unclassified 4.21 copy in v4.22:\n${unclassified.join("\n")}`);
    });

    it("the Class-C allowlist is exact — no stale entries", () => {
      const stale = CLASS_C_CROSS_VERSION_ALLOWLIST.filter((a) => !readModule(V422_DIR, a.file).includes(a.text)).map(
        (a) => `${a.file}: ${a.text}`
      );
      assert.deepEqual(stale, [], `Allowlist entries that no longer match anything:\n${stale.join("\n")}`);
    });

    it("every allowlist entry records why its minor must not move", () => {
      for (const a of CLASS_C_CROSS_VERSION_ALLOWLIST) {
        assert.ok(a.rationale && a.rationale.length > 30, `${a.file}: ${a.text} has no rationale`);
      }
    });

    it("no v4.22 module mentions 4.20 outside the allowlisted deprecation trackers", () => {
      const unexpected = [];
      for (const file of sourceFiles(V422_DIR)) {
        readModule(V422_DIR, file)
          .split("\n")
          .forEach((line, i) => {
            if (!line.includes("4.20")) return;
            const allowed = CLASS_C_CROSS_VERSION_ALLOWLIST.some((a) => a.file === file && line.includes(a.text));
            // The Azure downgrade caveat legitimately names 4.20 as the target
            // a user may step back to; it is part of the same re-decided sentence.
            const azureDowngrade = file === "azure.js" && line.includes("explicitly reduce the configuration to one node subnet");
            // The oc-mirror chapter-move note names 4.20 because the move is the
            // point: the chapter number changed and the slug did not.
            const chapterMove = file === "mirror.js" && line.includes("it was Chapter 7 at 4.20");
            if (!allowed && !azureDowngrade && !chapterMove) unexpected.push(`${file}:${i + 1}: ${line.trim()}`);
          });
      }
      assert.deepEqual(unexpected, [], `Unexpected 4.20 copy in v4.22:\n${unexpected.join("\n")}`);
    });
  });

  describe("documentation provenance", () => {
    it("every OCP documentation reference carries 4.22 provenance", () => {
      const wrong = [];
      for (const c of compartments_v422) {
        for (const ref of c.docRefs || []) {
          const m = ref.url.match(/openshift_container_platform\/(\d+\.\d+)/);
          if (m && m[1] !== "4.22") wrong.push(`${c.id}: ${ref.url}`);
        }
      }
      assert.deepEqual(wrong, []);
    });

    it("no docRef points at a book path that does not exist at 4.22", () => {
      const dead = [];
      for (const c of compartments_v422) {
        for (const ref of c.docRefs || []) {
          for (const p of DEAD_BOOK_PATHS) if (ref.url.includes(p)) dead.push(`${c.id}: ${ref.url}`);
        }
      }
      assert.deepEqual(dead, [], `v4.22 docRefs pointing at 4.21-era book paths:\n${dead.join("\n")}`);
    });

    it("every compartment that had docRefs at 4.21 still has them at 4.22", () => {
      const byId421 = new Map(compartments_v421.map((c) => [c.id, c]));
      for (const c of compartments_v422) {
        const prev = byId421.get(c.id);
        assert.equal((c.docRefs || []).length, (prev.docRefs || []).length, `${c.id} docRef count changed`);
      }
    });
  });

  describe("binary and tool guidance is copied verbatim (GAP-08)", () => {
    const tools421 = compartments_v421.find((c) => c.id === "tools-and-creds");
    const tools422 = compartments_v422.find((c) => c.id === "tools-and-creds");

    it("the download commands are byte-identical to v4.21", () => {
      const cmds = (c) => c.items.map((i) => i.cmd || "");
      assert.deepEqual(cmds(tools422), cmds(tools421));
    });

    it("oc-mirror is still resolved from clients/ocp/latest, not pinned to a minor", () => {
      const all = tools422.items.map((i) => i.cmd || "").join("\n");
      assert.match(all, /clients\/ocp\/latest\/oc-mirror\.tar\.gz/);
      assert.doesNotMatch(all, /clients\/ocp\/(latest-)?4\.\d+\/oc-mirror/);
    });

    it("oc is still resolved from the templated latest-<minor> channel", () => {
      const all = tools422.items.map((i) => i.cmd || "").join("\n");
      assert.match(all, /clients\/ocp\/latest-\{\{versionMajorMinor\}\}\/openshift-client-linux\.tar\.gz/);
    });

    it("openshift-install is still resolved from the templated exact release", () => {
      const all = tools422.items.map((i) => i.cmd || "").join("\n");
      assert.match(all, /clients\/ocp\/\{\{version\}\}\/openshift-install-linux\.tar\.gz/);
    });
  });

  describe("deliberate 4.22 content decisions (Class C)", () => {
    const textOf = (id) => {
      const c = compartments_v422.find((x) => x.id === id);
      return c.items.map((i) => `${i.text || ""} ${i.cmd || ""}`).join("\n");
    };

    it("records that RHCOS uses RHEL 9.8 at 4.22", () => {
      assert.match(textOf("global-prereqs"), /RHCOS uses RHEL 9\.8 packages in OpenShift 4\.22/);
    });

    it("records RHEL 10 as Technology Preview and NOT offered", () => {
      const t = textOf("global-prereqs");
      assert.match(t, /RHEL 10 as the cluster base image is a Technology Preview/);
      assert.match(t, /neither of which OpenShift Airgap Architect generates/);
    });

    it("records the cluster-node FIPS architecture limit without inverting the export-binary conclusion", () => {
      const t = textOf("fips-prereqs");
      assert.match(t, /x86_64, ppc64le and s390x only at OpenShift 4\.22/);
      assert.match(t, /Red Hat does publish an ARM64 RHEL 9 FIPS openshift-install build/);
    });

    it("records the oc-mirror v2 chapter move and the oc adm release mirror deprecation", () => {
      const t = textOf("mirror-registry-setup");
      assert.match(t, /Chapter 5 of the Disconnected environments book/);
      assert.match(t, /oc adm release mirror` command is deprecated/);
    });

    it("records that Red Hat Marketplace is removed at 4.22", () => {
      assert.match(textOf("cluster-resources-apply"), /Red Hat Marketplace is REMOVED at OpenShift 4\.22/);
    });

    it("records that ICSP stays deprecated and Architect is on the imageDigestSources side", () => {
      assert.match(textOf("cluster-resources-apply"), /imageDigestSources in install-config\.yaml/);
    });

    it("states the ARM-on-x86 bare-metal limitation rather than staying silent", () => {
      const t = textOf("bm-ipi-install");
      assert.match(t, /ARM \(aarch64\) compute nodes to a bare-metal cluster with x86 control planes/);
      assert.match(t, /does NOT model a mixed-architecture cluster/);
    });

    it("records the installer-source OS-image deprecation WITHOUT claiming product deprecation", () => {
      const t = textOf("bm-ipi-install");
      assert.match(t, /no longer required — the OS image is now part of the OpenShift release/);
      assert.match(t, /Red Hat 4\.22 product documentation does not list either field as deprecated/);
    });

    it("records the Fujitsu iRMC deprecation", () => {
      assert.match(textOf("bm-upi-prereqs"), /Fujitsu iRMC drivers is deprecated at OpenShift 4\.22/);
    });

    it("introduces platform.baremetal.provisioningNetworkGateway with its documented constraints", () => {
      // C1. Documented by Red Hat at 4.22 in Provisioning APIs Chapter 13
      // §13.1.1 .spec, and mechanically present in the exact 4.22.16 release.
      const t = textOf("bm-ipi-prereqs");
      assert.match(t, /New in OpenShift 4\.22: platform\.baremetal\.provisioningNetworkGateway/);
      assert.match(t, /only honoured when provisioningNetwork is Managed/);
      assert.match(t, /within provisioningNetworkCIDR, outside provisioningDHCPRange, and different from the provisioning IP/);
    });

    it("does NOT present the DHCP-overlap rule as installer-enforced (delta ledger D1)", () => {
      // The installer's own check is inert against the shipped 4.22.16 binary.
      // Telling the reader the installer will catch an overlap would assert a
      // constraint the binary does not apply.
      assert.match(
        textOf("bm-ipi-prereqs"),
        /DHCP-range overlap check does not fire against the shipped binary/
      );
    });
  });

  describe("4.22 is NOT wired into any runtime path", () => {
    it("FIELD_GUIDE_SUPPORTED_MINORS excludes 4.22", () => {
      assert.ok(!FIELD_GUIDE_SUPPORTED_MINORS.includes("4.22"));
      assert.deepEqual([...FIELD_GUIDE_SUPPORTED_MINORS], ["4.20", "4.21"]);
    });

    it("getAuthoritativeExport('4.22') does not resolve to the v4.22 compartments", () => {
      assert.notEqual(getAuthoritativeExport("4.22"), compartments_v422);
    });

    it("selectAndOrder rejects 4.22", () => {
      assert.throws(() => selectAndOrder("4.22", {}), /4\.22/);
    });

    it("assembler.js does not import or branch on v4.22", () => {
      const src = readFileSync(join(FG_DIR, "assembler.js"), "utf8");
      assert.doesNotMatch(src, /v4\.22/);
      assert.doesNotMatch(src, /compartments_v422/);
    });

    it("provenance.js does not import or branch on v4.22", () => {
      const src = readFileSync(join(FG_DIR, "provenance.js"), "utf8");
      assert.doesNotMatch(src, /v4\.22\//);
      assert.doesNotMatch(src, /compartments_v422/);
    });

    it("the v4.21 tree is unchanged by the presence of v4.22", () => {
      for (const file of sourceFiles(V421_DIR)) {
        assert.doesNotMatch(readModule(V421_DIR, file), /4\.22/, `${file} in v4.21 mentions 4.22`);
      }
    });
  });
});
