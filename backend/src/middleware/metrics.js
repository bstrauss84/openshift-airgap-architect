/**
 * Metrics Middleware
 *
 * Automatically records HTTP request metrics (duration, status codes) for
 * all requests. Integrates with Prometheus metrics module.
 *
 * @author Bill Strauss
 */

import { recordHttpRequest } from '../metrics.js';

/**
 * Extract route pattern from request path
 * Normalizes routes to avoid high cardinality (e.g., /api/job/:id -> /api/job/:id)
 */
function getRoutePattern(req) {
  // Use matched route if available (Express route matching)
  if (req.route?.path) {
    const baseUrl = req.baseUrl || '';
    return baseUrl + req.route.path;
  }

  // Fallback: normalize common patterns to avoid cardinality explosion
  let path = req.path || req.url;

  // Replace UUIDs with :id
  path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');

  // Replace nanoid-style IDs with :id
  path = path.replace(/\/[a-zA-Z0-9_-]{21}/g, '/:id');

  // Replace numeric IDs with :id
  path = path.replace(/\/\d+/g, '/:id');

  return path;
}

/**
 * Metrics middleware
 * Records HTTP request duration and counts for all requests
 */
export function metricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();

  // Capture original end function
  const originalEnd = res.end;

  // Override res.end to record metrics when response finishes
  res.end = function (...args) {
    // Calculate duration in seconds
    const endTime = process.hrtime.bigint();
    const durationNs = endTime - startTime;
    const durationSeconds = Number(durationNs) / 1e9;

    // Get route pattern (avoid high cardinality)
    const route = getRoutePattern(req);

    // Record metrics
    recordHttpRequest(req.method, route, res.statusCode, durationSeconds);

    // Call original end
    return originalEnd.apply(res, args);
  };

  next();
}
