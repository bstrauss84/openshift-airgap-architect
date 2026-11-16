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
import { OC_MIRROR_CLI_LIMITS } from "../../shared/ocMirrorCliLimits.js";
import { GO_DURATION_RE, SINCE_DATE_RE, RUN_LOG_LEVELS } from "./mirroringState.js";

// ===================================================================
// ERROR WORDING — stable across the Zod 3 → 4 migration (F20)
// ===================================================================

/**
 * Zod 4 changed every default issue message ("Required" became "Invalid
 * input: expected string, received undefined"). API clients read these
 * messages — RunOcMirrorStep translates "Required", "Invalid enum value",
 * "String must contain at least" and "at most" into field guidance — so the
 * response wording is part of the API contract and is kept exactly as Zod 3
 * produced it. Messages a schema sets itself ("Channel is required", the
 * pull-secret refine) take precedence over this map; unknown codes fall back
 * to Zod's own wording.
 */
const zod3TypeName = (value) => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isNaN(value) ? "nan" : "number";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  if (value instanceof Date) return "date";
  return typeof value;
};
const zod3Values = (values) => values.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(" | ");
const ZOD3_SIZE_NOUN = { string: ["String", "character(s)"], array: ["Array", "element(s)"], set: ["Set", "element(s)"] };

