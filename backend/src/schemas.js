/**
 * OpenShift Airgap Architect - API Request Validation Schemas
 *
 * Zod schemas for validating all POST/PUT endpoint request bodies.
 * Prevents state corruption, API abuse, and invalid configurations.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { z } from "zod";

// ===================================================================
// COMMON SCHEMAS - Reusable building blocks
// ===================================================================

const pullSecretSchema = z.string().refine(
  (val) => {
    try {
      const parsed = JSON.parse(val);
      return parsed.auths && typeof parsed.auths === "object";
    } catch {
      return false;
    }
  },
  { message: "Pull secret must be valid JSON with auths object" }
);

const ipv4Schema = z.string().regex(
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  "Invalid IPv4 address"
);

const cidrV4Schema = z.string().regex(
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:[0-9]|[12][0-9]|3[0-2])$/,
  "Invalid IPv4 CIDR"
);

const ipv6Schema = z.string().regex(
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  "Invalid IPv6 address"
);

const macAddressSchema = z.string().regex(
  /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
  "Invalid MAC address"
);

// ===================================================================
// /api/state - State Update Schema (CRITICAL)
// ===================================================================

/**
 * Comprehensive state schema for /api/state endpoint.
 * Validates the entire application state structure to prevent corruption.
 */
export const stateUpdateSchema = z.object({
  blueprint: z.object({
    platform: z.enum([
      "Bare Metal",
      "VMware vSphere",
      "AWS GovCloud",
      "Azure Government",
      "Nutanix",
      "IBM Cloud"
    ]).optional(),
    baseDomain: z.string().min(1).max(253).optional(),
    clusterName: z.string().min(1).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    channel: z.string().optional(),
    fipsMode: z.boolean().optional(),
    pullSecretPlaceholder: pullSecretSchema.optional(),
  }).optional(),

  methodology: z.object({
    method: z.enum(["IPI", "UPI", "Agent-Based Installer"]).optional(),
  }).optional(),

  credentials: z.object({
    sshPublicKey: z.string().optional(),
    pullSecretPlaceholder: pullSecretSchema.optional(),
    mirrorRegistryPullSecret: pullSecretSchema.optional(),
    usingMirrorRegistry: z.boolean().optional(),
    mirrorRegistryUnauthenticated: z.boolean().optional(),
  }).optional(),

  globalStrategy: z.object({
    networking: z.object({
      machineNetworkV4: cidrV4Schema.optional(),
      machineNetworkV6: ipv6Schema.optional(),
      clusterNetworkCidr: cidrV4Schema.optional(),
      clusterNetworkHostPrefix: z.number().int().min(1).max(32).optional(),
      serviceNetworkCidr: cidrV4Schema.optional(),
      apiVip: ipv4Schema.optional(),
      ingressVip: ipv4Schema.optional(),
    }).optional(),
    mirroring: z.object({
      registryFqdn: z.string().max(255).optional(),
      sources: z.array(z.object({
        source: z.string(),
        mirrors: z.array(z.string()),
      })).optional(),
    }).optional(),
  }).optional(),

  hostInventory: z.object({
    nodes: z.array(z.object({
      hostname: z.string().min(1).max(63).optional(),
      role: z.enum(["master", "worker", "arbiter"]).optional(),
      primary: z.object({
        type: z.enum(["ethernet", "bond", "vlan"]).optional(),
        mode: z.enum(["dhcp", "static"]).optional(),
        ethernet: z.object({
          name: z.string().optional(),
          macAddress: macAddressSchema.optional(),
        }).optional(),
        ipv4Cidr: cidrV4Schema.optional(),
        ipv4Gateway: ipv4Schema.optional(),
      }).optional(),
      bmc: z.object({
        address: z.string().optional(),
        bootMACAddress: macAddressSchema.optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        disableCertificateVerification: z.boolean().optional(),
      }).optional(),
    })).optional(),
    apiVip: ipv4Schema.optional(),
    ingressVip: ipv4Schema.optional(),
    enableIpv6: z.boolean().optional(),
  }).optional(),

  platformConfig: z.object({
    aws: z.object({
      region: z.string().optional(),
      amiId: z.string().optional(),
      hostedZone: z.string().optional(),
    }).optional(),
    azure: z.object({
      region: z.string().optional(),
      resourceGroup: z.string().optional(),
    }).optional(),
    nutanix: z.object({
      prismCentralAddress: z.string().optional(),
      port: z.string().regex(/^\d+$/).optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional(),
  }).optional(),

  trustProxy: z.object({
    httpProxy: z.string().url().optional(),
    httpsProxy: z.string().url().optional(),
    noProxy: z.string().optional(),
    additionalTrustBundle: z.string().optional(),
    additionalTrustBundlePolicy: z.enum(["Proxyonly", "Always"]).optional(),
  }).optional(),

  visitedSteps: z.record(z.boolean()).optional(),
  completedSteps: z.record(z.boolean()).optional(),
}).passthrough(); // Allow additional properties for forward compatibility

// ===================================================================
// /api/ssh/keypair - SSH Key Generation Schema
// ===================================================================

export const sshKeypairSchema = z.object({
  algorithm: z.enum(["ed25519", "rsa", "ecdsa"]).default("ed25519"),
});

// ===================================================================
// /api/operators/scan - Operator Scan Schema
// ===================================================================

export const operatorScanSchema = z.object({
  pullSecret: pullSecretSchema.optional(), // Optional if using mounted auth
  catalog: z.string().min(1).optional(), // Optional - scans all catalogs if not specified
});

// ===================================================================
// /api/ocmirror/preflight - oc-mirror Preflight Schema
// ===================================================================

export const ocMirrorPreflightSchema = z.object({
  mode: z.enum(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]).default("mirrorToDisk"),
  archivePath: z.string().optional(),
  workspacePath: z.string().optional(),
  cachePath: z.string().optional(),
  registryUrl: z.string().max(2048).optional(),
  configSourceType: z.enum(["generated", "uploaded"]).default("generated"),
  configPath: z.string().optional(),
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
  rhPullSecret: pullSecretSchema.optional(),
  mirrorAuthSource: z.enum(["reuse", "inline"]).optional(),
  mirrorPullSecret: pullSecretSchema.optional(),
  minBytes: z.number().nonnegative().optional(),
}).passthrough(); // Allow additional fields for flexibility

// ===================================================================
// /api/ocmirror/run - oc-mirror Job Execution Schema
// ===================================================================

export const ocMirrorRunSchema = z.object({
  mode: z.enum(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]).default("mirrorToDisk"),
  archivePath: z.string().optional(), // Required for disk modes but not mirrorToMirror
  workspacePath: z.string().optional(),
  cachePath: z.string().optional(),
  registryUrl: z.string().max(2048).optional(),
  configSourceType: z.enum(["generated", "uploaded"]).default("generated"),
  configPath: z.string().optional(),
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
  rhPullSecret: pullSecretSchema.optional(),
  mirrorAuthSource: z.enum(["reuse", "inline"]).optional(),
  mirrorPullSecret: pullSecretSchema.optional(),
  configContent: z.string().optional(),
}).passthrough(); // Allow additional fields

