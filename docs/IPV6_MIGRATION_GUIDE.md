# IPv6-only Single-Stack Migration Guide (v1.3.0)

## Overview

Version 1.3.0 introduces IPv6-only single-stack support, enabling OpenShift deployments with IPv6 networking only (no IPv4). This guide covers the state schema migration and new capabilities.

## State Schema Change (v2 → v3)

### What Changed

**Before (v1.2.x):**
```json
{
  "hostInventory": {
    "enableIpv6": true
  }
}
```

**After (v1.3.0+):**
```json
{
  "hostInventory": {
    "ipStackMode": "dual-stack"
  }
}
```

### Migration Behavior

**Automatic Migration:** When you import a v1.2.x exported run into v1.3.0+, the state is automatically migrated:

- `enableIpv6: false` → `ipStackMode: 'ipv4'`
- `enableIpv6: true` → `ipStackMode: 'dual-stack'`
- Missing enableIpv6 → `ipStackMode: 'ipv4'` (default)

**No Action Required:** Users importing old exports don't need to manually update state.

### Backward Compatibility

The backend generation logic includes backward compatibility for test fixtures and edge cases:

```javascript
// Auto-detect dual-stack from IPv6 network presence
let ipStackMode = state.hostInventory?.ipStackMode;
if (!ipStackMode) {
  const hasIpv6Network = Boolean(networkingState.machineNetworkV6);
  ipStackMode = hasIpv6Network ? 'dual-stack' : 'ipv4';
}
```

This ensures old state objects without `ipStackMode` still generate correct YAML.

## New IP Stack Modes

### IPv4 Only (Default)
- **State:** `ipStackMode: 'ipv4'`
- **Networks:** IPv4 machine/cluster/service networks
- **VIPs:** IPv4 API VIP and Ingress VIP
- **Use case:** Traditional IPv4-only infrastructure

### IPv6 Only (NEW in v1.3.0)
- **State:** `ipStackMode: 'ipv6'`
- **Networks:** IPv6 machine/cluster/service networks (single entries, no IPv4)
- **VIPs:** IPv6 API VIP (apiVipV6) and Ingress VIP (ingressVipV6)
- **Use case:** IPv6-only infrastructure deployments
- **Platform support:** Bare Metal (all methods), vSphere (all methods)

### Dual-Stack
- **State:** `ipStackMode: 'dual-stack'`
- **Networks:** Both IPv4 and IPv6 networks (IPv4 first, then IPv6 in arrays)
- **VIPs:** Both IPv4 and IPv6 VIPs
- **Use case:** Mixed IPv4+IPv6 infrastructure
- **Equivalent to:** v1.2.x `enableIpv6: true`

## UI Changes

### Before (v1.2.x)
- Single "Enable IPv6" toggle
- Toggle ON → dual-stack (IPv4 + IPv6)
- Toggle OFF → IPv4-only

### After (v1.3.0+)
- **IP Stack Mode dropdown** with 3 options:
  - IPv4 only
  - IPv6 only (only shown for supported platforms)
  - Dual-stack (IPv4 + IPv6)

### Conditional Field Visibility

**IPv4-only mode:**
- Shows: Machine Network (IPv4 CIDR), Cluster Network CIDR, Service Network CIDR, API VIP, Ingress VIP
- Hides: All IPv6 fields

**IPv6-only mode:**
- Shows: Machine Network (IPv6 CIDR), Cluster Network IPv6 CIDR, Service Network IPv6 CIDR, API VIP (IPv6), Ingress VIP (IPv6)
- Hides: All IPv4 fields

**Dual-stack mode:**
- Shows: All fields with (IPv4) and (IPv6) labels
- Labels: "Machine Network (IPv4 CIDR)", "Machine Network (IPv6 CIDR)", etc.

## Platform Support

### Supported Platforms (IPv6-only mode available)
- ✅ Bare Metal Agent-Based Installer
- ✅ Bare Metal IPI
- ✅ Bare Metal UPI
- ✅ vSphere Agent-Based Installer
- ✅ vSphere IPI
- ✅ vSphere UPI

### Unsupported Platforms (IPv4-only enforced)
- ❌ AWS GovCloud IPI/UPI
- ❌ IBM Cloud IPI
- ⚠️ Nutanix IPI (dual-stack supported, IPv6-only needs verification)
- ⚠️ Azure Government IPI/UPI (not currently in codebase)

See `docs/IPV6_PLATFORM_SUPPORT_MATRIX.md` for detailed platform support matrix.

## Generated YAML Examples

### IPv4-only install-config.yaml
```yaml
networking:
  machineNetwork:
  - cidr: 10.90.0.0/24
  clusterNetwork:
  - cidr: 10.128.0.0/14
    hostPrefix: 23
  serviceNetwork:
  - 172.30.0.0/16
platform:
  baremetal:
    apiVIPs:
    - 10.90.0.2
    ingressVIPs:
    - 10.90.0.3
```

### IPv6-only install-config.yaml (NEW)
```yaml
networking:
  machineNetwork:
  - cidr: fd00::/48
  clusterNetwork:
  - cidr: fd01::/48
    hostPrefix: 64
  serviceNetwork:
  - fd02::/112
platform:
  baremetal:
    apiVIPs:
    - fd00::2
    ingressVIPs:
    - fd00::3
```

