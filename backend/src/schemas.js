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
 * POST /api/state — permissive schema on purpose.
 *
 * The wizard persists the full client state object. A strict nested Zod shape
 * strips unknown keys inside known objects (Zod default), which removed fields
 * like blueprint.arch / blueprint.confirmed and large parts of globalStrategy,
 * breaking operator scans ("waiting to scan"), bundle download, and generation.
 * Main branch did not validate this body with Zod. Structural checks belong in
 * the route handler (see index.js) and in frontend validation — not here.
 */
export const stateUpdateSchema = z.object({}).catchall(z.unknown());

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

export const generateSchema = z.object({}).catchall(z.unknown());

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
