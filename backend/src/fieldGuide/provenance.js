/**
 * Field Guide Provenance Certification (FG-4.21-C)
 *
 * Deterministic provenance certification for Field Guide assembly inputs.
 * Fails closed before believable markdown is returned if version-specific
 * sources are unsupported, mixed between 4.20 and 4.21, inconsistent with
 * the strictly resolved minor, unattributable, ambiguous because of duplicate
 * compartment IDs, or claim unsupported 4.22 provenance.
 *
 * Input classifications (enforced, not merely labelled):
 *   VERSION_SPECIFIC — compartments from versioned v4.20/v4.21 exports,
 *                      certified against stable identity inventory
 *   SHARED           — renderer and troubleshooting source, explicitly bound
 *                      and certified at the assembler boundary
 *   RUNTIME_METADATA — caller-supplied docsLinks, shape-validated with no
 *                      URL-based version inference
 *
 * @module backend/src/fieldGuide/provenance
 */

import { FIELD_GUIDE_SUPPORTED_MINORS } from "./versionResolution.js";
import { compartments_v420 } from "./v4.20/index.js";
import { compartments_v421 } from "./v4.21/index.js";

class ProvenanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProvenanceError';
    this.code = 'PROVENANCE_ERROR';
    this.resolvedMinor = details.resolvedMinor || null;
    this.compartmentId = details.compartmentId || null;
    this.sourceIdentity = details.sourceIdentity || null;
    this.invariant = details.invariant || null;
  }
}

const INPUT_CLASSIFICATION = Object.freeze({
  VERSION_SPECIFIC: 'version-specific',
  SHARED: 'shared',
  RUNTIME_METADATA: 'runtime-metadata',
});

function getAuthoritativeExport(minor) {
  if (minor === '4.21') return compartments_v421;
  if (minor === '4.20') return compartments_v420;
  return null;
}

// Stable object-identity inventory captured at module initialization.
// Derived from the original v4.20/v4.21 exports without hard-coded counts or IDs.
// Certification rejects any object not in this inventory as unattributable.
const originalExportInventory = new Map();

for (const minor of FIELD_GUIDE_SUPPORTED_MINORS) {
  const authoritative = getAuthoritativeExport(minor);
  if (authoritative && Array.isArray(authoritative)) {
    originalExportInventory.set(minor, new Set(authoritative));
  }
}

// Accepted shared input registry — bound by the assembler at module level,
// certified at render time. Function identity is the provenance key.
const acceptedSharedInputs = new Map();

function registerAcceptedSharedInput(fn, classification) {
  if (typeof fn !== 'function') {
    throw new ProvenanceError(
      'Shared input must be a function reference',
      { invariant: 'accepted-shared-binding' }
    );
  }
  acceptedSharedInputs.set(fn, classification);
}

function certifySharedInput(fn, label) {
  if (!acceptedSharedInputs.has(fn)) {
    throw new ProvenanceError(
      `"${label}" is not bound as an accepted shared input`,
      { invariant: 'accepted-shared-binding' }
    );
  }
  const classification = acceptedSharedInputs.get(fn);
  if (classification !== INPUT_CLASSIFICATION.SHARED) {
    throw new ProvenanceError(
      `"${label}" is classified as "${classification}", expected "${INPUT_CLASSIFICATION.SHARED}"`,
      { invariant: 'shared-classification-mismatch' }
    );
  }
}

function getAcceptedSharedInputs() {
  return new Map(acceptedSharedInputs);
}

