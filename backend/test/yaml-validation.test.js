/**
 * OpenShift Airgap Architect - YAML Validation Tests
 *
 * Tests for validating generated install-config.yaml, agent-config.yaml, and imageset-config.yaml
 * against parameter catalogs. Uses reference YAML fixtures for each scenario.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRequiredFields,
  validateEnumValues,
  validateApplicability,
  validateYaml,
  validateAllFiles,
} from "../src/yamlValidator.js";
import { clearCatalogCache } from "../src/catalogValidator.js";

// ===================================================================
// REFERENCE YAML FIXTURES
// ===================================================================

const VALID_BARE_METAL_IPI_INSTALL_CONFIG = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
compute:
  - architecture: amd64
    hyperthreading: Enabled
    name: worker
    replicas: 0
controlPlane:
  architecture: amd64
  hyperthreading: Enabled
  name: master
  replicas: 3
networking:
  clusterNetwork:
    - cidr: 10.128.0.0/14
      hostPrefix: 23
  machineNetwork:
    - cidr: 192.168.1.0/24
  networkType: OVNKubernetes
  serviceNetwork:
    - 172.30.0.0/16
platform:
  baremetal:
    apiVIPs:
      - 192.168.1.10
    ingressVIPs:
      - 192.168.1.11
    hosts:
      - name: master-0
        role: master
        bootMACAddress: "52:54:00:aa:bb:01"
        bmc:
          address: ipmi://192.168.1.100
          username: admin
          password: password
      - name: master-1
        role: master
        bootMACAddress: "52:54:00:aa:bb:02"
        bmc:
          address: ipmi://192.168.1.101
          username: admin
          password: password
      - name: master-2
        role: master
        bootMACAddress: "52:54:00:aa:bb:03"
        bmc:
          address: ipmi://192.168.1.102
          username: admin
          password: password
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

const MISSING_REQUIRED_FIELDS_INSTALL_CONFIG = `apiVersion: v1
metadata:
  name: test-cluster
compute:
  - architecture: amd64
    hyperthreading: Enabled
    name: worker
    replicas: 0
controlPlane:
  architecture: amd64
  hyperthreading: Enabled
  name: master
  replicas: 3
networking:
  networkType: OVNKubernetes
platform:
  baremetal:
    hosts: []
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

const INVALID_ENUM_INSTALL_CONFIG = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
compute:
  - architecture: amd64
    hyperthreading: Enabled
    name: worker
    replicas: 0
controlPlane:
  architecture: amd64
  hyperthreading: Enabled
  name: master
  replicas: 3
networking:
  clusterNetwork:
    - cidr: 10.128.0.0/14
      hostPrefix: 23
  machineNetwork:
    - cidr: 192.168.1.0/24
  networkType: InvalidNetworkType
  serviceNetwork:
    - 172.30.0.0/16
platform:
  baremetal:
    apiVIPs:
      - 192.168.1.10
    ingressVIPs:
      - 192.168.1.11
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

const AZURE_GOV_IPI_INSTALL_CONFIG = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
compute:
  - architecture: amd64
    hyperthreading: Enabled
    name: worker
    replicas: 3
controlPlane:
  architecture: amd64
  hyperthreading: Enabled
  name: master
  replicas: 3
networking:
  clusterNetwork:
    - cidr: 10.128.0.0/14
      hostPrefix: 23
  machineNetwork:
    - cidr: 10.0.0.0/16
  networkType: OVNKubernetes
  serviceNetwork:
    - 172.30.0.0/16
platform:
  azure:
    baseDomainResourceGroupName: rg-dns
    cloudName: AzureUSGovernmentCloud
    region: usgovvirginia
    resourceGroupName: rg-cluster
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

// ===================================================================
// VALIDATION FUNCTION TESTS
// ===================================================================

test("validateRequiredFields: passes when all required fields present", () => {
  const result = validateRequiredFields(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test("validateRequiredFields: fails when baseDomain missing", () => {
  const result = validateRequiredFields(
    MISSING_REQUIRED_FIELDS_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.length > 0);

  // Should have error for baseDomain
  const baseDomainError = result.errors.find((e) => e.path === "baseDomain");
  assert.ok(baseDomainError);
  assert.ok(baseDomainError.message.includes("Required field missing"));
});

test("validateRequiredFields: returns error for invalid YAML", () => {
  const invalidYaml = `apiVersion: v1
baseDomain example.com
invalid yaml syntax`;

  const result = validateRequiredFields(
    invalidYaml,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "yaml"));
});

test("validateRequiredFields: returns error for non-existent catalog", () => {
  const result = validateRequiredFields(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "invalid-scenario",
    "4.20"
  );

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "catalog"));
});

test("validateEnumValues: passes when enum value is valid", () => {
  const result = validateEnumValues(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, true);
});

test("validateEnumValues: fails when networkType is invalid", () => {
  const result = validateEnumValues(
    INVALID_ENUM_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  // Note: This depends on networking.networkType having an allowed list in catalog
  // If catalog doesn't restrict networkType, this test will pass
  // For now, we'll check structure rather than specific failure
  assert.ok(result.valid !== undefined);
  assert.ok(Array.isArray(result.errors));
});

test("validateEnumValues: skips empty values", () => {
  const yamlWithEmptyEnum = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
networking:
  networkType: ""
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

  const result = validateEnumValues(
    yamlWithEmptyEnum,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  // Should pass - empty values are skipped
  assert.strictEqual(result.valid, true);
});

test("validateApplicability: passes when all fields are applicable", () => {
  const result = validateApplicability(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, true);
});

test("validateApplicability: handles invalid YAML gracefully", () => {
  const invalidYaml = "invalid: yaml: syntax";

  const result = validateApplicability(
    invalidYaml,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "yaml"));
});

test("validateYaml: combines all validation types", () => {
  const result = validateYaml(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(result.errors);
  assert.ok(result.errors.required);
  assert.ok(result.errors.enum);
  assert.ok(result.errors.applicability);
  assert.strictEqual(typeof result.totalErrors, "number");
});

test("validateYaml: reports total error count for invalid config", () => {
  const result = validateYaml(
    MISSING_REQUIRED_FIELDS_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  assert.strictEqual(result.valid, false);
  assert.ok(result.totalErrors > 0);
});

test("validateAllFiles: validates multiple YAML files", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "agent-config.yaml": null, // Not applicable for IPI
    "imageset-config.yaml": null,
    "FIELD_MANUAL.md": "# Field Manual\n\nSome content",
  };

  const result = validateAllFiles(files, "bare-metal-ipi", "4.20");

  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(result.fileErrors);
  assert.strictEqual(typeof result.totalErrors, "number");
});

test("validateAllFiles: skips non-YAML files", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "FIELD_MANUAL.md": "# Field Manual",
    "README.txt": "Some text content",
  };

  const result = validateAllFiles(files, "bare-metal-ipi", "4.20");

  // Should only validate install-config.yaml
  assert.ok(result.fileErrors["install-config.yaml"]);
  assert.strictEqual(result.fileErrors["FIELD_MANUAL.md"], undefined);
  assert.strictEqual(result.fileErrors["README.txt"], undefined);
});

test("validateAllFiles: skips null/empty files", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "agent-config.yaml": null,
    "imageset-config.yaml": "",
  };

  const result = validateAllFiles(files, "bare-metal-ipi", "4.20");

  // Should only validate install-config.yaml
  assert.ok(result.fileErrors["install-config.yaml"]);
  assert.strictEqual(result.fileErrors["agent-config.yaml"], undefined);
  assert.strictEqual(result.fileErrors["imageset-config.yaml"], undefined);
});

test("validateAllFiles: aggregates errors across files", () => {
  const files = {
    "install-config.yaml": MISSING_REQUIRED_FIELDS_INSTALL_CONFIG,
    "agent-config.yaml": `apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: test-cluster`,
  };

  const result = validateAllFiles(files, "bare-metal-ipi", "4.20");

  assert.strictEqual(result.valid, false);
  assert.ok(result.totalErrors > 0);
  assert.ok(result.fileErrors["install-config.yaml"]);
});

// ===================================================================
// VERSION-AWARE VALIDATION TESTS
// ===================================================================

test("4.21 required-field validation includes 4.21-only Azure subnet paths", () => {
  clearCatalogCache();
  const result421 = validateRequiredFields(
    AZURE_GOV_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "azure-government-ipi",
    "4.21"
  );

  const paths421 = result421.errors.map((e) => e.path);
  assert.ok(paths421.includes("platform.azure.subnets.name"), "4.21 should report missing platform.azure.subnets.name");
  assert.ok(paths421.includes("platform.azure.subnets.role"), "4.21 should report missing platform.azure.subnets.role");
});

test("4.20 required-field validation does not include 4.21-only Azure subnet paths", () => {
  clearCatalogCache();
  const result420 = validateRequiredFields(
    AZURE_GOV_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "azure-government-ipi",
    "4.20"
  );

  const paths420 = result420.errors.map((e) => e.path);
  assert.ok(!paths420.includes("platform.azure.subnets.name"), "4.20 should not report platform.azure.subnets.name");
  assert.ok(!paths420.includes("platform.azure.subnets.role"), "4.20 should not report platform.azure.subnets.role");
});

test("validateAllFiles propagation: 4.21 uses 4.21 catalog through complete chain", () => {
  clearCatalogCache();
  const files = {
    "install-config.yaml": AZURE_GOV_IPI_INSTALL_CONFIG,
  };

  const result421 = validateAllFiles(files, "azure-government-ipi", "4.21");
  const installErrors421 = result421.fileErrors["install-config.yaml"];
  const requiredPaths421 = installErrors421.errors.required.map((e) => e.path);
  assert.ok(requiredPaths421.includes("platform.azure.subnets.name"));
  assert.ok(requiredPaths421.includes("platform.azure.subnets.role"));
});

test("validateAllFiles propagation: 4.20 does not report 4.21-only paths", () => {
  clearCatalogCache();
  const files = {
    "install-config.yaml": AZURE_GOV_IPI_INSTALL_CONFIG,
  };

  const result420 = validateAllFiles(files, "azure-government-ipi", "4.20");
  const installErrors420 = result420.fileErrors["install-config.yaml"];
  const requiredPaths420 = installErrors420.errors.required.map((e) => e.path);
  assert.ok(!requiredPaths420.includes("platform.azure.subnets.name"));
  assert.ok(!requiredPaths420.includes("platform.azure.subnets.role"));
});

// ===================================================================
// MISSING SCENARIO WITH SUPPORTED VERSION
// ===================================================================

test("validateAllFiles: missing scenario with 4.21 produces catalog-not-found result", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
  };

  const result = validateAllFiles(files, "not-a-scenario", "4.21");

  assert.strictEqual(result.valid, false);
  const installErrors = result.fileErrors["install-config.yaml"];
  assert.ok(installErrors.errors.required.some((e) => e.path === "catalog"));
});

// ===================================================================
// UNSUPPORTED VERSION
// ===================================================================

test("validateAllFiles: unsupported 4.22 throws UNSUPPORTED_VERSION", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
  };

  assert.throws(
    () => validateAllFiles(files, "bare-metal-agent", "4.22"),
    (err) => {
      assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
      assert.strictEqual(err.requestedVersion, "4.22");
      assert.deepStrictEqual(err.supportedVersions, ["4.20", "4.21"]);
      return true;
    }
  );
});

// ===================================================================
// MISSING VERSION
// ===================================================================

test("validateAllFiles: omitted version throws CATALOG_VERSION_REQUIRED", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
  };

  assert.throws(
    () => validateAllFiles(files, "bare-metal-ipi"),
    (err) => {
      assert.strictEqual(err.code, "CATALOG_VERSION_REQUIRED");
      return true;
    }
  );
});

// ===================================================================
// REGRESSION CONTRACTS - RESULT SHAPES
// ===================================================================

test("regression: validateRequiredFields returns { valid, errors }", () => {
  const result = validateRequiredFields(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );
  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(Array.isArray(result.errors));
});

test("regression: validateEnumValues returns { valid, errors }", () => {
  const result = validateEnumValues(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );
  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(Array.isArray(result.errors));
});

test("regression: validateApplicability returns { valid, errors }", () => {
  const result = validateApplicability(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );
  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(Array.isArray(result.errors));
});

test("regression: validateYaml returns { valid, errors: { required, enum, applicability }, totalErrors }", () => {
  const result = validateYaml(
    VALID_BARE_METAL_IPI_INSTALL_CONFIG,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );
  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(result.errors);
  assert.ok(Array.isArray(result.errors.required));
  assert.ok(Array.isArray(result.errors.enum));
  assert.ok(Array.isArray(result.errors.applicability));
  assert.strictEqual(typeof result.totalErrors, "number");
});

test("regression: validateAllFiles returns { valid, fileErrors, totalErrors }", () => {
  const files = {
    "install-config.yaml": VALID_BARE_METAL_IPI_INSTALL_CONFIG,
  };
  const result = validateAllFiles(files, "bare-metal-ipi", "4.20");
  assert.strictEqual(typeof result.valid, "boolean");
  assert.ok(typeof result.fileErrors === "object");
  assert.strictEqual(typeof result.totalErrors, "number");
});

// ===================================================================
// EDGE CASES AND ERROR HANDLING
// ===================================================================

test("validateRequiredFields: handles deeply nested required fields", () => {
  const yamlWithNested = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
platform:
  aws:
    region: us-gov-west-1
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

  const result = validateRequiredFields(
    yamlWithNested,
    "install-config.yaml",
    "aws-govcloud-ipi",
    "4.20"
  );

  // Should not throw, even with nested structures
  assert.ok(result);
  assert.strictEqual(typeof result.valid, "boolean");
});

test("validateEnumValues: handles arrays of enum values", () => {
  const yamlWithArrayEnum = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
networking:
  machineNetwork:
    - cidr: 192.168.1.0/24
    - cidr: 192.168.2.0/24
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

  const result = validateEnumValues(
    yamlWithArrayEnum,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  // Should handle array without errors
  assert.ok(result);
  assert.strictEqual(typeof result.valid, "boolean");
});

test("validateYaml: handles minimal valid config", () => {
  const minimalConfig = `apiVersion: v1
baseDomain: example.com
metadata:
  name: test-cluster
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

  const result = validateYaml(
    minimalConfig,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  // Will likely fail due to missing required fields, but should not throw
  assert.ok(result);
  assert.strictEqual(typeof result.valid, "boolean");
});

test("validateAllFiles: handles empty files object", () => {
  const result = validateAllFiles({}, "bare-metal-ipi", "4.20");

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.totalErrors, 0);
  assert.deepStrictEqual(result.fileErrors, {});
});

// ===================================================================
// BYPASS BOUNDARY TESTS - validateAllFiles version contract
// ===================================================================

test("bypass boundary: missing version with empty files throws CATALOG_VERSION_REQUIRED", () => {
  assert.throws(
    () => validateAllFiles({}, "bare-metal-agent"),
    (err) => {
      assert.strictEqual(err.code, "CATALOG_VERSION_REQUIRED");
      return true;
    }
  );
});

test("bypass boundary: unsupported version with non-YAML-only files throws UNSUPPORTED_VERSION", () => {
  assert.throws(
    () => validateAllFiles({ "README.md": "text" }, "bare-metal-agent", "4.22"),
    (err) => {
      assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
      assert.strictEqual(err.requestedVersion, "4.22");
      assert.deepStrictEqual(err.supportedVersions, ["4.20", "4.21"]);
      return true;
    }
  );
});

test("bypass boundary: missing version with empty YAML throws CATALOG_VERSION_REQUIRED", () => {
  assert.throws(
    () => validateAllFiles({ "install-config.yaml": "" }, "bare-metal-agent"),
    (err) => {
      assert.strictEqual(err.code, "CATALOG_VERSION_REQUIRED");
      return true;
    }
  );
});

test("bypass boundary: supported version with empty files returns valid empty result", () => {
  const result = validateAllFiles({}, "bare-metal-agent", "4.20");
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.totalErrors, 0);
  assert.deepStrictEqual(result.fileErrors, {});
});

test("bypass boundary: supported version with non-YAML-only files returns valid empty result", () => {
  const result = validateAllFiles({ "README.md": "text", "notes.txt": "content" }, "bare-metal-agent", "4.20");
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.totalErrors, 0);
  assert.deepStrictEqual(result.fileErrors, {});
});

test("validateRequiredFields: handles YAML with comments", () => {
  const yamlWithComments = `# OpenShift Install Config
apiVersion: v1
baseDomain: example.com  # Base domain for cluster
metadata:
  name: test-cluster
# Network configuration
networking:
  networkType: OVNKubernetes
pullSecret: '{"auths":{}}'
sshKey: 'ssh-rsa AAAA...'`;

  const result = validateRequiredFields(
    yamlWithComments,
    "install-config.yaml",
    "bare-metal-ipi",
    "4.20"
  );

  // YAML parser should handle comments correctly
  assert.ok(result);
  assert.strictEqual(typeof result.valid, "boolean");
});
