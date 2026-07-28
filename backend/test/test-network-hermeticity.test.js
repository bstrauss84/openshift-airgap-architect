import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";

const externalConnections = [];
const originalNetConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
  const opts = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  const host = opts.host || "127.0.0.1";
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLoopback) {
    externalConnections.push({ host, port: opts.port, stack: new Error().stack });
  }
  return originalNetConnect.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  const opts = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  const host = opts.host || opts.servername || "127.0.0.1";
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLoopback) {
    externalConnections.push({ host, port: opts.port, protocol: "tls", stack: new Error().stack });
  }
  return originalTlsConnect.apply(this, args);
};

const { app } = await import("../src/index.js");
const { createTestServer, closeTestServer } = await import("./helpers/httpServerLifecycle.js");

describe("network hermeticity", () => {
  let server;
  let baseUrl;

  before(async () => {
    externalConnections.length = 0;
    const result = await createTestServer(app);
    server = result.server;
    baseUrl = result.baseUrl;
  });

  after(async () => {
    await closeTestServer(server);
    net.Socket.prototype.connect = originalNetConnect;
    tls.connect = originalTlsConnect;
  });

  it("importing the app creates no external connections", () => {
    const external = externalConnections.filter(c => c.protocol !== "tls" || true);
    assert.strictEqual(
      external.length, 0,
      "Expected zero external connections on import, got:\n" +
      external.map(c => `  ${c.protocol || "tcp"} ${c.host}:${c.port}`).join("\n")
    );
  });

  it("GET /api/state creates no external connections", async () => {
    externalConnections.length = 0;
    const res = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(res.status, 200);
    await res.json();
    const external = externalConnections.slice();
    assert.strictEqual(
      external.length, 0,
      "Expected zero external connections from /api/state, got:\n" +
      external.map(c => `  ${c.protocol || "tcp"} ${c.host}:${c.port}`).join("\n")
    );
  });

  it("GET /api/ready creates no external connections", async () => {
    externalConnections.length = 0;
    const res = await fetch(`${baseUrl}/api/ready`);
    assert.strictEqual(res.status, 200);
    await res.json();
    const external = externalConnections.slice();
    assert.strictEqual(
      external.length, 0,
      "Expected zero external connections from /api/ready, got:\n" +
      external.map(c => `  ${c.protocol || "tcp"} ${c.host}:${c.port}`).join("\n")
    );
  });

  it("GET /api/build-info creates no external connections", async () => {
    externalConnections.length = 0;
    const res = await fetch(`${baseUrl}/api/build-info`);
    assert.strictEqual(res.status, 200);
    await res.json();
    const external = externalConnections.slice();
    assert.strictEqual(
      external.length, 0,
      "Expected zero external connections from /api/build-info, got:\n" +
      external.map(c => `  ${c.protocol || "tcp"} ${c.host}:${c.port}`).join("\n")
    );
  });

  it("only loopback connections observed during entire test lifecycle", () => {
    const external = externalConnections.slice();
    assert.strictEqual(
      external.length, 0,
      "Expected zero total external connections, got:\n" +
      external.map(c => `  ${c.protocol || "tcp"} ${c.host}:${c.port}\n    ${c.stack.split("\n")[1]}`).join("\n")
    );
  });
});