### Dual-stack install-config.yaml
```yaml
networking:
  machineNetwork:
  - cidr: 10.90.0.0/24
  - cidr: fd00::/48
  clusterNetwork:
  - cidr: 10.128.0.0/14
    hostPrefix: 23
  - cidr: fd01::/48
    hostPrefix: 64
  serviceNetwork:
  - 172.30.0.0/16
  - fd02::/112
platform:
  baremetal:
    apiVIPs:
    - 10.90.0.2
    - fd00::2
    ingressVIPs:
    - 10.90.0.3
    - fd00::3
```

## Validation Changes

### Mode-Specific Requirements

**IPv4-only mode:**
- REQUIRED: Machine Network (IPv4 CIDR), API VIP, Ingress VIP
- OPTIONAL: Cluster/Service Network CIDRs (use defaults if not set)
- BLOCKED: IPv6 machine network, IPv6 VIPs

**IPv6-only mode:**
- REQUIRED: Machine Network (IPv6 CIDR), API VIP (IPv6), Ingress VIP (IPv6)
- OPTIONAL: Cluster/Service Network IPv6 CIDRs (use defaults if not set)
- BLOCKED: IPv4 machine network, IPv4 VIPs

**Dual-stack mode:**
- REQUIRED: Both IPv4 and IPv6 machine networks, both IPv4 and IPv6 VIPs
- OPTIONAL: Cluster/Service Network CIDRs for both families

### Per-Node Validation

When configuring nodes with static IP addresses:
- IPv4-only: Nodes must have ipv4Cidr configured
- IPv6-only: Nodes must have ipv6Cidr configured
- Dual-stack: Nodes must have both ipv4Cidr and ipv6Cidr configured

## Testing Regression Coverage

### Automated Tests
- ✅ State schema migration (v2 → v3)
- ✅ IPv6-only install-config generation (single network entries)
- ✅ IPv6-only agent-config generation (nmstate with IPv4 disabled)
- ✅ IPv6-only VIP emission (single IPv6 VIP in array)
- ✅ Dual-stack backward compatibility (old state without ipStackMode)
- ✅ Platform-specific generation (bare metal, vSphere, Nutanix)

### Manual Verification Checklist
- [ ] Import v1.2.x export with enableIpv6=true → migrates to dual-stack
- [ ] Import v1.2.x export with enableIpv6=false → migrates to IPv4-only
- [ ] Select bare-metal-agent scenario → IPv6-only option available in dropdown
- [ ] Select aws-govcloud-ipi scenario → IPv6-only option NOT available
- [ ] Configure IPv6-only cluster → all IPv4 fields hidden
- [ ] YAML preview shows only IPv6 networks when in IPv6-only mode
- [ ] Download assets → generated install-config.yaml has single IPv6 network entries

## Breaking Changes

### None (Automatic Migration)

This is a **minor version bump (1.2.2 → 1.3.0)** because:
- State schema migration is automatic
- Existing exports from v1.2.x import cleanly into v1.3.0
- No user action required for existing workflows
- New capability (IPv6-only) is additive, not breaking

### API Consumers

If you're consuming exported state JSON programmatically:
- **Old field:** `hostInventory.enableIpv6` (boolean)
- **New field:** `hostInventory.ipStackMode` (enum: 'ipv4' | 'ipv6' | 'dual-stack')
- **Migration:** Check for both fields, prefer ipStackMode if present

## Known Limitations

### Secondary Interfaces
Tests for multiple bonds/VLANs on same node are currently skipped (marked TODO). Secondary interface support requires backend implementation.

### Asymmetric VIPs
Dual-stack with asymmetric VIPs (e.g., IPv4 Ingress only) is currently skipped in tests pending validation logic review.

### DHCP IPv6
Static IPv4 + DHCP IPv6 on same interface is currently skipped pending behavior verification.

### Custom Routes
IPv6 custom route generation is currently skipped pending field mapping verification.

## Troubleshooting

### "IPv6-only mode not available in dropdown"
**Cause:** Your selected scenario doesn't support IPv6-only mode.
**Solution:** IPv6-only is only available for bare-metal and vSphere scenarios. AWS GovCloud and IBM Cloud enforce IPv4-only.

### "Required for IPv6-only mode" validation error
**Cause:** Missing required IPv6 network configuration.
**Solution:** Ensure you've configured:
- Machine Network (IPv6 CIDR)
- API VIP (IPv6)
- Ingress VIP (IPv6)
- Optionally: Cluster Network IPv6 CIDR, Service Network IPv6 CIDR

### Imported run shows wrong IP stack mode
**Cause:** Old export didn't have ipStackMode field.
**Solution:** Re-export from v1.3.0+ to include ipStackMode in state. Migration is automatic on import.

## References

- **Platform Support Matrix:** `docs/IPV6_PLATFORM_SUPPORT_MATRIX.md`
- **Implementation Plan:** `.claude/plans/*.md` (IPv6-only implementation)
- **OpenShift Documentation:** IPv6-only networking supported since OpenShift 4.12+
- **Release Tag:** v1.3.0
- **Commit:** 70a4433

---

**Last Updated:** 2026-05-18
**Version:** 1.3.0
