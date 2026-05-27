/**
 * OpenShift Airgap Architect - Request Correlation Middleware (PROD-002)
 *
 * Express middleware for structured request/response logging with
 * AsyncLocalStorage-based request ID propagation.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import logger from "../logger.js";

const asyncLocalStorage = new AsyncLocalStorage();

/** Regex to match health/readiness endpoints that generate excessive noise. */
const SKIP_LOG_PATTERN = /^\/(api\/)?(health|ready|jobs\/count)$/;

/**
 * Express middleware that:
 * 1. Assigns/propagates X-Request-ID headers
 * 2. Stores requestId in AsyncLocalStorage for downstream access
 * 3. Logs request start and completion with timing
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function loggingMiddleware(req, res, next) {
  const requestId =
    req.headers["x-request-id"] ||
    `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  req.requestId = requestId;

  asyncLocalStorage.run({ requestId }, () => {
    const skip = SKIP_LOG_PATTERN.test(req.path);

    if (!skip) {
      logger.info(
        { tag: "request:start", requestId, method: req.method, path: req.path },
        "Request started"
      );
    }

    const start = Date.now();
    res.on("finish", () => {
      if (skip) return;
      const duration = Date.now() - start;
      const logFn =
        res.statusCode >= 500
          ? logger.error.bind(logger)
          : res.statusCode >= 400
            ? logger.warn.bind(logger)
            : logger.info.bind(logger);
      logFn(
        {
          tag: "request:complete",
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
        },
        "Request completed"
      );
    });

    next();
  });
}

/**
 * Retrieve the current request ID from AsyncLocalStorage context.
 * Returns undefined if called outside a request context.
 *
 * @returns {string | undefined}
 */
export function getCurrentRequestId() {
  const store = asyncLocalStorage.getStore();
  return store?.requestId;
}
