/**
 * Prometheus Metrics Module
 *
 * Provides instrumentation for monitoring application health, performance,
 * and operational metrics. Exposes metrics via /api/metrics endpoint in
 * Prometheus text format for scraping.
 *
 * Metrics categories:
 * - HTTP requests (duration, status codes)
 * - Background jobs (counts, duration, errors)
 * - SQLite queries (duration, count)
 * - oc-mirror operations (archive size, duration, error rate)
 *
 * @author Bill Strauss
 */

import client from 'prom-client';

// Enable default metrics (Node.js process metrics: CPU, memory, event loop)
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ============================================================================
// HTTP Request Metrics
// ============================================================================

/**
 * HTTP request duration histogram (seconds)
 * Labels: method, route, status_code
 */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30], // 10ms to 30s
  registers: [register]
});

/**
 * HTTP requests total counter
 * Labels: method, route, status_code
 */
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// ============================================================================
// Background Job Metrics
// ============================================================================

/**
 * Background jobs total counter
 * Labels: job_type (cincinnati, operator_scan, oc_mirror), status (running, completed, failed, cancelled)
 */
export const jobsTotal = new client.Counter({
  name: 'background_jobs_total',
  help: 'Total number of background jobs by type and status',
  labelNames: ['job_type', 'status'],
  registers: [register]
});

/**
 * Background jobs currently running gauge
 * Labels: job_type
 */
export const jobsRunning = new client.Gauge({
  name: 'background_jobs_running',
  help: 'Number of background jobs currently running',
  labelNames: ['job_type'],
  registers: [register]
});

/**
 * Background job duration histogram (seconds)
 * Labels: job_type, status
 */
export const jobDuration = new client.Histogram({
  name: 'background_job_duration_seconds',
  help: 'Duration of background jobs in seconds',
  labelNames: ['job_type', 'status'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600], // 1s to 1 hour
  registers: [register]
});

/**
 * Background job errors total counter
 * Labels: job_type, error_type
 */
export const jobErrors = new client.Counter({
  name: 'background_job_errors_total',
  help: 'Total number of background job errors by type',
  labelNames: ['job_type', 'error_type'],
  registers: [register]
});

// ============================================================================
// SQLite Database Metrics
// ============================================================================

/**
 * SQLite query duration histogram (milliseconds)
 * Labels: operation (select, insert, update, delete)
 */
export const dbQueryDuration = new client.Histogram({
  name: 'sqlite_query_duration_milliseconds',
  help: 'Duration of SQLite queries in milliseconds',
  labelNames: ['operation'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000], // 1ms to 5s
  registers: [register]
});

/**
 * SQLite queries total counter
 * Labels: operation (select, insert, update, delete)
 */
export const dbQueriesTotal = new client.Counter({
  name: 'sqlite_queries_total',
  help: 'Total number of SQLite queries',
  labelNames: ['operation'],
  registers: [register]
});

/**
 * SQLite connection pool size gauge
 */
export const dbConnectionPoolSize = new client.Gauge({
  name: 'sqlite_connection_pool_size',
  help: 'Number of active SQLite connections',
  registers: [register]
});

// ============================================================================
// oc-mirror Operation Metrics
// ============================================================================

/**
 * oc-mirror operations total counter
 * Labels: workflow (mirror_to_disk, disk_to_mirror, mirror_to_mirror), status (success, failure)
 */
export const ocMirrorOperationsTotal = new client.Counter({
  name: 'oc_mirror_operations_total',
  help: 'Total number of oc-mirror operations by workflow and status',
  labelNames: ['workflow', 'status'],
  registers: [register]
});

/**
 * oc-mirror operation duration histogram (seconds)
 * Labels: workflow
 */
export const ocMirrorDuration = new client.Histogram({
  name: 'oc_mirror_duration_seconds',
  help: 'Duration of oc-mirror operations in seconds',
  labelNames: ['workflow'],
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400, 28800], // 1 min to 8 hours
  registers: [register]
});

/**
 * oc-mirror archive size gauge (bytes)
 * Labels: workflow
 */
export const ocMirrorArchiveSize = new client.Gauge({
  name: 'oc_mirror_archive_size_bytes',
  help: 'Size of oc-mirror archives in bytes',
  labelNames: ['workflow'],
  registers: [register]
});

