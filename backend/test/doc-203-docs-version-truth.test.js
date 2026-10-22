/**
 * DOC-203 — documentation links must never be built for a fabricated "4.0".
 *
 * GET /api/docs and POST /api/docs/update used to answer a state with no
 * selected minor as though it were OpenShift 4.0, a release that never existed:
 * docs.redhat.com URLs were built for it and cached under a `docs:4.0:…` key.
 *
 * Pinned here, for 4.20, 4.21, 4.22 and for "no version selected":
 *   - a supported minor uses exactly that minor's cache key;
 *   - no version -> GET says `versionRequired`, POST refuses with
 *     VERSION_NOT_SELECTED, and no `docs:4.0` row is ever written;
 *   - an unsupported minor -> 422 UNSUPPORTED_VERSION (No Fallback Rule);
 *   - generation with no version still fails closed rather than using "4.0".
 *
 * Supported-minor POSTs are served from a pre-seeded cache, so these tests make
 * no network requests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/index.js";
import { setState } from "../src/utils.js";
import { docsKey, getDocsFromCache, storeDocs } from "../src/docs.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };
const PLATFORM = "Bare Metal";
const METHOD = "Agent-Based Installer";
// A connectivity value no other suite uses: the backend suites share one
// DATA_DIR (and so one docs cache) across files, and seeding the real
// "fully-disconnected" key would leak these links into later generation tests.
const CONNECTIVITY = "doc203-isolated-cache-key";

function stateFor(minor) {
  const base = {
    _schemaVersion: 3,
    blueprint: { platform: PLATFORM, arch: "x86_64", clusterName: "doc203", baseDomain: "example.com" },
    methodology: { method: METHOD },
    docs: { connectivity: CONNECTIVITY, links: [] },
  };
  if (!minor) return { ...base, version: { _schemaVersion: 3, locked: false }, release: {} };
  const patch = PATCH[minor] || `${minor}.0`;
  return {
    ...base,
    version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: patch, selectedChannel: `stable-${minor}`, selectedVersion: patch, locked: true },
    release: { channel: minor, patchVersion: patch, confirmed: true },
  };
}

const fabricatedKey = () => docsKey("4.0", PLATFORM, METHOD, CONNECTIVITY);

let server, baseUrl;
before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => {
  // Leave a neutral, supported state behind for whichever suite runs next.
  setState(stateFor("4.22"));
  await closeTestServer(server);
});

const getDocs = () => fetch(`${baseUrl}/api/docs`);
const postUpdate = () =>
  fetch(`${baseUrl}/api/docs/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

describe("DOC-203 documentation endpoints use the selected supported minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: GET and POST resolve the ${minor} cache entry`, async () => {
      const links = [{ label: `doc203 ${minor}`, url: `https://docs.redhat.com/en/documentation/openshift_container_platform/${minor}/` }];
      storeDocs(docsKey(minor, PLATFORM, METHOD, CONNECTIVITY), links);
      setState(stateFor(minor));

      const got = await (await getDocs()).json();
      assert.equal(got.versionRequired, undefined);
      assert.deepEqual(got.cached?.links, links, `GET did not read the ${minor} entry`);

      const res = await postUpdate();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.cached, true, "POST should have been served from the seeded cache (no network)");
      assert.deepEqual(body.links, links);
      assert.equal(getDocsFromCache(fabricatedKey()), null, "a docs:4.0 row was written");
    });
  }
});

describe("DOC-203 no version selected: an honest answer, never 4.0", () => {
  it("GET /api/docs reports that a version is required", async () => {
    setState(stateFor(null));
    const res = await getDocs();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cached: null, versionRequired: true });
  });

  it("POST /api/docs/update refuses with VERSION_NOT_SELECTED and writes nothing", async () => {
    setState(stateFor(null));
    const res = await postUpdate();
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "VERSION_NOT_SELECTED");
    assert.match(body.error, /Select an OpenShift version/);
    assert.doesNotMatch(JSON.stringify(body), /4\.0\b/);
    assert.equal(getDocsFromCache(fabricatedKey()), null, "a docs:4.0 row was written");
  });

  it("generation with no version fails closed instead of using 4.0", async () => {
    setState(stateFor(null));
    const res = await fetch(`${baseUrl}/api/generate`);
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, "UNSUPPORTED_VERSION");
  });
});

describe("DOC-203 unsupported minor: 422, no substitution", () => {
  for (const route of ["GET", "POST"]) {
    it(`${route} returns 422 UNSUPPORTED_VERSION for 4.23`, async () => {
      setState(stateFor("4.23"));
      const res = route === "GET" ? await getDocs() : await postUpdate();
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.code, "UNSUPPORTED_VERSION");
      assert.equal(body.requestedVersion, "4.23");
      assert.equal(getDocsFromCache(docsKey("4.23", PLATFORM, METHOD, CONNECTIVITY)), null);
    });
  }
});
