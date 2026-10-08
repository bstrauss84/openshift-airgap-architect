/**
 * Tranche 6 §8 — `provisioningNetworkGateway` certified through REAL supported
 * 4.22 flows, not through the exported emission seam.
 *
 * `provisioning-network-gateway.test.js` exercises the rule exhaustively via
 * `applyProvisioningNetworkGateway`, because while 4.22 was unsupported that
 * seam was the only way to reach it. Tranche 5 added a first real-path block.
 * This file completes the §8 matrix end to end: every documented positive and
 * negative case driven through `buildInstallConfig` at a supported 4.22.
 *
 * Bare-metal IPI only — it is the only scenario whose 4.22 catalog classifies
 * the field `supported-ui`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { buildInstallConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { bareMetalIpi, bareMetalAgent } from "./fixtures/base-states.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };

const V4 = {
  provisioningNetwork: "Managed",
  provisioningNetworkCIDR: "172.22.0.0/24",
  provisioningDHCPRange: "172.22.0.10,172.22.0.100",
  clusterProvisioningIP: "172.22.0.3",
};

const V6 = {
  provisioningNetwork: "Managed",
  provisioningNetworkCIDR: "fd2e:6f44:5dd8:c956::/64",
  provisioningDHCPRange: "fd2e:6f44:5dd8:c956::10,fd2e:6f44:5dd8:c956::100",
  clusterProvisioningIP: "fd2e:6f44:5dd8:c956::3",
};

/** Build a real bare-metal IPI state at `minor` with the given provisioning block. */
function ipiState(minor, provisioning, gateway) {
  const inv = { ...provisioning };
  if (gateway !== undefined) inv.provisioningNetworkGateway = gateway;
  const st = bareMetalIpi({
    version: { selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, locked: true },
    release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  });
  st.hostInventory = { ...st.hostInventory, ...inv };
  return st;
}

const gatewayIn = (yamlText) => yaml.load(yamlText)?.platform?.baremetal?.provisioningNetworkGateway;

/* ------------------------------------------------------------------ */
/* Positive                                                             */
/* ------------------------------------------------------------------ */

describe("T6 §8 — positive IPv4 through real 4.22 generation", () => {
  it("a valid Managed IPv4 gateway is emitted into install-config", () => {
    const out = buildInstallConfig(ipiState("4.22", V4, "172.22.0.254"));
    assert.equal(gatewayIn(out), "172.22.0.254");
  });

  it("it sits inside the CIDR, outside the DHCP range, and differs from the provisioning IP", () => {
    // Restating the documented contract against the value that was accepted,
    // so the positive case is not just "something was emitted".
    const out = buildInstallConfig(ipiState("4.22", V4, "172.22.0.254"));
    const doc = yaml.load(out);
    assert.equal(doc.platform.baremetal.provisioningNetworkGateway, "172.22.0.254");
    assert.notEqual(doc.platform.baremetal.provisioningNetworkGateway, V4.clusterProvisioningIP);
  });

  it("the boundary value just above the DHCP range is accepted", () => {
    const out = buildInstallConfig(ipiState("4.22", V4, "172.22.0.101"));
    assert.equal(gatewayIn(out), "172.22.0.101");
  });
});

describe("T6 §8 — positive IPv6 through real 4.22 generation", () => {
  it("a valid Managed IPv6 gateway is emitted into install-config", () => {
    const out = buildInstallConfig(ipiState("4.22", V6, "fd2e:6f44:5dd8:c956::254"));
    assert.equal(gatewayIn(out), "fd2e:6f44:5dd8:c956::254");
  });

  it("IPv6 is not a second-class path — the same relations are enforced", () => {
    assert.throws(
      () => buildInstallConfig(ipiState("4.22", V6, "fd2e:6f44:5dd8:c956::50")),
      /falls inside the provisioning DHCP range/
    );
  });
});

describe("T6 §8 — optional behaviour", () => {
  it("a blank gateway is omitted, not emitted empty", () => {
    const out = buildInstallConfig(ipiState("4.22", V4, "   "));
    assert.equal(gatewayIn(out), undefined);
    assert.doesNotMatch(out, /provisioningNetworkGateway/);
  });

  it("an absent gateway is omitted and is not an error", () => {
    const out = buildInstallConfig(ipiState("4.22", V4, undefined));
    assert.equal(gatewayIn(out), undefined);
  });

  it("the rest of install-config is byte-identical with and without the field", () => {
    const withField = buildInstallConfig(ipiState("4.22", V4, "172.22.0.254"));
    const without = buildInstallConfig(ipiState("4.22", V4, undefined));
    assert.equal(
      withField.split("\n").filter((l) => !l.includes("provisioningNetworkGateway")).join("\n"),
      without
    );
  });
});

