/**
 * OpenShift Airgap Architect - Logger Tests (PROD-002)
 *
 * Tests for structured logging utility, error ID generation,
 * and request correlation middleware.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import logger, { generateErrorId } from "../src/logger.js";
import { loggingMiddleware, getCurrentRequestId } from "../src/middleware/logging.js";

describe("Logger utility", () => {
  test("logger is a pino instance with expected methods", () => {
    assert.strictEqual(typeof logger.info, "function");
    assert.strictEqual(typeof logger.error, "function");
    assert.strictEqual(typeof logger.warn, "function");
    assert.strictEqual(typeof logger.debug, "function");
    assert.strictEqual(typeof logger.trace, "function");
    assert.strictEqual(typeof logger.fatal, "function");
  });

  test("logger level is 'silent' in test environment", () => {
    // NODE_ENV=test is set by the test runner script
    assert.strictEqual(logger.level, "silent");
  });

  test("logger can create child loggers", () => {
    const child = logger.child({ tag: "test-child" });
    assert.strictEqual(typeof child.info, "function");
    assert.strictEqual(typeof child.error, "function");
  });

  test("logger.info does not throw with structured data", () => {
    assert.doesNotThrow(() => {
      logger.info({ tag: "test", requestId: "req_123", data: { nested: true } }, "Test message");
    });
  });

  test("logger.error does not throw with error objects", () => {
    const err = new Error("Test error");
    assert.doesNotThrow(() => {
      logger.error({ err }, "Error occurred");
    });
  });

  test("logger.warn does not throw", () => {
    assert.doesNotThrow(() => {
      logger.warn({ tag: "test-warn" }, "Warning message");
    });
  });

  test("logger.debug does not throw", () => {
    assert.doesNotThrow(() => {
      logger.debug({ detail: "debug-info" }, "Debug message");
    });
  });
});

describe("Error ID generation", () => {
  test("generateErrorId returns string starting with err_", () => {
    const id = generateErrorId();
    assert.strictEqual(typeof id, "string");
    assert.ok(id.startsWith("err_"), `Expected '${id}' to start with 'err_'`);
  });

  test("generateErrorId returns unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateErrorId());
    }
    assert.strictEqual(ids.size, 100, "All 100 generated error IDs should be unique");
  });

  test("generateErrorId contains UUID format", () => {
    const id = generateErrorId();
    // Strip "err_" prefix and check remaining is UUID-like
    const uuid = id.slice(4);
    // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    assert.ok(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid),
      `Expected UUID format after 'err_' prefix, got '${uuid}'`
    );
  });
});

describe("Logging middleware", () => {
  test("loggingMiddleware is a function", () => {
    assert.strictEqual(typeof loggingMiddleware, "function");
  });

  test("getCurrentRequestId is a function", () => {
    assert.strictEqual(typeof getCurrentRequestId, "function");
  });

  test("getCurrentRequestId returns undefined outside request context", () => {
    const id = getCurrentRequestId();
    assert.strictEqual(id, undefined);
  });

  test("loggingMiddleware assigns requestId to req", (t, done) => {
    const req = {
      headers: {},
      path: "/api/test",
      method: "GET",
    };
    const res = {
      on: () => {},
    };
    const next = () => {
      assert.ok(req.requestId, "requestId should be assigned");
      assert.ok(req.requestId.startsWith("req_"), `Expected '${req.requestId}' to start with 'req_'`);
      done();
    };
    loggingMiddleware(req, res, next);
  });

  test("loggingMiddleware preserves existing X-Request-ID header", (t, done) => {
    const req = {
      headers: { "x-request-id": "custom-id-12345" },
      path: "/api/test",
      method: "GET",
    };
    const res = {
      on: () => {},
    };
    const next = () => {
      assert.strictEqual(req.requestId, "custom-id-12345");
      done();
    };
    loggingMiddleware(req, res, next);
  });

  test("getCurrentRequestId returns requestId inside middleware context", (t, done) => {
    const req = {
      headers: { "x-request-id": "test-context-id" },
      path: "/api/test",
      method: "GET",
    };
    const res = {
      on: () => {},
    };
    const next = () => {
      const id = getCurrentRequestId();
      assert.strictEqual(id, "test-context-id");
      done();
    };
    loggingMiddleware(req, res, next);
  });
});
