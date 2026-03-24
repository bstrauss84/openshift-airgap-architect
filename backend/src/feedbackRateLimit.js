/**
 * In-memory rate limiter middleware for feedback endpoints.
 * Suitable for single-process deployments used by this app.
 */

function nowMs() {
  return Date.now();
}

function prune(entries, cutoff) {
  let idx = 0;
  while (idx < entries.length && entries[idx] < cutoff) idx += 1;
  if (idx > 0) entries.splice(0, idx);
}

export function createInMemoryRateLimiter({
  windowMs,
  max,
  burstWindowMs = 0,
  burstMax = 0,
  keyFn = (req) => req.ip || "unknown"
}) {
  const buckets = new Map();

  return function feedbackRateLimit(req, res, next) {
    const key = String(keyFn(req) || "unknown");
    const current = nowMs();
    const baseCutoff = current - windowMs;
    const burstCutoff = current - burstWindowMs;
    const bucket = buckets.get(key) || { baseHits: [], burstHits: [] };

    prune(bucket.baseHits, baseCutoff);
    if (burstWindowMs > 0 && burstMax > 0) {
      prune(bucket.burstHits, burstCutoff);
    } else {
      bucket.burstHits = [];
    }

    const baseOver = bucket.baseHits.length >= max;
    const burstOver =
      burstWindowMs > 0 && burstMax > 0
        ? bucket.burstHits.length >= burstMax
        : false;
    if (baseOver || burstOver) {
      const oldestBase = bucket.baseHits[0] || current;
      const oldestBurst = bucket.burstHits[0] || current;
      const baseRetryMs = Math.max(0, windowMs - (current - oldestBase));
      const burstRetryMs =
        burstWindowMs > 0 && burstMax > 0
          ? Math.max(0, burstWindowMs - (current - oldestBurst))
          : 0;
      const retryAfterMs = Math.max(baseRetryMs, burstRetryMs);
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({
        error:
          "Too many feedback submissions. Please wait and try again.",
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
      });
    }

    bucket.baseHits.push(current);
    if (burstWindowMs > 0 && burstMax > 0) bucket.burstHits.push(current);
    buckets.set(key, bucket);

    return next();
  };
}
