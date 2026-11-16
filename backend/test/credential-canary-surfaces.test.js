/**
 * Runtime credential canary sweep — Tranche Security Gate.
 *
 * Every credential class the application actually handles is seeded with a UNIQUE,
 * unmistakably synthetic canary generated AT RUNTIME, then every surface a credential
 * could escape to is searched for the raw canary value.
 *
 * Why runtime-generated: a realistic credential-shaped literal committed to source is
 * itself a finding, and it would make the repository's own secret scanners noisy. The
 * canaries never exist on disk in tracked form.
 *
 * Why raw-byte searching: reading the parsed state back only proves the shape the API
 * returns. These tests read the SQLite file off disk as bytes, so a credential stored in
 * a column, an index, a journal page or a stray JSON blob is still caught.
 *
 * A surface that genuinely does not exist is reported N/A with evidence in the final
 * gate report, not given a fabricated passing assertion here.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// DATA_DIR must be set before importing anything that opens the database.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-canary-data-"));
process.env.DATA_DIR = DATA_DIR;

const { app } = await import("../src/index.js");
const { sanitizeStateForPersistence } = await import("../src/stateSanitizer.js");
const { buildInstallConfig, buildImageSetConfig, buildFieldManual } = await import("../src/generate.js");
const { createTestServer, closeTestServer } = await import("./helpers/httpServerLifecycle.js");

/** Unique synthetic canary per credential class. Never a real credential. */
const uniq = () => crypto.randomBytes(9).toString("hex").toUpperCase();
const canary = (cls) => `OAA_SYNTH_CANARY_${cls}_${uniq()}`;

const C = {
  RH_PULL_SECRET: canary("RHPULLSECRET"),
  MIRROR_USER: canary("MIRRORUSER"),
  MIRROR_PASS: canary("MIRRORPASS"),
  MIRROR_PULL_SECRET: canary("MIRRORPULLSECRET"),
  VCENTER_USER: canary("VCENTERUSER"),
  VCENTER_PASS: canary("VCENTERPASS"),
  BMC_USER: canary("BMCUSER"),
  BMC_PASS: canary("BMCPASS"),
  AWS_ACCESS_KEY: canary("AWSACCESSKEY"),
  AWS_SECRET_KEY: canary("AWSSECRETKEY"),
  AZURE_CLIENT_SECRET: canary("AZURECLIENTSECRET"),
  AZURE_CLIENT_ID: canary("AZURECLIENTID"),
  IBMCLOUD_API_KEY: canary("IBMCLOUDAPIKEY"),
  NUTANIX_USER: canary("NUTANIXUSER"),
  NUTANIX_PASS: canary("NUTANIXPASS"),
  PROXY_PASS: canary("PROXYPASS"),
  SSH_PRIVATE_KEY: canary("SSHPRIVATEKEY"),
  REGISTRY_PASS: canary("REGISTRYPASS"),
};

const ALL_CANARIES = Object.entries(C);

/**
 * SECRET vs IDENTIFIER.
 *
 * A username or a client ID authenticates nothing on its own; the product deliberately
 * retains them so a reloaded session stays usable, and `sanitizeCredentialFields` strips
 * `clientSecret` while keeping `clientId`. Treating identifiers as secrets would force
 * either a false failure or a weakened assertion, so the distinction is explicit and the
 * retained set is pinned by its own test.
 *
 * Everything NOT listed here is a SECRET and must never reach an unintended surface.
 */
const IDENTIFIER_CLASSES = new Set([
  "MIRROR_USER",
  "VCENTER_USER",
  "BMC_USER",
  "AWS_ACCESS_KEY",
  "AZURE_CLIENT_ID",
  "NUTANIX_USER",
]);
const SECRET_CLASSES = new Set(ALL_CANARIES.map(([k]) => k).filter((k) => !IDENTIFIER_CLASSES.has(k)));

