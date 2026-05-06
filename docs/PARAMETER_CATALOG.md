# Parameter Catalog Reference

This document describes the parameter catalog system used to define OpenShift installation configuration parameters for different platform and installation method combinations.

**Location:** `frontend/src/data/catalogs/`

**Purpose:** Provide structured metadata about install-config.yaml and agent-config.yaml parameters, including required fields, allowed values, defaults, and documentation citations.

---

## Table of Contents

- [Overview](#overview)
- [Catalog File Structure](#catalog-file-structure)
- [Parameter Fields](#parameter-fields)
- [Field Types](#field-types)
- [Available Scenarios](#available-scenarios)
- [Usage in Code](#usage-in-code)
- [Adding New Scenarios](#adding-new-scenarios)
- [Version Upgrades](#version-upgrades)
- [Validation Rules](#validation-rules)
- [Examples](#examples)

---

## Overview

The parameter catalog system provides:

1. **Authoritative parameter definitions** - Derived from Red Hat OpenShift documentation
2. **Scenario-specific parameters** - Different catalogs for each platform/method combination
3. **Validation metadata** - Required fields, allowed values, types
4. **Documentation links** - Direct citations to official docs
5. **Version-specific support** - Catalogs tied to OpenShift versions (currently 4.20)

### Design Principles

- **Read-only at runtime** - Catalogs are static JSON files loaded at build time
- **Documentation-driven** - Each parameter includes citations to official docs
- **Scenario isolation** - Each platform/method combo has its own catalog
- **Validation optional** - Fields used for UI hints, not enforced validation

---

## Catalog File Structure

Each catalog file follows this structure:

```json
{
  "version": "4.20",
  "scenarioId": "bare-metal-agent",
  "parameters": [
    {
      "path": "baseDomain",
      "outputFile": "install-config.yaml",
      "type": "string",
      "allowed": "fully-qualified domain or subdomain",
      "default": "not specified in docs",
      "required": true,
      "description": "Base domain for cluster; used with metadata.name for routes.",
      "applies_to": ["bare-metal-agent"],
      "citations": [
        {
          "docId": "installation-config-parameters-agent",
          "docTitle": "Installation configuration parameters for the Agent-based Installer",
          "sectionHeading": "9.1.1. Required configuration parameters",
          "url": "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/..."
        }
      ]
    }
  ]
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | OpenShift version this catalog applies to (e.g., "4.20") |
| `scenarioId` | string | Unique scenario identifier (e.g., "bare-metal-agent") |
| `parameters` | array | Array of parameter definitions |

---

## Parameter Fields

Each parameter object contains the following fields:

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Parameter path in YAML (e.g., "baseDomain", "platform.baremetal.hosts") |
| `outputFile` | string | Target file ("install-config.yaml" or "agent-config.yaml") |
| `type` | string | Data type ("string", "int", "bool", "object", "array") |
| `required` | boolean | Whether parameter is required by OpenShift installer |
| `description` | string | Human-readable description of the parameter |
| `applies_to` | array | List of scenario IDs this parameter applies to |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | string | Allowed values or constraints (freeform text) |
| `default` | string | Default value if not specified (from docs) |
| `citations` | array | Documentation references (docId, docTitle, sectionHeading, url) |
| `label` | string | UI display label (if different from path) |
| `hint` | string | Additional UI hint or help text |

### Citation Structure

```json
{
  "docId": "installation-config-parameters-agent",
  "docTitle": "Installation configuration parameters for the Agent-based Installer",
  "sectionHeading": "9.1.1. Required configuration parameters",
  "url": "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `docId` | string | Unique document identifier |
| `docTitle` | string | Full document title |
| `sectionHeading` | string | Section within the document |
| `url` | string | Full URL to the documentation |

---

## Field Types

### `type` Values

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text value | `"example.com"` |
| `int` | Integer number | `3`, `23` |
| `bool` | Boolean value | `true`, `false` |
| `object` | Nested object | `{ "name": "cluster" }` |
| `array` | Array of values | `["node1", "node2"]` |

### Type Usage

- **Simple values:** Use `string`, `int`, `bool` for leaf nodes
- **Nested structures:** Use `object` for YAML objects
- **Collections:** Use `array` for lists

**Example:**
```yaml
# baseDomain: string
baseDomain: example.com

# controlPlane.replicas: int
controlPlane:
  replicas: 3

# fips: bool
fips: false

# metadata: object
metadata:
  name: my-cluster

# platform.baremetal.hosts: array
platform:
  baremetal:
    hosts:
      - name: master-0
      - name: master-1
```

---

## Available Scenarios

Scenarios are derived from platform + installation method combinations.

### Scenario ID Format

`<platform>-<method>`

- Platform: `bare-metal`, `vsphere`, `nutanix`, `aws-govcloud`, `azure-government`, `ibm-cloud`
- Method: `agent`, `ipi`, `upi`

### Current Scenarios (OCP 4.20)

| Scenario ID | Platform | Method | Catalog File |
|-------------|----------|--------|--------------|
| `bare-metal-agent` | Bare Metal | Agent-Based Installer | `bare-metal-agent.json` |
| `bare-metal-ipi` | Bare Metal | IPI | `bare-metal-ipi.json` |
| `bare-metal-upi` | Bare Metal | UPI | `bare-metal-upi.json` |
| `vsphere-agent` | VMware vSphere | Agent-Based Installer | `vsphere-agent.json` |
| `vsphere-ipi` | VMware vSphere | IPI | `vsphere-ipi.json` |
| `vsphere-upi` | VMware vSphere | UPI | `vsphere-upi.json` |
| `nutanix-ipi` | Nutanix | IPI | `nutanix-ipi.json` |
| `aws-govcloud-ipi` | AWS GovCloud | IPI | `aws-govcloud-ipi.json` |
| `aws-govcloud-upi` | AWS GovCloud | UPI | `aws-govcloud-upi.json` |
| `azure-government-ipi` | Azure Government | IPI | `azure-government-ipi.json` |
| `azure-government-upi` | Azure Government | UPI | `azure-government-upi.json` |
| `ibm-cloud-ipi` | IBM Cloud | IPI | `ibm-cloud-ipi.json` |

### Platform-Method Support Matrix

| Platform | Agent | IPI | UPI |
|----------|-------|-----|-----|
| Bare Metal | ✅ | ✅ | ✅ |
| VMware vSphere | ✅ | ✅ | ✅ |
| Nutanix | ❌ | ✅ | ❌ |
| AWS GovCloud | ❌ | ✅ | ✅ |
| Azure Government | ❌ | ✅ | ✅ |
| IBM Cloud | ❌ | ✅ | ❌ |

---

## Usage in Code

### Loading Catalogs

Catalogs are imported at build time:

```javascript
import bareMetalAgent from "./data/catalogs/bare-metal-agent.json";
import bareMetalIpi from "./data/catalogs/bare-metal-ipi.json";
// ...
```

### Resolving Scenario

```javascript
import { getScenarioId } from "./catalogResolver.js";

const scenarioId = getScenarioId(state);
// Returns: "bare-metal-agent", "vsphere-ipi", etc.
```

### Getting Parameter Metadata

```javascript
import { getParamMeta } from "./catalogFieldMeta.js";

const meta = getParamMeta(scenarioId, "baseDomain", "install-config.yaml");
// Returns: { path, type, required, description, ... }
```

### Getting Required Parameters

```javascript
import { getRequiredParamsForOutput } from "./catalogResolver.js";

const requiredPaths = getRequiredParamsForOutput(scenarioId, "install-config.yaml");
// Returns: ["apiVersion", "baseDomain", "metadata", ...]
```

### Validation (Optional)

Catalogs provide metadata for validation but **do not enforce it**. Validation happens separately in `validation.js`.

**Example: Check if field is required**
```javascript
const isRequired = meta?.required === true;
if (isRequired && !value) {
  errors.push(`${meta.path} is required`);
}
```

---

## Adding New Scenarios

### Step 1: Create Catalog File

Create `frontend/src/data/catalogs/<scenario-id>.json`:

```json
{
  "version": "4.21",
  "scenarioId": "new-platform-ipi",
  "parameters": []
}
```

### Step 2: Populate Parameters

Extract parameters from OpenShift documentation:

1. Navigate to official docs for platform/method/version
2. Find "Installation configuration parameters" section
3. For each parameter, create entry with:
   - `path` - Exact YAML path (e.g., "platform.newplatform.apiUrl")
   - `outputFile` - Target file (usually "install-config.yaml")
   - `type` - Data type from docs
   - `required` - Whether docs mark as required
   - `description` - Parameter description from docs
   - `citations` - Document reference with URL

### Step 3: Register Scenario

Update `frontend/src/catalogPaths.js`:

```javascript
import newPlatformIpi from "./data/catalogs/new-platform-ipi.json";

const CATALOGS = {
  "new-platform-ipi": newPlatformIpi.parameters,
  // ... existing scenarios
};
```

### Step 4: Add to Scenario ID Mapping

Update `frontend/src/hostInventoryV2Helpers.js`:

```javascript
export function getScenarioId(platform, method) {
  if (platform === "New Platform" && method === "IPI") return "new-platform-ipi";
  // ... existing mappings
}
```

### Step 5: Test

1. Select new platform in Blueprint step
2. Verify scenario ID resolves correctly
3. Check that parameters load in wizard
4. Validate generation produces correct YAML

---

## Version Upgrades

When upgrading to a new OpenShift version (e.g., 4.20 → 4.21):

### Process

1. **Review Documentation Changes**
   - Check for new parameters
   - Check for deprecated parameters
   - Check for changed defaults or allowed values

2. **Update Catalog Files**
   - Change `version` field to new version
   - Add new parameters
   - Mark deprecated parameters (consider removing if unused)
   - Update citations URLs to new version docs

3. **Test Generation**
   - Generate install-config.yaml with new catalogs
   - Validate against `openshift-install` for new version
   - Check for warnings/errors

4. **Update Defaults**
   - Review if any default values changed
   - Update `default` field in catalog
   - Update generation code if defaults embedded there

### Example: 4.20 → 4.21 Upgrade

```json
{
  "version": "4.21",  // Changed from "4.20"
  "scenarioId": "bare-metal-agent",
  "parameters": [
    {
      "path": "newParameter",  // Added in 4.21
      "outputFile": "install-config.yaml",
      "type": "string",
      "required": false,
      "description": "New parameter added in 4.21",
      "applies_to": ["bare-metal-agent"],
      "citations": [
        {
          "url": "https://docs.redhat.com/.../4.21/html/..."  // Updated URL
        }
      ]
    }
  ]
}
```

### Backward Compatibility

- Keep old version catalogs if supporting multiple OCP versions
- Use version-specific logic in generation code
- Document which catalog versions apply to which OCP releases

---

## Validation Rules

### Required Fields

Parameters with `"required": true` are considered mandatory by the OpenShift installer.

**UI Behavior:**
- Display "Required" badge
- Show validation error if missing
- Block generation until provided

### Allowed Values

The `allowed` field is **freeform text** describing constraints:

**Examples:**
- `"v1 (current)"` - Only v1 is allowed
- `"fully-qualified domain or subdomain"` - Format constraint
- `"3 or 1 (for SNO)"` - Specific numeric values
- `"not specified in docs"` - No constraint documented

**Implementation:**
- Frontend may use `allowed` for dropdown options
- Validation logic separate from catalog (in `validation.js`)
- Catalog provides documentation, not enforcement

### Cross-Parameter Dependencies

Catalogs do **not** encode cross-parameter dependencies. These are handled in:

- `validation.js` - Frontend validation logic
- `generate.js` - Backend generation logic

**Example: SNO requires controlPlane.replicas === 1**
- Catalog marks `controlPlane.replicas` as required
- Validation logic checks value based on topology

---

## Examples

### Example 1: Simple String Parameter

```json
{
  "path": "baseDomain",
  "outputFile": "install-config.yaml",
  "type": "string",
  "allowed": "fully-qualified domain or subdomain",
  "default": "not specified in docs",
  "required": true,
  "description": "Base domain for cluster; used with metadata.name for routes. Full DNS name is <metadata.name>.<baseDomain>.",
  "applies_to": ["bare-metal-agent"],
  "citations": [
    {
      "docId": "installation-config-parameters-agent",
      "docTitle": "Installation configuration parameters for the Agent-based Installer",
      "sectionHeading": "9.1.1. Required configuration parameters",
      "url": "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_an_on-premise_cluster_with_the_agent-based_installer/installation-config-parameters-agent"
    }
  ]
}
```

### Example 2: Integer with Specific Values

```json
{
  "path": "controlPlane.replicas",
  "outputFile": "install-config.yaml",
  "type": "int",
  "allowed": "3 or 1 (for SNO)",
  "default": "3",
  "required": true,
  "description": "Number of control plane machines. For high availability use 3; for single-node OpenShift use 1.",
  "applies_to": ["bare-metal-agent"],
  "citations": [
    {
      "docId": "installation-config-parameters-agent",
      "url": "https://docs.redhat.com/..."
    }
  ]
}
```

### Example 3: Boolean Flag

```json
{
  "path": "fips",
  "outputFile": "install-config.yaml",
  "type": "bool",
  "allowed": "true or false",
  "default": "false",
  "required": false,
  "description": "Enable FIPS mode. When true, OpenShift runs in FIPS 140-2 validated cryptographic mode.",
  "applies_to": ["bare-metal-agent", "bare-metal-ipi"],
  "citations": [
    {
      "docId": "installation-config-parameters-agent",
      "url": "https://docs.redhat.com/..."
    }
  ]
}
```

### Example 4: Nested Object

```json
{
  "path": "platform.baremetal",
  "outputFile": "install-config.yaml",
  "type": "object",
  "allowed": "not specified in docs",
  "default": "not specified in docs",
  "required": true,
  "description": "Platform-specific configuration for bare metal installations.",
  "applies_to": ["bare-metal-ipi"],
  "citations": [
    {
      "docId": "installation-config-parameters-baremetal",
      "url": "https://docs.redhat.com/..."
    }
  ]
}
```

### Example 5: Array Parameter

```json
{
  "path": "networking.machineNetwork",
  "outputFile": "install-config.yaml",
  "type": "array",
  "allowed": "list of CIDR objects with cidr key",
  "default": "not specified in docs",
  "required": false,
  "description": "IP address blocks for machines. Each entry is an object with a cidr key.",
  "applies_to": ["bare-metal-agent"],
  "citations": [
    {
      "docId": "installation-config-parameters-agent",
      "url": "https://docs.redhat.com/..."
    }
  ]
}
```

---

## Best Practices

### When Creating Catalogs

1. **Source from Official Docs** - Always derive parameters from Red Hat documentation
2. **Include Citations** - Provide exact doc section and URL for traceability
3. **Use Exact Paths** - Match YAML structure exactly (e.g., `platform.baremetal.hosts`, not `hosts`)
4. **Keep Freeform Fields Descriptive** - `allowed` and `default` should help users understand constraints
5. **Mark Optional as False** - Only set `required: true` if installer enforces it

### When Using Catalogs

1. **Don't Enforce Validation** - Catalogs are documentation, not schema validators
2. **Use for UI Hints** - Display required badges, help text, field labels
3. **Validate Separately** - Use `validation.js` for actual input validation
4. **Check Version Match** - Ensure catalog version matches target OpenShift version

### When Updating

1. **Test Against Installer** - Validate generated YAML with `openshift-install`
2. **Update All Scenarios** - If parameter applies across scenarios, update all relevant catalogs
3. **Document Breaking Changes** - Note in commit message if parameter semantics changed
4. **Maintain Citations** - Update URLs to point to correct version docs

---

## File Naming Convention

**Format:** `<platform>-<method>.json`

**Platform slugs:**
- `bare-metal`
- `vsphere`
- `nutanix`
- `aws-govcloud`
- `azure-government`
- `ibm-cloud`

**Method slugs:**
- `agent` - Agent-Based Installer
- `ipi` - Installer-Provisioned Infrastructure
- `upi` - User-Provisioned Infrastructure

**Examples:**
- `bare-metal-agent.json`
- `vsphere-ipi.json`
- `aws-govcloud-upi.json`

---

## Common Parameters Across Scenarios

Some parameters appear in most/all scenarios:

### Universal Parameters

| Path | Description | Required |
|------|-------------|----------|
| `apiVersion` | install-config API version | Yes |
| `baseDomain` | Cluster base domain | Yes |
| `metadata.name` | Cluster name | Yes |
| `networking.clusterNetwork` | Pod network CIDR | No (has default) |
| `networking.serviceNetwork` | Service network CIDR | No (has default) |
| `networking.machineNetwork` | Machine network CIDR | No (auto-detected) |
| `fips` | FIPS mode enable | No (default false) |
| `pullSecret` | Red Hat pull secret | Yes |
| `sshKey` | SSH public key | Yes (warning if missing) |

### Platform-Specific Parameters

**Bare Metal:**
- `platform.baremetal.hosts` - Host definitions
- `platform.baremetal.apiVIPs` - API VIP addresses
- `platform.baremetal.ingressVIPs` - Ingress VIP addresses

**vSphere:**
- `platform.vsphere.vcenter` - vCenter hostname
- `platform.vsphere.datacenter` - Datacenter name
- `platform.vsphere.failureDomains` - Failure domain definitions (4.16+)

**Nutanix:**
- `platform.nutanix.prismCentral` - Prism Central endpoint
- `platform.nutanix.prismElements` - Prism Element clusters
- `platform.nutanix.subnetUuids` - Network subnets

---

## Troubleshooting

### Catalog Not Loading

**Symptom:** Parameters not appearing in wizard

**Solutions:**
1. Check scenario ID resolution: `getScenarioId(state)`
2. Verify catalog file exists in `frontend/src/data/catalogs/`
3. Check import in `catalogPaths.js`
4. Verify JSON syntax (no trailing commas, proper escaping)

### Parameter Not Found

**Symptom:** `getParamMeta()` returns null/undefined

**Solutions:**
1. Check `path` matches exactly (case-sensitive, dots for nesting)
2. Verify `outputFile` matches ("install-config.yaml" vs "agent-config.yaml")
3. Ensure `applies_to` includes current scenario ID

### Generation Produces Wrong YAML

**Symptom:** Generated config doesn't match expected structure

**Solutions:**
1. Check catalog `path` matches desired YAML structure
2. Verify `type` is correct (object vs array vs string)
3. Review generation code in `backend/src/generate.js`
4. Validate against OpenShift installer schema

---

## See Also

- [STATE_SCHEMA.md](STATE_SCHEMA.md) - Application state structure
- [API.md](API.md) - Backend API reference
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture (TBD)
- [OpenShift Documentation](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/) - Official parameter docs
