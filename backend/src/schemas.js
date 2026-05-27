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
import logger, { generateErrorId } from "./logger.js";

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
  advanced: z.object({
    logLevel: z.enum(["info", "debug"]).optional(),
    parallelImages: z.number().int().min(1).max(32).optional(),
    parallelLayers: z.number().int().min(1).max(32).optional(),
    imageTimeout: z.string().optional(),
    retryTimes: z.number().int().min(0).max(10).optional(),
    retryDelay: z.string().optional(),
    since: z.string().optional(),
    strictArchive: z.boolean().optional(),
    signatureOptions: z.object({
      disableCertified: z.boolean().optional(),
      disableCommunity: z.boolean().optional(),
      customRegistries: z.array(z.string()).optional()
    }).optional(),
    removeSignatures: z.boolean().optional()
  }).optional()
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
  advanced: z.object({
    logLevel: z.enum(["info", "debug"]).optional(),
    parallelImages: z.number().int().min(1).max(32).optional(),
    parallelLayers: z.number().int().min(1).max(32).optional(),
    imageTimeout: z.string().optional(),
    retryTimes: z.number().int().min(0).max(10).optional(),
    retryDelay: z.string().optional(),
    since: z.string().optional(),
    strictArchive: z.boolean().optional(),
    signatureOptions: z.object({
      disableCertified: z.boolean().optional(),
      disableCommunity: z.boolean().optional(),
      customRegistries: z.array(z.string()).optional()
    }).optional(),
    removeSignatures: z.boolean().optional()
  }).optional()
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
  category: z.string().max(100).optional(),
  severity: z.string().max(100).optional(),
  summary: z.string().max(5000).optional(),
  details: z.string().max(50000).optional(),
  contactRequested: z.boolean().optional(),
  contactHandle: z.string().max(500).optional(),
  challengeToken: z.string().max(1024).optional(),
  uiContext: z.string().max(200).optional(),
  honeypot: z.string().max(500).optional(),
}).passthrough();

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
  preferredChannel: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
}).passthrough();

// ===================================================================
// /api/operators/confirm - Operator Confirmation Schema
// ===================================================================

/**
 * POST /api/operators/confirm reads from server state.
 * Frontend sends no body. Accept empty or any object for compatibility.
 */
export const operatorConfirmSchema = z.object({}).passthrough();

// ===================================================================
// /api/start-over - Start Over Schema
// ===================================================================

export const startOverSchema = z.object({
  cancelRunningOcMirror: z.boolean().optional(),
}).passthrough();

// ===================================================================
// /api/bundle.prepare - Bundle Preparation Schema
// ===================================================================

/**
 * POST /api/bundle.prepare accepts optional client state.
 * Uses parseOptionalClientState for deep validation.
 */
export const bundlePrepareSchema = z.object({
  state: z.object({}).catchall(z.unknown()).optional().nullable(),
}).passthrough();

// ===================================================================
// /api/run/import - Run Import Schema
// ===================================================================

export const runImportSchema = z.object({
  schemaVersion: z.number().int().min(1).max(2).optional(),
  state: z.object({}).catchall(z.unknown()),
  exportedAt: z.string().optional(),
  runId: z.string().optional(),
}).passthrough();

// ===================================================================
// /api/run/duplicate - Run Duplicate Schema
// ===================================================================

/**
 * POST /api/run/duplicate reads entirely from server state.
 * Body is unused but accepted as empty for compatibility.
 */
export const runDuplicateSchema = z.object({}).passthrough();

// ===================================================================
// /api/cincinnati/update - Cincinnati Update Schema
// ===================================================================

/**
 * POST /api/cincinnati/update forces a channel refresh.
 * No body fields are used but accepted as empty for compatibility.
 */
export const cincinnatiUpdateSchema = z.object({}).passthrough();

// ===================================================================
// /api/operators/prefetch - Operator Prefetch Schema
// ===================================================================

/**
 * POST /api/operators/prefetch reads from server state.
 * No body fields are used but accepted as empty for compatibility.
 */
export const operatorsPrefetchSchema = z.object({}).passthrough();

// ===================================================================
// /api/jobs/:id/stop - Job Stop Schema
// ===================================================================

/**
 * POST /api/jobs/:id/stop uses job ID from URL param only.
 * No body fields are used but accepted as empty for compatibility.
 */
export const jobStopSchema = z.object({}).passthrough();

// ===================================================================
// /api/docs/update - Docs Update Schema
// ===================================================================

/**
 * POST /api/docs/update reads entirely from server state.
 * No body fields are used but accepted as empty for compatibility.
 */
export const docsUpdateSchema = z.object({}).passthrough();

// ===================================================================
// /api/aws/warm-installer - AWS Warm Installer Schema
// ===================================================================

export const awsWarmInstallerSchema = z.object({
  version: z.string().min(1, "Version is required").max(100).optional(),
  arch: z.string().max(50).optional(),
}).passthrough();

// ===================================================================
// /api/trust/analyze - Trust Analysis Schema
// ===================================================================

export const trustAnalyzeSchema = z.object({
  state: z.object({}).catchall(z.unknown()).optional().nullable(),
}).passthrough();

// ===================================================================
// /api/bundle.zip - Bundle Zip Schema
// ===================================================================

/**
 * POST /api/bundle.zip accepts optional client state.
 * Uses parseOptionalClientState for deep validation.
 */
export const bundleZipSchema = z.object({
  state: z.object({}).catchall(z.unknown()).optional().nullable(),
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
        const errorId = generateErrorId();
        // Format validation errors in a user-friendly way
        const errors = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
        }));

        // Log validation failure with structured logging
        logger.warn({
          errorId,
          requestId: req.requestId,
          errors,
          path: req.path,
          method: req.method,
        }, "Validation failed");

        return res.status(400).json({
          error: "Validation failed",
          errorId,
          details: errors,
        });
      }
      // Unknown validation error
      const errorId = generateErrorId();
      logger.error({ errorId, err: error }, "Internal validation error");
      return res.status(500).json({
        error: "Internal validation error",
        errorId,
      });
    }
  };
}
