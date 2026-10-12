/**
 * OpenShift Airgap Architect - Node Drawer Agent Content Component
 *
 * Agent scenario drawer content with visual grouping and organized sections.
 * Extracted from HostInventoryV2Step.jsx to improve maintainability.
 *
 * Section order:
 * - Host Identity (role, hostname)
 * - Root Device Hints (8 optional boot disk constraints)
 * - Primary Network (interface type, config)
 * - DNS Configuration
 * - BMC Configuration (Day-2 seed, optional)
 * - Advanced (MTU, additional routes) - BEFORE Additional Interfaces
 * - Additional Interfaces
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import FieldLabelWithInfo from "./FieldLabelWithInfo.jsx";
import { normalizeMAC, formatMACAsYouType } from "../formatUtils.js";
import {
  PRIMARY_NAME_FALLBACKS,
  resolveBaseInterfaceName,
  resolveEffectiveInterfaceName,
  resolveVlanInterfaceName
} from "../../../shared/interfaceNaming.js";

/*
 * Interface naming is derived ONLY through shared/interfaceNaming.js — the same
 * module backend/src/generate.js uses. Three ad hoc derivations used to live in
 * this file (the additional-interface VLAN name, the primary VLAN name, and the
 * route next-hop placeholder) and all three disagreed with the generator and
 * with each other. The additional-interface one checked `ethernet.name` before
 * `bond.name`, and because every new row is seeded with an `ethernet.name` the
 * field displayed a bond MEMBER nic (`eno2.100`) for a VLAN the generator named
 * `bond0.100`.
 *
 * The primary interface takes the generator's blank-name substitutions
 * (eth0 / bond0) so the displayed name is literally what will be written; an
 * additional interface takes none, because the generator skips an additional
 * row that has no name rather than inventing one.
 */
const primaryNameOf = (node) => resolveEffectiveInterfaceName(node?.primary, PRIMARY_NAME_FALLBACKS);
const primaryBaseNameOf = (node) => resolveBaseInterfaceName(node?.primary, PRIMARY_NAME_FALLBACKS);
const primaryVlanNameOf = (node) => resolveVlanInterfaceName(node?.primary, PRIMARY_NAME_FALLBACKS);

const PRIMARY_TYPES = [
  { id: "ethernet", label: "Single NIC ethernet" },
  { id: "bond", label: "Bond (LACP or active-backup)" },
  { id: "vlan-on-ethernet", label: "VLAN on ethernet" },
  { id: "vlan-on-bond", label: "VLAN on bond" }
];

const BOND_MODES = ["active-backup", "802.3ad"];

/**
 * The static-route editor, used by BOTH the primary interface and every
 * additional interface.
 *
 * It is one component on purpose. `additionalInterfaces[].advanced.routes`
 * existed in state, was seeded by createInterfaceConfig, and had no editor and
 * no generator support at all — anything an imported run carried there was
 * silently discarded. Giving additional interfaces a second, separately written
 * route editor would have re-created the divergence this tranche is removing.
 *
 * @param {object[]} routes            the rows to render
 * @param {string}   ownerInterfaceName effective name of the interface these
 *                                      routes belong to; used as the next-hop
 *                                      placeholder and as the generator default
 * @param {string}   scopeLabel         "this host's primary interface" / "this interface"
 */
function RouteRows({ routes, ownerInterfaceName, scopeLabel, ipStackLabel, onChange, onAdd, onRemove }) {
  const list = routes || [];
  return (
    <div className="list host-inventory-v2-route-list">
      <h4>
        <FieldLabelWithInfo
          label="Additional Routes"
          hint={`Extra static routes for ${scopeLabel}, beyond the default gateway.

**What is this:**
Destination networks this node must reach that the default gateway does not cover. Each row becomes one NMState route.

**When it applies:**
Optional, in both DHCP and Static IP assignment modes. A static route on a DHCP interface is valid — DHCP supplies the default route, these reach somewhere it does not advertise.

**Format:**
Destination as a CIDR, next hop as a bare IP address, next-hop interface as an interface name on this node.

**Valid values:**
Destination and next hop must be the same address family, and that family must be one the cluster IP stack mode enables (currently ${ipStackLabel}). A route in a disabled family cannot be applied and is reported as an error rather than dropped quietly.

**How it's used:**
Appended to NMState \`routes.config\` with \`table-id: 254\` (the main routing table).

**Important:**
⚠️ The node's DEFAULT gateway is not set here. It is the IPv4/IPv6 gateway field in Static IP Configuration.

**Example:**
Destination 10.0.0.0/24, next hop 192.168.1.254, next-hop interface ${ownerInterfaceName || "(this interface)"}`}
        />
      </h4>
      {list.map((route, ri) => (
        <div key={ri} className="field-grid">
          <FieldLabelWithInfo
            label="Destination"
            hint={`The network this route reaches.

**What is this:**
The destination prefix matched against a packet's address.

**When it applies:**
Required for every route row.

**Format:**
CIDR — \`network/prefix-length\`. IPv4 or IPv6.

**Valid values:**
A network address, not a host address: 10.0.0.0/24, not 10.0.0.5/24. Do not enter 0.0.0.0/0 or ::/0 here — the default route is the gateway field in Static IP Configuration.

**How it's used:**
NMState \`routes.config[].destination\`.

**Important:**
⚠️ Must be the same address family as the next hop, and a family the cluster actually runs (currently ${ipStackLabel}).

**Example:**
10.0.0.0/24`}
          >
            <input
              value={route.destination || ""}
              onChange={(e) => onChange(ri, { destination: e.target.value })}
              placeholder="10.0.0.0/24"
            />
          </FieldLabelWithInfo>
          <FieldLabelWithInfo
            label="Next Hop Address"
            hint={`The router that forwards traffic to the destination.

**What is this:**
The gateway for this one route.

**When it applies:**
Required for every route row.

**Format:**
A bare IP address — no prefix, no CIDR.

**Valid values:**
A router reachable on a subnet this node is directly attached to. Same address family as the destination.

**How it's used:**
NMState \`routes.config[].next-hop-address\`.

**Important:**
⚠️ If the next hop is not on-link for this interface, the route cannot be installed and NetworkManager rejects the desired state at first boot.

**Example:**
192.168.1.254`}
          >
            <input
              value={route.nextHopAddress || ""}
              onChange={(e) => onChange(ri, { nextHopAddress: e.target.value })}
              placeholder="192.168.1.254"
            />
          </FieldLabelWithInfo>
          <FieldLabelWithInfo
            label="Next Hop Interface (optional)"
            hint={`Which of this node's interfaces the route leaves by.

**What is this:**
The egress interface for the route.

**When it applies:**
Optional. Left blank it defaults to ${ownerInterfaceName ? `**${ownerInterfaceName}**` : "the interface these routes belong to"}, which is almost always what you want.

**Format:**
An interface name exactly as it appears in the generated nmstate — the bond name, the VLAN name (\`bond0.100\`), or the ethernet device name.

**Valid values:**
Only an interface this node actually defines. A name that matches nothing is reported as an error, because NMState rejects the whole host configuration for an unknown next-hop interface.

**How it's used:**
NMState \`routes.config[].next-hop-interface\`.

**Important:**
⚠️ For a VLAN interface this is the VLAN device (\`bond0.100\`), not the bond or a bond member.

**Example:**
${ownerInterfaceName || "bond0.100"}`}
          >
            <input
              value={route.nextHopInterface || ""}
              onChange={(e) => onChange(ri, { nextHopInterface: e.target.value })}
              placeholder={ownerInterfaceName}
            />
          </FieldLabelWithInfo>
          <label>
            Remove
            <button type="button" className="ghost" onClick={() => onRemove(ri)}>
              Remove Route
            </button>
          </label>
        </div>
      ))}
      <button type="button" className="ghost" onClick={onAdd}>
        Add Route
      </button>
    </div>
  );
}

function CompareBadge({ kind }) {
  if (!kind) return null;
  const label = kind === "wouldBeHidden" ? "Would be hidden" : "Scenario-only";
  return <span className="host-inventory-v2-compare-badge" data-badge={kind} title={label}>{label}</span>;
}

