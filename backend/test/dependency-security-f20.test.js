/**
 * F20 — backend production dependency advisories (v2.2.0 security remediation).
 *
 *  - body-parser < 1.20.9  GHSA-27r3-jxmh-p828: a compressed body followed by
 *    trailing bytes raised an uncaught exception that terminated the process.
 *  - undici < 7.30.1       GHSA-xjj6-f33q-929c (process crash on > 5 content
 *    codings), GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472.
 *  - zod < 4.6.6           GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404: one issue per
 *    failing element, no early exit, so a large array exhausted memory. Zod 3
 *    has no fixed release; 4.6.6 rejects a collection whose leading check is
 *    a maximum size before parsing any element. Collections WITHOUT such a
 *    check are still parsed element by element, so the schemas must bound
 *    every collection — the structural guard below enforces that.
 *
 * Crash-type advisories run in a child process: a regression shows up as a
 * non-zero exit instead of killing the test runner. Each child ends on its own
 * once its server is closed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as S from "../src/schemas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..");
const require = createRequire(path.join(backendDir, "package.json"));

const versionOf = (name) => require(path.join(backendDir, "node_modules", name, "package.json")).version;
const atLeast = (v, floor) => {
  const a = v.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

const runChild = (source) => spawnSync(process.execPath, ["--input-type=module", "-e", source], {
  cwd: backendDir,
  env: { ...process.env, NODE_ENV: "test", PORT: "0" },
  encoding: "utf8",
  timeout: 30000,
});

describe("F20 installed versions are at or above the patched releases", () => {
  for (const [name, floor] of [["body-parser", "1.20.9"], ["undici", "7.30.1"], ["zod", "4.6.6"]]) {
    test(`${name} >= ${floor}`, () => {
      const v = versionOf(name);
      assert.ok(atLeast(v, floor), `${name} ${v} is below the patched ${floor}`);
    });
  }

  test("the schemas use the Zod 4 implementation, not the unpatched zod/v3 compatibility copy", () => {
    // zod/v3 inside 4.6.x is byte-identical between 4.6.5 and 4.6.6: it does not carry the fix.
    const probe = S.mirroringActiveSchema;
    assert.ok(probe._zod, "schema is not a Zod 4 (core) schema");
  });
});

describe("GHSA-27r3-jxmh-p828 — trailing bytes after a compressed body do not terminate the API", () => {
  // Trigger shape from upstream's own regression test (body-parser 1260c38):
  // a deflate frame plus one byte, then 1 KiB after the decoder has finished.
  // NOTE: the 1.20.8 crash did not reproduce locally (Node 20.20.2 / 22.23.4,
  // four trigger shapes including a port of the upstream test), so this test
  // is a smoke guard on the real app; the version floor above is what fails on
  // the vulnerable release.
  test("the real app answers the request and stays up", () => {
    const appUrl = pathToFileURL(path.join(backendDir, "src/index.js")).href;
    const helperUrl = pathToFileURL(path.join(here, "helpers/httpServerLifecycle.js")).href;
    const r = runChild(`
      import http from "node:http";
      import zlib from "node:zlib";
      const { app } = await import(${JSON.stringify(appUrl)});
      const { createTestServer, closeTestServer } = await import(${JSON.stringify(helperUrl)});
      const { server, baseUrl } = await createTestServer(app);
      const first = Buffer.concat([zlib.deflateSync(Buffer.from('{"profileId":null}')), Buffer.from([0])]);
      const trailing = Buffer.alloc(1024);
      const status = await new Promise((resolve, reject) => {
        const req = http.request(baseUrl + "/api/mirroring/active", { method: "POST", agent: false, headers: {
          "Content-Type": "application/json", "Content-Encoding": "deflate", "Content-Length": first.length + trailing.length } }, (res) => {
          res.resume(); res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.write(first);
        setTimeout(() => req.end(trailing), 200);
      });
      await new Promise((r) => setTimeout(r, 300));
      const health = await fetch(baseUrl + "/api/health");
      console.log("STATUS=" + status + " HEALTH=" + health.status);
      await closeTestServer(server);
    `);
    assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr.slice(-800)}`);
    assert.match(r.stdout, /HEALTH=200/);
  });
});

describe("GHSA-xjj6-f33q-929c — undici fetch rejects excessive content codings without crashing", () => {
  test("a server sending six codings and closing early does not terminate the process", () => {
    const r = runChild(`
      import net from "node:net";
      import { fetch } from "undici";
      const srv = net.createServer((sock) => {
        sock.once("data", () => {
          sock.end("HTTP/1.1 200 OK\\r\\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\nContent-Length: 100\\r\\n\\r\\nabc");
        });
      });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      let outcome = "resolved";
      try { const res = await fetch("http://127.0.0.1:" + srv.address().port + "/"); await res.text(); }
      catch { outcome = "rejected"; }
      await new Promise((r) => setTimeout(r, 300));
      console.log("OUTCOME=" + outcome);
      srv.close();
    `);
    assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr.slice(-800)}`);
    assert.match(r.stdout, /OUTCOME=rejected/);
  });
});

describe("GHSA-mrhx-c7xc-m3w5 — oversized collections fail fast with one issue", () => {
  const N = 2_000_000;
  const vectors = {
    "Mirroring profile operators.selected": [S.mirroringProfileWriteSchema, { operators: { selected: new Array(N).fill(0) } }, 500],
    "Mirroring profile additionalImages": [S.mirroringProfileWriteSchema, { additionalImages: new Array(N).fill(0) }, 500],
    "preflight signatureOptions.customRegistries": [S.ocMirrorPreflightSchema, { advanced: { signatureOptions: { customRegistries: new Array(N).fill(0) } } }, 50],
    "run signatureOptions.customRegistries": [S.ocMirrorRunSchema, { advanced: { signatureOptions: { customRegistries: new Array(N).fill(0) } } }, 50],
    "import files": [S.mirroringImportSchema, { files: new Array(N).fill(0) }, 10],
    "import review itemIds": [S.mirroringImportReviewSchema, { action: "omit", itemIds: new Array(N).fill(0) }, 200],
  };
  for (const [name, [schema, body, max]] of Object.entries(vectors)) {
    test(name, () => {
      const started = Date.now();
      const r = schema.safeParse(body);
      assert.equal(r.success, false);
      assert.equal(r.error.issues.length, 1, "every element was parsed (no early exit)");
      assert.equal(r.error.issues[0].message, `Array must contain at most ${max} element(s)`);
      assert.ok(Date.now() - started < 2000, "rejection was not immediate");
    });
  }

  test("import resolutions (a record) are bounded by key count before any entry is parsed", () => {
    const resolutions = Object.fromEntries(Array.from({ length: 200000 }, (_, i) => [`k${i}`, 0]));
    const r = S.mirroringImportSchema.safeParse({ files: [{ name: "a", contentBase64: "" }], resolutions });
    assert.equal(r.success, false);
    assert.equal(r.error.issues.length, 1);
    assert.equal(r.error.issues[0].message, "Object must contain at most 1000 key(s)");
  });

  test("bounded collections still accept their maximum", () => {
    assert.equal(S.mirroringImportReviewSchema.safeParse({ action: "omit", itemIds: new Array(200).fill("a") }).success, true);
    assert.equal(S.ocMirrorRunSchema.safeParse({ advanced: { signatureOptions: { customRegistries: new Array(50).fill("r.example") } } }).success, true);
    const resolutions = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`package:x|op${i}`, "1"]));
    assert.equal(S.mirroringImportSchema.safeParse({ files: [{ name: "a", contentBase64: "" }], resolutions }).success, true);
  });

  test("structural guard: every array leads with a maximum and every record is key-count bounded", () => {
    const problems = [];
    const seen = new Set();
    const walk = (schema, where, parent) => {
      if (!schema?._zod || seen.has(schema)) return;
      seen.add(schema);
      const def = schema._zod.def;
      if (def.type === "array") {
        const first = def.checks?.find((c) => c._zod.def.check !== "min_length");
        if (!first || first._zod.def.check !== "max_length") problems.push(`${where}: array without a leading .max()`);
      }
      if (def.type === "record" && !(parent?._zod.def.type === "pipe" && parent._zod.def.in._zod.def.checks?.length)) {
        problems.push(`${where}: record without a key-count bound (use boundedRecord)`);
      }
      const children = {
        object: () => [...Object.entries(def.shape).map(([k, v]) => [k, v]), ["*", def.catchall]],
        array: () => [["[]", def.element]],
        optional: () => [["", def.innerType]], nullable: () => [["", def.innerType]], default: () => [["", def.innerType]],
        union: () => def.options.map((o, i) => [`|${i}`, o]),
        pipe: () => [["<in>", def.in], ["<out>", def.out]],
        record: () => [["{k}", def.keyType], ["{v}", def.valueType]],
      }[def.type];
      for (const [k, child] of children ? children() : []) walk(child, `${where}.${k}`, schema);
    };
    for (const [name, value] of Object.entries(S)) if (value?._zod) walk(value, name, null);
    assert.deepEqual(problems, []);
  });
});

describe("Zod 3 → 4: API error wording is unchanged", () => {
  // RunOcMirrorStep.translateValidationError matches these exact phrases.
  const cases = [
    [S.ocMirrorPreflightSchema, { mode: "bogus" }, "mode", "Invalid enum value. Expected 'mirrorToDisk' | 'diskToMirror' | 'mirrorToMirror', received 'bogus'"],
    [S.pathCheckSchema, {}, "path", "Required"],
    [S.pathCheckSchema, { path: "" }, "path", "String must contain at least 1 character(s)"],
    [S.ocMirrorPreflightSchema, { registryUrl: "x".repeat(2049) }, "registryUrl", "String must contain at most 2048 character(s)"],
    [S.ocMirrorPreflightSchema, { minBytes: -1 }, "minBytes", "Number must be greater than or equal to 0"],
    [S.ocMirrorPreflightSchema, { advanced: { parallelImages: 2.5 } }, "advanced.parallelImages", "Expected integer, received float"],
    [S.ocMirrorPreflightSchema, { advanced: { parallelImages: "4" } }, "advanced.parallelImages", "Expected number, received string"],
    [S.ocMirrorPreflightSchema, { rhPullSecret: "bad" }, "rhPullSecret", "Pull secret must be valid JSON with auths object"],
    [S.mirroringActiveSchema, { profileId: null, extra: 1 }, "", "Unrecognized key(s) in object: 'extra'"],
    [S.mirroringImportReviewSchema, { action: "keep", itemIds: "all" }, "action", "Invalid literal value, expected \"omit\""],
    [S.mirroringImportReviewSchema, { action: "omit", itemIds: new Array(201).fill("a") }, "itemIds", "Array must contain at most 200 element(s)"],
    [S.mirroringReconcileCatalogSchema, {}, "action", "Required"],
    [S.sshKeypairSchema, { algorithm: null }, "algorithm", "Expected 'ed25519' | 'rsa' | 'ecdsa', received null"],
    [S.cincinnatiPatchesUpdateSchema, { channel: "" }, "channel", "Channel is required"],
  ];
  for (const [schema, input, pathText, message] of cases) {
    test(`${pathText || "(root)"}: ${message}`, () => {
      const r = schema.safeParse(input);
      assert.equal(r.success, false);
      const issue = r.error.issues.find((i) => i.path.join(".") === pathText);
      assert.ok(issue, `no issue at ${pathText}: ${JSON.stringify(r.error.issues)}`);
      assert.equal(issue.message, message);
    });
  }

  test("validateBody keeps its 400 response shape", () => {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let nextCalled = false;
    S.validateBody(S.pathCheckSchema)({ body: { path: 1 }, path: "/x", method: "POST" }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.code, 400);
    assert.equal(res.body.error, "Validation failed");
    assert.ok(res.body.errorId);
    assert.deepEqual(res.body.details, [{ path: "path", message: "Expected string, received number" }]);
  });

  test("unknown-key handling is unchanged: strict refuses, default strips, passthrough keeps", () => {
    assert.equal(S.mirroringProfileWriteSchema.safeParse({ execution: { archivePath: "/x" } }).success, false);
    assert.deepEqual(S.pathCheckSchema.parse({ path: "/a", extra: 1 }), { path: "/a" });
    assert.deepEqual(S.ocMirrorRunSchema.parse({ dryRun: true }), { mode: "mirrorToDisk", configSourceType: "generated", dryRun: true });
  });
});