function certifyExport(minor) {
  if (!FIELD_GUIDE_SUPPORTED_MINORS.includes(minor)) {
    throw new ProvenanceError(
      `Unsupported version "${minor}" for provenance certification. ` +
      `Supported: ${FIELD_GUIDE_SUPPORTED_MINORS.join(', ')}`,
      { resolvedMinor: minor, invariant: 'supported-version' }
    );
  }

  const authoritative = getAuthoritativeExport(minor);
  if (!authoritative || !Array.isArray(authoritative) || authoritative.length === 0) {
    throw new ProvenanceError(
      `No authoritative compartment export found for version "${minor}"`,
      { resolvedMinor: minor, invariant: 'export-exists' }
    );
  }

  const originalIdentity = originalExportInventory.get(minor);
  if (!originalIdentity) {
    throw new ProvenanceError(
      `No original identity inventory for version "${minor}"`,
      { resolvedMinor: minor, invariant: 'inventory-exists' }
    );
  }

  const seenIds = new Set();

  for (const compartment of authoritative) {
    if (compartment == null || typeof compartment !== 'object') {
      throw new ProvenanceError(
        `Entry in "${minor}" export is not a valid compartment object ` +
        `(received ${compartment === null ? 'null' : typeof compartment})`,
        { resolvedMinor: minor, invariant: 'compartment-shape' }
      );
    }

    // Check against stable identity inventory first — rejects injected,
    // substituted, or otherwise unattributable objects
    if (!originalIdentity.has(compartment)) {
      let foreignVersion = null;
      for (const [otherMinor, otherSet] of originalExportInventory) {
        if (otherMinor !== minor && otherSet.has(compartment)) {
          foreignVersion = otherMinor;
          break;
        }
      }
      if (foreignVersion) {
        throw new ProvenanceError(
          `Compartment "${compartment.id || '<unknown>'}" in "${minor}" export is the same object ` +
          `as in "${foreignVersion}" export (cross-version identity substitution)`,
          {
            resolvedMinor: minor,
            compartmentId: compartment.id || null,
            sourceIdentity: foreignVersion,
            invariant: 'no-cross-version-identity',
          }
        );
      }
      throw new ProvenanceError(
        `Compartment "${compartment.id || '<unknown>'}" in "${minor}" export is not in the ` +
        `original "${minor}" inventory (unattributable source)`,
        {
          resolvedMinor: minor,
          compartmentId: compartment.id || null,
          invariant: 'unattributable-source',
        }
      );
    }

    for (const otherMinor of FIELD_GUIDE_SUPPORTED_MINORS) {
      if (otherMinor === minor) continue;
      const otherExport = getAuthoritativeExport(otherMinor);
      if (otherExport && otherExport.includes(compartment)) {
        throw new ProvenanceError(
          `Compartment "${compartment.id || '<unknown>'}" in "${minor}" export also appears ` +
          `in current "${otherMinor}" export (exclusive export membership violated)`,
          {
            resolvedMinor: minor,
            compartmentId: compartment.id || null,
            sourceIdentity: otherMinor,
            invariant: 'exclusive-export-membership',
          }
        );
      }
    }

    if (!compartment.id || typeof compartment.id !== 'string' || !compartment.id.trim()) {
      throw new ProvenanceError(
        `Compartment in "${minor}" export has empty or missing ID`,
        { resolvedMinor: minor, invariant: 'nonempty-id' }
      );
    }

    if (seenIds.has(compartment.id)) {
      throw new ProvenanceError(
        `Duplicate compartment ID "${compartment.id}" in "${minor}" export`,
        { resolvedMinor: minor, compartmentId: compartment.id, invariant: 'unique-id' }
      );
    }
    seenIds.add(compartment.id);

    if (compartment.version !== minor) {
      throw new ProvenanceError(
        `Compartment "${compartment.id}" has version "${compartment.version}" ` +
        `but is in "${minor}" export. Resolved minor: "${minor}"`,
        { resolvedMinor: minor, compartmentId: compartment.id, invariant: 'version-consistency' }
      );
    }
  }

  for (const original of originalIdentity) {
    if (!authoritative.includes(original)) {
      let movedTo = null;
      for (const otherMinor of FIELD_GUIDE_SUPPORTED_MINORS) {
        if (otherMinor === minor) continue;
        const otherExport = getAuthoritativeExport(otherMinor);
        if (otherExport && otherExport.includes(original)) {
          movedTo = otherMinor;
          break;
        }
      }
      if (movedTo) {
        throw new ProvenanceError(
          `Original "${minor}" compartment "${original.id || '<unknown>'}" was moved to ` +
          `"${movedTo}" export (inventory completeness violated)`,
          {
            resolvedMinor: minor,
            compartmentId: original.id || null,
            sourceIdentity: movedTo,
            invariant: 'inventory-completeness',
          }
        );
      }
      throw new ProvenanceError(
        `Original "${minor}" compartment "${original.id || '<unknown>'}" is missing from ` +
        `current "${minor}" export (inventory completeness violated)`,
        {
          resolvedMinor: minor,
          compartmentId: original.id || null,
          invariant: 'inventory-completeness',
        }
      );
    }
  }

  return authoritative;
}

function validateSelectedSubset(selected, certified, minor) {
  const certifiedSet = new Set(certified);
  for (const compartment of selected) {
    if (!certifiedSet.has(compartment)) {
      throw new ProvenanceError(
        `Selected compartment "${compartment.id || '<unknown>'}" is not in the ` +
        `certified "${minor}" export (unattributable input)`,
        {
          resolvedMinor: minor,
          compartmentId: compartment.id || null,
          invariant: 'identity-preserving-subset',
        }
      );
    }
  }
}

