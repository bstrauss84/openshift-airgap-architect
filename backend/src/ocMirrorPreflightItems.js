/**
 * OpenShift Airgap Architect - structured oc-mirror preflight checks (v2.2.0 M5)
 *
 * The preflight used to answer with flat `blockers` / `warnings` strings plus a
 * loose `checks` object. Both workflows now also get `items`: one entry per
 * thing that was checked, so the UI can show what passed as well as what did
 * not, with a status that is never conveyed by colour alone.
 *
 *   { id, status, label, detail }
 *   status: "pass" | "warn" | "block" | "unverified" | "info"
 *
 * "unverified" is distinct from "pass": it means the check could not be made
 * here (for example, live catalogs were not reachable), and says so. The flat
 * `blockers` / `warnings` lists are unchanged and stay authoritative for `ok`.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";

export const PREFLIGHT_STATUSES = Object.freeze(["pass", "warn", "block", "unverified", "info"]);

export const item = (id, status, label, detail) => ({ id, status, label, detail });

const gib = (bytes) => (Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} GiB free` : null);

const fromFieldError = (fieldErrors, key) => {
  const e = fieldErrors[key];
  if (!e) return null;
  return e.severity === "blocker" ? "block" : "warn";
};

const pathItem = (id, label, dir, check, fieldErrors, key, purpose) => {
  const status = fromFieldError(fieldErrors, key);
  if (status) return item(id, status, label, `${dir || "(not set)"} — ${fieldErrors[key].message}`);
  if (!check) return item(id, "info", label, `${dir} — ${purpose}`);
  const state = check.exists ? "exists" : "will be created";
  const space = gib(check.freeBytes);
  return item(id, "pass", label, `${dir} — ${state}${check.writable || check.creatable ? ", writable" : ""}${space ? `, ${space}` : ""}. ${purpose}`);
};

/** Hostnames a pull secret carries credentials for — names only, never values. */
export const authRegistriesOf = (pullSecret) => {
  try {
    const auths = JSON.parse(String(pullSecret || ""))?.auths;
    return auths && typeof auths === "object" ? Object.keys(auths).sort() : [];
  } catch {
    return [];
  }
};

/**
 * Registry host of an image reference, as container tools resolve it: the
 * first path segment when it has a dot or a port or is localhost, else
 * Docker Hub.
 */
export const registryOfImage = (ref) => {
  const first = String(ref || "").split("/")[0];
  return String(ref || "").includes("/") && (/[.:]/.test(first) || first === "localhost") ? first : "docker.io";
};

/**
 * How oc-mirror will verify registry certificates in this container. oc-mirror
 * is a Go program: it trusts the system store plus SSL_CERT_FILE / SSL_CERT_DIR.
 */
export const describeTrust = (env = process.env) => {
  const configured = ["SSL_CERT_FILE", "SSL_CERT_DIR"].filter((k) => env[k]);
  if (!configured.length) {
    return item("trust", "info", "Registry certificate trust", "oc-mirror, and Architect's own catalog downloads, verify registry certificates against this container's system trust store plus any /etc/containers/certs.d/<host>/ca.crt. No additional CA bundle is configured (SSL_CERT_FILE / SSL_CERT_DIR).");
  }
  const missing = configured.filter((k) => !fs.existsSync(env[k]));
  if (missing.length) {
    return item("trust", "block", "Registry certificate trust", `${missing.join(" and ")} point${missing.length === 1 ? "s" : ""} to ${missing.map((k) => env[k]).join(", ")}, which does not exist in this container, so registries signed by that CA would fail certificate checks.`);
  }
  // Go semantics (registryTrust.js): SSL_CERT_FILE replaces only the bundle
  // FILE; the default directories (which on RHEL/UBI hold the system bundle
  // too) are still read unless SSL_CERT_DIR replaces them.
  const filePart = env.SSL_CERT_FILE ? `SSL_CERT_FILE=${env.SSL_CERT_FILE} (in place of the system bundle file)` : "the system bundle file";
  const dirPart = env.SSL_CERT_DIR ? `SSL_CERT_DIR=${env.SSL_CERT_DIR} (in place of /etc/ssl/certs and /etc/pki/tls/certs)` : "every certificate in /etc/ssl/certs and /etc/pki/tls/certs";
  return item("trust", "pass", "Registry certificate trust", `oc-mirror and Architect's catalog downloads trust ${filePart}, ${dirPart}, and any /etc/containers/certs.d/<host>/ca.crt.`);
};

/** The oc-mirror binary a run would use, as found without downloading anything. */
export const toolItem = (peek) => {
  if (!peek) return item("tool", "warn", "oc-mirror binary", "No local oc-mirror binary is available. The run downloads the latest release from mirror.openshift.com (clients/ocp/latest) and verifies it against that channel's sha256sum.txt first, which needs access to mirror.openshift.com.");
  if (peek.error) return item("tool", "block", "oc-mirror binary", peek.error);
  const t = peek.tool;
  const version = t?.version || "unknown";
  return item("tool", "pass", "oc-mirror binary", `${version}${t?.gitCommit ? ` (commit ${t.gitCommit.slice(0, 7)})` : ""} · SHA-256 ${t?.sha256 || "unknown"} · ${peek.source === "env" ? "from OC_MIRROR_BIN" : peek.source === "baked-in" ? "built into this image" : peek.source}`);
};