/**
 * oc-mirror error rate counter
 * Labels: workflow, error_type (network, auth, storage, timeout)
 */
export const ocMirrorErrors = new client.Counter({
  name: 'oc_mirror_errors_total',
  help: 'Total number of oc-mirror errors by workflow and type',
  labelNames: ['workflow', 'error_type'],
  registers: [register]
});

// ============================================================================
// Application-Level Metrics
// ============================================================================

/**
 * Application state persists total counter
 * Labels: operation (save, load)
 */
export const stateOperationsTotal = new client.Counter({
  name: 'app_state_operations_total',
  help: 'Total number of state save/load operations',
  labelNames: ['operation'],
  registers: [register]
});

/**
 * Cincinnati version discovery total counter
 * Labels: status (success, failure)
 */
export const cincinnatiDiscoveryTotal = new client.Counter({
  name: 'cincinnati_discovery_total',
  help: 'Total number of Cincinnati version discovery operations',
  labelNames: ['status'],
  registers: [register]
});

/**
 * Operator catalog scans total counter
 * Labels: status (success, failure)
 */
export const operatorScansTotal = new client.Counter({
  name: 'operator_scans_total',
  help: 'Total number of operator catalog scans',
  labelNames: ['status'],
  registers: [register]
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Record HTTP request metrics
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} route - Route pattern (e.g., /api/state, /api/generate)
 * @param {number} statusCode - HTTP status code
 * @param {number} durationSeconds - Request duration in seconds
 */
export function recordHttpRequest(method, route, statusCode, durationSeconds) {
  httpRequestsTotal.inc({ method, route, status_code: statusCode });
  httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
}

/**
 * Record background job start
 * @param {string} jobType - Job type (cincinnati, operator_scan, oc_mirror)
 */
export function recordJobStart(jobType) {
  jobsTotal.inc({ job_type: jobType, status: 'running' });
  jobsRunning.inc({ job_type: jobType });
}

/**
 * Record background job completion
 * @param {string} jobType - Job type
 * @param {string} status - Final status (completed, failed, cancelled)
 * @param {number} durationSeconds - Job duration in seconds
 */
export function recordJobComplete(jobType, status, durationSeconds) {
  jobsRunning.dec({ job_type: jobType });
  jobsTotal.inc({ job_type: jobType, status });
  jobDuration.observe({ job_type: jobType, status }, durationSeconds);
}

/**
 * Record background job error
 * @param {string} jobType - Job type
 * @param {string} errorType - Error classification (network, auth, timeout, etc.)
 */
export function recordJobError(jobType, errorType) {
  jobErrors.inc({ job_type: jobType, error_type: errorType });
}

/**
 * Record SQLite query metrics
 * @param {string} operation - SQL operation type (select, insert, update, delete)
 * @param {number} durationMs - Query duration in milliseconds
 */
export function recordDbQuery(operation, durationMs) {
  dbQueriesTotal.inc({ operation });
  dbQueryDuration.observe({ operation }, durationMs);
}

/**
 * Record oc-mirror operation metrics
 * @param {string} workflow - Workflow type (mirror_to_disk, disk_to_mirror, mirror_to_mirror)
 * @param {string} status - Operation status (success, failure)
 * @param {number} durationSeconds - Operation duration in seconds
 * @param {number} archiveSizeBytes - Archive size in bytes (optional)
 */
export function recordOcMirrorOperation(workflow, status, durationSeconds, archiveSizeBytes = null) {
  ocMirrorOperationsTotal.inc({ workflow, status });
  ocMirrorDuration.observe({ workflow }, durationSeconds);
  if (archiveSizeBytes !== null) {
    ocMirrorArchiveSize.set({ workflow }, archiveSizeBytes);
  }
}

/**
 * Record oc-mirror error
 * @param {string} workflow - Workflow type
 * @param {string} errorType - Error classification (network, auth, storage, timeout)
 */
export function recordOcMirrorError(workflow, errorType) {
  ocMirrorErrors.inc({ workflow, error_type: errorType });
}

/**
 * Get metrics in Prometheus text format
 * @returns {Promise<string>} Prometheus metrics text
 */
export async function getMetrics() {
  return register.metrics();
}

/**
 * Get metrics content type
 * @returns {string} Prometheus content type
 */
export function getMetricsContentType() {
  return register.contentType;
}

export { register };
