import crypto from "node:crypto";
import { nanoid } from "nanoid";

const FEEDBACK_MODES = new Set(["disabled", "relay", "managed", "offline"]);
const CATEGORY_VALUES = ["bug", "docs", "ux", "request", "security", "other"];
const SEVERITY_VALUES = ["low", "medium", "high", "critical"];
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

const usedChallengeNonces = new Map();

function parseNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sanitizeText(value, maxChars) {
  const raw = String(value || "")
    .replace(CONTROL_CHARS, " ")
    .trim();
  return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
}

function cleanupChallengeNonces(ttlMs) {
  const cutoff = Date.now() - ttlMs;
  for (const [nonce, ts] of usedChallengeNonces.entries()) {
    if (ts < cutoff) usedChallengeNonces.delete(nonce);
  }
}

function signPayload(payloadJson, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadJson)
    .digest("base64url");
}

function getModeConfigIssues(mode) {
  const issues = [];
  const relayUrl = (process.env.FEEDBACK_RELAY_URL || "").trim();
  const providerWebhookUrl = (process.env.FEEDBACK_PROVIDER_WEBHOOK_URL || "").trim();
  const challengeSecret = (process.env.FEEDBACK_CHALLENGE_SECRET || "").trim();

  if (mode === "relay" && !relayUrl) {
    issues.push("Relay mode requires FEEDBACK_RELAY_URL.");
  }
  if (mode === "managed" && !providerWebhookUrl) {
    issues.push("Managed mode requires FEEDBACK_PROVIDER_WEBHOOK_URL.");
  }
  if ((mode === "relay" || mode === "managed") && !challengeSecret) {
    issues.push("Online feedback requires FEEDBACK_CHALLENGE_SECRET.");
  }

  return issues;
}

function getChallengeSecret(config) {
  const explicit = (process.env.FEEDBACK_CHALLENGE_SECRET || "").trim();
  if (explicit) return explicit;
  if (config.mode === "offline") {
    return process.env.APP_GIT_SHA || "feedback-local-dev";
  }
  throw new Error("Challenge signing secret is not configured.");
}

export function resolveFeedbackConfig() {
  const modeRaw = (process.env.FEEDBACK_MODE || "disabled").trim().toLowerCase();
  const mode = FEEDBACK_MODES.has(modeRaw) ? modeRaw : "disabled";

  const sideSignal = (
    process.env.AIRGAP_RUNTIME_SIDE ||
    process.env.AIRGAP_OPERATING_MODE ||
    ""
  )
    .trim()
    .toLowerCase();
  const highSide = /high|disconnected/.test(sideSignal);
  const summaryMaxChars = parseNum(process.env.FEEDBACK_MAX_SUMMARY_CHARS, 200);
  const detailsMaxChars = parseNum(process.env.FEEDBACK_MAX_DETAILS_CHARS, 4000);
  const contactMaxChars = parseNum(process.env.FEEDBACK_MAX_CONTACT_CHARS, 200);
  const maxPayloadBytes = parseNum(process.env.FEEDBACK_MAX_PAYLOAD_BYTES, 32 * 1024);
  const challengeTtlMs = parseNum(process.env.FEEDBACK_CHALLENGE_TTL_MS, 10 * 60 * 1000);
  const minDwellMs = parseNum(process.env.FEEDBACK_MIN_DWELL_MS, 3000);
  const modeConfigIssues = getModeConfigIssues(mode);
  const onlineModeUnavailable =
    (mode === "relay" || mode === "managed") && modeConfigIssues.length > 0;

  if (highSide) {
    return {
      visible: false,
      enabled: false,
      mode: "disabled",
      selectedMode: mode,
      reason: "Feedback is unavailable in high-side/disconnected mode.",
      challengeTtlMs,
      minDwellMs,
      limits: {
        summaryMaxChars,
        detailsMaxChars,
        contactMaxChars,
        maxPayloadBytes
      },
      enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES }
    };
  }

  if (mode === "disabled") {
    return {
      visible: false,
      enabled: false,
      mode,
      selectedMode: mode,
      reason: "Feedback transport is not configured.",
      challengeTtlMs,
      minDwellMs,
      limits: {
        summaryMaxChars,
        detailsMaxChars,
        contactMaxChars,
        maxPayloadBytes
      },
      enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES }
    };
  }

  if (onlineModeUnavailable) {
    return {
      visible: false,
      enabled: false,
      mode: "disabled",
      selectedMode: mode,
      reason: modeConfigIssues[0] || "Feedback transport is not configured.",
      challengeTtlMs,
      minDwellMs,
      limits: {
        summaryMaxChars,
        detailsMaxChars,
        contactMaxChars,
        maxPayloadBytes
      },
      enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES },
      modeConfigIssues
    };
  }

  return {
    visible: true,
    enabled: true,
    mode,
    selectedMode: mode,
    reason: "",
    challengeTtlMs,
    minDwellMs,
    limits: {
      summaryMaxChars,
      detailsMaxChars,
      contactMaxChars,
      maxPayloadBytes
    },
    enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES }
  };
}

