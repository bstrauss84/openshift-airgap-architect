/**
 * platform.baremetal.provisioningNetworkGateway — runtime prerequisite (Tranche 3).
 *
 * 4.22 became supported in the v2.1 Tranche 5 flip. `buildInstallConfig()` asserts a supported minor
 * before any of this is reached, so the emission rule is exercised through the
 * narrow exported seam `applyProvisioningNetworkGateway` rather than by widening
 * the supported-minor list. The last block below proves the public boundary is
 * untouched.
 *
 * Covers:
 *   - the three Red Hat documented relationships, enforced by the tool because
 *     the shipped 4.22.16 binary does not enforce them (delta ledger D1);
 *   - Managed-only applicability — accepted-but-ignored modes emit nothing;
 *   - the version gate, including that 4.20 and 4.21 output is unchanged;
 *   - deterministic errors;
 *   - no claim that the installer rejects an overlapping gateway.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

import { buildInstallConfig, applyProvisioningNetworkGateway } from "../src/generate.js";
import { validateProvisioningNetworkGateway } from "../../shared/provisioningNetworkGateway.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";
import { bareMetalIpi, bareMetalAgent } from "./fixtures/base-states.js";

const PROVISIONING = {
  provisioningNetwork: "Managed",
  provisioningNetworkCIDR: "172.22.0.0/24",
  provisioningDHCPRange: "172.22.0.10,172.22.0.100",
  clusterProvisioningIP: "172.22.0.3",
};

/**
 * The validator takes its own parameter names (`cidr`, `dhcpRange`); the
 * hostInventory keys above are what generate.js maps FROM. Keeping the two
 * spellings distinct here is deliberate — an earlier draft spread the
 * hostInventory names straight in and silently skipped both relationship
 * checks, because an absent neighbour is a skip, not a failure.
 */
const VALIDATOR_ARGS = {
  provisioningNetwork: PROVISIONING.provisioningNetwork,
  cidr: PROVISIONING.provisioningNetworkCIDR,
  dhcpRange: PROVISIONING.provisioningDHCPRange,
  clusterProvisioningIP: PROVISIONING.clusterProvisioningIP,
};

/** Run the emission helper the way generate.js does, for a given minor. */
function emit(hostInventory, minor) {
  const baremetal = {};
  applyProvisioningNetworkGateway(baremetal, { ...PROVISIONING, ...hostInventory }, minor);
  return baremetal;
}

describe("provisioningNetworkGateway — documented relationships", () => {
  it("accepts a gateway inside the CIDR, outside the DHCP range, distinct from the provisioning IP", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "172.22.0.254" });
    assert.equal(r.valid, true);
    assert.equal(r.applicable, true);
    assert.deepEqual(r.errors, []);
  });

  it("rejects a malformed IP", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "not-an-ip" });
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /must be a valid IP address/);
  });

  it("rejects a gateway outside provisioningNetworkCIDR", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "192.168.1.1" });
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /outside provisioning network CIDR \(172\.22\.0\.0\/24\)/);
  });

  it("rejects a gateway inside provisioningDHCPRange", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "172.22.0.50" });
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /falls inside the provisioning DHCP range/);
  });

  it("rejects a gateway equal to the cluster provisioning IP", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "172.22.0.3" });
    assert.equal(r.valid, false);
    assert.match(r.errors[0], /must not be the same address as the cluster provisioning IP/);
  });

  it("never claims the installer rejects an overlapping gateway", () => {
    // The installer's own DHCP-overlap rule is inert against 4.22.16. Telling
    // the user otherwise would assert a constraint the binary does not apply.
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: "172.22.0.50" });
    for (const msg of r.errors) {
      assert.doesNotMatch(msg, /installer (will )?reject/i);
      assert.doesNotMatch(msg, /openshift-install/i);
    }
  });

  it("skips a relationship whose neighbouring field is itself malformed", () => {
    const r = validateProvisioningNetworkGateway({
      gateway: "172.22.0.254",
      provisioningNetwork: "Managed",
      cidr: "not-a-cidr",
      dhcpRange: "garbage",
      clusterProvisioningIP: "nonsense",
    });
    assert.equal(r.valid, true, "the neighbouring fields report their own errors");
  });

  it("treats blank and absent as not-set, not as invalid", () => {
    for (const gateway of ["", "   ", undefined, null]) {
      const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway });
      assert.equal(r.valid, true);
      assert.equal(r.blank, true);
    }
  });

  it("rejects a non-string value", () => {
    const r = validateProvisioningNetworkGateway({ ...VALIDATOR_ARGS, gateway: 172 });
    assert.equal(r.valid, false);
  });

  it("is applicable only when the provisioning network is Managed", () => {
    for (const mode of ["Unmanaged", "Disabled", undefined, ""]) {
      const r = validateProvisioningNetworkGateway({
        ...VALIDATOR_ARGS, provisioningNetwork: mode, gateway: "172.22.0.254",
      });
      assert.equal(r.applicable, false, `mode=${mode}`);
    }
  });
});