// ===================================================================
// /api/system/path-check - Path Validation Schema
// ===================================================================

export const pathCheckSchema = z.object({
  path: z.string().min(1).max(4096),
});

// ===================================================================
// /api/feedback/submit - Feedback Submission Schema
// ===================================================================

export const feedbackSubmitSchema = z.object({
  feedbackText: z.string().min(1).max(10000),
  email: z.string().email().optional(),
  appState: z.string().max(500000).optional(), // JSON-stringified state
  includeState: z.boolean().optional(),
});

// ===================================================================
// /api/generate - YAML Generation Schema
// ===================================================================

export const generateSchema = z.object({
  // Generation endpoint accepts full state, so reuse stateUpdateSchema
  // but require certain fields
}).merge(stateUpdateSchema);

// ===================================================================
// /api/cincinnati/patches/update - Cincinnati Patches Update Schema
// ===================================================================

export const cincinnatiPatchesUpdateSchema = z.object({
  channel: z.string().min(1, "Channel is required"),
});

// ===================================================================
// /api/cincinnati/refresh-job - Cincinnati Refresh Job Schema
// ===================================================================

export const cincinnatiRefreshSchema = z.object({
  preferredChannel: z.string().optional(),
  channel: z.string().optional(),
}).passthrough();

// ===================================================================
// /api/operators/confirm - Operator Confirmation Schema
// ===================================================================

export const operatorConfirmSchema = z.object({
  operators: z.array(z.object({
    catalog: z.string(),
    name: z.string(),
    defaultChannel: z.string().optional(),
    selectedChannel: z.string().optional(),
    minVersion: z.string().optional(),
    maxVersion: z.string().optional(),
  })),
});

// ===================================================================
// /api/start-over - Start Over Schema
// ===================================================================

export const startOverSchema = z.object({
  // No body required, but accept empty object
}).passthrough();

// ===================================================================
// /api/bundle.prepare - Bundle Preparation Schema
// ===================================================================

export const bundlePrepareSchema = z.object({
  includeDocs: z.boolean().default(true),
  includeTools: z.boolean().default(true),
  includeFieldGuide: z.boolean().default(true),
}).passthrough();

// ===================================================================
// Validation Middleware Helper
// ===================================================================

/**
 * Creates Express middleware for validating request body against a Zod schema.
 *
 * @param {z.ZodSchema} schema - The Zod schema to validate against
 * @returns {Function} Express middleware function
 *
 * @example
 * app.post("/api/state", validateBody(stateUpdateSchema), (req, res) => {
 *   // req.body is now validated
 * });
 */
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      // Validate and parse the request body
      const validated = schema.parse(req.body);
      // Replace req.body with validated/transformed data
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format validation errors in a user-friendly way
        const errors = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
        }));
        return res.status(400).json({
          error: "Validation failed",
          details: errors,
        });
      }
      // Unexpected error
      return res.status(500).json({
        error: "Internal validation error",
      });
    }
  };
}
