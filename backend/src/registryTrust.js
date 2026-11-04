/**
 * Certificate trust for OAA's own registry connections (v2.2.0 M7).
 *
 * OAA fetches operator catalogs itself, over verified TLS, so that catalog
 * content and registry credentials only ever travel over connections OAA has
 * verified. The trust OAA applies must
 * be the trust oc-mirror applies when it mirrors (mirror to disk, mirror to mirror),
 * otherwise a catalog could check out here and then fail — or worse, pass
 * here and nowhere else. So this copies the two sources oc-mirror reads:
 *
 *  1. Go's crypto/x509 system roots on Linux (root_unix.go / root_linux.go):
 *     SSL_CERT_FILE, when set, REPLACES the default bundle list; otherwise the
 *     first readable file of that list is used. SSL_CERT_DIR (colon-separated),
 *     when set, REPLACES the default directories; every file in them is read.
 *  2. containers/image per-registry CAs: `*.crt` in
 *     /etc/containers/certs.d/<host[:port]>/, ~/.config/containers/certs.d/<host[:port]>/
 *     and /etc/docker/certs.d/<host[:port]>/.
 *
 * Node's bundled Mozilla roots and NODE_EXTRA_CA_CERTS are deliberately NOT
 * used here: oc-mirror never sees them. Passing `ca` to Node TLS replaces its
 * defaults, so what is returned is exactly what is trusted.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Go 1.25 crypto/x509 root_linux.go, in order.
export const GO_CERT_FILES = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/ca-bundle.pem",
  "/etc/pki/tls/cacert.pem",
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  "/etc/ssl/cert.pem"
];
export const GO_CERT_DIRS = ["/etc/ssl/certs", "/etc/pki/tls/certs"];

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const MAX_TRUST_FILE_BYTES = 8 * 1024 * 1024;

const readPems = (file) => {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_TRUST_FILE_BYTES) return [];
    return fs.readFileSync(file, "utf8").match(PEM_RE) || [];
  } catch {
    return [];
  }
};

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
};

/** Directory names containers/image looks up for a registry host[:port]. */
export const certsDirsFor = (host, { env = process.env, home = os.homedir() } = {}) => {
  const roots = ["/etc/containers/certs.d", path.join(env.HOME || home, ".config/containers/certs.d"), "/etc/docker/certs.d"];
  return roots.map((r) => path.join(r, host));
};

/**
 * The CA certificates oc-mirror would trust for `host` (host[:port]).
 * @returns {{ ca: string[], sources: string[], systemFile: string|null }}
 */
export function registryTrustFor(host, { env = process.env } = {}) {
  const ca = [];
  const sources = [];
  const add = (file) => {
    const pems = readPems(file);
    if (pems.length) {
      ca.push(...pems);
      sources.push(file);
    }
    return pems.length > 0;
  };

  let systemFile = null;
  if (env.SSL_CERT_FILE) {
    if (add(env.SSL_CERT_FILE)) systemFile = env.SSL_CERT_FILE;
  } else {
    for (const f of GO_CERT_FILES) {
      if (add(f)) { systemFile = f; break; }
    }
  }
  const dirs = env.SSL_CERT_DIR ? env.SSL_CERT_DIR.split(":").filter(Boolean) : GO_CERT_DIRS;
  for (const d of dirs) {
    for (const f of listDir(d)) {
      // The default directories also hold the bundle already read above.
      if (f === systemFile) continue;
      add(f);
    }
  }
  for (const d of certsDirsFor(host, { env })) {
    for (const f of listDir(d)) if (f.endsWith(".crt")) add(f);
  }
  return { ca: [...new Set(ca)], sources, systemFile };
}
