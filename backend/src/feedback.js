import crypto from "node:crypto";
import { nanoid } from "nanoid";

const FEEDBACK_MODES = new Set(["disabled", "github", "offline"]);
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

function getChallengeSecret() {
  return (
    process.env.FEEDBACK_CHALLENGE_SECRET ||
    process.env.APP_GIT_SHA ||
    "feedback-local-dev"
  );
}

function getGithubRepo() {
  const repo = (
    process.env.FEEDBACK_GITHUB_REPO ||
    process.env.APP_REPO ||
    "bstrauss84/openshift-airgap-architect"
  ).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : "";
}

function categoryLabel(category) {
  const labels = {
    bug: "Bug report",
    docs: "Documentation",
    ux: "UX / usability",
    request: "Feature request",
    security: "Security",
    other: "General feedback"
  };
  return labels[category] || category;
}

function buildGithubIssueUrl(repo, title, body) {
  if (!repo) return "";
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

function scenarioSummary(scenarioContext = {}) {
  const parts = [];
  if (scenarioContext.platform) parts.push(`platform=${scenarioContext.platform}`);
  if (scenarioContext.methodology) parts.push(`methodology=${scenarioContext.methodology}`);
  if (scenarioContext.connectivity) parts.push(`connectivity=${scenarioContext.connectivity}`);
  if (scenarioContext.version) parts.push(`version=${scenarioContext.version}`);
  if (scenarioContext.scenarioId) parts.push(`scenario=${scenarioContext.scenarioId}`);
  return parts.join(", ") || "n/a";
}

export function buildFeedbackIssueDraft({ submission, config }) {
  const payload = submission?.payload || {};
  const build = submission?.build || {};
  const title = `[feedback] ${payload.summary || "General feedback"}`.slice(0, 120);
  const body = [
    "## Summary",
    payload.summary || "",
    "",
    "## Details",
    payload.details || "",
    "",
    "## Metadata",
    `- Category: ${categoryLabel(payload.category || "other")}`,
    `- Severity: ${payload.severity || "medium"}`,
    `- UI context: ${payload.uiContext || "n/a"}`,
    `- Scenario: ${scenarioSummary(payload.scenarioContext)}`,
    `- Contact requested: ${payload.contactRequested ? "yes" : "no"}`,
    `- Contact handle: ${payload.contactHandle || "n/a"}`,
    `- Submission ID: ${submission?.submissionId || "n/a"}`,
    `- Report mode: ${config.mode}`,
    `- Build SHA: ${build.gitSha || "unknown"}`,
    `- Build branch: ${build.branch || "unknown"}`,
    `- Build time: ${build.buildTime || "unknown"}`,
    `- Submitted at: ${submission?.receivedAt || "n/a"}`
  ].join("\n");
  const repo = getGithubRepo();
  return {
    title,
    markdown: body,
    githubRepo: repo,
    githubIssueUrl: config.mode === "github" ? buildGithubIssueUrl(repo, title, body) : ""
  };
}

export function resolveFeedbackConfig() {
  const modeRaw = (process.env.FEEDBACK_MODE || "github").trim().toLowerCase();
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
  const githubRepo = getGithubRepo();

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
      enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES },
      githubRepo,
      issueSubmission: "disabled"
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
      enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES },
      githubRepo,
      issueSubmission: "disabled"
    };
  }

  return {
    visible: true,
    enabled: true,
    mode,
    selectedMode: mode,
    reason:
      mode === "github" && !githubRepo
        ? "GitHub repository is not configured; use copy/export fallback."
        : "",
    challengeTtlMs,
    minDwellMs,
    limits: {
      summaryMaxChars,
      detailsMaxChars,
      contactMaxChars,
      maxPayloadBytes
    },
    enums: { categories: CATEGORY_VALUES, severities: SEVERITY_VALUES },
    githubRepo,
    issueSubmission: mode
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
  const signature = signPayload(payloadJson, getChallengeSecret());
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

  const expectedSig = signPayload(payloadJson, getChallengeSecret());
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
