import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { render } from "../src/fieldGuide/template.js";

const ctx = {
  archivePath: "/data/oc-mirror/archives",
  imageSetConfig: "imageset-config.yaml",
  registryFqdn: "mirror.example.com",
  workspacePath: "/data/oc-mirror/workspace",
};

function getMirrorCmds(compartments, id) {
  const compartment = compartments.find((c) => c.id === id);
  if (!compartment) return [];
  return compartment.items
    .filter((item) => item.cmd && item.cmd.includes("oc-mirror"))
    .map((item) => render(item.cmd, ctx));
}

for (const [label, compartments] of [["v4.20", compartments_v420], ["v4.21", compartments_v421]]) {
  describe(`oc-mirror v2 URI syntax — ${label}`, () => {
    describe("mirror-to-disk (low side)", () => {
      const cmds = getMirrorCmds(compartments, "oc-mirror-low-side");

      it("mirror-to-disk commands use file:// destination", () => {
        assert(cmds.length > 0, "should have oc-mirror commands");
        const mirrorCmds = cmds.filter((c) => c.includes("file://"));
        assert(mirrorCmds.length > 0, "at least one command should use file:// destination");
        for (const cmd of mirrorCmds) {
          assert.match(cmd, /file:\/\/\/data\/oc-mirror\/archives/, "file:// should prefix the archive path");
        }
      });

      it("mirror-to-disk does not double-prefix file://", () => {
        for (const cmd of cmds) {
          assert.doesNotMatch(cmd, /file:\/\/file:\/\//, "must not double-prefix file://");
        }
      });
    });

    describe("disk-to-mirror (high side)", () => {
      const cmds = getMirrorCmds(compartments, "oc-mirror-high-side");

      it("disk-to-mirror commands use --from file:// source", () => {
        assert(cmds.length > 0, "should have oc-mirror commands");
        const fromCmds = cmds.filter((c) => c.includes("--from"));
        assert(fromCmds.length > 0, "at least one command should use --from");
        for (const cmd of fromCmds) {
          assert.match(cmd, /--from file:\/\//, "--from must use file:// prefix");
        }
      });

      it("disk-to-mirror does not use bare --from /path", () => {
        const fromCmds = cmds.filter((c) => c.includes("--from"));
        for (const cmd of fromCmds) {
          assert.doesNotMatch(cmd, /--from \//, "must not use bare --from /path without file://");
        }
      });

      it("disk-to-mirror does not double-prefix file://", () => {
        for (const cmd of cmds) {
          assert.doesNotMatch(cmd, /file:\/\/file:\/\//, "must not double-prefix file://");
        }
      });

      it("disk-to-mirror uses docker:// for registry destination", () => {
        const dockerCmds = cmds.filter((c) => c.includes("docker://"));
        assert(dockerCmds.length > 0, "at least one command should use docker:// registry");
      });
    });
  });
}
