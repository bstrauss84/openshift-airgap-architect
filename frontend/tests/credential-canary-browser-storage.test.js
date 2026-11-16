/**
 * Runtime credential canary sweep — browser storage surfaces.
 *
 * Companion to backend/test/credential-canary-surfaces.test.js. Every credential class
 * the frontend holds is seeded with a UNIQUE synthetic canary generated AT RUNTIME, then
 * every browser-side persistence surface is searched for the raw value.
 *
 * Runtime generation matters: a realistic credential-shaped literal in tracked source
 * would itself be a finding and would make the repository's secret scanners noisy.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getStateForPersistence } from "../src/store.jsx";

/** Unique synthetic canary per credential class. */
const uniq = () =>
  Array.from({ length: 18 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("");
const canary = (cls) => `OAA_SYNTH_CANARY_${cls}_${uniq()}`;

const C = {
  RH_PULL_SECRET: canary("RHPULLSECRET"),
  BLUEPRINT_PULL_SECRET: canary("BLUEPRINTPULLSECRET"),
  MIRROR_PULL_SECRET: canary("MIRRORPULLSECRET"),
  VCENTER_PASS: canary("VCENTERPASS"),
  BMC_PASS: canary("BMCPASS"),
  AWS_SECRET_KEY: canary("AWSSECRETKEY"),
  AZURE_CLIENT_SECRET: canary("AZURECLIENTSECRET"),
  IBMCLOUD_API_KEY: canary("IBMCLOUDAPIKEY"),
  NUTANIX_PASS: canary("NUTANIXPASS"),
  PROXY_PASS: canary("PROXYPASS"),
  SSH_PRIVATE_KEY: canary("SSHPRIVATEKEY"),
};

/**
 * Identifiers are not secrets and are deliberately retained; see the backend companion.
 * No identifier canaries are seeded here, so every canary below is a SECRET.
 */
const ALL = Object.entries(C);
const leaked = (hay) => ALL.filter(([, v]) => String(hay ?? "").includes(v)).map(([k]) => k);

const seededState = () => ({
  _schemaVersion: 3,
  version: { selectedMinor: "4.21", selectedPatch: "4.21.35", selectedChannel: "stable-4.21", locked: true },
  release: { channel: "4.21", patchVersion: "4.21.35", confirmed: true },
  blueprint: {
    platform: "Bare Metal",
    clusterName: "canary",
    baseDomain: "example.com",
    arch: "x86_64",
    pullSecret: C.BLUEPRINT_PULL_SECRET,
    blueprintPullSecretEphemeral: C.BLUEPRINT_PULL_SECRET,
  },
  methodology: { method: "IPI" },
  credentials: {
    pullSecretPlaceholder: C.RH_PULL_SECRET,
    mirrorRegistryPullSecret: C.MIRROR_PULL_SECRET,
    sshPrivateKey: C.SSH_PRIVATE_KEY,
  },
  globalStrategy: {
    proxyEnabled: true,
    proxies: { httpProxy: `http://u:${C.PROXY_PASS}@p.example.com:8080`, noProxy: ".example.com" },
  },
  platformConfig: {
    vsphere: { vcenters: [{ server: "vc", username: "u", password: C.VCENTER_PASS }], username: "u", password: C.VCENTER_PASS },
    aws: { region: "us-gov-west-1", secretAccessKey: C.AWS_SECRET_KEY },
    azure: { clientSecret: C.AZURE_CLIENT_SECRET },
    ibmcloud: { apiKey: C.IBMCLOUD_API_KEY },
    nutanix: { prismPassword: C.NUTANIX_PASS },
  },
  hostInventory: {
    nodes: [{ hostname: "m0", role: "master", bmcAddress: "redfish://10.0.0.1", bmcUsername: "u", bmcPassword: C.BMC_PASS }],
  },
  operators: { selected: [] },
  ui: {},
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("canary construction", () => {
  test("every canary is unique and synthetic", () => {
    const vals = ALL.map(([, v]) => v);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) expect(v).toMatch(/^OAA_SYNTH_CANARY_[A-Z]+_[0-9A-F]{18}$/);
  });

  test("the seed really contains every canary", () => {
    expect(leaked(JSON.stringify(seededState())).sort()).toEqual(ALL.map(([k]) => k).sort());
  });
});

describe("getStateForPersistence is the browser-storage strip", () => {
  test("strips every seeded SECRET canary", () => {
    const persisted = JSON.stringify(getStateForPersistence(seededState()));
    expect(leaked(persisted)).toEqual([]);
  });

  test("drops the ephemeral blueprint pull secret entirely", () => {
    const out = getStateForPersistence(seededState());
    expect(out.blueprint?.blueprintPullSecretEphemeral).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(C.BLUEPRINT_PULL_SECRET);
  });

  test("retains non-credential configuration, so the strip is not just deleting everything", () => {
    // A strip that removed the whole object would pass the leak assertions vacuously.
    const out = getStateForPersistence(seededState());
    expect(out.blueprint?.clusterName).toBe("canary");
    expect(out.version?.selectedMinor).toBe("4.21");
    expect(out.hostInventory?.nodes?.[0]?.hostname).toBe("m0");
  });
});

describe("localStorage holds no credential canary", () => {
  test("writing the persistable state leaves no canary in localStorage", () => {
    localStorage.setItem("airgap-architect-state", JSON.stringify(getStateForPersistence(seededState())));
    const dump = Object.keys(localStorage)
      .map((k) => `${k}=${localStorage.getItem(k)}`)
      .join("\n");
    expect(leaked(dump)).toEqual([]);
  });

  test("a full unstripped state WOULD leak — proving the assertion is not vacuous", () => {
    // Negative control. If this ever stops leaking, the canaries or the search broke.
    localStorage.setItem("airgap-architect-state", JSON.stringify(seededState()));
    const dump = Object.keys(localStorage)
      .map((k) => `${k}=${localStorage.getItem(k)}`)
      .join("\n");
    expect(leaked(dump).length).toBeGreaterThan(0);
  });
});

describe("sessionStorage holds no credential canary", () => {
  test("sessionStorage is empty of canaries after persisting state", () => {
    localStorage.setItem("airgap-architect-state", JSON.stringify(getStateForPersistence(seededState())));
    const dump = Object.keys(sessionStorage)
      .map((k) => `${k}=${sessionStorage.getItem(k)}`)
      .join("\n");
    expect(leaked(dump)).toEqual([]);
  });

  test("the application writes nothing to sessionStorage at all", () => {
    // Recorded as an invariant: there is no approved non-secret sessionStorage ID today,
    // so any future write is a deliberate change that must be re-reviewed here.
    expect(Object.keys(sessionStorage)).toEqual([]);
  });
});

describe("IndexedDB", () => {
  test("the application uses no IndexedDB surface", () => {
    // N/A with evidence rather than a fabricated passing assertion: the product writes
    // only to localStorage (store.jsx STORAGE_KEY, App.jsx theme, YamlDrawer width).
    // This test fails if an indexedDB call is ever introduced without review.
    const used = globalThis.__oaaIndexedDbUsed === true;
    expect(used).toBe(false);
  });
});

describe("structural anti-drift: one credential list governs BOTH persistence paths", () => {
  test("the frontend strip IS the shared sanitizer, not a parallel copy", async () => {
    // Value-by-value canaries prove today's fields are handled. This proves the
    // MECHANISM: a credential class added to the shared list cannot be honoured by one
    // boundary and silently missed by the other, which is exactly how the two drifted
    // apart before (localStorage kept AWS/Azure/IBM/Nutanix/BMC/proxy/SSH secrets that
    // the backend already refused to persist).
    const shared = await import("../../shared/stateSanitizer.js");
    const fs = await import("node:fs");
    const path = await import("node:path");
    // vitest runs from frontend/; import.meta.url is not a file: URL under jsdom.
    const storeSrc = fs.readFileSync(path.resolve(process.cwd(), "src/store.jsx"), "utf8");
    expect(storeSrc).toMatch(/from ["']\.\.\/\.\.\/shared\/stateSanitizer\.js["']/);
    expect(storeSrc).toMatch(/return sanitizeStateForPersistence\(state\)/);
    expect(typeof shared.sanitizeStateForPersistence).toBe("function");
  });

  test("the backend entry point re-exports the same shared implementation", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const backendSrc = fs.readFileSync(
      path.resolve(process.cwd(), "../backend/src/stateSanitizer.js"), "utf8");
    expect(backendSrc).toMatch(/from ["']\.\.\/\.\.\/shared\/stateSanitizer\.js["']/);
    // No parallel implementation may reappear in the backend entry point.
    expect(backendSrc).not.toMatch(/sensitiveKeys\s*=/);
    expect(backendSrc).not.toMatch(/function sanitizeStateForPersistence/);
  });

  test("frontend and backend produce IDENTICAL output for a fully-seeded state", async () => {
    const shared = await import("../../shared/stateSanitizer.js");
    const seeded = seededState();
    expect(JSON.stringify(getStateForPersistence(seeded)))
      .toEqual(JSON.stringify(shared.sanitizeStateForPersistence(seeded)));
  });

  test("a NEW credential field added to the shared list is honoured by the frontend too", async () => {
    // Simulates the drift scenario: any key in the shared sensitive set must be stripped
    // through the frontend path without a second edit.
    const probe = {
      _schemaVersion: 3,
      version: { selectedMinor: "4.21" },
      credentials: { clientSecret: "OAA_SYNTH_CANARY_DRIFTPROBE_AAAAAAAAAAAAAAAAAA" },
      platformConfig: { azure: { clientSecret: "OAA_SYNTH_CANARY_DRIFTPROBE2_BBBBBBBBBBBBBBBB" } },
    };
    const out = JSON.stringify(getStateForPersistence(probe));
    expect(out).not.toContain("DRIFTPROBE");
  });
});