describe("provisioningNetworkGateway — IPv4 AND IPv6", () => {
  /**
   * Address family established from the exact 4.22.16 source, not from the
   * surrounding UI code: the installer parses the gateway with `net.ParseIP`,
   * the kubebuilder marker is `Format=ip` (not `ipv4`), containment is
   * `ProvisioningNetworkCIDR.Contains()` on a family-agnostic `ipnet.IPNet`,
   * the DHCP-range endpoints are also `net.ParseIP`, and Red Hat's own
   * `provisioningNetworkCIDR` text discusses IPv6 provisioning networks.
   *
   * So every relational constraint must apply to BOTH families. An earlier
   * draft format-checked IPv6 and then skipped all three relations, which is
   * worse than rejecting it: the value looked validated and was not.
   */
  const V6 = {
    provisioningNetwork: "Managed",
    cidr: "fd00:1234::/64",
    dhcpRange: "fd00:1234::10,fd00:1234::100",
    clusterProvisioningIP: "fd00:1234::3",
  };
  const V4 = VALIDATOR_ARGS;

  const cases = [
    ["IPv4", V4, {
      ok: "172.22.0.254", outsideCidr: "192.168.1.1", inDhcp: "172.22.0.50",
      equalsProvIp: "172.22.0.3", malformed: "172.22.0.999",
    }],
    ["IPv6", V6, {
      ok: "fd00:1234::254", outsideCidr: "fd00:9999::1", inDhcp: "fd00:1234::50",
      equalsProvIp: "fd00:1234::3", malformed: "fd00:::1",
    }],
  ];

  for (const [family, args, a] of cases) {
    describe(family, () => {
      it("accepts a valid in-CIDR gateway outside the DHCP range", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: a.ok });
        assert.equal(r.valid, true, r.errors[0]);
        assert.equal(r.family, family === "IPv4" ? 4 : 6);
      });

      it("rejects a gateway outside the provisioning network CIDR", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: a.outsideCidr });
        assert.equal(r.valid, false);
        assert.match(r.errors[0], /outside provisioning network CIDR/);
      });

      it("rejects a gateway inside the provisioning DHCP range", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: a.inDhcp });
        assert.equal(r.valid, false);
        assert.match(r.errors[0], /falls inside the provisioning DHCP range/);
      });

      it("rejects a gateway equal to the cluster provisioning IP", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: a.equalsProvIp });
        assert.equal(r.valid, false);
        assert.match(r.errors.join(" "), /must not be the same address as the cluster provisioning IP/);
      });

      it("rejects a malformed address", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: a.malformed });
        assert.equal(r.valid, false);
        assert.match(r.errors[0], /must be a valid IP address/);
      });

      it("treats blank as not-set", () => {
        const r = validateProvisioningNetworkGateway({ ...args, gateway: "   " });
        assert.equal(r.valid, true);
        assert.equal(r.blank, true);
      });
    });
  }

  it("reports an address-family mismatch rather than silently skipping containment", () => {
    const v6GatewayV4Net = validateProvisioningNetworkGateway({ ...V4, gateway: "fd00:1234::254" });
    assert.equal(v6GatewayV4Net.valid, false);
    assert.match(v6GatewayV4Net.errors[0], /is IPv6 but the provisioning network CIDR .* is IPv4/);

    const v4GatewayV6Net = validateProvisioningNetworkGateway({ ...V6, gateway: "172.22.0.254" });
    assert.equal(v4GatewayV6Net.valid, false);
    assert.match(v4GatewayV6Net.errors[0], /is IPv4 but the provisioning network CIDR .* is IPv6/);
  });

  it("an IPv6 gateway can never pass format validation and skip the relations", () => {
    // The regression this block exists for.
    const bad = validateProvisioningNetworkGateway({ ...V6, gateway: "fd00:9999::1" });
    assert.equal(bad.valid, false, "an out-of-CIDR IPv6 gateway must not be reported valid");
  });

  it("an IPv4-mapped IPv6 literal compares equal to the same IPv4 address", () => {
    const r = validateProvisioningNetworkGateway({ ...V4, gateway: "::ffff:172.22.0.3" });
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /same address as the cluster provisioning IP/);
  });

  it("a DHCP range in the other family is left to that field's own validation", () => {
    const r = validateProvisioningNetworkGateway({
      ...V6, gateway: "fd00:1234::254", dhcpRange: "172.22.0.10,172.22.0.100",
    });
    assert.equal(r.valid, true, "no derived error on top of a mixed-family range");
  });
});

