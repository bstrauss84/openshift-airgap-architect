/**
 * OpenShift Airgap Architect - Build Info Version Test
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

test("GET /api/build-info version is exactly 2.0.0-dev", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/build-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.version, "2.0.0-dev");
  } finally {
    await closeTestServer(server);
  }
});
