/**
 * TEST FIXTURES (no production code imports this).
 *
 * One naming matrix, imported by BOTH the frontend node-editor test and the
 * backend generator test, so "the UI shows what the generator writes" is
 * asserted against a single table of literal expectations rather than against
 * two independently written ones. If the editor and the generator ever drift
 * again, one of the two suites fails on the same row.
 *
 * Addresses are documentation-only ranges (RFC 5737 / RFC 3849) and MACs are
 * from the RFC 7042 documentation block.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

const MAC_A = "00:00:5E:00:53:01";
const MAC_B = "00:00:5E:00:53:02";
const MAC_C = "00:00:5E:00:53:03";

/**
 * Each case is one interface row plus the name it MUST produce, both in the
 * node editor's "VLAN Interface Name (auto)" field and in the generated
 * NMState `interfaces[].name`.
 *
 * `expectedBase` is the VLAN base interface (NMState `vlan.base-iface`); it is
 * null for rows that are not VLANs.
 */
const INTERFACE_NAMING_CASES = [
  {
    id: "vlan-on-bond-ignores-the-seeded-ethernet-name",
    /* The reported defect. Every row created in the UI is seeded with an
       ethernet.name even when its type is vlan-on-bond, and the Ethernet
       Interface Name input is not rendered for that type — so the stale value
       is invisible. The editor used to prefer it and displayed `eno2.100`. */
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "100", baseIface: "", name: "" }
    },
    expectedName: "bond0.100",
    expectedBase: "bond0",
    mustNotEqual: "eno2.100"
  },
  {
    id: "vlan-on-bond-follows-a-renamed-bond",
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond7",
        mode: "802.3ad",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "100", baseIface: "", name: "" }
    },
    expectedName: "bond7.100",
    expectedBase: "bond7"
  },
  {
    id: "vlan-on-bond-follows-the-vlan-id",
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "4094", baseIface: "", name: "" }
    },
    expectedName: "bond0.4094",
    expectedBase: "bond0"
  },
  {
    id: "vlan-on-bond-is-unaffected-by-renaming-a-member",
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "enp3s0f0", macAddress: MAC_A }, { name: "enp3s0f1", macAddress: MAC_B }]
      },
      vlan: { id: "100", baseIface: "", name: "" }
    },
    expectedName: "bond0.100",
    expectedBase: "bond0",
    mustNotEqual: "enp3s0f0.100"
  },
  {
    id: "vlan-on-ethernet-uses-the-ethernet-device",
    iface: {
      type: "vlan-on-ethernet",
      mode: "dhcp",
      ethernet: { name: "eno5", macAddress: MAC_A },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_B }, { name: "eno2", macAddress: MAC_C }]
      },
      vlan: { id: "300", baseIface: "", name: "" }
    },
    expectedName: "eno5.300",
    expectedBase: "eno5",
    mustNotEqual: "bond0.300"
  },
  {
    id: "an-imported-explicit-baseIface-overrides-the-type-derived-base",
    /* The mirrored defect: the editor ignored vlan.baseIface outright, so an
       imported run rendered bond0.100 while the generator wrote mgmt0.100. */
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "100", baseIface: "mgmt0", name: "" }
    },
    expectedName: "mgmt0.100",
    expectedBase: "mgmt0",
    mustNotEqual: "bond0.100"
  },
  {
    id: "an-explicit-vlan-name-always-wins",
    iface: {
      type: "vlan-on-bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "100", baseIface: "mgmt0", name: "storage-net" }
    },
    expectedName: "storage-net",
    expectedBase: "mgmt0"
  },
  {
    id: "a-plain-bond-is-named-after-the-bond",
    iface: {
      type: "bond",
      mode: "dhcp",
      ethernet: { name: "eno2", macAddress: MAC_C },
      bond: {
        name: "bond3",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_A }, { name: "eno2", macAddress: MAC_B }]
      },
      vlan: { id: "", baseIface: "", name: "" }
    },
    expectedName: "bond3",
    expectedBase: null
  },
  {
    id: "a-plain-ethernet-is-named-after-the-nic",
    iface: {
      type: "ethernet",
      mode: "dhcp",
      ethernet: { name: "eno9", macAddress: MAC_A },
      bond: {
        name: "bond0",
        mode: "active-backup",
        slaves: [{ name: "eno1", macAddress: MAC_B }, { name: "eno2", macAddress: MAC_C }]
      },
      vlan: { id: "", baseIface: "", name: "" }
    },
    expectedName: "eno9",
    expectedBase: null
  }
];

/** Subset that produces a VLAN interface. */
const VLAN_NAMING_CASES = INTERFACE_NAMING_CASES.filter((c) => c.expectedBase !== null);

export { INTERFACE_NAMING_CASES, VLAN_NAMING_CASES, MAC_A, MAC_B, MAC_C };