export function NodeDrawerAgentContent({
  node,
  scenarioId,
  isAgentInventoryScenario,
  updateNode,
  selectedIndex,
  handleNodeFieldChange,
  runNodeValidation,
  validationResults,
  mergedNodeValidation,
  enableIpv4 = true,
  enableIpv6,
  ipStackMode = "ipv4",
  effectiveHostname,
  showHostname,
  showDns = true,
  showRootDeviceHints = true,
  showAgentDay2InstallConfigBmc,
  showBmcCore = true,
  showBootMac = true,
  showPrimaryNetwork = true,
  showAdditionalInterfaces = true,
  showAdvancedDrawer,
  advancedOpen,
  setAdvancedOpen,
  additionalAdvancedOpen,
  setAdditionalAdvancedOpen,
  roleOptions,
  roleMeta,
  badgeBasicDrawer,
  badgeAdvancedDrawer,
  getFieldMeta,
  updatePrimary,
  updatePrimaryEthernet,
  updatePrimaryBond,
  updatePrimaryVlan,
  updatePrimaryAdvanced,
  updatePrimaryRoute,
  addPrimaryRoute,
  removePrimaryRoute,
  addBondMember,
  removeBondMember,
  updateAdditionalInterface,
  addAdditionalInterface,
  removeAdditionalInterface,
  updateAdditionalRoute,
  addAdditionalRoute,
  removeAdditionalRoute,
  isDefaultHostname,
  getDefaultHostnameForRole,
  nodes
}) {
  const selectedNode = node;
  const isArbiterDrawer = (selectedNode?.role || "").trim() === "arbiter";
  const ipStackLabel =
    ipStackMode === "ipv6" ? "IPv6-only" : ipStackMode === "dual-stack" ? "dual-stack" : "IPv4-only";

  return (
    <>
      <div className="host-inventory-v2-section-heading">
        <h4>{isAgentInventoryScenario ? "Host (Agent)" : "Basic"}</h4>
        <CompareBadge kind={badgeBasicDrawer} />
      </div>

      {isAgentInventoryScenario && selectedNode.role === "arbiter" && (
        <p className="note subtle">Arbiter node: hostname and primary network are used in agent-config for this 2 control plane + 1 arbiter topology. Set primary interface and IP so the agent can configure the node.</p>
      )}
      {isAgentInventoryScenario && selectedNode.role !== "arbiter" && (
        <p className="note subtle">These fields are used for agent-config and node configuration. Set primary interface and network for each host.</p>
      )}

      {/* Host Identity */}
      <div className="field-grid">
        <label>
          Role {roleMeta?.required ? <span className="required-marker" aria-label="required">*</span> : null}
          <select
            value={selectedNode.role}
            onChange={(e) => {
              const newRole = e.target.value;
              const patch = { role: newRole };
              if (isDefaultHostname(selectedNode)) patch.hostname = getDefaultHostnameForRole(newRole, selectedIndex, nodes);
              updateNode(selectedIndex, patch);
            }}
          >
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {mergedNodeValidation[selectedIndex]?.fieldErrors?.role ? (
            <div className="note warning">{mergedNodeValidation[selectedIndex].fieldErrors.role}</div>
          ) : null}
        </label>
        {showHostname !== false && (
          <>
            <label>
              Hostname{" "}
              <input
                value={selectedNode.hostname || ""}
                onChange={(e) => updateNode(selectedIndex, { hostname: e.target.value })}
                placeholder="e.g. master-0, arbiter-0"
                aria-required="true"
              />
            </label>
            <label className="host-inventory-v2-checkbox-label">
              <input
                type="checkbox"
                checked={!!selectedNode.hostnameUseFqdn}
                onChange={(e) => updateNode(selectedIndex, { hostnameUseFqdn: e.target.checked })}
                aria-label="Use FQDN for hostname"
              />
              {" "}Use FQDN (shortname.baseDomain)
            </label>
          </>
        )}
      </div>

      {/* Root Device Hints - hide for arbiter */}
      {showRootDeviceHints !== false && selectedNode.role !== "arbiter" && (
        <div className="workflow-group">
          <div className="workflow-group-header">
            <div className="workflow-group-title">Root Device Hints</div>
            <div className="workflow-group-description">Optional constraints for boot device selection</div>
          </div>
          <div className="workflow-group-modes">
            <p className="note subtle" style={{ margin: "0 0 12px" }}>
              <strong>All optional</strong>. Fill in one or more to identify the boot disk.{" "}
              OpenShift can evaluate multiple hints together; the selected disk must match <strong>all</strong> populated hints.{" "}
              If hints conflict, no disk will match and installation fails validation/runtime.{" "}
              If the host has only one disk, hints are usually unnecessary. For agent scenarios, these values are emitted to{" "}
              <code>agent-config.yaml hosts[].rootDeviceHints</code>. They appear in <strong>Assets / Review</strong>, not in step-level preview panes.
            </p>
            <div className="field-grid">
              <FieldLabelWithInfo
                label="Root device — deviceName (optional)"
                hint={`Stable Linux device path for the root disk.

**What is this:**
The device that OpenShift will install to (OS root filesystem)

**Best practice:**
Use **/dev/disk/by-path/...** for stability

**Avoid:**
Transient kernel names like /dev/sdX or /dev/vdX (can change across reboots)

**Example:**
/dev/disk/by-path/pci-0000:00:1f.2-ata-1`}
              >
                <input
                  value={selectedNode.rootDevice || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDevice: e.target.value })}
                  placeholder="/dev/disk/by-path/... or /dev/sda"
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — hctl (optional)"
                hint={`SCSI address for the root disk.

**What is this:**
The HCTL (Host:Channel:Target:LUN) address that identifies one specific SCSI device on this machine. It is the most precise root-device hint available, because it names a physical slot rather than a property a second disk might share.

**When it applies:**
Optional. Use it when a machine has several similar disks and you must pin installation to one of them. Omit it and the installer picks the first suitable device.

**Format:**
Four numbers separated by colons — host:channel:target:lun.

**Valid values:**
Whatever \`lsscsi\` reports on that machine. The value must match the discovered address exactly; unlike vendor or model, this hint is not a substring match.

**How it is used:**
Becomes \`rootDeviceHints.hctl\` on the host. The installer refuses to provision if no device matches.

**Important:**
⚠️ The address is tied to the physical slot and controller ordering. Replacing a controller or moving the disk can change it, so prefer a WWN or serial hint if the hardware may be re-seated.

**Example:**
0:0:0:0`}
              >
                <input
                  value={selectedNode.rootDeviceHintHctl || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintHctl: e.target.value })}
                  placeholder="0:0:0:0"
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — model (optional)"
                hint={`Device model identifier for the root disk.

**How matching works:**
This hint can be a **substring** of the discovered value

**When to use:**
Useful when you have multiple disks but want a specific model

**Example:**
INTEL SSDPE...`}
              >
                <input
                  value={selectedNode.rootDeviceHintModel || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintModel: e.target.value })}
                  placeholder="INTEL SSDPE..."
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — vendor (optional)"
                hint={`Device vendor/manufacturer identifier.

**What is this:**
The vendor string the machine reports for a disk. It selects the root device by who made it, rather than by where it is plugged in.

**When it applies:**
Optional. Useful when every machine of a given role has one disk from a known vendor and the slot ordering is not stable.

**Format:**
Free text, case-sensitive.

**Valid values:**
Any value the hardware reports. Matching is a **substring** test, so \`Samsung\` matches \`Samsung SSD 980 PRO\`.

**How it is used:**
Becomes \`rootDeviceHints.vendor\` on the host. Combine it with another hint when more than one disk shares a vendor.

**Important:**
⚠️ On its own this is rarely specific enough — a machine with two disks from the same vendor will still be ambiguous.

**Example:**
ATA, NVMe, Samsung, Intel`}
              >
                <input
                  value={selectedNode.rootDeviceHintVendor || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintVendor: e.target.value })}
                  placeholder="ATA, NVMe, Samsung..."
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — serial number (optional)"
                hint={`Disk serial number for exact matching.

**How matching works:**
This hint requires an **exact** match (not a substring)

**When to use:**
Most specific hint - identifies a unique disk

**Example:**
S3Z9NX0M123456`}
              >
                <input
                  value={selectedNode.rootDeviceHintSerialNumber || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintSerialNumber: e.target.value })}
                  placeholder="S3Z9..."
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — wwn (optional)"
                hint={`World Wide Name (WWN) for exact disk matching.

**How matching works:**
This hint requires an **exact** match (not a substring)

**Important:**
If udevadm shows ID_WWN_WITH_EXTENSION, use that value for this field

**Example:**
0x5000c500a1b2c3d4`}
              >
                <input
                  value={selectedNode.rootDeviceHintWwn || ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintWwn: e.target.value })}
                  placeholder="0x5000..."
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — min size GB (optional)"
                hint={`Minimum disk size requirement in gigabytes.

**What is this:**
Excludes disks smaller than this value

**Where this goes:**
rootDeviceHints.minSizeGigabytes

**Example:**
100 (selects disks 100GB or larger)`}
              >
                <input
                  type="number"
                  value={selectedNode.rootDeviceHintMinSizeGb ?? ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintMinSizeGb: e.target.value || undefined })}
                  placeholder="e.g. 100"
                />
              </FieldLabelWithInfo>

              <FieldLabelWithInfo
                label="Root device — rotational (optional)"
                hint={`Filter by disk rotation type.

**What is this:**
Selects the root device by whether it is spinning media. The usual reason to set it is to keep the operating system off a slow disk in a machine that has both.

**When it applies:**
Optional, and often the only hint needed on a machine with one SSD and one HDD.

**Format:**
A three-way choice; leave it as Any to express no preference.

**Valid values:**
• **false** — non-rotational (SSD, NVMe)
• **true** — rotational (HDD, spinning media)
• **Any** — no preference

**How it is used:**
Becomes \`rootDeviceHints.rotational\` on the host, and is combined with any other hints you set.

**Important:**
⚠️ This narrows the candidates, it does not pick one. If a machine has two SSDs, add a more specific hint as well.

**Example:**
false, to install on the SSD rather than the spinning disk`}
              >
                <select
                  value={selectedNode.rootDeviceHintRotational ?? ""}
                  onChange={(e) => updateNode(selectedIndex, { rootDeviceHintRotational: e.target.value })}
                >
                  <option value="">Any</option>
                  <option value="false">false (SSD/NVMe)</option>
                  <option value="true">true (HDD)</option>
                </select>
              </FieldLabelWithInfo>
            </div>
          </div>
        </div>
      )}

      {/* Primary Network */}
      {showPrimaryNetwork !== false && (<div className="workflow-group">
        <div className="workflow-group-header">
          <div className="workflow-group-title">Primary Network</div>
          <div className="workflow-group-description">Cluster networking interface configuration</div>
        </div>
        <div className="workflow-group-modes">
          <div className="field-grid">
            <FieldLabelWithInfo
              label="Primary Interface Type"
              hint={`Network interface type for cluster primary communication.

**What is this:**
The primary interface carries cluster traffic (API, pod networking, node-to-node communication). This is the most critical network connection for the node.

**Options:**
• **Ethernet** - Single physical NIC (most common for small deployments)
• **Bond** - LACP or active-backup bonding for redundancy (recommended for production)
• **VLAN (on ethernet)** - 802.1Q VLAN tagging on single NIC for network isolation
• **VLAN (on bond)** - VLAN tagging on bonded interfaces (combines redundancy + isolation)

**When to use each:**
• Ethernet: Lab/dev environments, single network path available
• Bond: Production clusters requiring high availability (eliminates single NIC failure)
• VLAN: Network segmentation required, shared physical infrastructure
• VLAN on bond: Production + network isolation requirements

**How it's used:**
Written to agent-config.yaml interfaces section. Installer configures NetworkManager on RHCOS nodes during bootstrap.

**Important:**
⚠️ All cluster nodes must be reachable on this network. Choose the same interface type across control plane nodes for consistency.

**Example:**
Bare metal with dual NICs for redundancy → Bond (mode 802.3ad or active-backup)`}
            >
              <select
                value={selectedNode.primary?.type || "ethernet"}
                onChange={(e) => updatePrimary(selectedIndex, { type: e.target.value })}
              >
                {PRIMARY_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </FieldLabelWithInfo>

            <FieldLabelWithInfo
              label="IP assignment"
              hint={`How the primary interface obtains its IP address.

**What is this:**
The method used to assign an IP address to this node's primary network interface.

**Options:**
• **DHCP** - Automatic IP assignment from network DHCP server (easier management, requires DHCP infrastructure)
• **Static** - Manual IP configuration (more control, no DHCP dependency)

**When to use DHCP:**
• DHCP server available and properly configured
• IP reservations configured for cluster nodes (recommended)
• Dynamic network environments

**When to use Static:**
• No DHCP server available
• Policy requires static IPs for servers
• Network team provides fixed IP allocations

**Requirements for Static:**
Must configure: IPv4/IPv6 CIDR, gateway, DNS servers

**How it's used:**
Written to agent-config.yaml. NetworkManager applies configuration during RHCOS first boot.

**Example:**
Production cluster with IP reservations → DHCP (with MAC-based reservations)
Air-gapped environment, no DHCP → Static`}
            >
              <select
                value={selectedNode.primary?.mode || "dhcp"}
                onChange={(e) => updatePrimary(selectedIndex, { mode: e.target.value })}
              >
                <option value="dhcp">DHCP</option>
                <option value="static">Static</option>
              </select>
            </FieldLabelWithInfo>
          </div>

          {/* Ethernet Config */}
          {(selectedNode.primary?.type === "ethernet" || selectedNode.primary?.type === "vlan-on-ethernet") && (
            <div className="option-subgroup">
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Ethernet interface"
                  hint={`Physical network interface name on this node.

**What is this:**
The Linux device name for the physical NIC that will carry cluster traffic. RHCOS uses predictable network interface names.

**When needed:**
Required when using Ethernet or VLAN-on-Ethernet primary interface types.

**Format:**
Standard Linux interface naming conventions:
• **enoN** - Onboard device index (e.g., eno1, eno2)
• **enpNsM** - PCI slot/function (e.g., enp0s3, enp3s0f1)
• **ethN** - Legacy kernel naming (rare on modern systems)

**How to find it:**
Boot node to rescue/live OS, run 'ip link show' or check BIOS/iDRAC NIC labels.

**How it's used:**
Written to agent-config.yaml interfaces section. NetworkManager binds configuration to this specific interface during RHCOS boot.

**Important:**
⚠️ Interface names vary by hardware. Verify actual interface names on your nodes before ISO creation. Wrong names = network failure during bootstrap.

**Example:**
Dell R640 onboard NIC 1 → eno1
HPE DL360 PCIe NIC → enp3s0f0`}
                >
                  <input
                    value={selectedNode.primary?.ethernet?.name || ""}
                    onChange={(e) => updatePrimaryEthernet(selectedIndex, { name: e.target.value })}
                    placeholder="eno0"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Ethernet MAC"
                  hint={`Hardware MAC address of the physical network interface.

**What is this:**
The unique 48-bit hardware identifier burned into the NIC. Used by OpenShift Agent installer to match interface configuration to the correct physical port.

**When needed:**
Always required when configuring ethernet interfaces. NetworkManager uses MAC address as the definitive way to identify which physical NIC gets which configuration.

**Format:**
Six colon-separated hexadecimal pairs (case-insensitive):
• Valid: 52:54:00:aa:11:01
• Valid: 52:54:00:AA:11:01 (case doesn't matter)
• Invalid: 52-54-00-aa-11-01 (dash-separated not accepted)
• Invalid: 525400aa1101 (no separators not accepted)

**How to find it:**
• BIOS/iDRAC: Check NIC inventory or boot screens
• Live OS: Run 'ip link show' or 'cat /sys/class/net/eno1/address'
• Physical label: Check NIC port or server label (often printed on chassis)

**How it's used:**
Written to agent-config.yaml interfaces section with 'macAddress:' key. During RHCOS boot, NetworkManager scans all NICs, finds the one matching this MAC, and applies the interface name and IP configuration to it.

**Important:**
⚠️ Wrong MAC address = network configuration applied to wrong NIC or not applied at all = cluster bootstrap failure. Double-check MAC addresses before creating agent ISO.

**Example:**
Dell R640 eno1 MAC from BIOS → 52:54:00:6b:34:56`}
                >
                  <input
                    value={selectedNode.primary?.ethernet?.macAddress || ""}
                    onChange={(e) => updatePrimaryEthernet(selectedIndex, { macAddress: formatMACAsYouType(e.target.value) })}
                    onBlur={(e) => {
                      const v = normalizeMAC(e.target.value);
                      if (v && v !== e.target.value) updatePrimaryEthernet(selectedIndex, { macAddress: v });
                    }}
                    placeholder="52:54:00:aa:11:01"
                    aria-required="true"
                  />
                </FieldLabelWithInfo>
              </div>
            </div>
          )}

          {/* Bond Config */}
          {(selectedNode.primary?.type === "bond" || selectedNode.primary?.type === "vlan-on-bond") && (
            <div className="option-subgroup">
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="Bond name"
                  hint={`Linux bond (virtual) interface name.

**What is this:**
The name of the bonded interface that will be created by NetworkManager. This virtual interface combines multiple physical NICs into one logical interface for redundancy or increased bandwidth.

**When needed:**
Required when using Bond or VLAN-on-Bond primary interface types.

**Format:**
Must follow Linux bonding interface naming convention: **bondN** where N is a number (0-9).
• Valid: bond0, bond1, bond2
• Invalid: bond, bondA, eth0, team0

**How it's used:**
Written to agent-config.yaml interfaces section. NetworkManager creates the bond interface during RHCOS boot and enslaves the member NICs to it.

**Recommended:**
Use **bond0** for primary cluster traffic (convention). Use bond1, bond2 for additional bonds if configuring secondary interfaces later.

**Important:**
⚠️ The bond name must be unique per node. Don't reuse bond0 for multiple different bonds on the same node.

**Example:**
Primary cluster network with dual NICs → bond0`}
                >
                  <input
                    value={selectedNode.primary?.bond?.name || ""}
                    onChange={(e) => updatePrimaryBond(selectedIndex, { name: e.target.value })}
                    placeholder="bond0"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="Bond mode"
                  hint={`Network bonding mode determining how traffic is distributed across member NICs.

**What is this:**
The Linux kernel bonding mode controls how multiple physical NICs work together as one logical interface. Different modes provide different levels of redundancy and bandwidth aggregation.

**Requirements:**
At least **2 bond members (slave interfaces)** required for any bond mode to function. Add member NICs in the section below.

**Modes:**
• **active-backup** - One NIC active, others standby. Simple failover, no switch configuration needed. Use when LACP not available.
• **802.3ad (LACP)** - Link Aggregation Control Protocol. All NICs active, traffic distributed. Requires switch-side LACP port channel configuration.

**When to use active-backup:**
• Switch doesn't support LACP
• Network team unable to configure port channels
• Simple failover sufficient (no bandwidth aggregation needed)
• Quick setup without switch coordination

**When to use 802.3ad (LACP):**
• Switch supports LACP (most enterprise switches do)
• Want bandwidth aggregation + failover
• Production cluster requiring maximum throughput
• Network team can configure matching LACP port channel on switch

**How it's used:**
Written to agent-config.yaml bond options. NetworkManager configures bonding module parameters during RHCOS boot.

**Important:**
⚠️ LACP requires switch configuration. If switch port channel not configured, bond will not come up = network failure = bootstrap failure. Verify switch config before using 802.3ad.

**Example:**
Production with Cisco switch LACP configured → 802.3ad
Lab environment, simple failover → active-backup`}
                >
                  <select
                    className="bond-mode-select"
                    value={selectedNode.primary?.bond?.mode || "active-backup"}
                    onChange={(e) => updatePrimaryBond(selectedIndex, { mode: e.target.value })}
                  >
                    {BOND_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </FieldLabelWithInfo>
              </div>

              <div className="bond-members-section">
                {(selectedNode.primary?.bond?.slaves || []).map((member, mi) => (
                  <div key={mi} className="bond-member-item">
                    <div className="bond-member-header">Bond member {mi + 1}</div>
                    <div className="bond-member-fields">
                      <FieldLabelWithInfo
                        label="Interface"
                        hint={`Physical NIC enslaved to this bond.

**What is this:**
One member (port) of the bond. The bond itself is virtual; these are the real NICs it aggregates.

**When it applies:**
Bond and VLAN-on-bond primary interface types. At least two members are required.

**Format:**
A Linux predictable interface name: \`enoN\` (onboard), \`enpNsM\` (PCI slot), or legacy \`ethN\`.

**Valid values:**
A NIC that exists on this host and is not used by another interface on this node.

**How it's used:**
Written to agent-config.yaml twice: as its own NMState \`ethernet\` interface, and in the bond's \`link-aggregation.port\` list.

**Important:**
⚠️ This is a bond MEMBER, not the bond. The node's IP address and any VLAN are configured on the bond, never on a member.

**Example:**
eno1`}
                      >
                        <input
                          value={member.name}
                          onChange={(e) =>
                            updateNode(selectedIndex, (n) => ({
                              ...n,
                              primary: {
                                ...n.primary,
                                bond: {
                                  ...n.primary.bond,
                                  slaves: (n.primary.bond?.slaves || []).map((m, i) =>
                                    i === mi ? { ...m, name: e.target.value } : m
                                  )
                                }
                              }
                            }))
                          }
                          placeholder={`eth${mi}`}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="MAC address"
                        hint={`Hardware MAC address of this bond member NIC.

**What is this:**
The 48-bit address burned into the physical port. It is how the agent identifies which NIC to enslave to the bond.

**When it applies:**
Always required for every bond member.

**Format:**
Six colon-separated hex pairs, case-insensitive (\`52:54:00:aa:11:02\`). Dashes and unseparated forms are rejected.

**Valid values:**
The real MAC of a NIC on THIS host. Each member must have a different MAC, and no two nodes may share one.

**How it's used:**
Written to agent-config.yaml \`hosts[].interfaces[]\`. At first boot the agent matches this MAC to a physical port and applies the interface name to it.

**Important:**
⚠️ A wrong MAC means the bond comes up with the wrong port, or not at all, and bootstrap fails. Read it from the BIOS/iDRAC NIC inventory or \`ip link show\`.

**Example:**
52:54:00:6b:34:57`}
                      >
                        <input
                          value={member.macAddress}
                          onChange={(e) =>
                            updateNode(selectedIndex, (n) => ({
                              ...n,
                              primary: {
                                ...n.primary,
                                bond: {
                                  ...n.primary.bond,
                                  slaves: (n.primary.bond?.slaves || []).map((m, i) =>
                                    i === mi ? { ...m, macAddress: formatMACAsYouType(e.target.value) } : m
                                  )
                                }
                              }
                            }))
                          }
                          onBlur={(e) => {
                            const v = normalizeMAC(e.target.value);
                            if (v && v !== e.target.value)
                              updateNode(selectedIndex, (n) => ({
                                ...n,
                                primary: {
                                  ...n.primary,
                                  bond: {
                                    ...n.primary.bond,
                                    slaves: (n.primary.bond?.slaves || []).map((m, i) =>
                                      i === mi ? { ...m, macAddress: v } : m
                                    )
                                  }
                                }
                              }));
                          }}
                          placeholder="52:54:00:aa:11:02"
                        />
                      </FieldLabelWithInfo>
                    </div>
                    {(selectedNode.primary?.bond?.slaves?.length || 0) > 2 && mi >= 2 && (
                      <button type="button" className="ghost bond-member-remove-btn" onClick={() => removeBondMember(selectedIndex, mi)}>
                        Remove member {mi + 1}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => addBondMember(selectedIndex)}>
                  Add bond member
                </button>
              </div>
            </div>
          )}

          {/* VLAN Config */}
          {(selectedNode.primary?.type === "vlan-on-ethernet" || selectedNode.primary?.type === "vlan-on-bond") && (
            <div className="option-subgroup">
              <div className="field-grid">
                <FieldLabelWithInfo
                  label="VLAN ID"
                  hint={`802.1Q VLAN tag carried on the primary interface.

**What is this:**
The numeric tag the switch uses to place this node's traffic on a specific VLAN. The node sends and receives cluster traffic tagged with this ID.

**When it applies:**
Only for the "VLAN on ethernet" and "VLAN on bond" primary interface types.

**Format:**
A whole number, no leading zeros, no "vlan" prefix.

**Valid values:**
1 – 4094. (0 and 4095 are reserved by 802.1Q.)

**How it's used:**
Written to agent-config.yaml as the NMState interface \`vlan.id\`, on an interface of type \`vlan\` whose \`base-iface\` is the ethernet or bond below.

**Important:**
⚠️ The switch port must be configured as a trunk carrying this VLAN. If the port is an access port, a tagged frame is dropped and the node never reaches the cluster network.

**Example:**
100`}
                >
                  <input
                    value={selectedNode.primary?.vlan?.id || ""}
                    onChange={(e) => updatePrimaryVlan(selectedIndex, { id: e.target.value })}
                    placeholder="100"
                  />
                </FieldLabelWithInfo>
                <FieldLabelWithInfo
                  label="VLAN name"
                  hint={`Name of the virtual VLAN interface this node will create.

**What is this:**
The Linux interface name for the tagged VLAN device stacked on top of the base interface. It is the interface that actually carries the node's IP address.

**When it applies:**
Only for the "VLAN on ethernet" and "VLAN on bond" primary interface types.

**Format:**
Derived automatically as \`<base interface>.<VLAN ID>\`. The base interface is the **bond** for "VLAN on bond" and the **ethernet NIC** for "VLAN on ethernet" — never a bond member.

**Valid values:**
Any Linux interface name (max 15 characters). Leave it as shown unless your site has a naming standard.

**How it's used:**
Becomes the NMState \`interfaces[].name\` of the \`vlan\` interface, and the \`next-hop-interface\` of this node's default route. Exactly this value is written to agent-config.yaml.

**Important:**
⚠️ Overtyping it does not change which interface the VLAN sits on — that is set by the interface type and the base interface. It only renames the device.

**Example:**
VLAN 100 on bond0 → bond0.100`}
                >
                  <input
                    value={selectedNode.primary?.vlan?.name || primaryVlanNameOf(selectedNode)}
                    onChange={(e) => updatePrimaryVlan(selectedIndex, { name: e.target.value })}
                  />
                </FieldLabelWithInfo>
              </div>
              <p className="note subtle" style={{ margin: "6px 0 0" }}>
                VLAN base interface: <strong>{primaryBaseNameOf(selectedNode) || "(set the interface name above)"}</strong>
                {" "}— taken from the selected primary interface type, which is what the generated nmstate uses.
              </p>
            </div>
          )}

          {/* Static IP Config — the node's address AND its default gateway.
              The gateway lives here, not under Advanced, and it exists only in
              Static mode because in DHCP mode the DHCP server supplies it. */}
          {selectedNode.primary?.mode === "static" && (
            <div className="workflow-group">
              <div className="workflow-group-header">
                <div className="workflow-group-title">Static IP Configuration</div>
                <div className="workflow-group-description">
                  Address of the primary interface <strong>and this node's default gateway</strong> — the gateway
                  field below is the default route in the generated nmstate. Cluster IP stack mode is{" "}
                  <strong>{ipStackLabel}</strong>, so only the matching address families are shown; the generator
                  discards an address in any other family.
                </div>
              </div>
              <div className="workflow-group-modes">
                <div className="field-grid">
                  {enableIpv4 && (
                    <>
                      <FieldLabelWithInfo
                        label="IPv4 CIDR"
                        hint={`Static IPv4 address of this node's primary interface, with its prefix length.

**What is this:**
The fixed address the node answers on for cluster traffic. It is not a network — it is this one host's address.

**When it applies:**
IP assignment = Static, and the cluster IP stack mode includes IPv4. Hidden entirely for an IPv6-only cluster, where the generator would discard it.

**Format:**
\`address/prefix-length\` — the prefix is a number, not a dotted mask.

**Valid values:**
A host address inside the cluster's machine network, not the network or broadcast address, and not already used by another node or by the API/Ingress VIPs.

**How it's used:**
Becomes NMState \`ipv4.address[0]\` (\`ip\` + \`prefix-length\`) on the primary interface, with \`dhcp: false\`.

**Important:**
⚠️ Use /24, not /255.255.255.0. A value outside the machine network is flagged as a warning because the installer cannot reach it.

**Example:**
192.168.1.20/24`}
                      >
                        <input
                          value={selectedNode.primary?.ipv4Cidr || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv4Cidr: e.target.value.trim() })}
                          placeholder="192.168.1.20/24"
                          aria-required="true"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="IPv4 gateway"
                        hint={`This node's IPv4 default gateway — the router it sends off-subnet traffic to.

**What is this:**
The default route. There is no separate "default route" field anywhere else in this editor; this one field is it.

**When it applies:**
IP assignment = Static only. In DHCP mode the gateway comes from the DHCP lease, which is why no gateway field appears there.

**Format:**
A bare IPv4 address — no prefix, no CIDR.

**Valid values:**
A router address that is reachable on the same subnet as the IPv4 CIDR above.

**How it's used:**
Emitted as the NMState route \`destination: 0.0.0.0/0\`, \`next-hop-address: <this value>\`, \`next-hop-interface: <the primary interface>\`, \`table-id: 254\`.

**Important:**
⚠️ Routes to networks the default gateway does not cover go in **Additional Routes**, in the Advanced section below — not here.

**Example:**
192.168.1.1`}
                      >
                        <input
                          value={selectedNode.primary?.ipv4Gateway || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv4Gateway: e.target.value.trim() })}
                          placeholder="192.168.1.1"
                          aria-required="true"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                  {enableIpv6 && (
                    <>
                      <FieldLabelWithInfo
                        label="IPv6 CIDR"
                        hint={`Static IPv6 address of this node's primary interface, with its prefix length.

**What is this:**
The fixed IPv6 address the node answers on for cluster traffic.

**When it applies:**
IP assignment = Static, and the cluster IP stack mode is IPv6-only or dual-stack. Required in an IPv6-only cluster — it is then the node's only address.

**Format:**
\`address/prefix-length\`, standard IPv6 notation (\`::\` compression allowed).

**Valid values:**
A host address inside the cluster's IPv6 machine network. /64 is the usual prefix.

**How it's used:**
Becomes NMState \`ipv6.address[0]\` on the primary interface, with \`dhcp: false\`.

**Important:**
⚠️ A link-local address (fe80::/10) is not usable here. Use a routable ULA or GUA.

**Example:**
2001:db8:1::20/64`}
                      >
                        <input
                          value={selectedNode.primary?.ipv6Cidr || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv6Cidr: e.target.value })}
                          placeholder="2001:db8:1::20/64"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="IPv6 gateway"
                        hint={`This node's IPv6 default gateway.

**What is this:**
The IPv6 default route. The IPv6 equivalent of the IPv4 gateway above, and likewise the only place a default route is set.

**When it applies:**
IP assignment = Static, and the cluster IP stack mode is IPv6-only or dual-stack.

**Format:**
A bare IPv6 address — no prefix.

**Valid values:**
A router address reachable on the same subnet as the IPv6 CIDR above. A link-local next hop (fe80::...) is common for IPv6 routers and is accepted.

**How it's used:**
Emitted as the NMState route \`destination: ::/0\`, \`next-hop-address: <this value>\`, \`next-hop-interface: <the primary interface>\`, \`table-id: 254\`.

**Important:**
⚠️ Setting a gateway without an IPv6 CIDR is rejected — the node needs an address in the family before it can have a route in it.

**Example:**
2001:db8:1::1`}
                      >
                        <input
                          value={selectedNode.primary?.ipv6Gateway || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv6Gateway: e.target.value })}
                          placeholder="2001:db8:1::1"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                </div>
                <p className="note subtle" style={{ margin: "8px 0 0" }}>
                  The gateway above <strong>is</strong> this node's default route. For routes to networks the
                  default gateway does not cover, use <strong>Additional Routes</strong> in the{" "}
                  <strong>Advanced</strong> section below.
                </p>
              </div>
            </div>
          )}

          {/* DHCP mode: say plainly why there is no gateway field, because its
              absence is what reads as "the gateway setting disappeared". */}
          {selectedNode.primary?.mode === "dhcp" && (
            <p className="note subtle host-inventory-v2-dhcp-gateway-note" style={{ marginTop: 8 }}>
              <strong>DHCP:</strong> address, default gateway and (optionally) DNS come from the DHCP server, so
              there is no gateway field to fill in. Switch <strong>IP assignment</strong> to <strong>Static</strong>{" "}
              to set an address and default gateway explicitly. Extra static routes are available either way, under{" "}
              <strong>Advanced → Additional Routes</strong>.
            </p>
          )}
        </div>
      </div>)}

      {/* DNS Configuration */}
      {showDns !== false && (
        <div className="workflow-group">
          <div className="workflow-group-header">
            <div className="workflow-group-title">DNS Configuration</div>
            <div className="workflow-group-description">
              Resolver settings for this host. Unlike the address fields above, these are{" "}
              <strong>not</strong> tied to the cluster IP stack mode — a resolver of either address family is
              written through unchanged.
            </div>
          </div>
          <div className="workflow-group-modes">
            <div className="field-grid">
              <FieldLabelWithInfo
                label="DNS servers"
                hint={`Resolvers this node will use.

**What is this:**
The nameservers written into the node's resolver configuration. In a disconnected cluster these must resolve the cluster's own records (api, api-int, *.apps) and the mirror registry.

**When it applies:**
Any IP assignment mode. With DHCP the DHCP-supplied resolvers are used unless you set these, which override them.

**Format:**
Comma-separated bare IP addresses — no port, no scheme, no hostnames.

**Valid values:**
IPv4 **or** IPv6 resolver addresses. This field is deliberately NOT filtered by the cluster IP stack mode: the generator writes \`dns-resolver.config.server\` verbatim, so an IPv4 resolver in an IPv6-capable cluster is legitimate as long as the node can reach it over a family it actually has.

**How it's used:**
Becomes NMState \`dns-resolver.config.server\` in this host's networkConfig.

**Important:**
⚠️ A resolver in a family the node has no address in is unreachable. In an IPv6-only cluster, use IPv6 resolvers.

**Example:**
192.168.1.10,192.168.1.11`}
              >
                <input
                  value={selectedNode.dnsServers || ""}
                  onChange={(e) => updateNode(selectedIndex, { dnsServers: e.target.value })}
                  placeholder="192.168.1.10,192.168.1.11"
                />
              </FieldLabelWithInfo>
              <FieldLabelWithInfo
                label="DNS search"
                hint={`Search domains appended to unqualified hostnames.

**What is this:**
The resolver's search list. A lookup for a bare name is retried with each of these suffixes appended.

**When it applies:**
Optional, any IP assignment mode.

**Format:**
Comma-separated DNS domains, no leading dot.

**Valid values:**
Usually \`<cluster name>.<base domain>\` so in-cluster short names resolve, plus any site domain.

**How it's used:**
Becomes NMState \`dns-resolver.config.search\` in this host's networkConfig.

**Important:**
⚠️ Not required for the cluster to install — OpenShift uses fully qualified names internally. Long search lists slow every failed lookup.

**Example:**
ocp1.example.com,example.com`}
              >
                <input
                  value={selectedNode.dnsSearch || ""}
                  onChange={(e) => updateNode(selectedIndex, { dnsSearch: e.target.value })}
                  placeholder="ocp1.example.com,example.com"
                />
              </FieldLabelWithInfo>
            </div>
          </div>
        </div>
      )}

      {/* BMC Configuration (Day-2 seed, optional) */}
      {showAgentDay2InstallConfigBmc && (showBmcCore !== false || showBootMac !== false) && (
        <>
          <div className="divider" />
          <div className="workflow-group">
            <div className="workflow-group-header">
              <div className="workflow-group-title">BMC Configuration (Day-2 Seed)</div>
              <div className="workflow-group-description">
                Optional Day-2 seed (see §9.1.4): these map to <code>install-config.yaml</code>{" "}
                <code>platform.baremetal.hosts[]</code> as <code>name</code>, <code>bootMACAddress</code>, and{" "}
                <code>bmc</code>. They are not used during initial agent provisioning; they can reduce post-install steps.
              </div>
            </div>
            <div className="workflow-group-modes">
              <div className="field-grid">
                {showBmcCore !== false && (
                  <>
                    <label>
                      BMC address{" "}
                      <input
                        value={selectedNode.bmc?.address || ""}
                        onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, address: e.target.value } })}
                        placeholder="redfish+http://192.168.1.1/..."
                      />
                    </label>
                    <label>
                      BMC username{" "}
                      <input
                        autoComplete="off"
                        value={selectedNode.bmc?.username || ""}
                        onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, username: e.target.value } })}
                      />
                    </label>
                    <label>
                      BMC password{" "}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={selectedNode.bmc?.password || ""}
                        onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, password: e.target.value } })}
                      />
                    </label>
                    <label className="host-inventory-v2-checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedNode.bmc?.disableCertificateVerification === true}
                        onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, disableCertificateVerification: e.target.checked } })}
                      />
                      {" "}Disable BMC certificate verification (e.g. self-signed)
                    </label>
                  </>
                )}
                {showBootMac !== false && (
                  <label>
                    Boot MAC{" "}
                    <input
                      value={selectedNode.bmc?.bootMACAddress || ""}
                      onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: formatMACAsYouType(e.target.value) } })}
                      onBlur={(e) => {
                        const v = normalizeMAC(e.target.value);
                        if (v && v !== e.target.value) updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, bootMACAddress: v } });
                      }}
                      placeholder="52:54:00:aa:bb:cc"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {isArbiterDrawer && (
        <p className="note subtle" style={{ gridColumn: "1 / -1" }}>
          Arbiter: primary interface, DNS, and root device hint are what this app emits to agent-config. Extra interfaces and primary advanced MTU/routes are hidden for this role to match the simplified arbiter workflow.
        </p>
      )}

      {/* Advanced - MOVED BEFORE Additional Interfaces, hidden for arbiter */}
      {showAdvancedDrawer && !isArbiterDrawer && showPrimaryNetwork !== false && (
        <>
          <div className="divider" />
          <div className="workflow-group">
            <div className="card-header host-inventory-v2-section-heading host-inventory-v2-advanced-header">
              <h4>Advanced</h4>
              <CompareBadge kind={badgeAdvancedDrawer} />
              <button
                type="button"
                className="card-header-collapse-btn"
                onClick={() => setAdvancedOpen((o) => !o)}
                aria-expanded={advancedOpen}
                aria-label={advancedOpen ? "Collapse Advanced" : "Expand Advanced"}
              >
                <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>
                  {advancedOpen ? "Collapse" : "Expand"}
                </span>
              </button>
            </div>
            {/* DISCOVERABILITY: this description stays visible while the panel
                is collapsed, so the contents are findable without expanding it.
                "Additional Routes" was here all along and simply could not be
                seen. */}
            <div className="workflow-group-description host-inventory-v2-advanced-summary">
              MTU and <strong>Additional Routes</strong> (extra static routes beyond the default gateway) for the
              primary interface.{" "}
              {selectedNode.primary?.mode === "static"
                ? "The default gateway itself is in Static IP Configuration above."
                : "The default gateway comes from DHCP; switch IP assignment to Static to set one."}
            </div>
            {advancedOpen && (
              <>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="MTU"
                    hint={`Maximum transmission unit of the primary interface, in bytes.

**What is this:**
The largest frame payload the interface will send. Everything on the path — NIC, switch ports, router — must agree.

**When it applies:**
Optional. Applies to the primary physical interface and to any VLAN stacked on it; each additional interface has its own MTU.

**Format:**
A whole number of bytes.

**Valid values:**
1500 is the Ethernet default. 9000 is the usual jumbo-frame value. Below 1280 breaks IPv6.

**How it's used:**
Written as NMState \`interfaces[].mtu\` on the primary interface (and its VLAN).

**Important:**
⚠️ Jumbo frames must be enabled end to end. A node set to 9000 behind a 1500-byte switch port suffers silent black-holing of large packets — the cluster appears to install and then fails intermittently.

**Example:**
1500`}
                  >
                    <input
                      value={selectedNode.primary?.advanced?.mtu || ""}
                      onChange={(e) => updatePrimaryAdvanced(selectedIndex, { mtu: e.target.value })}
                      placeholder="1500"
                    />
                  </FieldLabelWithInfo>
                </div>
                <p className="note subtle host-inventory-v2-advanced-mtu-note" style={{ marginTop: 6, marginBottom: 0 }}>
                  One MTU value applies to the primary physical interface and any VLAN on that path (same value in generated nmstate). Default 1500. Each additional interface has its own Advanced section with its own MTU.
                </p>
                <RouteRows
                  routes={selectedNode.primary?.advanced?.routes}
                  ownerInterfaceName={primaryNameOf(selectedNode)}
                  scopeLabel="this host's primary interface"
                  ipStackLabel={ipStackLabel}
                  onChange={(ri, patch) => updatePrimaryRoute(selectedIndex, ri, patch)}
                  onAdd={() => addPrimaryRoute(selectedIndex)}
                  onRemove={(ri) => removePrimaryRoute(selectedIndex, ri)}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* Additional Interfaces - MOVED AFTER Advanced, hidden for arbiter */}
      {!isArbiterDrawer && showAdditionalInterfaces !== false && (
        <>
          <div className="divider" />
          <h4>
            <FieldLabelWithInfo
              label="Additional Interfaces"
              hint={`Configure extra network interfaces beyond the primary.

**Use cases:**
• Extra NIC for storage or management traffic
• Additional VLANs for network isolation
• Secondary networks for tenant workloads

**Primary vs Additional:**
Primary interface is used for cluster networking; additional interfaces are optional`}
            />
          </h4>
          <div className="list">
            {(selectedNode.additionalInterfaces || []).map((iface, ifaceIndex) => (
              <section key={`iface-${ifaceIndex}`} className="card">
                <div className="card-header">
                  <h4>Interface {ifaceIndex + 1}</h4>
                  <button type="button" className="ghost" onClick={() => removeAdditionalInterface(selectedIndex, ifaceIndex)}>
                    Remove
                  </button>
                </div>
                <div className="field-grid">
                  <FieldLabelWithInfo
                    label="Type"
                    hint={`Shape of this additional interface.

**What is this:**
Whether this extra interface is a single NIC, a bond of several NICs, or a tagged VLAN on top of either.

**When it applies:**
Always. It decides which of the fields below are shown, and which interface the VLAN name is derived from.

**Options:**
• **Single NIC ethernet** — one physical port
• **Bond** — two or more ports aggregated (active-backup or 802.3ad)
• **VLAN on ethernet** — a tagged VLAN stacked on one port
• **VLAN on bond** — a tagged VLAN stacked on a bond

**How it's used:**
Determines the NMState interface types emitted for this row: \`ethernet\`, \`bond\` (+ one \`ethernet\` per member), and/or \`vlan\`.

**Important:**
⚠️ Changing the type changes which name the VLAN is built on — a VLAN on bond is named after the BOND, never after a bond member.

**Example:**
A storage network on its own tagged VLAN over a redundant pair → VLAN on bond`}
                  >
                    <select value={iface.type} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { type: e.target.value })}>
                      {PRIMARY_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </FieldLabelWithInfo>
                  <FieldLabelWithInfo
                    label="IP Assignment"
                    hint={`How this additional interface gets its address.

**What is this:**
DHCP or a static address, chosen per interface — independent of what the primary interface uses.

**When it applies:**
Always.

**Options:**
• **DHCP** — address and routes come from a DHCP server on that network
• **Static** — you supply the address below

**How it's used:**
DHCP emits NMState \`ipv4: { enabled: true, dhcp: true }\`; Static emits an explicit \`address\` entry with \`dhcp: false\`.

**Important:**
⚠️ No default gateway is set from an additional interface — the node has one default route and it belongs to the primary. Use **Additional Routes** under this interface's Advanced Networking to reach specific networks through it.

**Example:**
A storage VLAN with no DHCP server → Static`}
                  >
                    <select value={iface.mode} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { mode: e.target.value })}>
                      <option value="dhcp">DHCP</option>
                      <option value="static">Static</option>
                    </select>
                  </FieldLabelWithInfo>
                  {(iface.type === "ethernet" || iface.type === "vlan-on-ethernet") && (
                    <>
                      <FieldLabelWithInfo
                        label="Ethernet Interface Name"
                        hint={`Physical NIC this additional interface uses.

**What is this:**
The Linux device name of the port carrying this interface's traffic.

**When it applies:**
Types "Single NIC ethernet" and "VLAN on ethernet". For a VLAN on ethernet this is also the VLAN's base interface.

**Format:**
A Linux predictable name: \`enoN\`, \`enpNsM\`, or legacy \`ethN\`.

**Valid values:**
A NIC that exists on this host and is not already used by the primary interface or another additional interface. Duplicate names are rejected at generation.

**How it's used:**
Becomes an NMState \`ethernet\` interface in this host's networkConfig.

**Important:**
⚠️ Leave it blank and the whole row is skipped — an interface with no name cannot be expressed in NMState.

**Example:**
eno2`}
                      >
                        <input
                          value={iface.ethernet?.name || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, name: e.target.value } })}
                          placeholder="eth2"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Ethernet MAC Address"
                        hint={`Hardware MAC address of this additional NIC.

**What is this:**
The 48-bit address of the physical port, used to match the configuration to the right NIC at first boot.

**When it applies:**
Types "Single NIC ethernet" and "VLAN on ethernet".

**Format:**
Six colon-separated hex pairs, case-insensitive. Dashes or unseparated digits are rejected.

**Valid values:**
The real MAC of a port on THIS host, different from every other MAC in this inventory.

**How it's used:**
Written to agent-config.yaml \`hosts[].interfaces[]\` alongside the interface name.

**Important:**
⚠️ The wrong MAC applies this configuration to the wrong port. Read it from the BIOS/BMC NIC inventory or \`ip link show\`.

**Example:**
52:54:00:aa:11:03`}
                      >
                        <input
                          value={iface.ethernet?.macAddress || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: formatMACAsYouType(e.target.value) } })}
                          onBlur={(e) => {
                            const v = normalizeMAC(e.target.value);
                            if (v && v !== e.target.value) updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: v } });
                          }}
                          placeholder="52:54:00:aa:11:03"
                        />
                      </FieldLabelWithInfo>
                    </>
                  )}
                  {(iface.type === "bond" || iface.type === "vlan-on-bond") && (
                    <>
                      <FieldLabelWithInfo
                        label="Bond Name"
                        hint={`Name of the bonded interface created for this row.

**What is this:**
The virtual device that aggregates the member NICs listed below. For "VLAN on bond" it is also the VLAN's base interface.

**When it applies:**
Types "Bond" and "VLAN on bond".

**Format:**
\`bondN\` — the Linux bonding convention.

**Valid values:**
A name not already used on this node. The primary interface usually takes \`bond0\`, so an additional bond is typically \`bond1\`.

**How it's used:**
Becomes an NMState \`bond\` interface whose \`link-aggregation.port\` list is the members below.

**Important:**
⚠️ Must be unique per node. Reusing the primary's bond name makes the generated document invalid (duplicate interface name) and generation fails.

**Example:**
bond1`}
                      >
                        <input
                          value={iface.bond?.name || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, name: e.target.value } })}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="Bond Mode"
                        hint={`How traffic is shared across this bond's members.

**What is this:**
The Linux bonding mode for this additional bond.

**When it applies:**
Types "Bond" and "VLAN on bond". At least two members are required either way.

**Options:**
• **active-backup** — one member carries traffic, the rest stand by. No switch configuration needed.
• **802.3ad** — LACP. All members active; requires a matching port channel on the switch.

**How it's used:**
Written as NMState \`link-aggregation.mode\`, with \`miimon: 100\`.

**Important:**
⚠️ 802.3ad without switch-side LACP leaves the bond down, and anything depending on this interface never comes up. Confirm the switch configuration first.

**Example:**
Switch port channel already configured → 802.3ad`}
                      >
                        <select
                          value={iface.bond?.mode || "active-backup"}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, mode: e.target.value } })}
                        >
                          {BOND_MODES.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </FieldLabelWithInfo>
                      {(iface.bond?.slaves || []).map((slave, slaveIndex) => (
                        <React.Fragment key={`iface-${ifaceIndex}-slave-${slaveIndex}`}>
                          <FieldLabelWithInfo
                            label="Bond Member Interface"
                            hint={`Physical NIC enslaved to this additional bond.

**What is this:**
One member port of the bond above.

**When it applies:**
Types "Bond" and "VLAN on bond". Two members minimum.

**Format:**
A Linux predictable name: \`enoN\`, \`enpNsM\`, or legacy \`ethN\`.

**Valid values:**
A NIC on this host that is not used anywhere else in this node's inventory.

**How it's used:**
Emitted both as its own NMState \`ethernet\` interface and in the bond's \`link-aggregation.port\` list.

**Important:**
⚠️ Addresses and VLANs belong on the bond, not on a member. A member carries no IP configuration of its own.

**Example:**
eno3`}
                          >
                            <input
                              value={slave.name}
                              onChange={(e) => {
                                const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, name: e.target.value } : entry));
                                updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                              }}
                              placeholder={`eth${slaveIndex}`}
                            />
                          </FieldLabelWithInfo>
                          <FieldLabelWithInfo
                            label="Bond Member MAC"
                            hint={`Hardware MAC address of this bond member.

**What is this:**
The 48-bit address of the member NIC, used to bind the configuration to the right physical port.

**When it applies:**
Required for every member of an additional bond.

**Format:**
Six colon-separated hex pairs, case-insensitive.

**Valid values:**
The real MAC of a port on this host; unique across the whole inventory.

**How it's used:**
Written to agent-config.yaml \`hosts[].interfaces[]\` for the member device.

**Important:**
⚠️ Two members sharing a MAC, or a MAC copied from another node, produces a bond that never forms.

**Example:**
52:54:00:aa:11:04`}
                          >
                            <input
                              value={slave.macAddress}
                              onChange={(e) => {
                                const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, macAddress: formatMACAsYouType(e.target.value) } : entry));
                                updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                              }}
                              onBlur={(e) => {
                                const v = normalizeMAC(e.target.value);
                                if (v && v !== e.target.value) {
                                  const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, macAddress: v } : entry));
                                  updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                                }
                              }}
                              placeholder="52:54:00:aa:11:04"
                            />
                          </FieldLabelWithInfo>
                        </React.Fragment>
                      ))}
                    </>
                  )}
                  {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") && (
                    <>
                      <FieldLabelWithInfo
                        label="VLAN ID"
                        hint={`802.1Q VLAN tag carried on this additional interface.

**What is this:**
The numeric tag identifying the VLAN this interface joins.

**When it applies:**
Types "VLAN on ethernet" and "VLAN on bond".

**Format:**
A whole number, no "vlan" prefix.

**Valid values:**
1 – 4094 (0 and 4095 are reserved).

**How it's used:**
Written as the NMState \`vlan.id\` of an interface of type \`vlan\`, whose \`base-iface\` is the ethernet or bond configured above — chosen by the interface TYPE, not by whichever name field happens to be filled in.

**Important:**
⚠️ The switch port must be a trunk carrying this VLAN; on an access port the tagged frames are discarded.

**Example:**
100`}
                      >
                        <input
                          value={iface.vlan?.id || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, id: e.target.value } })}
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="VLAN Interface Name (auto)"
                        hint={`Name of the VLAN device this row creates.

**What is this:**
The Linux interface name of the tagged VLAN. It is the interface that holds this row's IP address and the one a route would name as its next-hop interface.

**When it applies:**
Types "VLAN on ethernet" and "VLAN on bond".

**Format:**
Derived as \`<base interface>.<VLAN ID>\`. The base is the **bond name** for "VLAN on bond" and the **ethernet interface name** for "VLAN on ethernet". It is never a bond member.

**Valid values:**
Any Linux interface name up to 15 characters, unique on this node. Leave the derived value unless your site mandates something else.

**How it's used:**
Becomes the NMState \`interfaces[].name\` of the \`vlan\` interface, exactly as shown here — the editor and the generator read this name from the same shared function.

**Important:**
⚠️ Editing this renames the device only. It does not change which interface the VLAN sits on; that follows from the Type above.

**Example:**
VLAN 100 on bond1 → bond1.100`}
                      >
                        <input
                          value={iface.vlan?.name || resolveVlanInterfaceName(iface)}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, name: e.target.value } })}
                        />
                      </FieldLabelWithInfo>
                      <p className="note subtle host-inventory-v2-additional-vlan-base" style={{ gridColumn: "1 / -1", margin: 0 }}>
                        VLAN base interface:{" "}
                        <strong>{resolveBaseInterfaceName(iface) || "(name the interface above)"}</strong>
                        {" "}— taken from this row's type, and the same value the generated nmstate uses.
                      </p>
                    </>
                  )}
                  {iface.mode === "static" && (
                    <>
                      {(
                        <FieldLabelWithInfo
                          label="IPv4 Address/CIDR"
                          hint={`Static IPv4 address of this additional interface.

**What is this:**
This interface's own host address — separate from the primary interface's address.

**When it applies:**
IP Assignment = Static. **Always available, whatever the cluster IP stack mode is.** A secondary interface is not bound to the cluster's address family: Red Hat delegates \`hosts[].networkConfig\` wholesale to the NMState Declarative Network API (Agent-based Installer §9.2.2), where \`ipv4\` and \`ipv6\` are independent per-interface settings. An IPv4 storage or management network on an IPv6-only cluster is valid and is generated. Only the PRIMARY interface — the one carrying the node address and the default route — follows the cluster stack mode.

**Format:**
\`address/prefix-length\`, e.g. \`10.10.0.20/24\`. Not a dotted netmask.

**Valid values:**
A host address on the network this interface attaches to. It must not collide with the primary interface's subnet unless you intend policy routing.

**How it's used:**
NMState \`ipv4.address[0]\` on this interface, with \`dhcp: false\`.

**Important:**
⚠️ No gateway field exists here on purpose: a node has one default route and it belongs to the primary interface. Reach other networks through this interface with **Additional Routes** below.

**Example:**
10.10.0.20/24`}
                        >
                          <input
                            value={iface.ipv4Cidr || ""}
                            onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv4Cidr: e.target.value.trim() })}
                            placeholder="10.10.0.20/24"
                          />
                        </FieldLabelWithInfo>
                      )}
                      {(
                        <FieldLabelWithInfo
                          label="IPv6 Address/CIDR"
                          hint={`Static IPv6 address of this additional interface.

**What is this:**
This interface's own IPv6 host address.

**When it applies:**
IP Assignment = Static, and the cluster IP stack mode is IPv6-only or dual-stack. Required in an IPv6-only cluster, where it is this interface's only address.

**Format:**
\`address/prefix-length\` in standard IPv6 notation; \`::\` compression allowed.

**Valid values:**
A routable ULA or GUA on the attached network. Link-local (fe80::/10) is not usable as the configured address.

**How it's used:**
NMState \`ipv6.address[0]\` on this interface, with \`dhcp: false\`.

**Important:**
⚠️ As with IPv4, no gateway is configured per additional interface. Use **Additional Routes** below.

**Example:**
2001:db8:10::20/64`}
                        >
                          <input
                            value={iface.ipv6Cidr || ""}
                            onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv6Cidr: e.target.value })}
                            placeholder="2001:db8:10::20/64"
                          />
                        </FieldLabelWithInfo>
                      )}
                    </>
                  )}
                </div>
                <div className="card-header">
                  <h4>Advanced Networking</h4>
                  <button
                    type="button"
                    className="card-header-collapse-btn"
                    onClick={() => setAdditionalAdvancedOpen((prev) => ({ ...prev, [ifaceIndex]: !prev[ifaceIndex] }))}
                    aria-expanded={additionalAdvancedOpen[ifaceIndex]}
                    aria-label={additionalAdvancedOpen[ifaceIndex] ? "Collapse Advanced Networking" : "Expand Advanced Networking"}
                  >
                    <span className="host-inventory-v2-gather-info-expand-label" aria-hidden>
                      {additionalAdvancedOpen[ifaceIndex] ? "Collapse" : "Expand"}
                    </span>
                  </button>
                </div>
                {/* Visible while collapsed, for the same discoverability reason
                    as the primary Advanced section. */}
                <div className="workflow-group-description host-inventory-v2-advanced-summary">
                  MTU, SR-IOV, VRF and <strong>Additional Routes</strong> for this interface.
                </div>
                {additionalAdvancedOpen[ifaceIndex] ? (
                  <>
                    <div className="field-grid">
                      <FieldLabelWithInfo
                        label="MTU (optional)"
                        hint={`Maximum transmission unit of this additional interface, in bytes.

**What is this:**
The largest frame payload this interface will send. Set per interface — it does not inherit the primary's MTU.

**When it applies:**
Optional. Applies to this interface and, for a VLAN row, to the VLAN device on the same path.

**Format:**
A whole number of bytes.

**Valid values:**
1500 (Ethernet default) or 9000 (jumbo). Below 1280 breaks IPv6.

**How it's used:**
NMState \`interfaces[].mtu\` for this interface.

**Important:**
⚠️ Jumbo frames must be enabled on every switch port and router on this interface's path, or large packets are dropped without any error.

**Example:**
9000 for a storage network`}
                      >
                        <input
                          value={iface.advanced?.mtu || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, mtu: e.target.value } })}
                          placeholder="1500"
                        />
                      </FieldLabelWithInfo>
                      <FieldLabelWithInfo
                        label="SR-IOV"
                        hint={`Enable SR-IOV virtual functions on this interface's NIC.

**What is this:**
Single Root I/O Virtualization splits one physical NIC into several virtual functions (VFs) that workloads can attach to directly, bypassing the host network stack.

**When it applies:**
Only on a NIC and a BIOS that support SR-IOV, with VT-d/IOMMU enabled in firmware.

**Format:**
A checkbox. Ticking it reveals **SR-IOV Total VFs**.

**Valid values:**
On or off. Off is correct unless workloads on this node need direct NIC access (typically CNF/DPDK).

**How it's used:**
Emits NMState \`interfaces[].ethernet.sr-iov.total-vfs\` for this interface.

**Important:**
⚠️ Enabling it without firmware support leaves the interface unable to come up. It is also not required merely to use the SR-IOV Network Operator later; this is the Day-1 NIC setting.

**Example:**
Off for a plain storage NIC`}
                      >
                        <input
                          type="checkbox"
                          checked={iface.advanced?.sriov?.enabled || false}
                          onChange={(e) =>
                            updateAdditionalInterface(selectedIndex, ifaceIndex, {
                              advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, enabled: e.target.checked } }
                            })
                          }
                        />
                      </FieldLabelWithInfo>
                      {iface.advanced?.sriov?.enabled && (
                        <FieldLabelWithInfo
                          label="SR-IOV Total VFs"
                          hint={`How many virtual functions to create on this NIC.

**What is this:**
The number of VFs the physical function is split into. Each VF can be assigned to a workload.

**When it applies:**
Only when SR-IOV above is enabled.

**Format:**
A whole number.

**Valid values:**
1 up to the maximum the NIC reports (commonly 8, 16, 32, 64 — check the adapter's datasheet). Asking for more than the NIC supports makes the configuration fail to apply.

**How it's used:**
NMState \`interfaces[].ethernet.sr-iov.total-vfs\`.

**Important:**
⚠️ VFs consume NIC resources whether used or not. Allocate what the workload actually needs rather than the maximum.

**Example:**
8`}
                        >
                          <input
                            value={iface.advanced?.sriov?.totalVfs || ""}
                            onChange={(e) =>
                              updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, totalVfs: e.target.value } }
                              })
                            }
                            placeholder="8"
                          />
                        </FieldLabelWithInfo>
                      )}
                      <FieldLabelWithInfo
                        label="VRF"
                        hint={`Put this interface in a Virtual Routing and Forwarding domain.

**What is this:**
A VRF is a separate routing table and interface group on the same host — traffic in one VRF cannot leak into another's routes.

**When it applies:**
Optional, and uncommon. Use it when this interface must have its own routing table, for example overlapping address space on a management network.

**Format:**
A checkbox. Ticking it reveals the VRF name, table ID and ports.

**Valid values:**
On or off.

**How it's used:**
Emits an extra NMState interface of type \`vrf\` with \`vrf.route-table-id\` and a \`vrf.port\` list.

**Important:**
⚠️ A VRF changes which routes apply to this interface. Routes in the main table (including this node's default route) do not apply inside the VRF.

**Example:**
Off, unless your network team asked for a VRF`}
                      >
                        <input
                          type="checkbox"
                          checked={iface.advanced?.vrf?.enabled || false}
                          onChange={(e) =>
                            updateAdditionalInterface(selectedIndex, ifaceIndex, {
                              advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, enabled: e.target.checked } }
                            })
                          }
                        />
                      </FieldLabelWithInfo>
                      {iface.advanced?.vrf?.enabled && (
                        <>
                          <FieldLabelWithInfo
                            label="VRF Name"
                            hint={`Name of the VRF device created for this interface.

**What is this:**
The Linux interface name of the VRF itself. It appears as its own interface in the generated nmstate.

**When it applies:**
Only when VRF above is enabled. It is then required.

**Format:**
Any Linux interface name, up to 15 characters.

**Valid values:**
A name not used by any other interface on this node — not an ethernet name, not a bond name, not a VLAN name. A collision is reported as a validation error.

**How it's used:**
NMState \`interfaces[].name\` of the \`vrf\` interface.

**Important:**
⚠️ Blank is rejected at generation, not just at validation: an enabled VRF with no name fails the whole host configuration.

**Example:**
vrf-mgmt`}
                          >
                            <input
                              value={iface.advanced?.vrf?.name || "vrf0"}
                              onChange={(e) =>
                                updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                  advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, name: e.target.value } }
                                })
                              }
                            />
                          </FieldLabelWithInfo>
                          <FieldLabelWithInfo
                            label="VRF Table ID"
                            hint={`Routing table number this VRF uses.

**What is this:**
The kernel routing table that holds routes for interfaces in this VRF.

**When it applies:**
Only when VRF is enabled. Required.

**Format:**
A whole number.

**Valid values:**
1 – 4294967295, but avoid the reserved tables: 253 (default), 254 (main — where this app writes ordinary routes) and 255 (local). Pick a distinct ID per VRF on the node.

**How it's used:**
NMState \`vrf.route-table-id\`.

**Important:**
⚠️ Reusing 254 merges the VRF with the main table and defeats the isolation you enabled the VRF for.

**Example:**
100`}
                          >
                            <input
                              value={iface.advanced?.vrf?.tableId || "100"}
                              onChange={(e) =>
                                updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                  advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, tableId: e.target.value } }
                                })
                              }
                            />
                          </FieldLabelWithInfo>
                          <FieldLabelWithInfo
                            label="VRF Ports (comma-separated)"
                            hint={`Which interfaces are enrolled in this VRF.

**What is this:**
The list of interfaces whose traffic uses the VRF's routing table.

**When it applies:**
Only when VRF is enabled. Optional.

**Format:**
Comma-separated interface names, exactly as they appear in the generated nmstate.

**Valid values:**
Names of interfaces defined on this node. Left blank it defaults to this row's own effective interface${resolveEffectiveInterfaceName(iface) ? ` (**${resolveEffectiveInterfaceName(iface)}**)` : ""}, which is the usual case.

**How it's used:**
NMState \`vrf.port\`.

**Important:**
⚠️ Naming an interface that does not exist on the node makes the host configuration invalid. For a VLAN row, the port is the VLAN device, not the bond underneath it.

**Example:**
${resolveEffectiveInterfaceName(iface) || "bond1.100"}`}
                          >
                            <input
                              value={iface.advanced?.vrf?.ports || ""}
                              onChange={(e) =>
                                updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                  advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, ports: e.target.value } }
                                })
                              }
                              placeholder={resolveEffectiveInterfaceName(iface)}
                            />
                          </FieldLabelWithInfo>
                        </>
                      )}
                    </div>
                    {/* Routes for THIS interface. Previously `advanced.routes`
                        here had no editor and no generator support, so imported
                        values were invisible and then discarded. */}
                    {typeof addAdditionalRoute === "function" && (
                      <RouteRows
                        routes={iface.advanced?.routes}
                        ownerInterfaceName={resolveEffectiveInterfaceName(iface)}
                        scopeLabel={`additional interface ${ifaceIndex + 1}`}
                        ipStackLabel={ipStackLabel}
                        onChange={(ri, patch) => updateAdditionalRoute(selectedIndex, ifaceIndex, ri, patch)}
                        onAdd={() => addAdditionalRoute(selectedIndex, ifaceIndex)}
                        onRemove={(ri) => removeAdditionalRoute(selectedIndex, ifaceIndex, ri)}
                      />
                    )}
                  </>
                ) : null}
              </section>
            ))}
            <button type="button" className="ghost" onClick={() => addAdditionalInterface(selectedIndex)}>
              Add Interface
            </button>
          </div>
        </>
      )}
    </>
  );
}
