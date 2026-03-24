/**
 * Feedback transport adapters.
 * Keeps destination/contact identity server-side via env injection only.
 */

const DEFAULT_TIMEOUT_MS = 4000;

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timeout) };
}

async function postJson(url, token, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timer = withTimeout(timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: timer.controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Transport failed (${resp.status}) ${text.slice(0, 120)}`);
    }
    return { ok: true };
  } finally {
    timer.clear();
  }
}

export async function deliverFeedback({ mode, payload }) {
  if (mode === "offline") {
    return {
      ok: true,
      mode: "offline",
      delivered: false,
      handoff: {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        payload
      }
    };
  }

  if (mode === "relay") {
    const relayUrl = (process.env.FEEDBACK_RELAY_URL || "").trim();
    const relayToken = (process.env.FEEDBACK_RELAY_TOKEN || "").trim();
    if (!relayUrl) throw new Error("Feedback relay is not configured.");
    await postJson(relayUrl, relayToken, payload);
    return { ok: true, mode: "relay", delivered: true };
  }

  if (mode === "managed") {
    const providerUrl = (process.env.FEEDBACK_PROVIDER_WEBHOOK_URL || "").trim();
    const providerToken = (process.env.FEEDBACK_PROVIDER_TOKEN || "").trim();
    const provider = (process.env.FEEDBACK_PROVIDER || "managed").trim();
    if (!providerUrl) throw new Error("Feedback provider is not configured.");
    await postJson(providerUrl, providerToken, {
      provider,
      payload
    });
    return { ok: true, mode: "managed", delivered: true };
  }

  throw new Error("Feedback delivery mode is disabled.");
}