/** A realistic-shaped state carrying every canary. */
function seededState() {
  return {
    _schemaVersion: 3,
    version: { selectedMinor: "4.21", selectedPatch: "4.21.35", selectedChannel: "stable-4.21", locked: true },
    release: { channel: "4.21", patchVersion: "4.21.35", confirmed: true },
    blueprint: {
      platform: "Bare Metal",
      clusterName: "canary-cluster",
      baseDomain: "example.com",
      arch: "x86_64",
      pullSecret: C.RH_PULL_SECRET,
    },
    methodology: { method: "IPI" },
    credentials: {
      pullSecretPlaceholder: C.RH_PULL_SECRET,
      mirrorRegistryPullSecret: C.MIRROR_PULL_SECRET,
      operatorPullSecret: C.RH_PULL_SECRET,
      registryUsername: C.MIRROR_USER,
      registryPassword: C.REGISTRY_PASS,
      sshPrivateKey: C.SSH_PRIVATE_KEY,
    },
    globalStrategy: {
      fips: false,
      proxyEnabled: true,
      proxies: {
        httpProxy: `http://proxyuser:${C.PROXY_PASS}@proxy.example.com:8080`,
        httpsProxy: `https://proxyuser:${C.PROXY_PASS}@proxy.example.com:8080`,
        noProxy: ".example.com",
      },
      mirroring: { registryFqdn: "mirror.example.com", registryUsername: C.MIRROR_USER, registryPassword: C.MIRROR_PASS },
    },
    platformConfig: {
      vsphere: {
        vcenters: [{ server: "vc.example.com", username: C.VCENTER_USER, password: C.VCENTER_PASS }],
        username: C.VCENTER_USER,
        password: C.VCENTER_PASS,
      },
      aws: { region: "us-gov-west-1", accessKeyId: C.AWS_ACCESS_KEY, secretAccessKey: C.AWS_SECRET_KEY },
      azure: { clientId: C.AZURE_CLIENT_ID, clientSecret: C.AZURE_CLIENT_SECRET, subscriptionId: "sub-1234" },
      ibmcloud: { apiKey: C.IBMCLOUD_API_KEY, region: "us-east" },
      nutanix: { prismUsername: C.NUTANIX_USER, prismPassword: C.NUTANIX_PASS, prismCentral: "pc.example.com" },
    },
    hostInventory: {
      nodes: [
        {
          hostname: "master-0",
          role: "master",
          bootMACAddress: "00:11:22:33:44:55",
          bmcAddress: "redfish://10.0.0.1/redfish/v1/Systems/1",
          bmcUsername: C.BMC_USER,
          bmcPassword: C.BMC_PASS,
        },
      ],
    },
    operators: { selected: [] },
    imagesetConfig: {},
    trust: {},
    docs: { connectivity: "fully-disconnected" },
    ui: {},
  };
}

/** Find which canaries appear in a blob of text/bytes. */
function leaked(haystack) {
  const s = typeof haystack === "string" ? haystack : String(haystack);
  return ALL_CANARIES.filter(([, v]) => s.includes(v)).map(([k]) => k);
}

let srv;
let baseUrl;

before(async () => {
  const started = await createTestServer(app);
  srv = started.server;
  baseUrl = started.baseUrl;
});

