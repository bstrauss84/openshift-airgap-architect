/**
 * Deterministic tests for the component inventory generator.
 *
 * FIXTURES ONLY — miniature lockfiles and a trimmed rpm query transcript. No
 * image is started and no network is touched, so the suite runs identically
 * on a host with no container engine.
 *
 * The assertions are mostly about SCOPE and about REFUSAL, because those are
 * the two properties that distinguish this document from a reassuring one: a
 * frontend production dependency must not be classifiable as "not shipped",
 * and a generation missing any source must refuse rather than emit a BOM
 * whose absent scope is indistinguishable from an empty one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  SCOPES,
  SHIPPED_SCOPES,
  NPM_SCOPE_MAP,
  RPM_QUERY_FORMAT,
  packageNameFromLockPath,
  npmPurl,
  integrityToHash,
  componentsFromLockfile,
  rpmComponentsFromQuery,
  rpmComponentsFromImage,
  externalBinaryComponents,
  deterministicSerialNumber,
  scopeTally,
  buildCycloneDx,
  generateInventory,
  canonicalSubjectImages,
} from "./sbomGenerate.mjs";

const b64 = (hex) => Buffer.from(hex, "hex").toString("base64");
const sha512Hex = (s) => createHash("sha512").update(s).digest("hex");

const BACKEND_LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { name: "airgap-architect-backend", version: "2.1.0-dev" },
    "node_modules/express": { version: "4.21.2", resolved: "https://registry.npmjs.org/express/-/express-4.21.2.tgz", integrity: `sha512-${b64(sha512Hex("express"))}` },
    "node_modules/better-sqlite3": { version: "11.5.0" },
    "node_modules/vitest": { version: "2.1.9", dev: true },
    "node_modules/@types/node": { version: "22.9.0", devOptional: true },
  },
};

const FRONTEND_LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { name: "airgap-architect-frontend", version: "2.1.0-dev" },
    "node_modules/react": { version: "18.3.1" },
    "node_modules/@patternfly/react-core": { version: "5.4.1" },
    "node_modules/vite": { version: "5.4.11", dev: true },
    "node_modules/jsdom": { version: "25.0.1", dev: true, optional: true },
  },
};

/** Trimmed from the real `rpm -qa` transcript of the backend image. */
const RPM_OUT = [
  "redhat-release|(none)|9.8|1.0.el9|x86_64|redhat-release-9.8-1.0.el9.src.rpm",
  "gpg-pubkey|(none)|fd431d51|4ae0493b|(none)|(none)",
  "setup|(none)|2.13.7|10.el9|noarch|setup-2.13.7-10.el9.src.rpm",
  "openssl|1|3.2.2|6.el9_5.1|x86_64|openssl-3.2.2-6.el9_5.1.src.rpm",
  "",
].join("\n");

const EXTERNAL = {
  complete: true,
  reason: null,
  baked: [
    {
      tool: "oc",
      version: "4.22.17",
      sha256: "466f6c5d060479fca2096b85367c88759ecabe3d12e1328e7debbbd60e3420a7",
      installedSha256: "d3c21a0d2ab0be00e9967b81747f4d29981732c72c0c2327cd233d86479500fd",
      checksumCovers: "openshift-client-linux.tar.gz",
      checksumVerified: true,
      path: "/usr/local/bin/oc",
      url: "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest-4.22/openshift-client-linux.tar.gz",
    },
  ],
  runtimeAcquired: [
    { tool: "openshift-install", acquisition: "downloaded at request time", urlTemplate: "https://example.invalid/x", checksumVerified: false, finding: "no SHA256 verification" },
  ],
  verificationGaps: [{ tool: "openshift-install", finding: "no SHA256 verification" }],
};

const scopeOf = (c) => c.properties.find((p) => p.name === "oaa:scope").value;
const byName = (components, name) => components.find((c) => c.name === name);

