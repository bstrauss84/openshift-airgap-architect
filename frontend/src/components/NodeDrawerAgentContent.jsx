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

const PRIMARY_TYPES = [
  { id: "ethernet", label: "Single NIC ethernet" },
  { id: "bond", label: "Bond (LACP or active-backup)" },
  { id: "vlan-on-ethernet", label: "VLAN on ethernet" },
  { id: "vlan-on-bond", label: "VLAN on bond" }
];

const BOND_MODES = ["active-backup", "802.3ad"];

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
  enableIpv6,
  effectiveHostname,
  showAgentDay2InstallConfigBmc,
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
  primaryBaseIface,
  suggestedVlanName,
  isDefaultHostname,
  getDefaultHostnameForRole,
  nodes
}) {
  const selectedNode = node;
  const isArbiterDrawer = (selectedNode?.role || "").trim() === "arbiter";

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
      </div>

      {/* Root Device Hints - hide for arbiter */}
      {selectedNode.role !== "arbiter" && (
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

**Format:**
host:channel:target:lun (four numbers separated by colons)

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

**How matching works:**
This hint can be a **substring** of the discovered value

**Examples:**
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

**Options:**
• false = non-rotational (SSD/NVMe)
• true = rotational (HDD, spinning media)
• Any = no preference

**Use case:**
Ensure OS is installed on SSD, not spinning disks`}
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
      <div className="workflow-group">
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
                      <label>
                        Interface
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
                      </label>
                      <label>
                        MAC address
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
                      </label>
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
                <label>
                  VLAN ID{" "}
                  <input
                    value={selectedNode.primary?.vlan?.id || ""}
                    onChange={(e) => updatePrimaryVlan(selectedIndex, { id: e.target.value })}
                    placeholder="100"
                  />
                </label>
                <label>
                  VLAN name{" "}
                  <input
                    value={selectedNode.primary?.vlan?.name || suggestedVlanName(primaryBaseIface(selectedNode), selectedNode.primary?.vlan?.id)}
                    onChange={(e) => updatePrimaryVlan(selectedIndex, { name: e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Static IP Config */}
          {selectedNode.primary?.mode === "static" && (
            <div className="workflow-group">
              <div className="workflow-group-header">
                <div className="workflow-group-title">Static IP Configuration</div>
              </div>
              <div className="workflow-group-modes">
                <div className="field-grid">
                  <label>
                    IPv4 CIDR{" "}
                    <input
                      value={selectedNode.primary?.ipv4Cidr || ""}
                      onChange={(e) => updatePrimary(selectedIndex, { ipv4Cidr: e.target.value.trim() })}
                      placeholder="192.168.1.20/24"
                      aria-required="true"
                    />
                  </label>
                  <label>
                    IPv4 gateway{" "}
                    <input
                      value={selectedNode.primary?.ipv4Gateway || ""}
                      onChange={(e) => updatePrimary(selectedIndex, { ipv4Gateway: e.target.value.trim() })}
                      aria-required="true"
                    />
                  </label>
                  {enableIpv6 && (
                    <>
                      <label>
                        IPv6 CIDR{" "}
                        <input
                          value={selectedNode.primary?.ipv6Cidr || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv6Cidr: e.target.value })}
                        />
                      </label>
                      <label>
                        IPv6 gateway{" "}
                        <input
                          value={selectedNode.primary?.ipv6Gateway || ""}
                          onChange={(e) => updatePrimary(selectedIndex, { ipv6Gateway: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DNS Configuration */}
      <div className="workflow-group">
        <div className="workflow-group-header">
          <div className="workflow-group-title">DNS Configuration</div>
        </div>
        <div className="workflow-group-modes">
          <div className="field-grid">
            <label>
              DNS servers{" "}
              <input
                value={selectedNode.dnsServers || ""}
                onChange={(e) => updateNode(selectedIndex, { dnsServers: e.target.value })}
                placeholder="192.168.1.10,192.168.1.11"
              />
            </label>
            <label>
              DNS search{" "}
              <input
                value={selectedNode.dnsSearch || ""}
                onChange={(e) => updateNode(selectedIndex, { dnsSearch: e.target.value })}
              />
            </label>
          </div>
        </div>
      </div>

      {/* BMC Configuration (Day-2 seed, optional) */}
      {showAgentDay2InstallConfigBmc && (
        <>
          <div className="divider" />
          <div className="workflow-group">
            <div className="workflow-group-header">
              <div className="workflow-group-title">BMC Configuration (Day-2 Seed)</div>
              <div className="workflow-group-description">
                Optional Day-2 seed (OpenShift 4.20 §9.1.4): these map to <code>install-config.yaml</code>{" "}
                <code>platform.baremetal.hosts[]</code> as <code>name</code>, <code>bootMACAddress</code>, and{" "}
                <code>bmc</code>. They are not used during initial agent provisioning; they can reduce post-install steps.
              </div>
            </div>
            <div className="workflow-group-modes">
              <div className="field-grid">
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
                <label className="host-inventory-v2-checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedNode.bmc?.disableCertificateVerification === true}
                    onChange={(e) => updateNode(selectedIndex, { bmc: { ...selectedNode.bmc, disableCertificateVerification: e.target.checked } })}
                  />
                  {" "}Disable BMC certificate verification (e.g. self-signed)
                </label>
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
      {showAdvancedDrawer && !isArbiterDrawer && (
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
            {advancedOpen && (
              <>
                <div className="field-grid">
                  <label>
                    MTU{" "}
                    <input
                      value={selectedNode.primary?.advanced?.mtu || ""}
                      onChange={(e) => updatePrimaryAdvanced(selectedIndex, { mtu: e.target.value })}
                      placeholder="1500"
                    />
                  </label>
                </div>
                <p className="note subtle host-inventory-v2-advanced-mtu-note" style={{ marginTop: 6, marginBottom: 0 }}>
                  One MTU value applies to the primary physical interface and any VLAN on that path (same value in generated nmstate). Default 1500. Each additional interface has its own Advanced section with its own MTU.
                </p>
                <div className="list">
                  <h4>
                    <FieldLabelWithInfo
                      label="Additional Routes"
                      hint={`Optional static routes beyond the default gateway.

**When to use:**
When nodes need to reach networks not covered by the default route

**Common scenarios:**
• Multiple subnets on the primary network
• Routes to storage networks
• Routes to management networks

**Example:**
Destination: 10.0.0.0/24, Next Hop: 192.168.1.1`}
                    />
                  </h4>
                  {(selectedNode.primary?.advanced?.routes || []).map((route, ri) => {
                    const baseIface = primaryBaseIface(selectedNode);
                    const vlanName = selectedNode.primary?.vlan?.name || suggestedVlanName(selectedNode.primary?.vlan?.baseIface || baseIface, selectedNode.primary?.vlan?.id);
                    return (
                      <div key={ri} className="field-grid">
                        <label>
                          Destination
                          <input
                            value={route.destination}
                            onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { destination: e.target.value })}
                            placeholder="10.0.0.0/24"
                          />
                        </label>
                        <label>
                          Next Hop Address
                          <input
                            value={route.nextHopAddress}
                            onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { nextHopAddress: e.target.value })}
                            placeholder="192.168.1.1"
                          />
                        </label>
                        <label>
                          Next Hop Interface (optional)
                          <input
                            value={route.nextHopInterface || ""}
                            onChange={(e) => updatePrimaryRoute(selectedIndex, ri, { nextHopInterface: e.target.value })}
                            placeholder={vlanName || baseIface}
                          />
                        </label>
                        <label>
                          Remove
                          <button type="button" className="ghost" onClick={() => removePrimaryRoute(selectedIndex, ri)}>
                            Remove Route
                          </button>
                        </label>
                      </div>
                    );
                  })}
                  <button type="button" className="ghost" onClick={() => addPrimaryRoute(selectedIndex)}>
                    Add Route
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Additional Interfaces - MOVED AFTER Advanced, hidden for arbiter */}
      {!isArbiterDrawer && (
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
                  <label>
                    Type
                    <select value={iface.type} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { type: e.target.value })}>
                      {PRIMARY_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    IP Assignment
                    <select value={iface.mode} onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { mode: e.target.value })}>
                      <option value="dhcp">DHCP</option>
                      <option value="static">Static</option>
                    </select>
                  </label>
                  {(iface.type === "ethernet" || iface.type === "vlan-on-ethernet") && (
                    <>
                      <label>
                        Ethernet Interface Name
                        <input
                          value={iface.ethernet?.name || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, name: e.target.value } })}
                          placeholder="eth2"
                        />
                      </label>
                      <label>
                        Ethernet MAC Address
                        <input
                          value={iface.ethernet?.macAddress || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: formatMACAsYouType(e.target.value) } })}
                          onBlur={(e) => {
                            const v = normalizeMAC(e.target.value);
                            if (v && v !== e.target.value) updateAdditionalInterface(selectedIndex, ifaceIndex, { ethernet: { ...iface.ethernet, macAddress: v } });
                          }}
                          placeholder="52:54:00:aa:11:03"
                        />
                      </label>
                    </>
                  )}
                  {(iface.type === "bond" || iface.type === "vlan-on-bond") && (
                    <>
                      <label>
                        Bond Name{" "}
                        <input
                          value={iface.bond?.name || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, name: e.target.value } })}
                        />
                      </label>
                      <label>
                        Bond Mode
                        <select
                          value={iface.bond?.mode || "active-backup"}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, mode: e.target.value } })}
                        >
                          {BOND_MODES.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      {(iface.bond?.slaves || []).map((slave, slaveIndex) => (
                        <React.Fragment key={`iface-${ifaceIndex}-slave-${slaveIndex}`}>
                          <label>
                            Bond Member Interface
                            <input
                              value={slave.name}
                              onChange={(e) => {
                                const next = (iface.bond?.slaves || []).map((entry, i) => (i === slaveIndex ? { ...entry, name: e.target.value } : entry));
                                updateAdditionalInterface(selectedIndex, ifaceIndex, { bond: { ...iface.bond, slaves: next } });
                              }}
                              placeholder={`eth${slaveIndex}`}
                            />
                          </label>
                          <label>
                            Bond Member MAC
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
                            />
                          </label>
                        </React.Fragment>
                      ))}
                    </>
                  )}
                  {(iface.type === "vlan-on-ethernet" || iface.type === "vlan-on-bond") && (
                    <>
                      <FieldLabelWithInfo
                        label="VLAN ID"
                        hint={`802.1Q VLAN tag for this interface.

**What is this:**
The numeric VLAN tag (1-4094)

**How it works:**
VLAN base interface is **derived from the selected interface** (ethernet or bond)

**Example:**
100`}
                      >
                        <input
                          value={iface.vlan?.id || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, id: e.target.value } })}
                        />
                      </FieldLabelWithInfo>
                      <label>
                        VLAN Interface Name (auto)
                        <input
                          value={iface.vlan?.name || suggestedVlanName(iface.vlan?.baseIface || iface.ethernet?.name || iface.bond?.name, iface.vlan?.id)}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { vlan: { ...iface.vlan, name: e.target.value } })}
                        />
                      </label>
                    </>
                  )}
                  {iface.mode === "static" && (
                    <>
                      <label>
                        IPv4 Address/CIDR
                        <input
                          value={iface.ipv4Cidr || ""}
                          onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv4Cidr: e.target.value.trim() })}
                        />
                      </label>
                      {enableIpv6 && (
                        <label>
                          IPv6 Address/CIDR
                          <input
                            value={iface.ipv6Cidr || ""}
                            onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { ipv6Cidr: e.target.value })}
                          />
                        </label>
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
                {additionalAdvancedOpen[ifaceIndex] ? (
                  <div className="field-grid">
                    <label>
                      MTU (optional)
                      <input
                        value={iface.advanced?.mtu || ""}
                        onChange={(e) => updateAdditionalInterface(selectedIndex, ifaceIndex, { advanced: { ...iface.advanced, mtu: e.target.value } })}
                        placeholder="1500"
                      />
                    </label>
                    <label>
                      SR-IOV
                      <input
                        type="checkbox"
                        checked={iface.advanced?.sriov?.enabled || false}
                        onChange={(e) =>
                          updateAdditionalInterface(selectedIndex, ifaceIndex, {
                            advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, enabled: e.target.checked } }
                          })
                        }
                      />
                    </label>
                    {iface.advanced?.sriov?.enabled && (
                      <label>
                        SR-IOV Total VFs
                        <input
                          value={iface.advanced?.sriov?.totalVfs || ""}
                          onChange={(e) =>
                            updateAdditionalInterface(selectedIndex, ifaceIndex, {
                              advanced: { ...iface.advanced, sriov: { ...iface.advanced?.sriov, totalVfs: e.target.value } }
                            })
                          }
                          placeholder="8"
                        />
                      </label>
                    )}
                    <label>
                      VRF
                      <input
                        type="checkbox"
                        checked={iface.advanced?.vrf?.enabled || false}
                        onChange={(e) =>
                          updateAdditionalInterface(selectedIndex, ifaceIndex, {
                            advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, enabled: e.target.checked } }
                          })
                        }
                      />
                    </label>
                    {iface.advanced?.vrf?.enabled && (
                      <>
                        <label>
                          VRF Name
                          <input
                            value={iface.advanced?.vrf?.name || "vrf0"}
                            onChange={(e) =>
                              updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, name: e.target.value } }
                              })
                            }
                          />
                        </label>
                        <label>
                          VRF Table ID
                          <input
                            value={iface.advanced?.vrf?.tableId || "100"}
                            onChange={(e) =>
                              updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, tableId: e.target.value } }
                              })
                            }
                          />
                        </label>
                        <label>
                          VRF Ports (comma-separated)
                          <input
                            value={iface.advanced?.vrf?.ports || ""}
                            onChange={(e) =>
                              updateAdditionalInterface(selectedIndex, ifaceIndex, {
                                advanced: { ...iface.advanced, vrf: { ...iface.advanced?.vrf, ports: e.target.value } }
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
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