after(async () => {
  await closeTestServer(srv);
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("canary construction", () => {
  test("every credential class has a unique synthetic canary", () => {
    const values = ALL_CANARIES.map(([, v]) => v);
    assert.equal(new Set(values).size, values.length, "canaries must be unique so a leak is attributable");
    for (const v of values) assert.match(v, /^OAA_SYNTH_CANARY_[A-Z]+_[0-9A-F]{18}$/);
  });

  test("the seeded state really contains every canary", () => {
    const serialized = JSON.stringify(seededState());
    assert.deepEqual(
      leaked(serialized).sort(),
      ALL_CANARIES.map(([k]) => k).sort(),
      "if a canary is not in the seed, its surface is untested rather than proven clean"
    );
  });
});

describe("SQLite persistence carries no credential canary", () => {
  test("POST /api/state REJECTS a state carrying a credentials block", async () => {
    // Server-side control, not merely frontend discipline: the API refuses the payload.
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seededState()),
    });
    assert.equal(res.status, 400, "a credentials block must be rejected at the HTTP boundary");
    const body = await res.text();
    assert.match(body, /Credentials should not be included in state POST/);
    assert.deepEqual(leaked(body), [], "the rejection body must not echo the credentials it rejected");
  });

  test("a frontend-shaped state (credentials stripped) persists no canary to disk", async () => {
    // What the browser actually sends: getStateForPersistence has removed `credentials`,
    // but platform, BMC and proxy values are still present in the submitted state.
    const s = seededState();
    delete s.credentials;
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    assert.equal(res.status, 200, `expected the frontend-shaped state to be accepted, got ${res.status}`);

    // Read every file in the data directory as BYTES: db, -wal, -shm, journals. A value
    // in a column, an index page or a stray blob is still caught.
    const files = fs.readdirSync(DATA_DIR).filter((f) => fs.statSync(path.join(DATA_DIR, f)).isFile());
    assert.ok(files.some((f) => f.endsWith(".db")), `expected a database file in ${DATA_DIR}, saw ${files.join(", ")}`);

    const found = new Set();
    for (const f of files) {
      for (const k of leaked(fs.readFileSync(path.join(DATA_DIR, f), "latin1"))) {
        if (SECRET_CLASSES.has(k)) found.add(`${k}@${f}`);
      }
    }
    assert.deepEqual([...found], [], "SECRET canaries found in persisted database files");
  });

  test("sanitizeStateForPersistence strips every SECRET canary", () => {
    const sanitized = JSON.stringify(sanitizeStateForPersistence(seededState()));
    const secretsLeft = leaked(sanitized).filter((k) => SECRET_CLASSES.has(k));
    assert.deepEqual(secretsLeft, [], "sanitizer left SECRET canaries in the persistable state");
  });

  test("non-secret identifiers are retained deliberately, and that set is pinned", () => {
    // Usernames and client IDs are identifiers, not secrets, and are intentionally kept
    // so a reloaded session stays usable. Pinned so the set cannot grow unnoticed and so
    // a reader does not mistake retention for a leak.
    const sanitized = JSON.stringify(sanitizeStateForPersistence(seededState()));
    const retained = leaked(sanitized).sort();
    assert.deepEqual(retained, ["AZURE_CLIENT_ID", "MIRROR_USER"],
      "the retained non-secret identifier set changed; confirm each addition is genuinely not a secret");
    for (const k of retained) assert.ok(!SECRET_CLASSES.has(k), `${k} is classified SECRET but was retained`);
  });

  test("GET /api/state returns no SECRET canary", async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    const body = await res.text();
    assert.deepEqual(leaked(body).filter((k) => SECRET_CLASSES.has(k)), []);
  });
});