/**
 * Items for what computeOcMirrorPreflight already checked.
 */
/**
 * The OKD-documented placeholder for registries that need no credentials
 * (https://github.com/orgs/okd-project/discussions/1930): base64 of "id:pass\n".
 * Install's "Anonymous pulls" and Mirroring's anonymous destination use it.
 */
export const OKD_PLACEHOLDER_AUTH = "aWQ6cGFzcwo=";

/** True when every entry of a destination credential is the OKD placeholder (anonymous access). */
export const isAnonymousPlaceholder = (authJson) => {
  try {
    const auths = JSON.parse(authJson)?.auths;
    const entries = auths && typeof auths === "object" ? Object.values(auths) : [];
    return entries.length > 0 && entries.every((e) => e?.auth === OKD_PLACEHOLDER_AUTH);
  } catch {
    return false;
  }
};

export function sharedPreflightItems({ mode, checks, fieldErrors, archivePath, workspacePath, cachePath, registryUrl, configSourceType, rhPullSecret, rhAuthSource, mirrorPullSecret = null, tool, trust, redHatContent = true, imageRegistries = [] }) {
  const items = [];
  if (mode === "mirrorToDisk" || mode === "diskToMirror") {
    items.push(pathItem("archive", mode === "mirrorToDisk" ? "Archive destination" : "Archive source", archivePath, checks.archivePath, fieldErrors, "archivePath",
      mode === "mirrorToDisk" ? "oc-mirror writes the mirror_*.tar archives and working-dir here." : "oc-mirror reads the archives and working-dir from here."));
  }
  if (mode === "mirrorToMirror") {
    items.push(pathItem("workspace", "Workspace", workspacePath, checks.workspacePath, fieldErrors, "workspacePath", "oc-mirror keeps its working-dir here between runs."));
  }
  items.push(pathItem("cache", "Cache", cachePath, checks.cachePath, fieldErrors, "cachePath", "oc-mirror's local image cache, reused by later runs."));

  if (mode !== "diskToMirror") {
    const label = redHatContent ? "Red Hat pull secret" : "Pull secret";
    const st = fromFieldError(fieldErrors, "rhPullSecret");
    const registries = authRegistriesOf(rhPullSecret);
    if (st) {
      items.push(item("credentials", st, label, fieldErrors.rhPullSecret.message));
    } else if (checks.auth === "absent") {
      items.push(item("credentials", "info", label, "No pull secret: oc-mirror pulls anonymously, so any registry that requires a login will refuse the images."));
    } else {
      items.push(item("credentials", "pass", label, `${rhAuthSource === "mounted" ? "Mounted pull secret" : "Provided for this run only, not stored"}; credentials for ${registries.join(", ") || "the listed registries"}.`));
    }
    if (!st && redHatContent && registries.length && !registries.includes("registry.redhat.io")) {
      items.push(item("credentials-redhat", "warn", "registry.redhat.io credentials", "The pull secret has no entry for registry.redhat.io, where OpenShift release and Red Hat operator content is pulled from."));
    }
    const uncovered = [...new Set(imageRegistries)].filter((r) => !registries.includes(r) && !(r === "docker.io" && registries.some((x) => /docker\.io$/.test(x))));
    if (!st && uncovered.length) {
      items.push(item("credentials-images", "info", "Image registry credentials", `No credentials for ${uncovered.join(", ")}. That is fine when those registries allow anonymous pulls; otherwise add them to the pull secret.`));
    }
  }
  if (mode !== "mirrorToDisk") {
    const st = fromFieldError(fieldErrors, "mirrorPullSecret") || fromFieldError(fieldErrors, "registryUrl");
    items.push(st
      ? item("registry", st, "Mirror registry", (fieldErrors.registryUrl || fieldErrors.mirrorPullSecret).message)
      : item("registry", "pass", "Mirror registry", isAnonymousPlaceholder(mirrorPullSecret)
        ? `${registryUrl}; anonymous access — the OKD placeholder credential, no real account. The registry must accept pushes without logging in.`
        : `${registryUrl}; credentials provided for this run only.`));
  }

  const cfg = fromFieldError(fieldErrors, "configPath");
  items.push(cfg
    ? item("config", cfg, "ImageSetConfiguration", fieldErrors.configPath.message)
    : item("config", "pass", "ImageSetConfiguration", configSourceType === "generated" ? "Generated by Architect and checked against the oc-mirror v2 schema." : "External file found and checked against the oc-mirror v2 schema."));

  const optionKeys = ["parallelImages", "parallelLayers", "retryTimes", "retryDelay", "imageTimeout", "logLevel", "since"];
  const badOptions = optionKeys.filter((k) => fieldErrors[k]);
  items.push(badOptions.length
    ? item("options", "block", "oc-mirror options", badOptions.map((k) => fieldErrors[k].message).join(" "))
    : item("options", "pass", "oc-mirror options", "Within the ranges oc-mirror accepts."));

  if (tool !== undefined) items.push(toolItem(tool));
  if (trust) items.push(trust);
  return items;
}
