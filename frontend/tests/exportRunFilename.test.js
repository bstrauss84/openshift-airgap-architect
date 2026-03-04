import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getExportRunFilename } from "../src/exportRunFilename.js";

describe("getExportRunFilename (#39)", () => {
  let realDate;
  beforeEach(() => {
    realDate = global.Date;
    global.Date = class extends realDate {
      constructor(...args) {
        if (args.length === 0) {
          super("2026-03-04T14:15:00.000Z");
        } else {
          super(...args);
        }
      }
      static now() {
        return new realDate("2026-03-04T14:15:00.000Z").getTime();
      }
    };
  });
  afterEach(() => {
    global.Date = realDate;
  });

  it("returns fallback filename when state is empty or minimal", () => {
    const name = getExportRunFilename({});
    expect(name).toMatch(/^airgap-run_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
    expect(name).toContain("2026-03-04");
  });

  it("includes scenario, arch, version when set", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64" },
      methodology: { method: "Agent-Based Installer" },
      release: { patchVersion: "4.20.0" }
    };
    const name = getExportRunFilename(state);
    expect(name).toContain("bare-metal-agent");
    expect(name).toContain("amd64");
    expect(name).toContain("ocp-4.20");
    expect(name).toMatch(/\.json$/);
  });

  it("includes fips and proxy when enabled", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "x86_64" },
      methodology: { method: "IPI" },
      release: { patchVersion: "4.19.1" },
      globalStrategy: { fips: true, proxyEnabled: true }
    };
    const name = getExportRunFilename(state);
    expect(name).toContain("fips");
    expect(name).toContain("proxy");
  });

  it("includes control plane and worker counts when nodes present", () => {
    const state = {
      blueprint: { platform: "Bare Metal", arch: "aarch64" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: {
        nodes: [
          { role: "master" },
          { role: "master" },
          { role: "master" },
          { role: "worker" },
          { role: "worker" }
        ]
      }
    };
    const name = getExportRunFilename(state);
    expect(name).toContain("3cp");
    expect(name).toContain("2w");
    expect(name).toContain("arm64");
  });

  it("omits unset values and produces filesystem-safe name", () => {
    const state = { blueprint: {}, methodology: {} };
    const name = getExportRunFilename(state);
    expect(name).not.toMatch(/\s/);
    expect(name).toMatch(/^[a-z0-9_.-]+\.json$/);
  });
});