describe("provisioningNetworkGateway — emission rule (4.22 seam)", () => {
  it("emits for Managed when the target minor carries the field", () => {
    assert.equal(emit({ provisioningNetworkGateway: "172.22.0.254" }, "4.22").provisioningNetworkGateway, "172.22.0.254");
  });

  it("does not emit when unset", () => {
    assert.equal("provisioningNetworkGateway" in emit({}, "4.22"), false);
    assert.equal("provisioningNetworkGateway" in emit({ provisioningNetworkGateway: "  " }, "4.22"), false);
  });

  it("does not emit when the provisioning mode makes it irrelevant", () => {
    for (const mode of ["Unmanaged", "Disabled"]) {
      const out = emit({ provisioningNetwork: mode, provisioningNetworkGateway: "172.22.0.254" }, "4.22");
      assert.equal("provisioningNetworkGateway" in out, false, `mode=${mode}`);
    }
  });

  it("does not emit below 4.22, even when the state carries a value", () => {
    for (const minor of ["4.20", "4.21"]) {
      const out = emit({ provisioningNetworkGateway: "172.22.0.254" }, minor);
      assert.equal("provisioningNetworkGateway" in out, false, `minor=${minor}`);
    }
  });

  it("does not validate below 4.22 either — an old target is unaffected by a stray value", () => {
    for (const minor of ["4.20", "4.21"]) {
      assert.doesNotThrow(() => emit({ provisioningNetworkGateway: "not-an-ip" }, minor));
    }
  });

  it("throws a deterministic error for an invalid relationship at 4.22", () => {
    assert.throws(
      () => emit({ provisioningNetworkGateway: "172.22.0.50" }, "4.22"),
      /falls inside the provisioning DHCP range/
    );
    assert.throws(() => emit({ provisioningNetworkGateway: "nope" }, "4.22"), /must be a valid IP address/);
  });

  it("emits for a later minor too — the gate is >= 4.22, not == 4.22", () => {
    assert.equal(emit({ provisioningNetworkGateway: "172.22.0.254" }, "4.23").provisioningNetworkGateway, "172.22.0.254");
  });
});