export function createChallengeToken(config) {
  const issuedAt = Date.now();
  const payload = {
    nonce: nanoid(),
    issuedAt
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString("base64url");
  const signature = signPayload(payloadJson, getChallengeSecret(config));
  return {
    token: `${payloadB64}.${signature}`,
    issuedAt,
    expiresAt: issuedAt + config.challengeTtlMs
  };
}

export function verifyChallengeToken(token, config) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, error: "Challenge token is required." };
  }
  const [payloadB64, signature] = token.split(".");
  let payloadJson = "";
  let parsed = null;
  try {
    payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    parsed = JSON.parse(payloadJson);
  } catch {
    return { ok: false, error: "Challenge token is invalid." };
  }

  const expectedSig = signPayload(payloadJson, getChallengeSecret(config));
  const gotBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (gotBuf.length !== expBuf.length || !crypto.timingSafeEqual(gotBuf, expBuf)) {
    return { ok: false, error: "Challenge token signature mismatch." };
  }

  const now = Date.now();
  if (!parsed?.issuedAt || !parsed?.nonce) {
    return { ok: false, error: "Challenge token payload is invalid." };
  }
  if (now - parsed.issuedAt < config.minDwellMs) {
    return { ok: false, error: "Please wait a few seconds before submitting." };
  }
  if (now - parsed.issuedAt > config.challengeTtlMs) {
    return { ok: false, error: "Challenge token expired." };
  }

  cleanupChallengeNonces(config.challengeTtlMs);
  if (usedChallengeNonces.has(parsed.nonce)) {
    return { ok: false, error: "Challenge token has already been used." };
  }
  usedChallengeNonces.set(parsed.nonce, now);

  return { ok: true };
}

function normalizeScenarioContext(input = {}) {
  if (!input || typeof input !== "object") return {};
  const allowedKeys = ["platform", "methodology", "connectivity", "version", "scenarioId"];
  const out = {};
  for (const key of allowedKeys) {
    if (input[key] == null) continue;
    out[key] = sanitizeText(input[key], 80);
  }
  return out;
}

export function validateFeedbackPayload(body, config) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Feedback payload is required." };
  }
  const honeypot = String(body.honeypot || "");
  if (honeypot.trim().length > 0) {
    return { ok: false, error: "Submission rejected." };
  }

  const category = sanitizeText(body.category, 40).toLowerCase();
  if (!CATEGORY_VALUES.includes(category)) {
    return { ok: false, error: "Invalid feedback category." };
  }
  const severity = sanitizeText(body.severity, 40).toLowerCase();
  if (!SEVERITY_VALUES.includes(severity)) {
    return { ok: false, error: "Invalid feedback severity." };
  }

  const summary = sanitizeText(body.summary, config.limits.summaryMaxChars);
  if (!summary) return { ok: false, error: "Summary is required." };

  const details = sanitizeText(body.details, config.limits.detailsMaxChars);
  if (!details) return { ok: false, error: "Details are required." };

  const contactRequested = Boolean(body.contactRequested);
  const contactHandle = sanitizeText(body.contactHandle, config.limits.contactMaxChars);
  const uiContext = sanitizeText(body.uiContext, 120);
  const challengeToken = sanitizeText(body.challengeToken, 1024);
  if (!challengeToken) {
    return { ok: false, error: "Challenge token is required." };
  }

  const payload = {
    category,
    severity,
    summary,
    details,
    contactRequested,
    contactHandle,
    scenarioContext: normalizeScenarioContext(body.scenarioContext),
    uiContext
  };

  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (payloadBytes > config.limits.maxPayloadBytes) {
    return {
      ok: false,
      error: "Feedback payload exceeds allowed size."
    };
  }

  return { ok: true, payload, challengeToken };
}