/* ------------------------------------------------------------------ */
/* Negative                                                             */
/* ------------------------------------------------------------------ */

describe("T6 §8 — negative cases are refused by the real builder, never coerced", () => {
  const cases = [
    ["outside the CIDR", V4, "10.0.0.1", /within the provisioning network CIDR|outside/i],
    ["inside the DHCP range", V4, "172.22.0.50", /falls inside the provisioning DHCP range/],
    ["equal to the cluster provisioning IP", V4, "172.22.0.3", /same as the cluster provisioning IP|provisioning IP/i],
    ["a malformed address", V4, "not-an-ip", /must be a valid IP address/],
    // The family mismatch is reported EXPLICITLY ("is IPv6 but the CIDR is
    // IPv4") rather than as a generic containment failure, which is what stops
    // a mismatched address from silently skipping the containment check.
    ["IPv6 gateway on an IPv4 provisioning network", V4, "fd2e:6f44:5dd8:c956::254", /is IPv6 but the provisioning network CIDR .* is IPv4/],
    ["IPv4 gateway on an IPv6 provisioning network", V6, "172.22.0.254", /is IPv4 but the provisioning network CIDR .* is IPv6/],
  ];

  for (const [label, provisioning, gateway, pattern] of cases) {
    it(`${label} is rejected before any YAML is produced`, () => {
      let produced = null;
      let err = null;
      try { produced = buildInstallConfig(ipiState("4.22", provisioning, gateway)); } catch (e) { err = e; }
      assert.ok(err, `${label} must be rejected`);
      assert.match(err.message, pattern);
      assert.equal(produced, null, "a rejected state must produce no install-config at all");
    });
  }
});

describe("T6A §3 — provisioning modes where the field does not apply", () => {
  // CORRECTED IN TRANCHE 6A. Tranche 6 recorded that validation ran before the
  // applicability check, so a stale INVALID gateway blocked generation in a
  // mode where openshift-install ignores the field entirely — and where the UI
  // no longer renders the control, so the user could not see or fix it.
  //
  // The lifecycle contract, now consistent end to end:
  //   UI      hides the control outside Managed and PRESERVES the value
  //           (same choice the version transition makes; destroying user input
  //           on a mode toggle would be worse)
  //   backend neither emits nor validates an inapplicable field
  //           (same treatment the `>= 4.22` version gate already gave)
  for (const mode of ["Unmanaged", "Disabled"]) {
    it(`${mode}: a VALID stale value is carried harmlessly and not emitted`, () => {
      const out = buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, "172.22.0.254"));
      assert.doesNotMatch(out, /provisioningNetworkGateway/);
    });

    it(`${mode}: an INVALID stale value does NOT block generation`, () => {
      // The F2 regression. Reaching this state is ordinary: enter a gateway in
      // Managed mode, then switch the provisioning mode.
      let out;
      assert.doesNotThrow(() => {
        out = buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, "10.0.0.1"));
      });
      assert.doesNotMatch(out, /provisioningNetworkGateway/, "and it is certainly not emitted");
    });

    it(`${mode}: a MALFORMED stale value does not block generation either`, () => {
      let out;
      assert.doesNotThrow(() => {
        out = buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, "not-an-ip"));
      });
      assert.doesNotMatch(out, /provisioningNetworkGateway/);
    });

    it(`${mode}: output is byte-identical whether or not the stale value is present`, () => {
      const withStale = buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, "10.0.0.1"));
      const without = buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, undefined));
      assert.equal(withStale, without);
    });
  }

  it("Managed-mode relational validation is NOT weakened by the reordering", () => {
    // The whole point of the fix is that it changes inapplicable modes only.
    for (const bad of ["10.0.0.1", "172.22.0.50", "172.22.0.3", "not-an-ip"]) {
      assert.throws(
        () => buildInstallConfig(ipiState("4.22", V4, bad)),
        /gateway/i,
        `Managed must still refuse ${bad}`
      );
    }
  });

  it("a non-string value is a state fault and is refused in EVERY mode", () => {
    for (const mode of ["Managed", "Unmanaged", "Disabled"]) {
      assert.throws(
        () => buildInstallConfig(ipiState("4.22", { ...V4, provisioningNetwork: mode }, 12345)),
        /must be a string/,
        mode
      );
    }
  });

  it("an absent provisioning mode is treated as not-Managed, so nothing is emitted", () => {
    // Applicability has not been established; guessing Managed would emit a
    // field the installer ignores.
    const st = ipiState("4.22", { ...V4 }, "172.22.0.254");
    delete st.hostInventory.provisioningNetwork;
    const out = buildInstallConfig(st);
    assert.doesNotMatch(out, /provisioningNetworkGateway/);
  });
});