describe("lockfile component extraction", () => {
  test("backend production dependencies are SHIPPED_RUNTIME; its devDependencies are BUILDER_ONLY", () => {
    const res = componentsFromLockfile(BACKEND_LOCK, { component: "backend" });
    assert.equal(res.ok, true);
    assert.equal(scopeOf(byName(res.components, "express")), SCOPES.SHIPPED_RUNTIME);
    assert.equal(scopeOf(byName(res.components, "better-sqlite3")), SCOPES.SHIPPED_RUNTIME);
    assert.equal(scopeOf(byName(res.components, "vitest")), SCOPES.BUILDER_ONLY);
  });

  test("devOptional counts as a devDependency edge, so it is BUILDER_ONLY", () => {
    const res = componentsFromLockfile(BACKEND_LOCK, { component: "backend" });
    assert.equal(scopeOf(byName(res.components, "@types/node")), SCOPES.BUILDER_ONLY);
  });

  test("THE 7C LESSON: frontend production deps are SHIPPED_BUNDLED, never builder-only", () => {
    const res = componentsFromLockfile(FRONTEND_LOCK, { component: "frontend" });
    assert.equal(scopeOf(byName(res.components, "react")), SCOPES.SHIPPED_BUNDLED);
    assert.equal(scopeOf(byName(res.components, "@patternfly/react-core")), SCOPES.SHIPPED_BUNDLED);
    assert.ok(SHIPPED_SCOPES.includes(SCOPES.SHIPPED_BUNDLED));
  });

  test("the frontend build toolchain stays BUILDER_ONLY and is NOT silently dropped", () => {
    const res = componentsFromLockfile(FRONTEND_LOCK, { component: "frontend" });
    assert.equal(scopeOf(byName(res.components, "vite")), SCOPES.BUILDER_ONLY);
    assert.equal(scopeOf(byName(res.components, "jsdom")), SCOPES.BUILDER_ONLY);
  });

  test("a bundled component declares that its inclusion is NOT proven", () => {
    const react = byName(componentsFromLockfile(FRONTEND_LOCK, { component: "frontend" }).components, "react");
    assert.equal(react.properties.find((p) => p.name === "oaa:inclusionProven").value, "false");
    assert.match(react.properties.find((p) => p.name === "oaa:inclusionBasis").value, /tree-shaking/);
  });

  test("a shipped-runtime component makes no inclusion-proof claim, because its files are present", () => {
    const express = byName(componentsFromLockfile(BACKEND_LOCK, { component: "backend" }).components, "express");
    assert.equal(express.properties.find((p) => p.name === "oaa:inclusionProven"), undefined);
  });

  test("the root package entry is excluded — it is the subject, not a dependency", () => {
    const res = componentsFromLockfile(BACKEND_LOCK, { component: "backend" });
    assert.equal(byName(res.components, "airgap-architect-backend"), undefined);
  });

  test("an unsupported lockfileVersion is refused rather than best-effort parsed", () => {
    assert.equal(componentsFromLockfile({ lockfileVersion: 1, packages: {} }, { component: "backend" }).ok, false);
    assert.match(componentsFromLockfile({ lockfileVersion: 1 }, { component: "backend" }).reason, /unsupported lockfileVersion/);
  });

  test("a component with no declared scope mapping is refused, never defaulted to builder-only", () => {
    const res = componentsFromLockfile(BACKEND_LOCK, { component: "some-new-service" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /no scope mapping declared/);
  });

  test("bom-refs are unique even when npm installs one name@version at several paths", () => {
    // CycloneDX 1.5 requires bom-ref to be unique within a BOM, and VEX
    // addresses components BY bom-ref — so a repeated ref makes a statement
    // about one nested copy silently cover all of them. The real backend tree
    // hits this: buffer@6.0.3 is installed under archiver, compress-commons
    // and crc32-stream.
    const res = componentsFromLockfile(BACKEND_LOCK, { component: "backend" });
    const refs = res.components.map((c) => c["bom-ref"]);
    const dupes = refs.filter((r, i) => refs.indexOf(r) !== i);
    assert.deepEqual(dupes, [], `duplicate bom-refs: ${[...new Set(dupes)].join(", ")}`);
    assert.equal(new Set(refs).size, res.components.length);
  });

  test("a name@version installed twice yields two distinct, path-qualified refs", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root", version: "1.0.0" },
        "node_modules/archiver": { version: "8.0.0" },
        "node_modules/archiver/node_modules/buffer": { version: "6.0.3" },
        "node_modules/crc32-stream/node_modules/buffer": { version: "6.0.3" },
      },
    };
    const refs = componentsFromLockfile(lock, { component: "backend" }).components
      .filter((c) => c.name === "buffer")
      .map((c) => c["bom-ref"]);
    assert.equal(refs.length, 2);
    assert.notEqual(refs[0], refs[1]);
    // The purl stays identical — it identifies the package, not the install
    // site. Uniqueness has to live in the ref, which is what VEX points at.
    for (const r of refs) assert.match(r, /^backend:shipped-runtime:buffer@6\.0\.3#node_modules\//);
  });

  test("every component declared in NPM_SCOPE_MAP maps prod to a SHIPPED scope", () => {
    for (const [name, m] of Object.entries(NPM_SCOPE_MAP)) {
      assert.ok(SHIPPED_SCOPES.includes(m.prod), `${name} prod scope ${m.prod} is not a shipped scope`);
      assert.equal(m.dev, SCOPES.BUILDER_ONLY);
    }
  });
});

