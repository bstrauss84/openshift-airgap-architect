/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Security regression tests for critical vulnerabilities
 */
import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { app } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("Path Traversal: should block access to /etc/passwd", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/etc/passwd`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /etc directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/etc`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /root directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/root`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block path traversal attempts with ../", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/tmp/../../etc/passwd`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block path traversal from /data with ../", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/data/../../../etc`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should allow access to /tmp", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/tmp`);
    // Should succeed (200) or fail with read error (400), but NOT 403
    assert.notStrictEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test("Path Traversal: should allow access to DATA_DIR", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const dataDir = process.env.DATA_DIR || "/data";
    const res = await fetch(`${baseUrl}/api/fs/ls?path=${encodeURIComponent(dataDir)}`);
    // Should succeed (200) or fail with read error (400), but NOT 403
    assert.notStrictEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test("Path Traversal: should allow access to subdirectories within DATA_DIR", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const dataDir = process.env.DATA_DIR || "/data";
    const res = await fetch(`${baseUrl}/api/fs/ls?path=${encodeURIComponent(dataDir + "/subdir")}`);
    // Should succeed (200) or fail with read error (400), but NOT 403
    assert.notStrictEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test("Path Traversal: should allow access to subdirectories within /tmp", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/tmp/subdir`);
    // Should succeed (200) or fail with read error (400), but NOT 403
    assert.notStrictEqual(res.status, 403);
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /home directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/home`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /var directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/var`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /proc directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/proc`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block access to /sys directory", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/sys`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should block URL-encoded path traversal attempts", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls?path=/tmp/%2e%2e/%2e%2e/etc`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Path Traversal: should handle default path (root) by blocking it", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/fs/ls`);
    // Default is "/" which should be blocked
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes("Access denied"));
  } finally {
    server.close();
  }
});

test("Temp Auth Files: should create auth files with secure permissions (0o600)", async () => {
  const fs = await import("node:fs");
  const { writeTempAuth, safeUnlink } = await import("../src/utils.js");

  const testAuth = JSON.stringify({ auths: { "registry.example.com": { auth: "dGVzdDp0ZXN0" } } });
  const authFile = writeTempAuth(testAuth);

  try {
    const stats = fs.statSync(authFile);
    const mode = stats.mode & 0o777; // Get only the permission bits
    assert.strictEqual(mode, 0o600, `Auth file permissions should be 0o600 but got 0o${mode.toString(8)}`);
  } finally {
    safeUnlink(authFile);
  }
});

test("SSH Algorithm Validation: should reject invalid algorithm", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ssh/keypair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "malicious-algo" })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
    // Zod validation returns "Validation failed" with details
    assert.ok(data.error === "Validation failed" || data.error.includes("Invalid"));
    if (data.details) {
      // Verify Zod error structure
      assert.ok(Array.isArray(data.details));
      assert.ok(data.details.some(d => d.path === "algorithm"));
    }
  } finally {
    server.close();
  }
});

test("SSH Algorithm Validation: should accept ed25519", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ssh/keypair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "ed25519" })
    });
    // Should succeed or fail with generation error, but NOT 400 validation error
    assert.notStrictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test("SSH Algorithm Validation: should accept rsa", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ssh/keypair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "rsa" })
    });
    // Should succeed or fail with generation error, but NOT 400 validation error
    assert.notStrictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test("SSH Algorithm Validation: should accept ecdsa", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ssh/keypair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: "ecdsa" })
    });
    // Should succeed or fail with generation error, but NOT 400 validation error
    assert.notStrictEqual(res.status, 400);
  } finally {
    server.close();
  }
});
