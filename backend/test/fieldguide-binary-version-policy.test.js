import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { render } from "../src/fieldGuide/template.js";

const ctx = { version: "4.21.8", versionMajorMinor: "4.21" };

function getCompartmentItems(compartments, id) {
  const c = compartments.find((comp) => comp.id === id);
  if (!c) return [];
  return c.items.map((item) => ({
    text: render(item.text, ctx),
    cmd: item.cmd ? render(item.cmd, ctx) : "",
  }));
}

for (const [label, compartments] of [["v4.20", compartments_v420], ["v4.21", compartments_v421]]) {
  describe(`Field Guide binary version policy — ${label}`, () => {
    const prereqItems = getCompartmentItems(compartments, "global-prereqs");
    const toolsItems = getCompartmentItems(compartments, "tools-and-creds");

    it("does not say all three binaries must be the same version", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text + " " + i.cmd).join("\n");
      assert.ok(
        !allText.includes("all must match the release version"),
        "should not contain 'all must match the release version'"
      );
      assert.ok(
        !allText.includes("same version as the selected release"),
        "should not contain 'same version as the selected release'"
      );
      assert.ok(
        !allText.includes("all match " + ctx.version),
        "should not contain 'all match <version>'"
      );
    });

    it("openshift-install must correspond to the selected release version", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        allText.includes("openshift-install must correspond to the selected OpenShift release"),
        "should state openshift-install corresponds to the selected release"
      );
      assert.ok(
        allText.includes("({{VERSION}})".replace("{{VERSION}}", ctx.version)),
        "should name the selected release explicitly"
      );
    });

    it("oc-mirror uses the globally latest v2 release, not a release-specific one", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        allText.includes("latest available oc-mirror v2 release"),
        "should state oc-mirror uses the latest available v2 release"
      );
      assert.ok(
        allText.includes("independent of the target OpenShift minor"),
        "should state oc-mirror is independent of the target minor"
      );
    });

    it("oc-mirror download URL uses /latest/ not /version/", () => {
      const allCmds = toolsItems.map((i) => i.cmd).join("\n");
      const ocMirrorDownload = allCmds.match(/curl.*oc-mirror\.tar\.gz/);
      assert.ok(ocMirrorDownload, "should have an oc-mirror download command");
      assert.ok(
        ocMirrorDownload[0].includes("/latest/"),
        "oc-mirror download should use /latest/ path, not release-specific"
      );
      assert.ok(
        !ocMirrorDownload[0].includes("/" + ctx.version + "/"),
        "oc-mirror download should NOT use release-specific version path"
      );
    });

    it("openshift-install download URL uses release-specific version", () => {
      const allCmds = toolsItems.map((i) => i.cmd).join("\n");
      const installDownload = allCmds.match(/curl.*openshift-install-linux\.tar\.gz/);
      assert.ok(installDownload, "should have an openshift-install download command");
      assert.ok(
        installDownload[0].includes("/" + ctx.version + "/"),
        "openshift-install download should use release-specific version path"
      );
    });

    it("oc download URL uses the target minor's latest channel, not the installer patch", () => {
      // Resolver policy (backend/src/ocMirrorRuntime.js ocChannelForMinor):
      // oc = latest patch WITHIN the selected supported target minor.
      const allCmds = toolsItems.map((i) => i.cmd).join("\n");
      const ocDownload = allCmds.match(/curl.*openshift-client-linux\.tar\.gz/);
      assert.ok(ocDownload, "should have an oc download command");
      assert.ok(
        ocDownload[0].includes("/clients/ocp/latest-" + ctx.versionMajorMinor + "/"),
        "oc download should use the clients/ocp/latest-<minor> channel"
      );
      assert.ok(
        !ocDownload[0].includes("/" + ctx.version + "/"),
        "oc download must NOT be pinned to the exact installer patch"
      );
      assert.ok(
        !ocDownload[0].includes("/clients/ocp/latest/"),
        "oc download must NOT use the global latest channel"
      );
    });

    it("version verification distinguishes per-tool requirements", () => {
      const verifyItem = [...prereqItems, ...toolsItems].find(
        (i) => i.text.includes("openshift-install version") && i.text.includes("oc-mirror version")
      );
      assert.ok(verifyItem, "should have a combined verification item");
      assert.ok(
        verifyItem.text.includes("must show " + ctx.version),
        "openshift-install verification should require the exact selected release"
      );
      assert.ok(
        verifyItem.text.includes(ctx.versionMajorMinor + ".z client"),
        "oc verification should require a client from the selected target minor"
      );
      assert.ok(
        verifyItem.text.includes("does not need to equal " + ctx.version),
        "oc verification should state it need not equal the installer patch"
      );
      assert.ok(
        verifyItem.text.includes("latest available oc-mirror v2 release"),
        "oc-mirror verification should require the latest available v2 release"
      );
      assert.ok(
        verifyItem.text.includes("independent of the target OpenShift minor"),
        "oc-mirror verification should state independence from the target minor"
      );
    });

    it("does not carry the superseded, too-weak oc-mirror wording", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        !allText.includes("any recent v2 release"),
        "'any recent v2 release is acceptable' understates the resolver policy"
      );
    });

    it("does not claim oc must equal the selected installer patch", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      const stale = [
        "oc \u2014 use the version matching your target cluster release",
        "openshift-install and oc must match the target release",
        "oc version --client \u2192 should match " + ctx.version,
      ];
      for (const forbidden of stale) {
        assert.ok(!allText.includes(forbidden), `stale phrase present: ${forbidden}`);
      }
    });

    it("does not tell the user to take a globally latest oc", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text + " " + i.cmd).join("\n");
      assert.ok(
        !/oc\b[^\n]*globally latest/i.test(allText),
        "oc must be scoped to the target minor, not globally latest"
      );
    });

    it("states the per-tool rules deliberately differ", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        allText.includes("not expected to report the same version") ||
          allText.includes("expected to differ from each other"),
        "guide should tell the user the three versions legitimately differ"
      );
    });
  });
}
