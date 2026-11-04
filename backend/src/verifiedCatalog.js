/**
 * A catalog oc-mirror can list without touching the network (v2.2.0 M7).
 *
 * openVerifiedCatalog() fetches the catalog over verified TLS into
 * DATA_DIR/catalog-cache (verifiedRegistry.js), serves it on loopback
 * (loopbackRegistry.js) and returns the digest-pinned loopback reference plus
 * the identities a caller should record: the source reference as written, the
 * digest it resolved to, and the platform manifest digest actually listed.
 *
 * The cache keeps the two most recent layouts per catalog repository; layouts
 * in use by a running listing are never removed.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchVerifiedImage } from "./verifiedRegistry.js";
import { serveLayout } from "./loopbackRegistry.js";

const KEEP_PER_REPOSITORY = 2;
const inUse = new Map(); // layoutDir -> count

export const catalogCacheRoot = (dataDir = process.env.DATA_DIR || "/data") => path.join(dataDir, "catalog-cache");

function prune(layoutDir) {
  const repoDir = path.dirname(layoutDir);
  let entries;
  try {
    entries = fs.readdirSync(repoDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
      const dir = path.join(repoDir, d.name);
      return { dir, mtime: fs.statSync(dir).mtimeMs };
    });
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (const { dir } of entries.slice(KEEP_PER_REPOSITORY)) {
    if (dir === layoutDir || inUse.get(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let testOpener = null;
/**
 * Tests only: replace how catalogs are opened (route tests use stub oc-mirror
 * binaries and catalog names that must not reach a network). Refused outside
 * NODE_ENV=test; there is no environment variable or API path to it.
 */
export function setCatalogOpenerForTests(fn) {
  if (process.env.NODE_ENV !== "test") throw new Error("setCatalogOpenerForTests is available in tests only.");
  testOpener = fn;
}

/**
 * @returns {Promise<{ reference, resolvedDigest, manifestDigest, localReference, trustSources, fetchedAt, close }>}
 */
export async function openVerifiedCatalog(catalogImage, opts = {}) {
  if (testOpener && process.env.NODE_ENV === "test") return testOpener(catalogImage, opts);
  const { authFile = null, dataDir, signal = null, onProgress = null, fetchOptions = {} } = opts;
  const fetched = await fetchVerifiedImage(catalogImage, { authFile, cacheRoot: catalogCacheRoot(dataDir), signal, onProgress, ...fetchOptions });
  inUse.set(fetched.layoutDir, (inUse.get(fetched.layoutDir) || 0) + 1);
  const now = new Date();
  try { fs.utimesSync(fetched.layoutDir, now, now); } catch { /* best effort */ }
  let server;
  try {
    server = await serveLayout(fetched.layoutDir);
  } catch (err) {
    inUse.set(fetched.layoutDir, inUse.get(fetched.layoutDir) - 1);
    throw err;
  }
  prune(fetched.layoutDir);
  // An explicit, empty auth file for the listing: without --authfile,
  // oc-mirror reads the default credential locations (and a "permission
  // denied" there is fatal — observed as root without XDG_RUNTIME_DIR).
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-list-auth-"));
  const emptyAuthFile = path.join(authDir, "auth.json");
  fs.writeFileSync(emptyAuthFile, '{"auths":{}}\n', { mode: 0o600 });
  let closed = false;
  return {
    ...fetched,
    localReference: server.reference(fetched.manifestDigest),
    emptyAuthFile,
    requests: server.requests,
    close: async () => {
      if (closed) return;
      closed = true;
      fs.rmSync(authDir, { recursive: true, force: true });
      await server.close();
      const n = (inUse.get(fetched.layoutDir) || 1) - 1;
      if (n <= 0) inUse.delete(fetched.layoutDir); else inUse.set(fetched.layoutDir, n);
    }
  };
}

/** oc-mirror arguments for listing a loopback catalog: digest-pinned, with an empty auth file (no credentials, none read from defaults). */
export const loopbackCatalogArgs = (localReference, emptyAuthFile = null) => [`--catalog=${localReference}`, "--src-tls-verify=false", ...(emptyAuthFile ? [`--authfile=${emptyAuthFile}`] : [])];

/**
 * Environment for that oc-mirror child: loopback is never proxied, and no
 * registry auth file is inherited (nothing on this hop needs credentials).
 */
export function loopbackListEnv(env = process.env) {
  const { REGISTRY_AUTH_FILE: _a, ...rest } = env;
  const add = (v) => ["127.0.0.1", "localhost", ...(v ? v.split(",") : [])].filter(Boolean).join(",");
  return { ...rest, NO_PROXY: add(env.NO_PROXY), no_proxy: add(env.no_proxy) };
}