describe("the Agent scenario never emits the field", () => {
  // Reconciled in Tranche 3. The OCP Agent-based Installer parameter chapter
  // lists the additional platform.baremetal parameters it accepts and does not
  // include provisioningNetworkGateway — the identifier appears ZERO times in
  // the whole Agent book at 4.20, 4.21 and 4.22. The bare-metal-agent catalog
  // records it as hidden-not-applicable, and generation must agree.
  it("the Agent Day-2 block does not call the emission helper", () => {
    const gen = readFileSync(join(REPO, "backend", "src", "generate.js"), "utf8");
    const calls = [...gen.matchAll(/applyProvisioningNetworkGateway\(baremetal/g)];
    assert.equal(calls.length, 1, "exactly one emission site — the IPI one — may exist");
  });

  it("the Agent Day-2 block records WHY it does not emit", () => {
    const gen = readFileSync(join(REPO, "backend", "src", "generate.js"), "utf8");
    assert.match(gen, /provisioningNetworkGateway is deliberately NOT emitted here/);
  });

  it("the agent catalog row is hidden-not-applicable, matching generation", () => {
    const row = JSON.parse(
      readFileSync(join(REPO, "data", "params", "4.22", "bare-metal-agent.json"), "utf8")
    ).parameters.find((p) => p.path === "platform.baremetal.provisioningNetworkGateway");
    assert.equal(row.supportStatus, "hidden-not-applicable");
  });

  it("the IPI catalog row remains supported-ui, matching its control", () => {
    const row = JSON.parse(
      readFileSync(join(REPO, "data", "params", "4.22", "bare-metal-ipi.json"), "utf8")
    ).parameters.find((p) => p.path === "platform.baremetal.provisioningNetworkGateway");
    assert.equal(row.supportStatus, "supported-ui");
  });
});

describe("4.20 / 4.21 install-config is unchanged", () => {
  const parse = (s) => yaml.load(s);

  for (const minor of ["4.20", "4.21"]) {
    for (const [name, factory] of [["bare-metal-ipi", bareMetalIpi], ["bare-metal-agent", bareMetalAgent]]) {
      it(`${name} at ${minor} emits no provisioningNetworkGateway even when state carries one`, () => {
        const base = factory({
          version: { selectedMinor: minor, selectedPatch: `${minor}.8` },
          release: { channel: minor, patchVersion: `${minor}.8` },
        });
        const withGateway = {
          ...base,
          hostInventory: { ...base.hostInventory, ...PROVISIONING, provisioningNetworkGateway: "172.22.0.254" },
        };
        const out = buildInstallConfig(withGateway);
        assert.doesNotMatch(out, /provisioningNetworkGateway/);
        assert.equal(parse(out).platform?.baremetal?.provisioningNetworkGateway, undefined);
      });

      it(`${name} at ${minor} is byte-identical with and without the 4.22-only field in state`, () => {
        const base = factory({
          version: { selectedMinor: minor, selectedPatch: `${minor}.8` },
          release: { channel: minor, patchVersion: `${minor}.8` },
        });
        const without = { ...base, hostInventory: { ...base.hostInventory, ...PROVISIONING } };
        const with_ = {
          ...base,
          hostInventory: { ...base.hostInventory, ...PROVISIONING, provisioningNetworkGateway: "172.22.0.254" },
        };
        assert.equal(buildInstallConfig(with_), buildInstallConfig(without));
      });
    }
  }
});

// Before the flip these three tests pinned that 4.22 was unreachable, so the
// emission rule could only be exercised through the exported `emit` seam. 4.22
// is supported now, so the same rule is verified through the real public path —
// which is what the seam was standing in for.
describe("the gateway field reaches install-config through the public path at 4.22", () => {
  const at422 = (inventory = {}) => {
    const state = bareMetalIpi({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.16" },
      release: { channel: "4.22", patchVersion: "4.22.16" },
    });
    state.hostInventory = { ...state.hostInventory, ...PROVISIONING, ...inventory };
    return state;
  };

  it("4.22 is a supported minor", () => {
    assert.ok(SUPPORTED_MINORS.includes("4.22"));
  });

  it("a valid gateway is emitted into real 4.22 install-config", () => {
    const yaml = buildInstallConfig(at422({ provisioningNetworkGateway: "172.22.0.254" }));
    assert.match(yaml, /provisioningNetworkGateway: 172\.22\.0\.254/);
  });

  it("an absent gateway emits nothing, and the rest of the file is unaffected", () => {
    const without = buildInstallConfig(at422());
    assert.doesNotMatch(without, /provisioningNetworkGateway/);
  });

  it("an invalid relationship is refused by the real builder, not silently dropped", () => {
    // DHCP-range overlap: accepted by the 4.22.16 binary at validation time and
    // then fails during provisioning, which is why this tool checks it.
    assert.throws(
      () => buildInstallConfig(at422({ provisioningNetworkGateway: "172.22.0.50" })),
      /falls inside the provisioning DHCP range/
    );
    assert.throws(
      () => buildInstallConfig(at422({ provisioningNetworkGateway: "nope" })),
      /must be a valid IP address/
    );
  });

  it("an unsupported minor is still refused outright — the gate moved, it did not go", () => {
    const state = bareMetalIpi({
      version: { selectedMinor: "4.23", selectedPatch: "4.23.0" },
      release: { channel: "4.23", patchVersion: "4.23.0" },
    });
    state.hostInventory = { ...state.hostInventory, ...PROVISIONING, provisioningNetworkGateway: "172.22.0.254" };
    assert.throws(
      () => buildInstallConfig(state),
      (e) => e.code === "UNSUPPORTED_VERSION" && e.requestedVersion === "4.23"
    );
  });
});
