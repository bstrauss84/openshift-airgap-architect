import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { app } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function withEnv(env, fn) {
  const prev = new Map();
  Object.keys(env).forEach((k) => prev.set(k, process.env[k]));
  Object.entries(env).forEach(([k, v]) => {
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.keys(env).forEach((k) => {
        const old = prev.get(k);
        if (old == null) delete process.env[k];
        else process.env[k] = old;
      });
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getChallenge(baseUrl) {
  const res = await fetch(`${baseUrl}/api/feedback/challenge`);
  const data = await res.json();
  return { res, data };
}

test("GET /api/feedback/config returns disabled when feedback mode disabled", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "disabled",
      AIRGAP_RUNTIME_SIDE: ""
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/feedback/config`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(data.visible, false);
      } finally {
        server.close();
      }
    }
  ));

test("GET /api/feedback/config is hidden when high-side/disconnected mode is set", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "relay",
      AIRGAP_RUNTIME_SIDE: "high-side"
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/feedback/config`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(data.visible, false);
        assert.match(String(data.reason || ""), /high-side/i);
      } finally {
        server.close();
      }
    }
  ));

test("GET /api/feedback/config hides relay mode when relay URL is missing", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "relay",
      FEEDBACK_RELAY_URL: "",
      FEEDBACK_CHALLENGE_SECRET: "test-secret",
      AIRGAP_RUNTIME_SIDE: ""
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/feedback/config`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(data.visible, false);
        assert.strictEqual(data.mode, "disabled");
        assert.match(String(data.reason || ""), /FEEDBACK_RELAY_URL/i);
      } finally {
        server.close();
      }
    }
  ));

test("GET /api/feedback/config hides managed mode when webhook URL is missing", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "managed",
      FEEDBACK_PROVIDER_WEBHOOK_URL: "",
      FEEDBACK_CHALLENGE_SECRET: "test-secret",
      AIRGAP_RUNTIME_SIDE: ""
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/feedback/config`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(data.visible, false);
        assert.strictEqual(data.mode, "disabled");
        assert.match(String(data.reason || ""), /FEEDBACK_PROVIDER_WEBHOOK_URL/i);
      } finally {
        server.close();
      }
    }
  ));

test("GET /api/feedback/config hides relay mode when challenge secret is missing", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "relay",
      FEEDBACK_RELAY_URL: "https://relay.example.invalid/submit",
      FEEDBACK_CHALLENGE_SECRET: "",
      AIRGAP_RUNTIME_SIDE: ""
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/feedback/config`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(data.visible, false);
        assert.strictEqual(data.mode, "disabled");
        assert.match(String(data.reason || ""), /FEEDBACK_CHALLENGE_SECRET/i);
      } finally {
        server.close();
      }
    }
  ));

test("GET /api/feedback/challenge returns token when enabled", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "offline",
      FEEDBACK_CHALLENGE_SECRET: "test-secret"
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const { res, data } = await getChallenge(baseUrl);
        assert.strictEqual(res.status, 200);
        assert.ok(data.token);
        assert.ok(data.expiresAt > data.issuedAt);
      } finally {
        server.close();
      }
    }
  ));

test("POST /api/feedback/submit returns offline handoff payload in offline mode", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "offline",
      FEEDBACK_CHALLENGE_SECRET: "test-secret",
      FEEDBACK_MIN_DWELL_MS: "1"
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const challenge = await getChallenge(baseUrl);
        assert.strictEqual(challenge.res.status, 200);
        const payload = {
          category: "bug",
          severity: "low",
          summary: "Test summary",
          details: "Test details",
          contactRequested: false,
          contactHandle: "",
          scenarioContext: { platform: "Bare Metal" },
          uiContext: "review",
          honeypot: "",
          challengeToken: challenge.data.token
        };
        await sleep(3);
        const res = await fetch(`${baseUrl}/api/feedback/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.mode, "offline");
        assert.strictEqual(data.delivered, false);
        assert.ok(data.handoff?.payload?.submissionId);
      } finally {
        server.close();
      }
    }
  ));

test("POST /api/feedback/submit rejects honeypot submissions", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "offline",
      FEEDBACK_CHALLENGE_SECRET: "test-secret",
      FEEDBACK_MIN_DWELL_MS: "1"
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const challenge = await getChallenge(baseUrl);
        const payload = {
          category: "bug",
          severity: "low",
          summary: "Test summary",
          details: "Test details",
          honeypot: "bot",
          challengeToken: challenge.data.token
        };
        const res = await fetch(`${baseUrl}/api/feedback/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        assert.strictEqual(res.status, 400);
      } finally {
        server.close();
      }
    }
  ));

test("POST /api/feedback/submit rate limits repeated submissions", async () =>
  withEnv(
    {
      FEEDBACK_MODE: "offline",
      FEEDBACK_CHALLENGE_SECRET: "test-secret",
      FEEDBACK_MIN_DWELL_MS: "1",
      FEEDBACK_RATE_LIMIT_WINDOW_MS: "60000",
      FEEDBACK_RATE_LIMIT_MAX: "1",
      FEEDBACK_BURST_WINDOW_MS: "60000",
      FEEDBACK_BURST_MAX: "1"
    },
    async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const c1 = await getChallenge(baseUrl);
        await sleep(3);
        const first = await fetch(`${baseUrl}/api/feedback/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "bug",
            severity: "low",
            summary: "First",
            details: "First details",
            honeypot: "",
            challengeToken: c1.data.token
          })
        });
        assert.strictEqual(first.status, 200);

        const c2 = await getChallenge(baseUrl);
        await sleep(3);
        const second = await fetch(`${baseUrl}/api/feedback/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "bug",
            severity: "low",
            summary: "Second",
            details: "Second details",
            honeypot: "",
            challengeToken: c2.data.token
          })
        });
        assert.strictEqual(second.status, 429);
      } finally {
        server.close();
      }
    }
  ));

test("docker compose defaults feedback mode to disabled", () => {
  const composePath = path.resolve(process.cwd(), "..", "docker-compose.yml");
  const compose = fs.readFileSync(composePath, "utf8");
  assert.match(compose, /FEEDBACK_MODE=\$\{FEEDBACK_MODE:-disabled\}/);
});