describe("T6A §3 — the mode-change lifecycle, end to end", () => {
  const transition = (fromMode, toMode, gateway) => {
    // The UI writes only `provisioningNetwork` on a mode change; everything
    // else in hostInventory, including the gateway, is preserved.
    const before = ipiState("4.22", { ...V4, provisioningNetwork: fromMode }, gateway);
    const after = { ...before, hostInventory: { ...before.hostInventory, provisioningNetwork: toMode } };
    return { before, after };
  };

  it("Managed -> Unmanaged with a stale VALID gateway: generates, omits the field", () => {
    const { before, after } = transition("Managed", "Unmanaged", "172.22.0.254");
    assert.match(buildInstallConfig(before), /provisioningNetworkGateway: 172\.22\.0\.254/);
    const out = buildInstallConfig(after);
    assert.doesNotMatch(out, /provisioningNetworkGateway/);
  });

  it("Managed -> Unmanaged with a stale INVALID gateway: generates, omits the field", () => {
    const { after } = transition("Managed", "Unmanaged", "10.0.0.1");
    assert.doesNotThrow(() => buildInstallConfig(after));
  });

  it("Managed -> Disabled with a stale INVALID gateway: generates, omits the field", () => {
    const { after } = transition("Managed", "Disabled", "10.0.0.1");
    assert.doesNotThrow(() => buildInstallConfig(after));
  });

  it("switching BACK to Managed restores the value and re-applies validation", () => {
    // Preservation is the point: the user does not retype a correct value, and
    // an incorrect one is caught again the moment it matters.
    const good = transition("Unmanaged", "Managed", "172.22.0.254");
    assert.match(buildInstallConfig(good.after), /provisioningNetworkGateway: 172\.22\.0\.254/);

    const bad = transition("Unmanaged", "Managed", "10.0.0.1");
    assert.throws(() => buildInstallConfig(bad.after), /outside provisioning network CIDR/);
  });
});

describe("T6A §3 — stale IMPORTED state carrying an inapplicable gateway", () => {
  for (const mode of ["Unmanaged", "Disabled"]) {
    it(`an imported ${mode} state with an invalid gateway generates cleanly`, () => {
      // A state saved before the mode was changed, or hand-edited, must not be
      // undeliverable. It must also never leak the field into output.
      const imported = ipiState("4.22", { ...V4, provisioningNetwork: mode }, "192.168.99.1");
      const out = buildInstallConfig(imported);
      assert.doesNotMatch(out, /provisioningNetworkGateway/);
      assert.match(out, /baseDomain:/, "and the rest of the file is produced normally");
    });
  }
});

/* ------------------------------------------------------------------ */
/* Agent, and the older minors                                          */
/* ------------------------------------------------------------------ */

describe("T6 §8 — the bare-metal Agent scenario never emits it at 4.22", () => {
  it("a 4.22 Agent state carrying a valid gateway emits nothing", () => {
    const st = bareMetalAgent({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
      release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
    });
    st.hostInventory = { ...st.hostInventory, ...V4, provisioningNetworkGateway: "172.22.0.254" };
    const out = buildInstallConfig(st);
    assert.doesNotMatch(out, /provisioningNetworkGateway/);
  });

  it("and the Agent install-config is identical with and without the field in state", () => {
    const mk = (gw) => {
      const st = bareMetalAgent({
        version: { selectedMinor: "4.22", selectedPatch: "4.22.16", selectedChannel: "stable-4.22", locked: true },
        release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
      });
      st.hostInventory = { ...st.hostInventory, ...V4 };
      if (gw) st.hostInventory.provisioningNetworkGateway = gw;
      return buildInstallConfig(st);
    };
    assert.equal(mk("172.22.0.254"), mk(null));
  });
});

describe("T6 §8 — 4.20 and 4.21 output is unchanged by the 4.22 field", () => {
  for (const minor of SUPPORTED_MINORS.filter((m) => m !== "4.22")) {
    it(`${minor} emits nothing even when state carries a valid gateway`, () => {
      const out = buildInstallConfig(ipiState(minor, V4, "172.22.0.254"));
      assert.doesNotMatch(out, /provisioningNetworkGateway/);
    });

    it(`${minor} is byte-identical with and without the field in state`, () => {
      assert.equal(
        buildInstallConfig(ipiState(minor, V4, "172.22.0.254")),
        buildInstallConfig(ipiState(minor, V4, undefined))
      );
    });

    it(`${minor} does not even validate a malformed value — an old target is unaffected`, () => {
      assert.doesNotThrow(() => buildInstallConfig(ipiState(minor, V4, "not-an-ip")));
    });
  }
});