export function zod3IssueMessage(issue) {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.input === undefined) return "Required";
      if (issue.expected === "int") return `Expected integer, received ${Number.isInteger(issue.input) ? "number" : "float"}`;
      return `Expected ${issue.expected === "record" ? "object" : issue.expected}, received ${zod3TypeName(issue.input)}`;
    }
    case "invalid_value": {
      const values = issue.values || [];
      if (values.length === 1 && issue.inst?._zod?.def?.type === "literal") {
        return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      }
      if (issue.input === undefined) return "Required";
      if (values.every((v) => typeof v === "string") && typeof issue.input !== "string") {
        return `Expected ${zod3Values(values)}, received ${zod3TypeName(issue.input)}`;
      }
      return `Invalid enum value. Expected ${zod3Values(values)}, received '${issue.input}'`;
    }
    case "too_small":
    case "too_big": {
      const small = issue.code === "too_small";
      const bound = small ? issue.minimum : issue.maximum;
      if (issue.origin === "number" || issue.origin === "int") {
        const rel = small ? (issue.inclusive ? "greater than or equal to" : "greater than") : (issue.inclusive ? "less than or equal to" : "less than");
        return `Number must be ${rel} ${bound}`;
      }
      const noun = ZOD3_SIZE_NOUN[issue.origin];
      if (!noun) return undefined;
      const rel = issue.exact ? "exactly" : small ? (issue.inclusive ? "at least" : "over") : (issue.inclusive ? "at most" : "under");
      return `${noun[0]} must contain ${rel} ${bound} ${noun[1]}`;
    }
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${issue.keys.map((k) => `'${k}'`).join(", ")}`;
    case "invalid_union": {
      // Zod 3 reported the branch that matched the input's type but failed a
      // check (e.g. an array over its maximum) rather than a generic failure.
      const typed = (issue.errors || []).find((branch) => branch.length
        && !branch.some((i) => i.path.length === 0 && (i.code === "invalid_type" || i.code === "invalid_value")));
      return typed ? typed[0].message : "Invalid input";
    }
    case "invalid_key":
      // Zod 3 reported the key's own failure ("String must contain at most …").
      return issue.issues?.[0]?.message;
    default:
      return undefined;
  }
}

z.config({ customError: zod3IssueMessage });

// ===================================================================
// RESOURCE BOUNDS (GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404)
// ===================================================================

/**
 * Zod collects one issue per failing element. Zod >= 4.6.6 rejects a
 * collection whose LEADING check is a maximum size before parsing any element;
 * a collection without one is still parsed element by element. So every
 * array in these schemas starts with .max(), and records — which have no size
 * check of their own — go through boundedRecord, whose key-count check runs
 * first and stops the pipe before any entry is parsed.
 */
const boundedRecord = (keySchema, valueSchema, maxKeys) =>
  z.unknown().check((ctx) => {
    const v = ctx.value;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > maxKeys) {
      ctx.issues.push({ code: "custom", message: `Object must contain at most ${maxKeys} key(s)`, input: v, continue: false });
    }
  }).pipe(z.record(keySchema, valueSchema));

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
  // v2.2.0 Mirroring: explicit catalog minor; validated (exact + supported) by the route.
  catalogMinor: z.string().max(16).optional(),
  // v2.2.0 Mirroring: the profile that asked (recorded for Operations) and the
  // explicit source credential choice, the same contract as runs and live checks.
  profileId: z.string().regex(/^p-[A-Za-z0-9_-]{1,64}$/).optional(),
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
});

// ===================================================================
// /api/ocmirror/preflight - oc-mirror Preflight Schema
// ===================================================================

export const ocMirrorPreflightSchema = z.object({
  mode: z.enum(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]).default("mirrorToDisk"),
  // Mirroring: a full transfer (everything, not only what changed) — rebaselines the disconnected side.
  fullBaseline: z.boolean().optional(),
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
    // The binary accepts 1–10 (F12, shared/ocMirrorCliLimits.js), not 1–32.
    parallelImages: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelImages.min).max(OC_MIRROR_CLI_LIMITS.parallelImages.max).optional(),
    parallelLayers: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelLayers.min).max(OC_MIRROR_CLI_LIMITS.parallelLayers.max).optional(),
    imageTimeout: z.string().optional(),
    retryTimes: z.number().int().min(0).max(10).optional(),
    retryDelay: z.string().optional(),
    since: z.string().optional(),
    strictArchive: z.boolean().optional(),
    signatureOptions: z.object({
      disableCertified: z.boolean().optional(),
      disableCommunity: z.boolean().optional(),
      customRegistries: z.array(z.string().max(253)).max(50).optional()
    }).optional(),
    removeSignatures: z.boolean().optional()
  }).optional()
}).passthrough(); // Allow additional fields for flexibility

// ===================================================================
// /api/ocmirror/run - oc-mirror Job Execution Schema
// ===================================================================

export const ocMirrorRunSchema = z.object({
  mode: z.enum(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]).default("mirrorToDisk"),
  // Mirroring: a full transfer (everything, not only what changed) — rebaselines the disconnected side.
  fullBaseline: z.boolean().optional(),
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
    // The binary accepts 1–10 (F12, shared/ocMirrorCliLimits.js), not 1–32.
    parallelImages: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelImages.min).max(OC_MIRROR_CLI_LIMITS.parallelImages.max).optional(),
    parallelLayers: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelLayers.min).max(OC_MIRROR_CLI_LIMITS.parallelLayers.max).optional(),
    imageTimeout: z.string().optional(),
    retryTimes: z.number().int().min(0).max(10).optional(),
    retryDelay: z.string().optional(),
    since: z.string().optional(),
    strictArchive: z.boolean().optional(),
    signatureOptions: z.object({
      disableCertified: z.boolean().optional(),
      disableCommunity: z.boolean().optional(),
      customRegistries: z.array(z.string().max(253)).max(50).optional()
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
        const errors = error.issues.map((err) => ({
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

// ===================================================================
// /api/mirroring - Mirroring workflow profiles (v2.2.0 M1)
// ===================================================================

/**
 * Create/update body for a Mirroring profile. Strict: unknown keys are
 * refused, so a client cannot supply filesystem paths, history or job ids —
 * those are derived or recorded by the server. Field contents are whitelisted
 * again by mirroringState.normalizeProfile.
 */
export const mirroringProfileWriteSchema = z.object({
  name: z.string().max(80).optional(),
  content: z.object({
    platform: z.boolean().optional(),
    operators: z.boolean().optional(),
    additionalImages: z.boolean().optional(),
  }).strict().optional(),
  platform: z.object({
    release: z.object({}).passthrough().optional(),
    version: z.object({}).passthrough().optional(),
    architecture: z.string().max(16).nullable().optional(),
    graph: z.boolean().optional(),
    kubeVirtContainer: z.boolean().optional(),
  }).strict().optional(),
  operators: z.object({
    catalogMinor: z.string().max(16).nullable().optional(),
    catalogMinorSource: z.enum(["platform", "user"]).nullable().optional(),
    selected: z.array(z.object({}).passthrough()).max(500).optional(),
  }).strict().optional(),
  additionalImages: z.array(z.union([z.string(), z.object({}).passthrough()])).max(500).optional(),
  // M5: archive size in GiB per archive file — a whole number >= 1 (the
  // canonical schema's archiveSize rule); null removes it (oc-mirror default).
  options: z.object({
    archiveSize: z.number().int("Archive size must be a whole number of GiB.").min(1, "Archive size must be at least 1 GiB.").max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  }).strict().optional(),
  execution: z.object({
    mode: z.enum(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]).optional(),
    registryUrl: z.string().max(2048).optional(),
    // M5: oc-mirror options kept with the profile for its runs; null clears one.
    options: z.object({
      parallelImages: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelImages.min).max(OC_MIRROR_CLI_LIMITS.parallelImages.max).nullable().optional(),
      parallelLayers: z.number().int().min(OC_MIRROR_CLI_LIMITS.parallelLayers.min).max(OC_MIRROR_CLI_LIMITS.parallelLayers.max).nullable().optional(),
      retryTimes: z.number().int().min(0).max(10).nullable().optional(),
      retryDelay: z.string().max(16).regex(GO_DURATION_RE, "Use a duration such as 1s, 30s or 2m.").nullable().optional(),
      imageTimeout: z.string().max(16).regex(GO_DURATION_RE, "Use a duration such as 10m, 30m or 1h.").nullable().optional(),
      logLevel: z.enum(RUN_LOG_LEVELS).nullable().optional(),
      since: z.string().max(10).regex(SINCE_DATE_RE, "Use a date as yyyy-MM-dd, for example 2026-01-31.").nullable().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict();

export const mirroringEmptySchema = z.object({}).passthrough();

/**
 * POST /api/mirroring/import/analyze and /apply (M4). Files travel as base64
 * of their raw bytes so the server's UTF-8 check sees exactly what is on disk
 * (a browser text reader would silently replace invalid bytes). Bounds: 10
 * files; each base64 string fits a 1 MiB file; totals are checked again on
 * the decoded bytes.
 */
export const mirroringImportSchema = z.object({
  files: z.array(z.object({
    name: z.string().max(255),
    contentBase64: z.string().max(1400000),
  }).strict()).min(1).max(10),
  mode: z.enum(["separate", "merge", "into"]).optional(),
  profileId: z.string().max(40).nullable().optional(),
  resolutions: boundedRecord(z.string().max(400), z.string().max(8), 1000).optional(),
  names: z.array(z.string().max(80)).max(10).optional(),
}).strict();

/** POST /api/mirroring/profiles/:id/imports/:importId/review — leave unresolved items out, explicitly. */
export const mirroringImportReviewSchema = z.object({
  action: z.literal("omit"),
  itemIds: z.union([z.literal("all"), z.array(z.string().max(40)).min(1).max(200)]),
}).strict();

/** POST /api/mirroring/profiles/:id/reconcile-catalog — explicit catalog/platform conflict resolution (M4). */
export const mirroringReconcileCatalogSchema = z.object({
  action: z.enum(["align", "split"]),
}).strict();

/** POST /api/mirroring/active — the profile the Mirroring UI has open, or null. */
export const mirroringActiveSchema = z.object({
  profileId: z.string().max(40).nullable(),
}).strict();

/**
 * POST /api/mirroring/profiles/:id/verify-catalogs (M5). The pull secret is
 * used for this check only and never stored; "mounted" uses the secret
 * mounted into the container.
 */
export const mirroringVerifyCatalogsSchema = z.object({
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
  rhPullSecret: pullSecretSchema.optional(),
}).strict();

/** POST /api/mirroring/profiles/:id/transfer (M6): the mirror-to-disk run to transfer. */
export const mirroringTransferPrepareSchema = z.object({
  jobId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
  // M7 (DOC-155): prepare even though oc-mirror left a catalog unpinned; the
  // manifest then records the transfer as not offline-ready.
  acknowledgeUnpinned: z.boolean().optional(),
}).strict();

/** POST /api/mirroring/profiles/:id/operations/:jobId/retry — fresh credentials for the attempt only. */
export const mirroringRetrySchema = z.object({
  rhAuthSource: z.enum(["inline", "mounted"]).optional(),
  rhPullSecret: pullSecretSchema.optional(),
  mirrorAuthSource: z.enum(["inline"]).optional(),
  mirrorPullSecret: pullSecretSchema.optional(),
  registryUrl: z.string().max(2048).optional(),
  isolateNetwork: z.boolean().optional()
}).strict();

/** POST /api/mirroring/profiles/:id/storage: one of the approved storage roots (container path). */
export const mirroringStorageChoiceSchema = z.object({
  base: z.string().min(1).max(1024).refine((v) => v.startsWith("/"), "Use an absolute path.")
}).strict();

/** POST /api/mirroring/receive (M6): a directory on the server that holds a transfer. */
export const mirroringReceiveSchema = z.object({
  transferDir: z.string().min(1).max(4096),
}).strict();
