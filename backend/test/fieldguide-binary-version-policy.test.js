import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { render } from "../src/fieldGuide/template.js";

const ctx = { version: "4.21.8" };

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

    it("openshift-install must match the selected release version", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        allText.includes("openshift-install") && allText.includes("must match"),
        "should state openshift-install must match the release"
      );
    });

    it("oc-mirror uses latest available version, not release-specific", () => {
      const allText = [...prereqItems, ...toolsItems].map((i) => i.text).join("\n");
      assert.ok(
        allText.includes("latest available version"),
        "should state oc-mirror uses the latest available version"
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

    it("oc download URL uses release-specific version", () => {
      const allCmds = toolsItems.map((i) => i.cmd).join("\n");
      const ocDownload = allCmds.match(/curl.*openshift-client-linux\.tar\.gz/);
      assert.ok(ocDownload, "should have an oc download command");
      assert.ok(
        ocDownload[0].includes("/" + ctx.version + "/"),
        "oc download should use release-specific version path"
      );
    });

    it("version verification distinguishes per-tool requirements", () => {
      const verifyItem = [...prereqItems, ...toolsItems].find(
        (i) => i.text.includes("openshift-install version") && i.text.includes("oc-mirror version")
      );
      assert.ok(verifyItem, "should have a combined verification item");
      assert.ok(
        verifyItem.text.includes("any recent v2 release"),
        "oc-mirror verification should say 'any recent v2 release is acceptable'"
      );
    });
  });
}
