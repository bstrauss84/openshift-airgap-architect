import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PlatformSpecificsStep from "../src/steps/PlatformSpecificsStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";
import { getFieldAnnotationInfo } from "../src/catalogFieldMeta.js";
import { getCatalogForScenario } from "../src/catalogPaths.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function mockApis() {
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === "/api/cincinnati/channels")
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (path === "/api/cincinnati/update" && opts?.method === "POST")
      return Promise.resolve({ channels: ["4.20", "4.21"] });
    if (String(path).startsWith("/api/cincinnati/patches?")) {
      const m = path.match(/channel=([^&]+)/);
      const ch = m ? decodeURIComponent(m[1]) : "4.20";
      return Promise.resolve({ versions: [`${ch}.8`, `${ch}.3`] });
    }
    if (path === "/api/secrets/rh-pull-secret")
      return Promise.resolve({ available: false });
    return Promise.resolve({});
  });
}

function makeState(platform, method, minor, patch) {
  return {
    blueprint: {
      platform, arch: "x86_64", clusterName: "test", baseDomain: "example.com", confirmed: false,
    },
    release: { channel: minor, patchVersion: patch, confirmed: true },
    version: {
      versionConfirmed: true, selectedMinor: minor, selectedPatch: patch,
      selectedChannel: `stable-${minor}`, selectedVersion: patch, locked: false,
    },
    methodology: { method },
    credentials: {
      pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
    },
    platformConfig: {
      aws: { region: "us-gov-west-1" },
      azure: { region: "usgovvirginia", baseDomainResourceGroupName: "dns-rg", vnetMode: "existing-vnet", virtualNetwork: "test-vnet", networkResourceGroupName: "net-rg", controlPlaneSubnet: "cp-subnet" },
      vsphere: { placementMode: "legacy" },
    },
    hostInventory: {
      nodes: [
        { role: "master", hostname: "m0", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:01" } },
        { role: "master", hostname: "m1", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:02" } },
        { role: "master", hostname: "m2", primary: { type: "ethernet", name: "eno1", macAddress: "52:54:00:aa:bb:03" } },
      ],
      apiVip: "10.90.0.2", ingressVip: "10.90.0.3", machineNetworkCidr: "10.90.0.0/24", ipStackMode: "ipv4",
    },
    operators: {},
    ui: {
      segmentedFlowV1: true, activeStepId: "platform-specifics",
      visitedSteps: { "platform-specifics": true }, completedSteps: {},
    },
  };
}

function renderPlatformStep(state) {
  mockApis();
  const dispatch = vi.fn();
  return render(
    <AppContext.Provider value={{ state, dispatch }}>
      <PlatformSpecificsStep />
    </AppContext.Provider>
  );
}

describe("getFieldAnnotationInfo unit tests", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("returns isIntroduced=true for throughput at 4.21", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi", "4.21");
    const result = getFieldAnnotationInfo("controlPlane.platform.aws.rootVolume.throughput", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isIntroduced).toBe(true);
    expect(result.introductionMinor).toBe("4.21");
  });

  it("returns isIntroduced=false for throughput at 4.20 (not in catalog)", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi", "4.20");
    const result = getFieldAnnotationInfo("controlPlane.platform.aws.rootVolume.throughput", "install-config.yaml", params, "4.20", "4.20");
    expect(result.isIntroduced).toBe(false);
    expect(result.introductionMinor).toBeNull();
  });

  it("returns isIntroduced=true for confidentialCompute at 4.21", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi", "4.21");
    const result = getFieldAnnotationInfo("controlPlane.platform.aws.cpuOptions.confidentialCompute", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isIntroduced).toBe(true);
  });

  it("returns isIntroduced=true for allowSharedKeyAccess at 4.21", () => {
    const params = getCatalogForScenario("azure-government-ipi", "4.21");
    const result = getFieldAnnotationInfo("platform.azure.allowSharedKeyAccess", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isIntroduced).toBe(true);
  });

  it("returns isIntroduced=true for subnets.name at 4.21", () => {
    const params = getCatalogForScenario("azure-government-ipi", "4.21");
    const result = getFieldAnnotationInfo("platform.azure.subnets.name", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isIntroduced).toBe(true);
  });

  it("returns isIntroduced=true for bmcVerifyCA at 4.21", () => {
    const params = getCatalogForScenario("bare-metal-ipi", "4.21");
    const result = getFieldAnnotationInfo("platform.baremetal.bmcVerifyCA", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isIntroduced).toBe(true);
  });

  it("returns isDeprecated=true for vSphere datacenter", () => {
    const params = getCatalogForScenario("vsphere-ipi", "4.21");
    const result = getFieldAnnotationInfo("platform.vsphere.datacenter", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isDeprecated).toBe(true);
  });

  it("returns isDeprecated=true for vSphere defaultDatastore", () => {
    const params = getCatalogForScenario("vsphere-ipi", "4.21");
    const result = getFieldAnnotationInfo("platform.vsphere.defaultDatastore", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isDeprecated).toBe(true);
  });

  it("returns isIntroduced=false for baseline-version fields", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi", "4.20");
    const result = getFieldAnnotationInfo("platform.aws.region", "install-config.yaml", params, "4.20", "4.20");
    expect(result.isIntroduced).toBe(false);
  });

  it("returns isDeprecated=false for non-deprecated fields", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi", "4.21");
    const result = getFieldAnnotationInfo("controlPlane.platform.aws.rootVolume.throughput", "install-config.yaml", params, "4.21", "4.20");
    expect(result.isDeprecated).toBe(false);
  });
});

