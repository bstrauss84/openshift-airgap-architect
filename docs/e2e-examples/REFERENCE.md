# 4.20 install-config / agent-config reference (E2E validation)

Derived from `data/params/4.20/*.json` and official 4.20 installation docs.

## install-config — required top-level

| Key | Required | Notes |
|-----|----------|-------|
| apiVersion | yes | "v1" |
| baseDomain | yes | FQDN or subdomain |
| metadata | yes | metadata.name = cluster name |
| compute | yes | Array of machine pools (name, replicas; optional architecture, platform when required) |
| controlPlane | yes | name, replicas; optional architecture, platform when required |
| networking | yes | networkType, machineNetwork, clusterNetwork, serviceNetwork (optional ovnKubernetesConfig) |
| platform | yes | One of baremetal, vsphere, aws, azure, nutanix, none (UPI) with platform-specific subkeys |
| pullSecret | yes | JSON string |

## install-config — controlPlane.platform / compute[].platform (K follow-up)

Per 4.20 params these are **optional**. Emit only when:

1. **Bare-metal UPI:** `controlPlane.platform: "none"`, `compute[].platform: "none"`.
2. **AWS GovCloud IPI** with instance types: `controlPlane.platform: { aws: { type: "<instanceType>" } }`, `compute[].platform: { aws: { type: "<instanceType>" } }`.

Do **not** emit string platform (e.g. "baremetal", "vsphere") on controlPlane/compute for other scenarios; top-level `platform.<key>` is sufficient.

## agent-config — required (bare-metal Agent-Based Installer only)

| Key | Required | Notes |
|-----|----------|-------|
| apiVersion | yes | "v1beta1" |
| kind | yes | "AgentConfig" |
| metadata | yes | metadata.name |
| rendezvousIP | yes | IPv4 or IPv6 of bootstrap node |
| hosts | yes | Array of host config (hostname, role, interfaces, networkConfig, rootDeviceHints) |

## Scenario → platform block

| scenarioId | install-config platform key | agent-config |
|------------|-----------------------------|--------------|
| bare-metal-agent | platform.baremetal | emitted |
| bare-metal-ipi | platform.baremetal (hosts, provisioning network, etc.) | — |
| bare-metal-upi | platform.baremetal (apiVIP, ingressVIP only); controlPlane/compute platform "none" | — |
| vsphere-ipi, vsphere-upi | platform.vsphere | — |
| aws-govcloud-ipi, aws-govcloud-upi | platform.aws (existing VPC: platform.aws.vpc.subnets[].id per 4.20 doc) | — |
| azure-government-ipi | platform.azure | — |
| nutanix-ipi | platform.nutanix | — |
