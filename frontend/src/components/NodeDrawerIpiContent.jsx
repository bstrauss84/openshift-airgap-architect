/**
 * OpenShift Airgap Architect - Node Drawer IPI Content Component
 *
 * IPI scenario drawer content with visual grouping for Root Device Hints and BMC Configuration.
 * Extracted from HostInventoryV2Step.jsx for maintainability and cleaner separation of concerns.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import FieldLabelWithInfo from "./FieldLabelWithInfo.jsx";

export function NodeDrawerIpiContent({
  node,
  updateNode,
  selectedIndex,
  mergedNodeValidation,
  roleOptions,
  roleMeta,
  formatMACAsYouType,
  normalizeMAC,
  isDefaultHostname,
  getDefaultHostnameForRole,
  nodes
}) {
  // Extract field errors for inline display
  const fieldErrors = mergedNodeValidation[selectedIndex]?.fieldErrors || {};
  const ipError = fieldErrors["networkConfig.primaryInterface.ip"];
  const gatewayError = fieldErrors["networkConfig.primaryInterface.gateway"];

  return (
    <>
      <div className="host-inventory-v2-section-heading">
        <h4>Host (Bare metal IPI)</h4>
      </div>
      <p className="note subtle">
        These fields populate install-config <code>platform.baremetal.hosts[]</code>. Each host needs BMC and boot MAC for provisioning.
      </p>

      {/* Host Identity */}
      <div className="field-grid">
        <label>
          Role {roleMeta?.required ? <span className="required-marker" aria-label="required">*</span> : null}
          <select
            value={node.role}
            onChange={(e) => {
              const newRole = e.target.value;
              const patch = { role: newRole };
              if (isDefaultHostname(node)) {
                patch.hostname = getDefaultHostnameForRole(newRole, selectedIndex, nodes);
              }
              updateNode(selectedIndex, patch);
            }}
          >
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {fieldErrors.role && <span className="note warning inline">{fieldErrors.role}</span>}
        </label>
        <label>
          Hostname{" "}
          <input
            value={node.hostname || ""}
            onChange={(e) => updateNode(selectedIndex, { hostname: e.target.value })}
            placeholder="master-0 or worker-0"
            aria-required="true"
          />
        </label>
        <label className="host-inventory-v2-checkbox-label">
          <input
            type="checkbox"
            checked={!!node.hostnameUseFqdn}
            onChange={(e) => updateNode(selectedIndex, { hostnameUseFqdn: e.target.checked })}
            aria-label="Use FQDN for hostname"
          />
          {" "}Use FQDN (shortname.baseDomain)
        </label>
      </div>

      {/* Root Device Hints Group */}
      <div className="workflow-group">
        <div className="workflow-group-header">
          <div className="workflow-group-title">Root Device Hints</div>
          <div className="workflow-group-description">Optional constraints for boot device selection</div>
        </div>
        <p className="note subtle" style={{ margin: "8px 0" }}>
          Root device hints — <strong>all optional</strong>. Fill in one or more to identify the boot disk.{" "}
          OpenShift can evaluate multiple hints together; the selected disk must match <strong>all</strong> populated hints.{" "}
          If hints conflict, no disk will match and installation fails validation/runtime.{" "}
          If the host has only one disk, hints are usually unnecessary. These values are emitted to{" "}
          <code>agent-config.yaml hosts[].rootDeviceHints</code> and to{" "}
          <code>install-config.yaml platform.baremetal.hosts[].rootDeviceHints</code> for bare-metal IPI.
        </p>
        <div className="workflow-group-modes">
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
                value={node.rootDevice || ""}
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
                value={node.rootDeviceHintHctl || ""}
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
                value={node.rootDeviceHintModel || ""}
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
                value={node.rootDeviceHintVendor || ""}
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
                value={node.rootDeviceHintSerialNumber || ""}
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
                value={node.rootDeviceHintWwn || ""}
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
                value={node.rootDeviceHintMinSizeGb ?? ""}
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
                value={node.rootDeviceHintRotational ?? ""}
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

      <div className="divider" />

      {/* BMC Configuration Group */}
      <div className="workflow-group">
        <div className="workflow-group-header">
          <div className="workflow-group-title">
            <FieldLabelWithInfo
              label="Baseboard Management Controller (BMC)"
              hint={`Baseboard management controller for remote power/boot control.

**What is this:**
Out-of-band management interface (iDRAC, iLO, IPMI, Redfish)

**When required:**
**Required** for installer-provisioned (IPI) deployment

**Use case:**
Allows OpenShift installer to remotely boot and provision bare metal nodes`}
            />
          </div>
          <div className="workflow-group-description">Required for installer-provisioned (IPI) deployment</div>
        </div>
        <div className="workflow-group-modes">
          <div className="field-grid">
            <label>
              BMC address{" "}
              <input
                value={node.bmc?.address || ""}
                onChange={(e) => updateNode(selectedIndex, { bmc: { ...node.bmc, address: e.target.value } })}
                placeholder="redfish+http://192.168.1.1/..."
              />
            </label>

            <label>
              BMC username{" "}
              <input
                autoComplete="off"
                value={node.bmc?.username || ""}
                onChange={(e) => updateNode(selectedIndex, { bmc: { ...node.bmc, username: e.target.value } })}
              />
            </label>

            <label>
              BMC password{" "}
              <input
                type="password"
                autoComplete="new-password"
                value={node.bmc?.password || ""}
                onChange={(e) => updateNode(selectedIndex, { bmc: { ...node.bmc, password: e.target.value } })}
              />
            </label>

            <label>
              Boot MAC{" "}
              <input
                value={node.bmc?.bootMACAddress || ""}
                onChange={(e) => updateNode(selectedIndex, { bmc: { ...node.bmc, bootMACAddress: formatMACAsYouType(e.target.value) } })}
                onBlur={(e) => {
                  const v = normalizeMAC(e.target.value);
                  if (v && v !== e.target.value) {
                    updateNode(selectedIndex, { bmc: { ...node.bmc, bootMACAddress: v } });
                  }
                }}
                placeholder="52:54:00:aa:bb:cc"
              />
            </label>

            <label className="host-inventory-v2-checkbox-label">
              <input
                type="checkbox"
                checked={node.bmc?.disableCertificateVerification === true}
                onChange={(e) => updateNode(selectedIndex, { bmc: { ...node.bmc, disableCertificateVerification: e.target.checked } })}
              />
              {" "}Disable BMC certificate verification (e.g. self-signed)
            </label>
          </div>
        </div>
      </div>

      {/* Network Configuration Group */}
      <div className="divider" />
      <div className="workflow-group">
        <div className="workflow-group-header">
          <div className="workflow-group-title">
            <FieldLabelWithInfo
              label="Network Configuration (Static IP)"
              hint={`Optional static network configuration using NMState format.

**What is this:**
Defines static IP addresses, DNS servers, and routes for this node

**When needed:**
Required when DHCP is not available or static IPs are mandated by policy

**Alternative:**
Leave blank to use DHCP (simpler, recommended if available)

**Important:**
⚠️ Incorrect network config will prevent node from communicating`}
            />
          </div>
          <div className="workflow-group-description">
            Configure static IP addressing (optional)
          </div>
        </div>

        <div className="workflow-group-modes">
          <div className="field-grid">
            <label>
              Interface name
              <input
                value={node.networkConfig?.primaryInterface?.name || ""}
                onChange={(e) => updateNode(selectedIndex, {
                  networkConfig: {
                    ...node.networkConfig,
                    primaryInterface: {
                      ...node.networkConfig?.primaryInterface,
                      name: e.target.value
                    }
                  }
                })}
                placeholder="enp1s0"
              />
            </label>

            <label>
              IP Address (CIDR)
              <input
                value={node.networkConfig?.primaryInterface?.ip || ""}
                onChange={(e) => updateNode(selectedIndex, {
                  networkConfig: {
                    ...node.networkConfig,
                    primaryInterface: {
                      ...node.networkConfig?.primaryInterface,
                      ip: e.target.value
                    }
                  }
                })}
                placeholder="192.168.1.10/24"
                className={ipError ? "input-error" : ""}
                title={ipError || ""}
                aria-invalid={ipError ? "true" : "false"}
              />
              {ipError && <span className="note warning inline">{ipError}</span>}
            </label>

            <label>
              Gateway
              <input
                value={node.networkConfig?.primaryInterface?.gateway || ""}
                onChange={(e) => updateNode(selectedIndex, {
                  networkConfig: {
                    ...node.networkConfig,
                    primaryInterface: {
                      ...node.networkConfig?.primaryInterface,
                      gateway: e.target.value
                    }
                  }
                })}
                placeholder="192.168.1.1"
                className={gatewayError ? "input-error" : ""}
                title={gatewayError || ""}
                aria-invalid={gatewayError ? "true" : "false"}
              />
              {gatewayError && <span className="note warning inline">{gatewayError}</span>}
            </label>

            <label>
              DNS Servers (comma-separated)
              <input
                value={node.networkConfig?.primaryInterface?.dns || ""}
                onChange={(e) => updateNode(selectedIndex, {
                  networkConfig: {
                    ...node.networkConfig,
                    primaryInterface: {
                      ...node.networkConfig?.primaryInterface,
                      dns: e.target.value
                    }
                  }
                })}
                placeholder="8.8.8.8, 8.8.4.4"
              />
            </label>
          </div>
        </div>
      </div>
    </>
  );
}
