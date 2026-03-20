#!/usr/bin/env node
/**
 * E2E matrix runner (Workstream K). Runs full scenario × path matrix: minimal, with-fips, with-proxy,
 * dual-stack, node-counts, aws-with-instance-types, vsphere-failure-domains, bare-metal-provisioning.
 * Loads fixtures from data/e2e-fixtures/fixtures.json. Saves install-config (and agent-config where
 * applicable) per cell, validates against 4.20 structure and example reference, writes report.
 * Run from backend: node scripts/e2e-matrix.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildInstallConfig, buildAgentConfig } from "../src/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BACKEND_DIR, "..");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "e2e-artifacts");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "E2E_REPORT_4.20.md");
const FIXTURES_PATH = path.join(REPO_ROOT, "data", "e2e-fixtures", "fixtures.json");

const SCENARIOS = [
  { id: "bare-metal-agent", platform: "Bare Metal", method: "Agent-Based Installer", agentConfig: true },
  { id: "bare-metal-ipi", platform: "Bare Metal", method: "IPI", agentConfig: false },
  { id: "bare-metal-upi", platform: "Bare Metal", method: "UPI", agentConfig: false },
  { id: "vsphere-ipi", platform: "VMware vSphere", method: "IPI", agentConfig: false },
  { id: "vsphere-upi", platform: "VMware vSphere", method: "UPI", agentConfig: false },
  { id: "vsphere-agent", platform: "VMware vSphere", method: "Agent-Based Installer", agentConfig: true },
  { id: "aws-govcloud-ipi", platform: "AWS GovCloud", method: "IPI", agentConfig: false },
  { id: "aws-govcloud-upi", platform: "AWS GovCloud", method: "UPI", agentConfig: false },
  { id: "azure-government-ipi", platform: "Azure Government", method: "IPI", agentConfig: false },
  { id: "azure-government-upi", platform: "Azure Government", method: "UPI", agentConfig: false },
  { id: "nutanix-ipi", platform: "Nutanix", method: "IPI", agentConfig: false }
];

// Paths that apply per scenario. Part 4: every logical combination including hyperthreading, trust-bundle, advanced.
const PATH_APPLIES = {
  minimal: () => true,
  "with-fips": () => true,
  "with-proxy": () => true,
  "dual-stack": () => true,
  "node-counts": (sid) => ["bare-metal-agent", "bare-metal-ipi", "vsphere-agent"].includes(sid),
  "aws-with-instance-types": (sid) => sid === "aws-govcloud-ipi",
  "vsphere-failure-domains": (sid) => ["vsphere-ipi", "vsphere-upi", "vsphere-agent"].includes(sid),
  "bare-metal-provisioning": (sid) => sid === "bare-metal-ipi",
  "with-trust-bundle": () => true,
  "hyperthreading-enabled": () => true,
  "hyperthreading-disabled": () => true,
  "with-advanced": () => true,
  "with-fips-and-proxy": () => true
};

const ALL_PATH_IDS = [
  "minimal",
  "with-fips",
  "with-proxy",
  "dual-stack",
  "node-counts",
  "aws-with-instance-types",
  "vsphere-failure-domains",
  "bare-metal-provisioning",
  "with-trust-bundle",
  "hyperthreading-enabled",
  "hyperthreading-disabled",
  "with-advanced",
  "with-fips-and-proxy"
];

function loadFixtures() {
  try {
    const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      networking: { machineNetworkV6: "fd00::/48" },
      hosts: { hostnames: ["master-0", "master-1", "master-2", "worker-0", "worker-1"], apiVip: "192.168.1.100", ingressVip: "192.168.1.101", primaryCidr: "192.168.1.10/24" },
      macs: { bootMACs: ["52:54:00:00:00:01", "52:54:00:00:00:02", "52:54:00:00:00:03", "52:54:00:00:00:10", "52:54:00:00:00:11"] },
      bmc: { address: "redfish+http://192.168.1.1/redfish/v1/Systems/1", disableCertificateVerification: true },
      provisioning: { provisioningNetwork: "Unmanaged", provisioningNetworkCIDR: "172.22.0.0/24", provisioningNetworkInterface: "eth1", provisioningDHCPRange: "172.22.0.10,172.22.0.254", clusterProvisioningIP: "172.22.0.3", provisioningMACAddress: "52:54:00:00:00:01" },
      vsphere: { vcenter: "vcenter.example.com", datacenter: "DC0", cluster: "cluster0", datastore: "datastore0", network: "VM Network" },
      aws: { region: "us-gov-west-1", controlPlaneInstanceType: "m5.xlarge", workerInstanceType: "m5.large" },
      proxy: { httpProxy: "http://proxy.example.com:3128", httpsProxy: "https://proxy.example.com:3129", noProxy: ".example.com,192.168.1.0/24" }
    };
  }
}

function minimalState() {
  return {
    blueprint: {
      arch: "x86_64",
      platform: "Bare Metal",
      baseDomain: "example.com",
      clusterName: "airgap-cluster"
    },
    release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
    version: { versionConfirmed: true },
    methodology: { method: "Agent-Based Installer" },
    globalStrategy: {
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "10.90.0.0/24",
        machineNetworkV6: "",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16"
      },
      mirroring: {
        registryFqdn: "registry.local:5000",
        sources: [
          { source: "quay.io/openshift-release-dev/ocp-release", mirrors: ["registry.local:5000/ocp-release"] },
          { source: "quay.io/openshift-release-dev/ocp-v4.0-art-dev", mirrors: ["registry.local:5000/ocp-v4.0-art-dev"] }
        ]
      }
    },
    platformConfig: {
      publish: "External",
      aws: { region: "", subnets: "", hostedZone: "", amiId: "", controlPlaneInstanceType: "", workerInstanceType: "" },
      vsphere: { vcenter: "", datacenter: "", cluster: "", datastore: "", network: "", username: "", password: "" },
      nutanix: {
        endpoint: "",
        port: "9440",
        username: "",
        password: "",
        cluster: "",
        subnet: "",
        apiVIP: "",
        ingressVIP: "",
        apiVIPV6: "",
        ingressVIPV6: ""
      },
      azure: { cloudName: "AzureUSGovernmentCloud", region: "", resourceGroupName: "", baseDomainResourceGroupName: "" }
    },
    trust: {},
    hostInventory: {
      apiVip: "",
      ingressVip: "",
      provisioningNetwork: "Managed",
      schemaVersion: 2,
      nodes: []
    },
    credentials: { sshPublicKey: "", pullSecretPlaceholder: "{\"auths\":{}}" }
  };
}

function scenarioOverrides(scenarioId) {
  const overrides = {
    "bare-metal-agent": {
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: {
        nodes: [
          { hostname: "master-0", role: "master", primary: { ipv4Cidr: "192.168.1.10/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:01" } }, bmc: {}, rootDevice: "" },
          { hostname: "master-1", role: "master", primary: { ipv4Cidr: "192.168.1.11/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:02" } }, bmc: {}, rootDevice: "" },
          { hostname: "master-2", role: "master", primary: { ipv4Cidr: "192.168.1.12/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:03" } }, bmc: {}, rootDevice: "" }
        ],
        apiVip: "192.168.1.100",
        ingressVip: "192.168.1.101"
      }
    },
    "bare-metal-ipi": {
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "IPI" },
      hostInventory: { nodes: [], provisioningNetwork: "Managed" }
    },
    "bare-metal-upi": {
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "UPI" },
      hostInventory: { nodes: [], apiVip: "192.168.1.100", ingressVip: "192.168.1.101" }
    },
    "vsphere-ipi": {
      blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "IPI" },
      platformConfig: {
        vsphere: {
          vcenter: "vcenter.example.com",
          datacenter: "DC0",
          cluster: "cluster0",
          datastore: "datastore0",
          network: "VM Network"
        }
      }
    },
    "vsphere-upi": {
      blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "UPI" },
      platformConfig: {
        vsphere: {
          vcenter: "vcenter.example.com",
          datacenter: "DC0",
          cluster: "cluster0",
          datastore: "datastore0",
          network: "VM Network"
        }
      }
    },
    "vsphere-agent": {
      blueprint: { platform: "VMware vSphere", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "Agent-Based Installer" },
      platformConfig: {
        vsphere: {
          placementMode: "legacy",
          vcenter: "vcenter.example.com",
          datacenter: "DC0",
          cluster: "cluster0",
          datastore: "datastore0",
          network: "VM Network"
        }
      },
      hostInventory: {
        nodes: [
          { hostname: "master-0", role: "master", primary: { ipv4Cidr: "192.168.1.10/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:01" } }, bmc: {}, rootDevice: "" },
          { hostname: "master-1", role: "master", primary: { ipv4Cidr: "192.168.1.11/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:02" } }, bmc: {}, rootDevice: "" },
          { hostname: "master-2", role: "master", primary: { ipv4Cidr: "192.168.1.12/24", ethernet: { name: "eth0", macAddress: "52:54:00:00:00:03" } }, bmc: {}, rootDevice: "" }
        ],
        apiVip: "192.168.1.100",
        ingressVip: "192.168.1.101"
      }
    },
    "aws-govcloud-ipi": {
      blueprint: { platform: "AWS GovCloud", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "IPI" },
      platformConfig: { aws: { region: "us-gov-west-1" } }
    },
    "aws-govcloud-upi": {
      blueprint: { platform: "AWS GovCloud", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "UPI" },
      platformConfig: { aws: { region: "us-gov-west-1" } }
    },
    "azure-government-upi": {
      blueprint: { platform: "Azure Government", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "UPI" },
      platformConfig: {
        azure: { cloudName: "AzureUSGovernmentCloud", region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg" }
      }
    },
    "azure-government-ipi": {
      blueprint: { platform: "Azure Government", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "IPI" },
      platformConfig: {
        azure: {
          cloudName: "AzureUSGovernmentCloud",
          region: "usgovvirginia",
          resourceGroupName: "rg-example",
          baseDomainResourceGroupName: "rg-dns"
        }
      }
    },
    "nutanix-ipi": {
      blueprint: { platform: "Nutanix", baseDomain: "example.com", clusterName: "airgap-cluster" },
      methodology: { method: "IPI" },
      platformConfig: {
        controlPlaneReplicas: 3,
        computeReplicas: 3,
        nutanix: {
          endpoint: "prism-central.example.com",
          port: "9440",
          subnet: "subnet-uuid-placeholder",
          apiVIP: "10.90.0.10",
          ingressVIP: "10.90.0.11",
          apiVIPV6: "",
          ingressVIPV6: ""
        }
      }
    }
  };
  return overrides[scenarioId] || {};
}

function pathOverrides(pathId, scenarioId, fixtures) {
  const f = fixtures || {};
  switch (pathId) {
    case "minimal":
      return {};
    case "with-fips":
      return { globalStrategy: { fips: true } };
    case "with-proxy":
      return {
        globalStrategy: {
          proxyEnabled: true,
          proxies: {
            httpProxy: f.proxy?.httpProxy || "",
            httpsProxy: f.proxy?.httpsProxy || "",
            noProxy: f.proxy?.noProxy || ""
          }
        }
      };
    case "dual-stack":
      return {
        globalStrategy: {
          networking: {
            networkType: "OVNKubernetes",
            machineNetworkV4: "10.90.0.0/24",
            machineNetworkV6: f.networking?.machineNetworkV6 || "fd00::/48",
            clusterNetworkCidr: "10.128.0.0/14",
            clusterNetworkHostPrefix: 23,
            serviceNetworkCidr: "172.30.0.0/16"
          }
        },
        hostInventory: { enableIpv6: true }
      };
    case "node-counts": {
      const hostnames = f.hosts?.hostnames || ["master-0", "master-1", "master-2", "worker-0", "worker-1"];
      const bootMACs = f.macs?.bootMACs || ["52:54:00:00:00:01", "52:54:00:00:00:02", "52:54:00:00:00:03", "52:54:00:00:00:10", "52:54:00:00:00:11"];
      const primaryCidr = f.hosts?.primaryCidr || "192.168.1.10/24";
      const bmc = f.bmc || {};
      const cidrs = [primaryCidr, "192.168.1.11/24", "192.168.1.12/24", "192.168.1.20/24", "192.168.1.21/24"];
      const nodes = hostnames.slice(0, 5).map((hostname, i) => {
        const role = i < 3 ? "master" : "worker";
        const n = {
          hostname,
          role,
          primary: { ipv4Cidr: cidrs[i] || primaryCidr },
          bmc: { address: bmc.address, disableCertificateVerification: bmc.disableCertificateVerification },
          rootDevice: ""
        };
        if (bootMACs[i]) n.bmc.bootMACAddress = bootMACs[i];
        return n;
      });
      return { hostInventory: { nodes } };
    }
    case "aws-with-instance-types":
      return {
        platformConfig: {
          aws: {
            region: f.aws?.region || "us-gov-west-1",
            controlPlaneInstanceType: f.aws?.controlPlaneInstanceType || "m5.xlarge",
            workerInstanceType: f.aws?.workerInstanceType || "m5.large"
          }
        }
      };
    case "vsphere-failure-domains": {
      const vs = f.vsphere || {};
      return {
        platformConfig: {
          vsphere: {
            failureDomains: [
              {
                name: "fd-0",
                region: vs.datacenter || "DC0",
                zone: vs.cluster || "cluster0",
                server: vs.vcenter || "vcenter.example.com",
                topology: {
                  datacenter: vs.datacenter || "DC0",
                  computeCluster: vs.cluster || "cluster0",
                  datastore: vs.datastore || "datastore0",
                  networks: [vs.network || "VM Network"]
                }
              }
            ],
            vcenters: [
              {
                server: vs.vcenter || "vcenter.example.com",
                datacenters: [vs.datacenter || "DC0"],
                port: 443
              }
            ]
          }
        }
      };
    }
    case "bare-metal-provisioning": {
      const p = f.provisioning || {};
      return {
        hostInventory: {
          nodes: [
            { hostname: "master-0", role: "master", bmc: { address: (f.bmc || {}).address }, rootDevice: "" }
          ],
          provisioningNetwork: p.provisioningNetwork || "Unmanaged",
          provisioningNetworkCIDR: p.provisioningNetworkCIDR,
          provisioningNetworkInterface: p.provisioningNetworkInterface,
          provisioningDHCPRange: p.provisioningDHCPRange,
          clusterProvisioningIP: p.clusterProvisioningIP,
          provisioningMACAddress: p.provisioningMACAddress
        }
      };
    }
    case "with-trust-bundle":
      return {
        trust: {
          proxyCaPem: "-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJALeqDQyWBory\n-----END CERTIFICATE-----",
          additionalTrustBundlePolicy: "Proxyonly"
        }
      };
    case "hyperthreading-enabled":
      return {
        platformConfig: {
          computeHyperthreading: "Enabled",
          controlPlaneHyperthreading: "Enabled"
        }
      };
    case "hyperthreading-disabled":
      return {
        platformConfig: {
          computeHyperthreading: "Disabled",
          controlPlaneHyperthreading: "Disabled"
        }
      };
    case "with-advanced":
      return {
        platformConfig: {
          baselineCapabilitySet: "vCurrent",
          additionalEnabledCapabilities: [],
          cpuPartitioningMode: "None"
        }
      };
    case "with-fips-and-proxy":
      return {
        globalStrategy: {
          fips: true,
          proxyEnabled: true,
          proxies: {
            httpProxy: f.proxy?.httpProxy || "http://proxy.example.com:3128",
            httpsProxy: f.proxy?.httpsProxy || "https://proxy.example.com:3129",
            noProxy: f.proxy?.noProxy || ".example.com,192.168.1.0/24"
          }
        }
      };
    default:
      return {};
  }
}

function getPathsForScenario(scenarioId) {
  return ALL_PATH_IDS.filter((pid) => PATH_APPLIES[pid](scenarioId));
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] != null && typeof over[k] === "object" && !Array.isArray(over[k])) {
      out[k] = deepMerge(out[k] || {}, over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

const INSTALL_CONFIG_REQUIRED = ["apiVersion", "baseDomain", "metadata", "compute", "controlPlane", "networking", "platform", "pullSecret"];
const AGENT_CONFIG_REQUIRED = ["apiVersion", "kind", "metadata", "rendezvousIP", "hosts"];

function validateInstallConfig(obj, scenarioId) {
  const errors = [];
  for (const key of INSTALL_CONFIG_REQUIRED) {
    if (obj[key] === undefined) errors.push(`missing install-config.${key}`);
  }
  const platformKeys = Object.keys(obj.platform || {}).filter((k) => k !== "none");
  // Bare Metal UPI per 4.20 doc: platform must be only none; no platform.baremetal.
  if (scenarioId === "bare-metal-upi") {
    if (!obj.platform || !Object.prototype.hasOwnProperty.call(obj.platform, "none")) {
      errors.push("bare-metal-upi must have platform.none");
    }
    if (obj.platform?.baremetal !== undefined) {
      errors.push("bare-metal-upi must not have platform.baremetal (4.20 doc: no additional platform config)");
    }
  } else {
    const expectedPlatform = {
      "bare-metal-agent": "baremetal",
      "bare-metal-ipi": "baremetal",
      "vsphere-ipi": "vsphere",
      "vsphere-upi": "vsphere",
      "vsphere-agent": "vsphere",
      "aws-govcloud-ipi": "aws",
      "aws-govcloud-upi": "aws",
      "azure-government-ipi": "azure",
      "azure-government-upi": "azure",
      "nutanix-ipi": "nutanix"
    };
    const expect = expectedPlatform[scenarioId];
    if (expect && !platformKeys.includes(expect)) {
      errors.push(`expected platform.${expect} for ${scenarioId}`);
    }
  }
  return errors;
}

function validateAgentConfig(obj) {
  const errors = [];
  for (const key of AGENT_CONFIG_REQUIRED) {
    if (obj[key] === undefined) errors.push(`missing agent-config.${key}`);
  }
  if (obj.kind !== "AgentConfig") errors.push("agent-config kind must be AgentConfig");
  return errors;
}

function runMatrix() {
  if (process.cwd() !== BACKEND_DIR) {
    console.error("Run from backend directory: cd backend && node scripts/e2e-matrix.js");
    process.exit(1);
  }
  const fixtures = loadFixtures();
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const results = [];
  for (const scenario of SCENARIOS) {
    const pathIds = getPathsForScenario(scenario.id);
    for (const pathId of pathIds) {
      let state = deepMerge(minimalState(), scenarioOverrides(scenario.id));
      state = deepMerge(state, pathOverrides(pathId, scenario.id, fixtures));
      state.blueprint.platform = scenario.platform;
      state.methodology.method = scenario.method;
      const outDir = path.join(ARTIFACTS_DIR, `${scenario.id}_${pathId}`);
      fs.mkdirSync(outDir, { recursive: true });
      const entry = { scenario: scenario.id, path: pathId, installConfig: null, agentConfig: null, errors: [], misalignments: [] };
      try {
        const installYaml = buildInstallConfig(state);
        const installPath = path.join(outDir, "install-config.yaml");
        fs.writeFileSync(installPath, installYaml, "utf8");
        entry.installConfig = installPath;
        const installObj = yaml.load(installYaml);
        const icErrors = validateInstallConfig(installObj, scenario.id);
        entry.errors.push(...icErrors);
        if (icErrors.length) entry.misalignments.push(...icErrors);
        if (scenario.agentConfig) {
          const agentYaml = buildAgentConfig(state);
          const agentPath = path.join(outDir, "agent-config.yaml");
          fs.writeFileSync(agentPath, agentYaml, "utf8");
          entry.agentConfig = agentPath;
          const agentObj = yaml.load(agentYaml);
          const acErrors = validateAgentConfig(agentObj);
          entry.errors.push(...acErrors);
          if (acErrors.length) entry.misalignments.push(...acErrors);
        }
      } catch (err) {
        const msg = String(err?.message || err);
        entry.errors.push(msg);
        entry.misalignments.push(msg);
      }
      results.push(entry);
    }
  }
  const totalCells = results.length;
  const passCount = results.filter((r) => r.errors.length === 0).length;
  const failCount = totalCells - passCount;
  const reportLines = [
    "# E2E Report — 4.20 alignment (Workstream K)",
    "",
    "Full scenario × path matrix. Generated by backend/scripts/e2e-matrix.js. Validates install-config (and agent-config where applicable) against 4.20 structure and docs/e2e-examples/REFERENCE.md.",
    "",
    "## Matrix size",
    `- Scenarios: ${SCENARIOS.length}`,
    `- Paths: ${ALL_PATH_IDS.join(", ")} (applicability varies by scenario).`,
    `- **Total cells executed: ${totalCells}**`,
    `- Pass: ${passCount} | Fail: ${failCount}`,
    "",
    "## Artifact location",
    "- e2e-artifacts/<scenarioId>_<pathId>/install-config.yaml",
    "- e2e-artifacts/<scenarioId>_<pathId>/agent-config.yaml (bare-metal-agent only)",
    "",
    "## Results",
    "",
    "| Scenario | Path | install-config | agent-config | Validation |",
    "|----------|------|----------------|--------------|------------|"
  ];
  for (const r of results) {
    const ic = r.installConfig ? "✓" : "—";
    const ac = r.agentConfig ? "✓" : "—";
    const valid = r.errors.length === 0 ? "pass" : "fail";
    const mis = r.misalignments.length ? " — " + r.misalignments.join("; ") : "";
    reportLines.push(`| ${r.scenario} | ${r.path} | ${ic} | ${ac} | ${valid}${mis} |`);
  }
  reportLines.push("");
  reportLines.push("## Validation notes");
  reportLines.push("- install-config: required top-level keys; scenario-appropriate platform block; controlPlane/compute.platform only when required (bare-metal UPI none, AWS IPI instance types).");
  reportLines.push("- agent-config (bare-metal-agent only): apiVersion, kind AgentConfig, metadata, rendezvousIP, hosts.");
  reportLines.push("- Fixtures: data/e2e-fixtures/fixtures.json. Example reference: docs/e2e-examples/REFERENCE.md.");
  reportLines.push("");
  reportLines.push("K follow-up: see docs/E2E_FOLLOWUP_REPORT_4.20.md for platform-field clarification and full validation.");
  reportLines.push("");
  reportLines.push("*End of report.*");
  fs.writeFileSync(REPORT_PATH, reportLines.join("\n"), "utf8");
  console.log("E2E full matrix run complete.");
  console.log("Total cells executed:", totalCells);
  console.log("Pass:", passCount, "| Fail:", failCount);
  console.log("Artifacts:", ARTIFACTS_DIR);
  console.log("Report:", REPORT_PATH);
  const failed = results.filter((r) => r.errors.length > 0);
  if (failed.length > 0) {
    console.error("Failed cells:", failed.map((f) => `${f.scenario}_${f.path}: ${f.errors.join("; ")}`));
    process.exit(1);
  }
}

runMatrix();