describe("purls and hashes", () => {
  test("scoped package purls are encoded the way npm encodes them", () => {
    assert.equal(npmPurl("@patternfly/react-core", "5.4.1"), "pkg:npm/%40patternfly/react-core@5.4.1");
    assert.equal(npmPurl("react", "18.3.1"), "pkg:npm/react@18.3.1");
  });

  test("a lockfile integrity becomes a hex CycloneDX hash", () => {
    const hex = sha512Hex("express");
    assert.deepEqual(integrityToHash(`sha512-${b64(hex)}`), { alg: "SHA-512", content: hex });
  });

  test("a truncated or unknown integrity yields no hash rather than an unverifiable one", () => {
    assert.equal(integrityToHash("sha512-dHJ1bmNhdGVk"), null);
    assert.equal(integrityToHash("md5-abc"), null);
    assert.equal(integrityToHash(undefined), null);
  });

  test("a package with no integrity is still inventoried, just without a hash", () => {
    const c = byName(componentsFromLockfile(BACKEND_LOCK, { component: "backend" }).components, "better-sqlite3");
    assert.ok(c);
    assert.equal(c.hashes, undefined);
  });

  test("nested lock paths resolve to the innermost package name", () => {
    assert.equal(packageNameFromLockPath("node_modules/a/node_modules/@s/b"), "@s/b");
    assert.equal(packageNameFromLockPath("not/a/module/path"), null);
  });
});

