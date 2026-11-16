/**
 * OpenShift Airgap Architect - Build Info Version Test
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

// VERSION is the canonical application identity; every manifest and lockfile is
// synchronized to it by scripts/set-app-version.mjs and enforced by
// npm run check:app-version. Reading it here keeps this test honest across a
// version bump instead of pinning a literal that must be hand-edited each release.
const CANONICAL_VERSION = readFileSync(
  join(import.meta.dirname, "..", "..", "VERSION"),
  "utf-8"
).trim();

test("GET /api/build-info version matches the canonical VERSION file", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/build-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version, CANONICAL_VERSION);
  } finally {
    await closeTestServer(server);
  }
});
