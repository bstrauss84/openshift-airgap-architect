/**
 * OpenShift Airgap Architect - container image reference check (v2.2.0)
 *
 * One rule for "is this a usable image reference" shared by the Mirroring
 * additional-images editor, its bulk import and (later) Install. Mirrors the
 * server's policy in backend/src/mirroringState.js: the same characters, the
 * same 512-character limit, a registry or repository path, and a :tag or an
 * @sha256: digest so the exact image is known.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const IMAGE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/;
export const MAX_IMAGE_REF_LENGTH = 512;

/** "" for a usable reference (or an empty value), otherwise the reason it is not. */
export const validateImageRef = (value) => {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.length > MAX_IMAGE_REF_LENGTH) return `An image reference can be at most ${MAX_IMAGE_REF_LENGTH} characters.`;
  if (!IMAGE_REF_RE.test(v)) return "Use a container image reference without spaces or quotes, for example quay.io/org/app:v1.";
  if (!v.includes("/")) return "Include the registry or repository path, for example quay.io/org/app:v1.";
  if (!/[:@]/.test(v.split("/").pop())) return "Add a :tag or an @sha256: digest so the exact image is known.";
  return "";
};
