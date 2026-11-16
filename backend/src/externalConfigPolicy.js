/**
 * OpenShift Airgap Architect - external ImageSetConfiguration file policy
 * (v2.2.0 M1)
 *
 * An "external" (uploaded/server-side) ImageSetConfiguration is untrusted
 * input named by a path the client supplies. Two defects lived here:
 *
 * 1. Preflight parsed it with `await import("yaml")`. `yaml` is not a backend
 *    dependency (the backend uses js-yaml), so the import always threw and
 *    every external-config preflight reported "Config file validation failed"
 *    as a blocker, whatever the file contained.
 * 2. Preflight and run accepted ANY server path: `path.resolve(configPath)`
 *    with no root containment, so the request could point oc-mirror (and the
 *    preflight reader) at any readable file in the container.
 *
 * The path is now canonicalised with realpath (so a symlink inside an allowed
 * root cannot escape it), must be a regular file inside the same roots the
 * file browser (GET /api/fs/ls) exposes, and is size-bounded. Content is
 * checked by the shared oc-mirror v2 structural validator (M4).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import fs from "node:fs";
import path from "node:path";
import { validateImageSetConfigText, MAX_IMAGESET_CONFIG_BYTES } from "./imagesetConfigValidator.js";

export const MAX_EXTERNAL_CONFIG_BYTES = MAX_IMAGESET_CONFIG_BYTES;

const isInside = (child, root) => child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * @param {string} configPath client-supplied path
 * @param {string[]} allowedRoots absolute roots
 * @returns {{ ok: true, realPath: string } | { ok: false, reason: "missing"|"outside"|"not-file"|"too-large", message: string }}
 */
export const resolveExternalConfigPath = (configPath, allowedRoots) => {
  if (typeof configPath !== "string" || !configPath.trim()) {
    return { ok: false, reason: "missing", message: "Config path is required when using external config." };
  }
  const lexical = path.resolve(configPath.trim());
  const roots = allowedRoots.map((r) => {
    try { return fs.realpathSync(path.resolve(r)); } catch { return path.resolve(r); }
  });
  // Lexical check first so a path outside every root is refused without
  // touching (or revealing the existence of) the target.
  if (!allowedRoots.some((r) => isInside(lexical, path.resolve(r))) && !roots.some((r) => isInside(lexical, r))) {
    return { ok: false, reason: "outside", message: `Config file must be inside one of: ${allowedRoots.join(", ")}.` };
  }
  let real;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    return { ok: false, reason: "missing", message: "Config file not found." };
  }
  if (!roots.some((r) => isInside(real, r))) {
    return { ok: false, reason: "outside", message: `Config file must be inside one of: ${allowedRoots.join(", ")}.` };
  }
  let stat;
  try {
    stat = fs.statSync(real);
  } catch {
    return { ok: false, reason: "missing", message: "Config file not found." };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "not-file", message: "Config file not found." };
  }
  if (stat.size > MAX_EXTERNAL_CONFIG_BYTES) {
    return { ok: false, reason: "too-large", message: `Config file is larger than ${MAX_EXTERNAL_CONFIG_BYTES} bytes.` };
  }
  return { ok: true, realPath: real };
};

/**
 * ImageSetConfiguration checks for an external file (v2.2.0 M4): the SAME
 * shared validator Mirroring imports and every generated configuration use
 * (imagesetConfigValidator.js, against data/oc-mirror-v2/imageset-config-schema.json),
 * so Install's external-config preflight and Mirroring reject exactly the same
 * documents. Returns { blockers, warnings } as message strings, matching the
 * preflight response contract.
 */
export const checkImageSetConfigContent = (content) => {
  const result = validateImageSetConfigText(content);
  const prefix = (f) => `Config file${f.line ? ` line ${f.line}` : ""}: ${f.message}`;
  return {
    blockers: result.errors.map(prefix),
    warnings: result.warnings.map(prefix)
  };
};