describe("OS packages from the image rpmdb", () => {
  test("rpm output becomes SHIPPED_OS components with rpm purls and epoch handling", () => {
    const res = rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" });
    assert.equal(res.ok, true);
    const openssl = byName(res.components, "openssl");
    assert.equal(openssl.version, "1:3.2.2-6.el9_5.1");
    assert.match(openssl.purl, /^pkg:rpm\/redhat\/openssl@/);
    assert.match(openssl.purl, /arch=x86_64/);
    assert.equal(scopeOf(openssl), SCOPES.SHIPPED_OS);
  });

  test("an absent epoch does not become the literal string (none)", () => {
    const res = rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" });
    assert.equal(byName(res.components, "setup").version, "2.13.7-10.el9");
  });

  test("gpg-pubkey pseudo-packages are excluded explicitly, not dropped silently", () => {
    const res = rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" });
    assert.equal(byName(res.components, "gpg-pubkey"), undefined);
    assert.equal(res.excluded.length, 1);
    assert.match(res.excluded[0].reason, /signing key/);
  });

  test("OS components are marked image-derived, not package-manager-derived", () => {
    const res = rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" });
    assert.match(byName(res.components, "setup").properties.find((p) => p.name === "oaa:derivation").value, /image-derived/);
  });

  test("an unparseable line refuses the whole OS inventory rather than returning a short one", () => {
    const res = rpmComponentsFromQuery(`${RPM_OUT}\nthis-is-not-a-record`, { imageRole: "backend" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /refusing a partial OS inventory/);
  });

  test("empty rpm output is a failure, not an empty-but-ok inventory", () => {
    assert.equal(rpmComponentsFromQuery("", { imageRole: "backend" }).ok, false);
  });

  test("the in-image query fails closed with no engine, no id, or a non-zero exit", () => {
    assert.equal(rpmComponentsFromImage(null, "id").ok, false);
    assert.equal(rpmComponentsFromImage("podman", null).ok, false);
    const runner = () => ({ status: 1, stdout: "", stderr: "rpm: not found\n", spawnError: null, timedOut: false });
    const res = rpmComponentsFromImage("podman", "id", { runner, imageRole: "frontend" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /rpm: not found/);
  });

  test("the in-image query passes the documented format string to rpm", () => {
    let seen = null;
    const runner = (_c, args) => {
      seen = args;
      return { status: 0, stdout: RPM_OUT, stderr: "", spawnError: null, timedOut: false };
    };
    const res = rpmComponentsFromImage("podman", "sha256:abc", { runner, imageRole: "backend" });
    assert.equal(res.ok, true);
    assert.ok(seen.includes(RPM_QUERY_FORMAT));
    assert.ok(seen.includes("--network=none"), "the rpm query must not be able to reach the network");
  });
});

describe("external binary components", () => {
  test("the component hash is the MEASURED binary, with the tarball checksum kept as a labelled property", () => {
    const [oc] = externalBinaryComponents(EXTERNAL);
    assert.deepEqual(oc.hashes, [{ alg: "SHA-256", content: EXTERNAL.baked[0].installedSha256 }]);
    assert.equal(oc.properties.find((p) => p.name === "oaa:distributionTarballSha256").value, EXTERNAL.baked[0].sha256);
    assert.equal(oc.properties.find((p) => p.name === "oaa:distributionTarball").value, "openshift-client-linux.tar.gz");
  });

  test("runtime-acquired tools appear as components and carry their verification finding", () => {
    const comps = externalBinaryComponents(EXTERNAL);
    const installer = byName(comps, "openshift-install");
    assert.ok(installer);
    assert.equal(installer.properties.find((p) => p.name === "oaa:checksumVerified").value, "false");
    assert.match(installer.properties.find((p) => p.name === "oaa:finding").value, /no SHA256 verification/);
  });

  test("external binaries say in the document that no SBOM generator sees them", () => {
    const [oc] = externalBinaryComponents(EXTERNAL);
    assert.match(oc.properties.find((p) => p.name === "oaa:note").value, /absent from any Syft-generated SBOM/);
  });
});

describe("document assembly is deterministic", () => {
  const lockfiles = [
    { component: "backend", lock: BACKEND_LOCK },
    { component: "frontend", lock: FRONTEND_LOCK },
  ];
  const osInventories = [{ role: "backend", ...rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" }) }];
  const spec = {
    lockfiles,
    osInventories,
    externalBinaries: EXTERNAL,
    timestamp: "2026-10-13T00:00:00.000Z",
    subject: { type: "application", name: "openshift-airgap-architect", version: "2.1.0-dev" },
  };

  test("the same inputs produce byte-identical output", () => {
    const a = generateInventory(spec);
    const b = generateInventory(spec);
    assert.equal(a.ok, true);
    assert.equal(JSON.stringify(a.bom), JSON.stringify(b.bom));
  });

  test("the serial number is derived from the content, so it moves only when components move", () => {
    const a = generateInventory(spec).bom;
    const changed = generateInventory({
      ...spec,
      lockfiles: [{ component: "backend", lock: { ...BACKEND_LOCK, packages: { ...BACKEND_LOCK.packages, "node_modules/express": { version: "4.21.3" } } } }, lockfiles[1]],
    }).bom;
    assert.notEqual(a.serialNumber, changed.serialNumber);
    assert.match(a.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  });

  test("component order does not change the serial number", () => {
    const comps = generateInventory(spec).bom.components;
    assert.equal(deterministicSerialNumber([...comps].sort((x, y) => x.name.localeCompare(y.name))), deterministicSerialNumber([...comps].sort((x, y) => x.name.localeCompare(y.name))));
  });

  test("the clock is never read: an omitted timestamp throws instead of defaulting to now", () => {
    assert.throws(() => buildCycloneDx({ components: [{ name: "x", version: "1", properties: [] }], subject: {}, derivation: "d" }), /explicit timestamp/);
  });

  test("the BOM states its derivation, what it does not cover, and that it is not a substitute for an image scan", () => {
    const bom = generateInventory(spec).bom;
    const prop = (n) => bom.metadata.properties.find((p) => p.name === n).value;
    assert.match(prop("oaa:derivation"), /package-manager-derived and image-rpmdb-derived/);
    assert.match(prop("oaa:doesNotCover"), /vendored inside a published npm tarball/);
    assert.match(prop("oaa:notASubstituteFor"), /syft\/trivy/);
  });

  test("the scope tally is carried in metadata and counts every scope", () => {
    const bom = generateInventory(spec).bom;
    const tally = JSON.parse(bom.metadata.properties.find((p) => p.name === "oaa:scopeTally").value);
    assert.deepEqual(tally, scopeTally(bom.components));
    assert.equal(tally[SCOPES.SHIPPED_RUNTIME], 2);
    assert.equal(tally[SCOPES.SHIPPED_BUNDLED], 2);
    assert.equal(tally[SCOPES.BUILDER_ONLY], 4);
    assert.equal(tally[SCOPES.SHIPPED_OS], 3);
    assert.equal(tally[SCOPES.EXTERNAL_BINARY], 2);
  });
});

describe("generation refuses a half-inventory", () => {
  const base = {
    lockfiles: [{ component: "backend", lock: BACKEND_LOCK }],
    osInventories: [{ role: "backend", ...rpmComponentsFromQuery(RPM_OUT, { imageRole: "backend" }) }],
    externalBinaries: EXTERNAL,
    timestamp: "2026-10-13T00:00:00.000Z",
    subject: { type: "application", name: "oaa", version: "2.1.0-dev" },
  };

  test("no external-binary inventory refuses, naming the binaries that would vanish", () => {
    const res = generateInventory({ ...base, externalBinaries: null });
    assert.equal(res.ok, false);
    assert.equal(res.bom, null);
    assert.match(res.problems.join(" "), /oc, oc-mirror, openshift-install and mirror-registry would be invisible/);
  });

  test("a failed OS inventory refuses rather than emitting a BOM with a silently empty OS scope", () => {
    const res = generateInventory({ ...base, osInventories: [{ role: "backend", ok: false, reason: "rpm query exited 127" }] });
    assert.equal(res.ok, false);
    assert.match(res.problems.join(" "), /rpm query exited 127/);
  });

  test("an incomplete external inventory refuses even though components could be emitted", () => {
    const res = generateInventory({ ...base, externalBinaries: { ...EXTERNAL, complete: false, reason: "provenance env absent" } });
    assert.equal(res.ok, false);
    assert.match(res.problems.join(" "), /provenance env absent/);
  });

  test("no lockfiles at all refuses", () => {
    const res = generateInventory({ ...base, lockfiles: [] });
    assert.equal(res.ok, false);
    assert.match(res.problems.join(" "), /no lockfiles supplied/);
  });

  test("a refusal still reports how many components it had, so the gap is measurable", () => {
    const res = generateInventory({ ...base, externalBinaries: null });
    assert.ok(res.partialComponentCount > 0);
  });
});

/**
 * The BOM must name the images it describes.
 *
 * `shipped-os` components are read by `rpm -qa` inside one specific image. A
 * document listing them without naming that image cannot be checked against
 * anything later, and a sibling identity file is not a binding — files get
 * separated from each other.
 */
describe("binding the BOM to the image identities it describes", () => {
  const IMAGES = [
    {
      role: "frontend",
      ref: "localhost/openshift-airgap-architect-frontend:latest",
      identity: {
        id: "6154276a8ba0c7f38e4a842db7f03d00d19ddff6214198805578af6e113441b6",
        digest: "sha256:f69e3ea3f87e9f94212860a5c34ebea9659561e182b9bdd899a79bfec59a641c",
      },
      identityDigest: "4b3a2e32d630eb28f231c10aafb5517545ba4a3d3087ddb556c6ab4a8d93a121",
    },
    {
      role: "backend",
      ref: "localhost/openshift-airgap-architect-backend:latest",
      identity: {
        id: "7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5",
        digest: "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f",
      },
      identityDigest: "2e92458e35039fd4d05a561d65b5609dd4740e1f4916377678f05d00425685f3",
    },
  ];

  const comps = [{ name: "x", version: "1", properties: [{ name: "oaa:scope", value: "shipped-os" }] }];

  test("records config and manifest digests under distinct names", () => {
    const rows = JSON.parse(canonicalSubjectImages(IMAGES));
    const backend = rows.find((r) => r.role === "backend");
    assert.equal(backend.configDigest, "sha256:7252836047c2978cee0a8f71626e8e774cc7897b048a3defb079a0dc88d789e5");
    assert.equal(backend.manifestDigest, "sha256:eeec74ed006fc9ab5e43ccbc21a4f67b19ca1157f559d41f1fb628a94bda231f");
    assert.notEqual(backend.configDigest, backend.manifestDigest);
  });

  test("the rendering is order-independent, so the BOM stays byte-stable", () => {
    assert.equal(canonicalSubjectImages(IMAGES), canonicalSubjectImages([...IMAGES].reverse()));
    assert.equal(JSON.parse(canonicalSubjectImages(IMAGES))[0].role, "backend", "sorted by role");
  });

  test("the identities ride in the BOM metadata, not only in a sibling file", () => {
    const bom = buildCycloneDx({ components: comps, subject: {}, timestamp: "2026-10-14T00:00:00Z", derivation: "d", subjectImages: IMAGES });
    const prop = bom.metadata.properties.find((p) => p.name === "oaa:subjectImages");
    assert.ok(prop, "oaa:subjectImages must be present");
    assert.equal(JSON.parse(prop.value).length, 2);
  });

  test("omitting the images omits the property rather than emitting a hollow one", () => {
    const bom = buildCycloneDx({ components: comps, subject: {}, timestamp: "2026-10-14T00:00:00Z", derivation: "d" });
    assert.equal(bom.metadata.properties.find((p) => p.name === "oaa:subjectImages"), undefined);
  });

  test("a changed image digest changes the recorded binding", () => {
    const moved = [IMAGES[0], { ...IMAGES[1], identity: { ...IMAGES[1].identity, id: "deadbeef" } }];
    assert.notEqual(canonicalSubjectImages(IMAGES), canonicalSubjectImages(moved));
  });

  test("a bare hex id is normalised to a sha256: form", () => {
    assert.match(JSON.parse(canonicalSubjectImages([{ role: "a", identity: { id: "abc123" } }]))[0].configDigest, /^sha256:abc123$/);
  });
});