function certifyDocRefs(compartments, resolvedMinor) {
  for (const compartment of compartments) {
    if (compartment.docRefs === undefined) continue;
    const cId = compartment.id || '<unknown>';

    if (!Array.isArray(compartment.docRefs)) {
      throw new ProvenanceError(
        `Compartment "${cId}" docRefs must be an array, received ${typeof compartment.docRefs}`,
        {
          resolvedMinor,
          compartmentId: compartment.id || null,
          invariant: 'docref-shape',
        }
      );
    }

    for (let i = 0; i < compartment.docRefs.length; i++) {
      const entry = compartment.docRefs[i];

      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ProvenanceError(
          `Compartment "${cId}" docRefs[${i}] is not a valid object`,
          {
            resolvedMinor,
            compartmentId: compartment.id || null,
            invariant: 'docref-entry-shape',
          }
        );
      }

      if (typeof entry.label !== 'string' || !entry.label.trim()) {
        throw new ProvenanceError(
          `Compartment "${cId}" docRefs[${i}] missing or empty "label" field`,
          {
            resolvedMinor,
            compartmentId: compartment.id || null,
            invariant: 'docref-entry-shape',
          }
        );
      }

      if (typeof entry.url !== 'string' || !entry.url.trim()) {
        throw new ProvenanceError(
          `Compartment "${cId}" docRefs[${i}] missing or empty "url" field`,
          {
            resolvedMinor,
            compartmentId: compartment.id || null,
            invariant: 'docref-entry-shape',
          }
        );
      }

      let parsed;
      try {
        parsed = new URL(entry.url);
      } catch {
        throw new ProvenanceError(
          `Compartment "${cId}" docRefs[${i}] URL is not parseable: "${entry.url}"`,
          {
            resolvedMinor,
            compartmentId: compartment.id || null,
            invariant: 'docref-url-parseable',
          }
        );
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ProvenanceError(
          `Compartment "${cId}" docRefs[${i}] URL scheme "${parsed.protocol}" is not HTTP(S): "${entry.url}"`,
          {
            resolvedMinor,
            compartmentId: compartment.id || null,
            invariant: 'docref-url-scheme',
          }
        );
      }

      if (parsed.hostname === 'docs.redhat.com') {
        const segments = parsed.pathname.split('/').filter(s => s.length > 0);
        const ocpIndex = segments.indexOf('openshift_container_platform');
        if (ocpIndex !== -1) {
          const versionSegment = segments[ocpIndex + 1];
          if (!versionSegment || versionSegment !== resolvedMinor) {
            throw new ProvenanceError(
              `Compartment "${cId}" docRefs[${i}] official OCP documentation URL version ` +
              `"${versionSegment || '<missing>'}" does not match resolved minor "${resolvedMinor}"`,
              {
                resolvedMinor,
                compartmentId: compartment.id || null,
                invariant: 'docref-ocp-version-match',
              }
            );
          }
        }
      }
    }
  }
}

function classifyDocsLinks(docsLinks) {
  if (docsLinks === null || docsLinks === undefined) return [];
  if (!Array.isArray(docsLinks)) {
    throw new ProvenanceError(
      `docsLinks must be an array, received ${typeof docsLinks}`,
      { invariant: 'runtime-metadata-shape' }
    );
  }
  for (let i = 0; i < docsLinks.length; i++) {
    const link = docsLinks[i];
    if (!link || typeof link !== 'object') {
      throw new ProvenanceError(
        `docsLinks[${i}] is not a valid object`,
        { invariant: 'runtime-metadata-shape' }
      );
    }
    if (typeof link.url !== 'string' || !link.url.trim()) {
      throw new ProvenanceError(
        `docsLinks[${i}] missing or empty "url" field`,
        { invariant: 'runtime-metadata-shape' }
      );
    }
    if (typeof link.label !== 'string' || !link.label.trim()) {
      throw new ProvenanceError(
        `docsLinks[${i}] missing or empty "label" field`,
        { invariant: 'runtime-metadata-shape' }
      );
    }
  }
  return docsLinks;
}

export {
  ProvenanceError,
  INPUT_CLASSIFICATION,
  certifyExport,
  certifyDocRefs,
  validateSelectedSubset,
  classifyDocsLinks,
  getAuthoritativeExport,
  registerAcceptedSharedInput,
  certifySharedInput,
  getAcceptedSharedInputs,
};