describe("generated artifacts carry no unintended credential canary", () => {
  test("default export: install-config carries NO credential canary, proxy included", () => {
    // The security invariant: ordinary/default export is credential-free. Proxy userinfo
    // is a credential and obeys the same opt-in rule as every other class.
    const yaml = buildInstallConfig(seededState());
    assert.deepEqual(leaked(yaml), [], "default-export install-config leaked credential canaries");
  });

  test("default export: the proxy ENDPOINT is preserved while its credentials are removed", () => {
    // Stripping must not silently drop non-secret configuration - that would be a
    // different defect wearing the same green tick.
    const yaml = buildInstallConfig(seededState());
    assert.match(yaml, /httpProxy:\s*http:\/\/proxy\.example\.com:8080/, "proxy endpoint must survive");
    assert.match(yaml, /noProxy:/);
    assert.ok(!yaml.includes(C.PROXY_PASS));
    assert.ok(!yaml.includes("proxyuser:"), "userinfo must be removed entirely");
  });

  test("explicit credential-inclusive export DOES carry the proxy credential", () => {
    // The opt-in path is deliberate inclusion, not a leak, and is tested separately.
    const s2 = seededState();
    s2.exportOptions = { includeCredentials: true };
    const yaml = buildInstallConfig(s2);
    assert.ok(yaml.includes(C.PROXY_PASS), "explicit opt-in must include the proxy credential");
  });

  test("explicit inclusion OFF behaves exactly like default/undefined", () => {
    const off = seededState(); off.exportOptions = { includeCredentials: false };
    const undef = seededState();                     // no exportOptions at all
    assert.deepEqual(leaked(buildInstallConfig(off)), []);
    assert.deepEqual(leaked(buildInstallConfig(undef)), []);
    assert.equal(buildInstallConfig(off), buildInstallConfig(undef),
      "a legacy/default boolean must not be able to grant inclusion");
  });

  test("imageset-config contains no credential canary", () => {
    const yaml = buildImageSetConfig(seededState());
    assert.deepEqual(leaked(yaml), []);
  });

  test("default export: Field Guide carries NO credential canary", () => {
    const guide = buildFieldManual(seededState(), []);
    const text = typeof guide === "string" ? guide : JSON.stringify(guide);
    assert.deepEqual(leaked(text), [], "Field Guide leaked credential canaries");
  });

  test("Field Guide keeps the proxy endpoint while removing its credentials", () => {
    const guide = buildFieldManual(seededState(), []);
    const text = typeof guide === "string" ? guide : JSON.stringify(guide);
    assert.ok(text.includes("proxy.example.com"), "proxy endpoint must survive in the guide");
    assert.ok(!text.includes(C.PROXY_PASS));
  });

  test("POST /api/preview response contains no credential canary", async () => {
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seededState()),
    });
    const body = await res.text();
    assert.deepEqual(leaked(body), [], "preview response leaked credential canaries");
  });
});

describe("error paths do not echo credentials", () => {
  const malformed = () => {
    const s = seededState();
    // Force validation/generation failure while credentials are present.
    s.version = { selectedMinor: "4.23", selectedPatch: "4.23.16", selectedChannel: "stable-4.23", locked: true };
    s.release = { channel: "4.23", patchVersion: "4.23.16", confirmed: true };
    return s;
  };

  test("unsupported-version rejection body contains no credential canary", async () => {
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(malformed()),
    });
    const body = await res.text();
    assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);
    assert.deepEqual(leaked(body), [], "HTTP error body leaked credential canaries");
  });

  test("generator throw for an unsupported minor carries no canary in the message", () => {
    let message = "";
    try {
      buildImageSetConfig(malformed());
    } catch (err) {
      message = `${err.message} ${err.stack || ""}`;
    }
    assert.ok(message.length > 0, "expected the generator to throw for 4.23");
    assert.deepEqual(leaked(message), [], "error message/stack leaked credential canaries");
  });

  test("schema-rejected state does not echo credentials back", async () => {
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...seededState(), _schemaVersion: 99 }),
    });
    const body = await res.text();
    assert.deepEqual(leaked(body), []);
  });
});

describe("temp and cache files hold no credential canary after operations", () => {
  test("no file under DATA_DIR contains a canary after the preceding operations", () => {
    const found = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        for (const k of leaked(fs.readFileSync(full, "latin1"))) {
          // Identifiers are deliberately retained (pinned by its own test above);
          // only SECRET canaries constitute a leak here.
          if (SECRET_CLASSES.has(k)) found.add(`${k}@${path.relative(DATA_DIR, full)}`);
        }
      }
    };
    walk(DATA_DIR);
    assert.deepEqual([...found], [], "SECRET canaries left behind in data/temp/cache files");
  });
});
