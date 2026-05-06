# Application State Schema

This document describes the complete structure of the application state object, which is stored in SQLite and tracks wizard progress and configuration.

**Storage:** SQLite table `app_state`, column `state_json` (JSON blob)

**Access:** 
- `GET /api/state` - Retrieve current state
- `POST /api/state` - Update state (partial merge)

---

## Table of Contents

- [Overview](#overview)
- [Top-Level Structure](#top-level-structure)
- [Blueprint](#blueprint)
- [Methodology](#methodology)
- [Version/Release](#versionrelease)
- [Global Strategy](#global-strategy)
- [Host Inventory](#host-inventory)
- [Credentials](#credentials)
- [Trust & Certificates](#trust--certificates)
- [Platform Config](#platform-config)
- [Export Options](#export-options)
- [oc-mirror Config](#oc-mirror-config)
- [Operators](#operators)
- [Ephemeral Fields](#ephemeral-fields)
- [State Evolution](#state-evolution)
- [Validation Rules](#validation-rules)

---

## Overview

The application state is a **single JSON object** that represents the complete wizard configuration. It is:

- **Persistent:** Stored in SQLite, survives server restarts
- **Partial Update:** Frontend sends delta updates, backend deep-merges
- **Versioned:** Can be exported/imported as JSON
- **Validated:** Validation happens on frontend before submission and on backend generation

**Design Principle:** State follows wizard flow - fields are populated as user progresses through steps.

---

## Top-Level Structure

```json
{
  "blueprint": { ... },
  "methodology": { ... },
  "version": { ... },
  "release": { ... },
  "globalStrategy": { ... },
  "hostInventory": { ... },
  "credentials": { ... },
  "trust": { ... },
  "platformConfig": { ... },
  "exportOptions": { ... },
  "ocMirrorConfig": { ... },
  "operators": { ... }
}
```

### Key Characteristics

- **Optional Fields:** All top-level keys are optional (wizard may be incomplete)
- **No Schema Version:** Currently no explicit versioning (implicit via field presence)
- **Flat Hierarchy:** Most nesting is 2-3 levels deep
- **No Arrays at Top Level:** All top-level values are objects

---

## Blueprint

Core cluster identity and platform selection.

**Step:** Blueprint (Core Lock-In)

```json
{
  "blueprint": {
    "platform": "Bare Metal",
    "arch": "x86_64",
    "baseDomain": "example.com",
    "clusterName": "my-cluster",
    "version": "4.20.1",
    "blueprintPullSecretEphemeral": "{\"auths\":{...}}",
    "confirmed": true,
    "confirmationTimestamp": 1714569600000
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Installation platform |
| `arch` | string | Yes | CPU architecture |
| `baseDomain` | string | Yes | DNS base domain |
| `clusterName` | string | Yes | Cluster name (DNS-safe) |
| `version` | string | Yes | OpenShift version (e.g., "4.20.1") |
| `blueprintPullSecretEphemeral` | string | No | Pull secret (ephemeral, not exported) |
| `confirmed` | boolean | No | Whether blueprint is locked |
| `confirmationTimestamp` | number | No | Unix timestamp of lock |

### Allowed Values

**`platform`:**
- `"Bare Metal"`
- `"VMware vSphere"`
- `"Nutanix"`
- `"AWS GovCloud"`
- `"Azure Government"`
- `"IBM Cloud"`

**`arch`:**
- `"x86_64"` (Intel/AMD)
- `"aarch64"` (ARM64)
- `"ppc64le"` (IBM Power)
- `"s390x"` (IBM Z)

**Architecture Support by Platform:**
- Bare Metal: all architectures
- VMware vSphere: x86_64, aarch64
- Nutanix: x86_64 only
- AWS GovCloud: x86_64, aarch64
- Azure Government: x86_64 only
- IBM Cloud: x86_64 only

**`version`:** Semantic version string from Cincinnati (e.g., "4.20.0", "4.20.1")

### Validation

- `clusterName` must be DNS-safe (lowercase, alphanumeric, hyphens)
- `baseDomain` must be valid DNS domain
- `arch` must be supported by selected `platform`
- `version` must be confirmed before proceeding
- `blueprintPullSecretEphemeral` validated if present (optional field)

---

## Methodology

Installation method selection.

**Step:** Methodology (Install Method)

```json
{
  "methodology": {
    "method": "Agent-Based Installer",
    "fips": false,
    "placeholderValuesEnabled": false
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | Installation method |
| `fips` | boolean | No | Enable FIPS mode |
| `placeholderValuesEnabled` | boolean | No | Use placeholder values for sensitive fields (Bare Metal only) |

### Allowed Values

**`method`:**
- `"IPI"` (Installer-Provisioned Infrastructure)
- `"UPI"` (User-Provisioned Infrastructure)
- `"Agent-Based Installer"` (Bare Metal, vSphere only)

**Method Availability by Platform:**
- Bare Metal: IPI, UPI, Agent-Based Installer
- VMware vSphere: IPI, UPI, Agent-Based Installer
- Nutanix: IPI only
- AWS GovCloud: IPI, UPI
- Azure Government: IPI, UPI
- IBM Cloud: IPI only

### Validation

- `method` must be supported by selected platform
- `placeholderValuesEnabled` only applicable to Bare Metal

---

## Version/Release

OpenShift version selection and confirmation.

**Step:** Blueprint (integrated into Core Lock-In)

```json
{
  "version": {
    "selectedVersion": "4.20.1",
    "selectedChannel": "4.20",
    "versionConfirmed": true,
    "confirmationTimestamp": 1714569600000,
    "manualMinor": "",
    "manualPatch": ""
  },
  "release": {
    "channel": "4.20",
    "patchVersion": "4.20.1",
    "confirmed": true,
    "confirmationTimestamp": 1714569600000
  }
}
```

### Fields

**`version` (new schema):**
| Field | Type | Description |
|-------|------|-------------|
| `selectedVersion` | string | Chosen patch version |
| `selectedChannel` | string | Release channel |
| `versionConfirmed` | boolean | User confirmed selection |
| `confirmationTimestamp` | number | When confirmed (Unix ms) |
| `manualMinor` | string | Manual minor version override |
| `manualPatch` | string | Manual patch version override |

**`release` (legacy schema - still supported):**
| Field | Type | Description |
|-------|------|-------------|
| `channel` | string | Release channel (e.g., "4.20") |
| `patchVersion` | string | Full version (e.g., "4.20.1") |
| `confirmed` | boolean | User confirmed |
| `confirmationTimestamp` | number | When confirmed |

### Notes

- `version` and `release` coexist for backward compatibility
- Validation checks both `version.versionConfirmed` and `release.confirmed`
- Manual version entry bypasses Cincinnati validation

---

## Global Strategy

Networking, cluster identity, mirroring, and proxy configuration.

**Steps:** Identity & Access, Networking, Connectivity & Mirroring, Trust & Proxy

```json
{
  "globalStrategy": {
    "clusterIdentity": { ... },
    "networking": { ... },
    "mirroring": { ... },
    "proxy": { ... }
  }
}
```

### Cluster Identity

```json
{
  "clusterIdentity": {
    "clusterName": "my-cluster",
    "baseDomain": "example.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clusterName` | string | Yes | Cluster name (duplicated from blueprint) |
| `baseDomain` | string | Yes | Base domain (duplicated from blueprint) |

**Note:** These fields duplicate `blueprint.clusterName` and `blueprint.baseDomain` for segmented flow compatibility.

### Networking

```json
{
  "networking": {
    "machineNetworkV4": "10.0.0.0/16",
    "machineNetworkV6": "fd00::/48",
    "clusterNetworkCidr": "10.128.0.0/14",
    "clusterNetworkCidrV6": "fd01::/48",
    "clusterNetworkHostPrefix": 23,
    "clusterNetworkHostPrefixV6": 64,
    "serviceNetworkCidr": "172.30.0.0/16",
    "serviceNetworkCidrV6": "fd02::/112",
    "ovnInternalJoinSubnet": "100.64.0.0/16"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `machineNetworkV4` | string | Yes | Machine network CIDR (IPv4) |
| `machineNetworkV6` | string | No | Machine network CIDR (IPv6, dual-stack) |
| `clusterNetworkCidr` | string | Yes | Pod network CIDR (IPv4) |
| `clusterNetworkCidrV6` | string | No | Pod network CIDR (IPv6) |
| `clusterNetworkHostPrefix` | number | Yes | Pod subnet prefix length (IPv4) |
| `clusterNetworkHostPrefixV6` | number | No | Pod subnet prefix length (IPv6) |
| `serviceNetworkCidr` | string | Yes | Service network CIDR (IPv4) |
| `serviceNetworkCidrV6` | string | No | Service network CIDR (IPv6) |
| `ovnInternalJoinSubnet` | string | No | OVN internal subnet (IPv4 only) |

**Defaults:**
- `machineNetworkV4`: `"10.0.0.0/16"` (varies by platform)
- `clusterNetworkCidr`: `"10.128.0.0/14"`
- `clusterNetworkHostPrefix`: `23`
- `serviceNetworkCidr`: `"172.30.0.0/16"`
- `ovnInternalJoinSubnet`: `"100.64.0.0/16"`

**Dual-Stack:**
- If `machineNetworkV6` is set, cluster operates in dual-stack mode
- IPv6 fields required when dual-stack enabled
- AWS GovCloud and IBM Cloud do not support dual-stack (4.20)

**Validation:**
- All CIDRs must be valid network addresses (not host addresses)
- No overlaps between machine, cluster, and service networks
- IPv4 and IPv6 networks validated independently

### Mirroring

```json
{
  "mirroring": {
    "registryFqdn": "mirror.example.com:5000",
    "sources": [
      {
        "source": "quay.io/openshift-release-dev/ocp-release",
        "mirrors": ["mirror.example.com:5000/openshift/release"]
      }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `registryFqdn` | string | No | Disconnected registry hostname:port |
| `sources` | array | No | ImageContentSourcePolicy mappings |

**`sources[]` Structure:**
| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Upstream registry/repository |
| `mirrors` | array of strings | Mirror registry/repository paths |

**OpenShift Version Support:**
- OCP 4.20+: Uses `imageDigestSources` in install-config.yaml
- OCP 4.14-4.19: Uses deprecated `imageContentSources`

### Proxy

```json
{
  "proxy": {
    "httpProxy": "http://proxy.corp.example:8080",
    "httpsProxy": "http://proxy.corp.example:8080",
    "noProxy": "localhost,127.0.0.1,.cluster.local"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `httpProxy` | string | No | HTTP proxy URL |
| `httpsProxy` | string | No | HTTPS proxy URL |
| `noProxy` | string | No | Comma-separated bypass list |

**Notes:**
- These settings apply to the **OpenShift cluster**, not the wizard application
- Application proxy configured via environment variables (see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md))

---

## Host Inventory

Node definitions for bare metal and vSphere deployments.

**Step:** Hosts Inventory (Host Inventory V2)

```json
{
  "hostInventory": {
    "enableIpv6": false,
    "apiVip": "10.0.0.10",
    "apiVipV6": "fd00::10",
    "ingressVip": "10.0.0.11",
    "ingressVipV6": "fd00::11",
    "provisioningNetwork": "Managed",
    "provisioningNetworkCIDR": "172.22.0.0/24",
    "provisioningNetworkInterface": "eno2",
    "clusterProvisioningIP": "172.22.0.3",
    "nodes": [ ... ]
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enableIpv6` | boolean | No | Enable dual-stack networking |
| `apiVip` | string | No | API VIP (IPv4) |
| `apiVipV6` | string | No | API VIP (IPv6) |
| `ingressVip` | string | No | Ingress VIP (IPv4) |
| `ingressVipV6` | string | No | Ingress VIP (IPv6) |
| `provisioningNetwork` | string | No | Provisioning network mode (Bare Metal IPI only) |
| `provisioningNetworkCIDR` | string | No | Provisioning network CIDR |
| `provisioningNetworkInterface` | string | No | Provisioning interface name |
| `clusterProvisioningIP` | string | No | Cluster provisioning IP |
| `nodes` | array | No | Host definitions |

**`provisioningNetwork` Values:**
- `"Managed"` - Installer manages provisioning network
- `"Unmanaged"` - User manages provisioning network
- `"Disabled"` - No provisioning network

### Node Structure

```json
{
  "nodes": [
    {
      "hostname": "master-0",
      "role": "master",
      "rootDevice": "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
      "bmc": {
        "address": "redfish-virtualmedia://192.168.1.100:443/redfish/v1/Systems/1",
        "username": "admin",
        "password": "password",
        "bootMACAddress": "00:11:22:33:44:55"
      },
      "primary": {
        "type": "ethernet",
        "mode": "dhcp",
        "ethernet": {
          "name": "eno1",
          "macAddress": "00:11:22:33:44:56"
        }
      },
      "additionalInterfaces": [
        {
          "type": "bond",
          "mode": "static",
          "bond": {
            "name": "bond0",
            "mode": "active-backup",
            "slaves": [
              { "name": "eno2", "macAddress": "00:11:22:33:44:57" },
              { "name": "eno3", "macAddress": "00:11:22:33:44:58" }
            ]
          },
          "ipv4Cidr": "192.168.100.10/24"
        }
      ]
    }
  ]
}
```

### Node Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hostname` | string | Yes | Node hostname |
| `role` | string | Yes | Node role |
| `rootDevice` | string | No | Root device hint (by-path preferred) |
| `bmc` | object | No | BMC configuration (Bare Metal IPI only) |
| `primary` | object | Yes | Primary network interface |
| `additionalInterfaces` | array | No | Additional network interfaces |

**`role` Values:**
- `"master"` - Control plane node
- `"worker"` - Compute node
- `"arbiter"` - Arbiter node (compact HA: 2 masters + 1 arbiter)

### BMC Structure (Bare Metal IPI)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string | Yes | BMC URL (redfish, idrac, ilo, etc.) |
| `username` | string | Yes* | BMC username |
| `password` | string | Yes* | BMC password |
| `bootMACAddress` | string | Yes | Boot interface MAC address |

*Required when `exportOptions.includeCredentials` is true

### Primary/Additional Interface Structure

**Common Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Interface type |
| `mode` | string | IP assignment mode |

**`type` Values:**
- `"ethernet"` - Single Ethernet interface
- `"bond"` - Link aggregation (bonding)
- `"vlan-on-ethernet"` - VLAN on Ethernet
- `"vlan-on-bond"` - VLAN on bond

**`mode` Values:**
- `"dhcp"` - DHCP IP assignment
- `"static"` - Static IP configuration

### Ethernet Interface

```json
{
  "type": "ethernet",
  "mode": "static",
  "ethernet": {
    "name": "eno1",
    "macAddress": "00:11:22:33:44:55"
  },
  "ipv4Cidr": "10.0.0.10/24",
  "ipv4Gateway": "10.0.0.1",
  "ipv6Cidr": "fd00::10/64",
  "ipv6Gateway": "fd00::1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ethernet.name` | string | Yes | Interface name |
| `ethernet.macAddress` | string | Yes | MAC address |
| `ipv4Cidr` | string | Yes* | IPv4 address/prefix (static mode) |
| `ipv4Gateway` | string | Yes* | IPv4 gateway (static mode) |
| `ipv6Cidr` | string | No | IPv6 address/prefix (static + dual-stack) |
| `ipv6Gateway` | string | No | IPv6 gateway (static + dual-stack) |

*Required when `mode === "static"`

### Bond Interface

```json
{
  "type": "bond",
  "mode": "dhcp",
  "bond": {
    "name": "bond0",
    "mode": "active-backup",
    "slaves": [
      { "name": "eno2", "macAddress": "00:11:22:33:44:57" },
      { "name": "eno3", "macAddress": "00:11:22:33:44:58" }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bond.name` | string | Yes | Bond interface name |
| `bond.mode` | string | Yes | Bonding mode |
| `bond.slaves` | array | Yes | Member interfaces (min 2) |
| `bond.slaves[].name` | string | Yes | Slave interface name |
| `bond.slaves[].macAddress` | string | Yes | Slave MAC address |

**`bond.mode` Values:**
- `"active-backup"` (mode 1)
- `"balance-rr"` (mode 0)
- `"balance-xor"` (mode 2)
- `"broadcast"` (mode 3)
- `"802.3ad"` (mode 4, LACP)
- `"balance-tlb"` (mode 5)
- `"balance-alb"` (mode 6)

**Validation:**
- Minimum 2 slaves required for bond
- All slave MACs must be unique

### VLAN Interface

```json
{
  "type": "vlan-on-ethernet",
  "mode": "dhcp",
  "ethernet": {
    "name": "eno1",
    "macAddress": "00:11:22:33:44:55"
  },
  "vlan": {
    "id": 100,
    "baseIface": "eno1"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vlan.id` | number | Yes | VLAN ID (1-4094) |
| `vlan.baseIface` | string | No* | Base interface name |

*Auto-derived from `ethernet.name` or `bond.name` if not provided

---

## Credentials

SSH and pull secret credentials.

**Step:** Identity & Access, Connectivity & Mirroring

```json
{
  "credentials": {
    "sshPublicKey": "ssh-ed25519 AAAAC3... user@host",
    "pullSecretPlaceholder": "{\"auths\":{...}}",
    "usingMirrorRegistry": true,
    "mirrorRegistryUnauthenticated": false,
    "mirrorRegistryPullSecret": "{\"auths\":{...}}"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sshPublicKey` | string | Yes* | SSH public key for node access |
| `pullSecretPlaceholder` | string | No | Red Hat pull secret (connected) |
| `usingMirrorRegistry` | boolean | No | Using disconnected mirror registry |
| `mirrorRegistryUnauthenticated` | boolean | No | Mirror allows anonymous pulls |
| `mirrorRegistryPullSecret` | string | No | Mirror registry auth (if not unauthenticated) |

*Required for most installations (warning if missing)

**Notes:**
- `pullSecretPlaceholder` used for connected installs
- `mirrorRegistryPullSecret` used for disconnected installs
- If `mirrorRegistryUnauthenticated` is true, backend injects dummy auth

---

## Trust & Certificates

CA certificates for mirror registries and proxies.

**Step:** Trust & Proxy

```json
{
  "trust": {
    "mirrorRegistryUsesPrivateCa": true,
    "mirrorRegistryCaPem": "-----BEGIN CERTIFICATE-----\n...",
    "proxyCaPem": "-----BEGIN CERTIFICATE-----\n...",
    "additionalTrustBundlePolicy": "Proxyonly"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mirrorRegistryUsesPrivateCa` | boolean | No | Mirror uses private/self-signed CA |
| `mirrorRegistryCaPem` | string | No | Mirror registry CA bundle (PEM) |
| `proxyCaPem` | string | No | Proxy CA bundle (PEM) |
| `additionalTrustBundlePolicy` | string | No | Trust bundle policy |

**`additionalTrustBundlePolicy` Values:**
- `"Proxyonly"` - Trust bundle applies to proxy connections only
- `"Always"` - Trust bundle applies to all connections

**Validation:**
- If `mirrorRegistryUsesPrivateCa` is true, `mirrorRegistryCaPem` is required
- If any CA bundle provided, `additionalTrustBundlePolicy` is required
- Policy must be supported by selected OpenShift version

**OpenShift Version Support:**
- OCP 4.17+: Supports `additionalTrustBundlePolicy`
- OCP 4.14-4.16: Does not support policy (trust bundle always applied)

---

## Platform Config

Platform-specific configuration options.

**Step:** Platform Specifics

### AWS GovCloud

```json
{
  "platformConfig": {
    "aws": {
      "region": "us-gov-west-1"
    },
    "controlPlaneReplicas": 3,
    "computeReplicas": 3
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `aws.region` | string | Yes | AWS GovCloud region |
| `controlPlaneReplicas` | number | No | Control plane node count (IPI) |
| `computeReplicas` | number | No | Compute node count (IPI) |

### VMware vSphere

```json
{
  "platformConfig": {
    "vsphere": {
      "placementMode": "legacy",
      "vcenter": "vcenter.example.com",
      "datacenter": "DC1",
      "cluster": "Cluster1",
      "datastore": "datastore1",
      "network": "VM Network",
      "failureDomains": [
        {
          "name": "fd-west",
          "vcenter": "vcenter.example.com",
          "datacenter": "DC1",
          "computeCluster": "Cluster1",
          "datastore": "datastore1",
          "network": "VM Network"
        }
      ]
    }
  }
}
```

**Legacy Placement (IPI):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vsphere.placementMode` | string | Yes | `"legacy"` or `"failureDomains"` |
| `vsphere.vcenter` | string | Yes | vCenter hostname |
| `vsphere.datacenter` | string | Yes | Datacenter name |
| `vsphere.cluster` | string | Yes | Compute cluster |
| `vsphere.datastore` | string | Yes | Datastore |
| `vsphere.network` | string | Yes | VM Network |

**Failure Domains (IPI, OCP 4.16+):**
| Field | Type | Description |
|-------|------|-------------|
| `vsphere.failureDomains` | array | Failure domain definitions |
| `vsphere.failureDomains[].name` | string | Failure domain name |
| `vsphere.failureDomains[].vcenter` | string | vCenter for this FD |
| `vsphere.failureDomains[].datacenter` | string | Datacenter for this FD |
| `vsphere.failureDomains[].computeCluster` | string | Cluster for this FD |
| `vsphere.failureDomains[].datastore` | string | Datastore for this FD |
| `vsphere.failureDomains[].network` | string | Network for this FD |

### Nutanix

```json
{
  "platformConfig": {
    "nutanix": {
      "prismCentral": "prism.example.com",
      "port": 9440,
      "username": "admin",
      "password": "password",
      "prismElements": [
        {
          "name": "PE1",
          "endpoint": "10.0.0.100"
        }
      ],
      "subnetUuids": [
        "uuid-1234-5678-90ab"
      ]
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `nutanix.prismCentral` | string | Yes | Prism Central hostname |
| `nutanix.port` | number | Yes | Prism Central port |
| `nutanix.username` | string | Yes* | Prism Central username |
| `nutanix.password` | string | Yes* | Prism Central password |
| `nutanix.prismElements` | array | Yes | Prism Element clusters |
| `nutanix.subnetUuids` | array | Yes | Subnet UUIDs |

*Required when `exportOptions.includeCredentials` is true

### Azure Government

```json
{
  "platformConfig": {
    "azure": {
      "cloudName": "AzureUSGovernmentCloud",
      "region": "usgovvirginia"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `azure.cloudName` | string | Yes | `"AzureUSGovernmentCloud"` |
| `azure.region` | string | Yes | Azure Government region |

### IBM Cloud

```json
{
  "platformConfig": {
    "ibmcloud": {
      "region": "us-south"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ibmcloud.region` | string | Yes | IBM Cloud region |

---

## Export Options

Bundle generation and export preferences.

**Step:** Export & Download

```json
{
  "exportOptions": {
    "includeCredentials": true,
    "includeFieldGuide": true,
    "draftMode": false
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `includeCredentials` | boolean | No | Include credentials in export |
| `includeFieldGuide` | boolean | No | Generate PDF field guide |
| `draftMode` | boolean | No | Mark export as draft (watermark) |

**Notes:**
- `includeCredentials === false`: BMC passwords, Nutanix credentials omitted from export
- `includeFieldGuide`: Requires cached documentation for offline rendering
- `draftMode`: Adds "DRAFT" watermark to generated configs

---

## oc-mirror Config

ImageSetConfiguration for oc-mirror operations.

**Step:** Run oc-mirror

```json
{
  "ocMirrorConfig": {
    "imageSetConfigYaml": "...",
    "lastJobId": "abc123",
    "lastRunTimestamp": 1714569600000
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `imageSetConfigYaml` | string | ImageSetConfiguration YAML content |
| `lastJobId` | string | Last oc-mirror job ID |
| `lastRunTimestamp` | number | Unix timestamp of last run |

**Notes:**
- `imageSetConfigYaml` generated by wizard based on state
- Job tracking allows resuming/monitoring long-running mirrors

---

## Operators

Operator catalog scan results.

**Step:** Operators

```json
{
  "operators": {
    "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.20",
    "scannedAt": 1714569600000,
    "operators": [
      {
        "name": "advanced-cluster-management",
        "displayName": "Advanced Cluster Management",
        "defaultChannel": "release-2.11"
      }
    ],
    "selectedOperators": [
      {
        "name": "advanced-cluster-management",
        "channel": "release-2.11",
        "packages": ["advanced-cluster-management"]
      }
    ]
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `catalog` | string | Scanned catalog image reference |
| `scannedAt` | number | Unix timestamp of scan |
| `operators` | array | Available operators from scan |
| `selectedOperators` | array | User-selected operators |

**`operators[]` Structure:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Operator package name |
| `displayName` | string | Human-readable name |
| `defaultChannel` | string | Default update channel |

**`selectedOperators[]` Structure:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Operator package name |
| `channel` | string | Selected update channel |
| `packages` | array | Package names to mirror |

---

## Ephemeral Fields

Fields that are **not persisted** or **cleared on export**.

### Not Exported

- `blueprint.blueprintPullSecretEphemeral` - Temporary pull secret (security)
- `operators.operators` - Full catalog scan results (too large, can be re-scanned)

### Cleared on Duplicate

When duplicating a run (`POST /api/run/duplicate`), these fields are reset:
- `ocMirrorConfig.lastJobId`
- `ocMirrorConfig.lastRunTimestamp`
- `operators.scannedAt`
- `blueprint.confirmed`
- `blueprint.confirmationTimestamp`
- `version.versionConfirmed`
- `version.confirmationTimestamp`
- `release.confirmed`
- `release.confirmationTimestamp`

---

## State Evolution

### Version History

**Current:** No explicit version field (implicit v1)

**Future Versioning (Proposed):**
```json
{
  "_version": "2",
  "blueprint": { ... }
}
```

### Migration Strategy

- **Backward Compatibility:** Frontend tolerates missing fields (uses defaults)
- **Forward Compatibility:** Unknown fields ignored by validation
- **Breaking Changes:** Require migration function on state load

### Known Schema Changes

1. **Release → Version:** Added `version` object, maintained `release` for compatibility
2. **Segmented Flow:** Added `globalStrategy.clusterIdentity` (duplicates blueprint fields)
3. **Dual-Stack IPv6:** Added `*V6` network fields, `enableIpv6` flags

---

## Validation Rules

### Cross-Field Validation

**Network Overlaps:**
- `machineNetworkV4` must not overlap `clusterNetworkCidr`
- `machineNetworkV4` must not overlap `serviceNetworkCidr`
- `clusterNetworkCidr` must not overlap `serviceNetworkCidr`
- Same for IPv6 networks

**Host Inventory:**
- API/Ingress VIPs must be within `machineNetworkV4`
- If `enableIpv6`, IPv6 VIPs must be within `machineNetworkV6`
- Total node count must match topology (SNO: 1 master, 0 worker; HA: 3+ masters)

**Credentials:**
- If `usingMirrorRegistry` and not `mirrorRegistryUnauthenticated`, require `mirrorRegistryPullSecret`
- If not `usingMirrorRegistry`, require `pullSecretPlaceholder`

### Platform-Specific Validation

**Bare Metal Agent:**
- Node count: SNO (1 master), Compact HA (2 masters + 1 arbiter), HA (3 masters)
- Arbiter nodes: only in Compact HA topology

**Bare Metal IPI:**
- BMC configuration required for all nodes
- Boot MAC address required

**VMware vSphere:**
- IPI: Requires platform config (vcenter, datacenter, etc.)
- Agent: Requires host inventory

**Nutanix:**
- IPI only
- Requires Prism Central credentials

---

## State Size Considerations

**Typical State Size:** 50-500 KB

**Large State Triggers:**
- Many host inventory nodes (20+)
- Large pull secrets
- Extensive operator selections
- Multiple CA bundles

**SQLite Limits:**
- Maximum JSON blob size: Effectively unlimited (SQLite supports up to 1 GB)
- Practical limit: Keep under 10 MB for performance

---

## Example Complete State

```json
{
  "blueprint": {
    "platform": "Bare Metal",
    "arch": "x86_64",
    "baseDomain": "example.com",
    "clusterName": "prod-cluster",
    "version": "4.20.1",
    "confirmed": true,
    "confirmationTimestamp": 1714569600000
  },
  "methodology": {
    "method": "Agent-Based Installer",
    "fips": false
  },
  "version": {
    "selectedVersion": "4.20.1",
    "selectedChannel": "4.20",
    "versionConfirmed": true
  },
  "globalStrategy": {
    "networking": {
      "machineNetworkV4": "10.0.0.0/16",
      "clusterNetworkCidr": "10.128.0.0/14",
      "clusterNetworkHostPrefix": 23,
      "serviceNetworkCidr": "172.30.0.0/16"
    },
    "mirroring": {
      "registryFqdn": "mirror.example.com:5000"
    }
  },
  "hostInventory": {
    "apiVip": "10.0.0.10",
    "ingressVip": "10.0.0.11",
    "nodes": [
      {
        "hostname": "master-0",
        "role": "master",
        "rootDevice": "/dev/sda",
        "primary": {
          "type": "ethernet",
          "mode": "static",
          "ethernet": {
            "name": "eno1",
            "macAddress": "00:11:22:33:44:55"
          },
          "ipv4Cidr": "10.0.0.100/16",
          "ipv4Gateway": "10.0.0.1"
        }
      }
    ]
  },
  "credentials": {
    "sshPublicKey": "ssh-ed25519 AAAAC3... user@host",
    "usingMirrorRegistry": true,
    "mirrorRegistryPullSecret": "{\"auths\":{...}}"
  },
  "trust": {
    "mirrorRegistryUsesPrivateCa": true,
    "mirrorRegistryCaPem": "-----BEGIN CERTIFICATE-----\n...",
    "additionalTrustBundlePolicy": "Proxyonly"
  },
  "exportOptions": {
    "includeCredentials": true,
    "includeFieldGuide": true
  }
}
```

---

## See Also

- [API.md](API.md) - Backend API for state management
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) - Environment configuration
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture (TBD)
- [README.md](../README.md) - Setup and deployment