describe("DOC-103 introduced-field annotations — DOM rendering", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const INTRODUCED_FIELDS = [
    { platform: "AWS GovCloud", method: "IPI", path: "controlPlane.platform.aws.rootVolume.throughput", label: /Root volume throughput/ },
    { platform: "AWS GovCloud", method: "IPI", path: "controlPlane.platform.aws.cpuOptions.confidentialCompute", label: /Confidential compute/ },
    { platform: "Azure Government", method: "IPI", path: "platform.azure.allowSharedKeyAccess", label: /Azure Storage shared-key/ },
    { platform: "Bare Metal", method: "IPI", path: "platform.baremetal.bmcVerifyCA", label: /BMC verify CA/ },
  ];

  INTRODUCED_FIELDS.forEach(({ platform, method, path, label }) => {
    it(`shows "New in OpenShift 4.21" annotation for ${path} at 4.21`, () => {
      const state = makeState(platform, method, "4.21", "4.21.8");
      const { container } = renderPlatformStep(state);
      const annotations = container.querySelectorAll('[data-version-annotation="introduced"]');
      const matching = Array.from(annotations).filter(el => el.textContent.includes("New in OpenShift 4.21"));
      expect(matching.length).toBeGreaterThan(0);
    });

    it(`does NOT show "New in OpenShift" annotation for ${path} at 4.20`, () => {
      const state = makeState(platform, method, "4.20", "4.20.8");
      const { container } = renderPlatformStep(state);
      const annotations = container.querySelectorAll('[data-version-annotation="introduced"]');
      expect(annotations.length).toBe(0);
    });
  });

  it('shows "New in OpenShift 4.21" annotation for Azure subnets at 4.21 with BYO VNet', () => {
    const state = makeState("Azure Government", "IPI", "4.21", "4.21.8");
    state.platformConfig.azure.vnetMode = "existing-vnet";
    state.platformConfig.azure.virtualNetwork = "test-vnet";
    state.platformConfig.azure.networkResourceGroupName = "net-rg";
    state.platformConfig.azure.controlPlaneSubnet = "cp-subnet";
    const { container } = renderPlatformStep(state);
    const annotations = container.querySelectorAll('[data-version-annotation="introduced"]');
    const subnetAnnotation = Array.from(annotations).find(el => el.textContent.includes("multiple node subnets"));
    expect(subnetAnnotation).toBeTruthy();
  });

  it("does NOT show Azure subnets annotation at 4.20", () => {
    const state = makeState("Azure Government", "IPI", "4.20", "4.20.8");
    state.platformConfig.azure.vnetMode = "existing-vnet";
    state.platformConfig.azure.virtualNetwork = "test-vnet";
    state.platformConfig.azure.networkResourceGroupName = "net-rg";
    state.platformConfig.azure.controlPlaneSubnet = "cp-subnet";
    const { container } = renderPlatformStep(state);
    const annotations = container.querySelectorAll('[data-version-annotation="introduced"]');
    const subnetAnnotation = Array.from(annotations).find(el => el.textContent.includes("multiple node subnets"));
    expect(subnetAnnotation).toBeFalsy();
  });
});

describe("DOC-103 deprecated-field annotations — vSphere legacy fields", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows deprecation text for vSphere legacy fields at 4.21", () => {
    const state = makeState("VMware vSphere", "IPI", "4.21", "4.21.8");
    state.platformConfig.vsphere = { placementMode: "legacy" };
    const { container } = renderPlatformStep(state);
    const legacySection = container.querySelector(".note.warning");
    expect(legacySection).not.toBeNull();
    expect(legacySection.textContent).toMatch(/deprecated/i);
  });

  it("shows deprecation text for vSphere legacy fields at 4.20", () => {
    const state = makeState("VMware vSphere", "IPI", "4.20", "4.20.8");
    state.platformConfig.vsphere = { placementMode: "legacy" };
    const { container } = renderPlatformStep(state);
    const legacySection = container.querySelector(".note.warning");
    expect(legacySection).not.toBeNull();
    expect(legacySection.textContent).toMatch(/deprecated/i);
  });

  it("deprecated vSphere computeCluster hint includes DEPRECATED text", () => {
    const state = makeState("VMware vSphere", "IPI", "4.21", "4.21.8");
    state.platformConfig.vsphere = { placementMode: "legacy" };
    const { container } = renderPlatformStep(state);
    const helpers = container.querySelectorAll(".field-helper");
    const deprecatedHint = Array.from(helpers).find(el => /DEPRECATED/i.test(el.textContent));
    expect(deprecatedHint).not.toBeNull();
  });
});
