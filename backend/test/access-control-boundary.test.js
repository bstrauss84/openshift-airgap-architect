/**
 * OpenShift Airgap Architect — API access control boundary
 *
 * Covers backend/src/accessControl.js: the origin allowlist, the CSRF
 * defence and the identity requirement that replace `app.use(cors())` and
 * the complete absence of authentication.
 *
 * THESE ARE NEGATIVE TESTS FIRST. The property that matters is not "a
 * legitimate request succeeds" — almost any implementation manages that. It
 * is that a forged one FAILS, so most of this file is attacks:
 *
 *   - a pod that reaches the backend Service directly, skipping the proxy;
 *   - a caller that invents X-Forwarded-User;
 *   - a caller that knows the header name but not the shared secret;
 *   - a cross-site form POST with an empty body (the shape that reaches 18
 *     handlers, because body-parser sets req.body = {} before the
 *     content-type check);
 *   - a cross-origin XHR trying to READ a response.
 *
 * The middleware is exercised directly against a minimal Express app rather
 * than through the real server, because the real server reads its mode from
 * the environment ONCE at import. Testing both modes in one process needs
 * independent instances, and a unit of middleware is exactly what is under
 * test here.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";

import {
  assertAccessControlConfig,
  installAccessControl,
  resolveBindAddress,
  detectContainerRuntime,
  ACCESS_CONTROL_HEADERS,
} from "../src/accessControl.js";

const SECRET = "x".repeat(40);
const ORIGIN = "https://airgap-architect.apps.example.com";

/** Build a throwaway server with the boundary installed for a given env. */
async function serverWith(env) {
  const app = express();
  const config = installAccessControl(app, env);
  app.use(express.json());
  app.get("/api/state", (req, res) => res.json({ ok: true, identity: req.identity ?? null }));
  app.post("/api/start-over", (req, res) => res.json({ ok: true, identity: req.identity ?? null }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    config,
    close: () => new Promise((r) => server.close(r)),
  };
}

const PROXY_ENV = {
  OAA_AUTH_MODE: "proxy",
  OAA_PROXY_SHARED_SECRET: SECRET,
  OAA_ALLOWED_ORIGINS: ORIGIN,
};

/** Headers a legitimate request from the authenticating proxy carries. */
const authedHeaders = (extra = {}) => ({
  [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: SECRET,
  [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "alice",
  [ACCESS_CONTROL_HEADERS.CSRF_HEADER]: "1",
  "Content-Type": "application/json",
  ...extra,
});

describe("accessControl — startup configuration fails closed", () => {
  it("refuses proxy mode with no shared secret", () => {
    assert.throws(
      () => assertAccessControlConfig({ OAA_AUTH_MODE: "proxy", OAA_ALLOWED_ORIGINS: ORIGIN }),
      /requires OAA_PROXY_SHARED_SECRET/
    );
  });

  it("refuses a shared secret too short to be worth having", () => {
    assert.throws(
      () =>
        assertAccessControlConfig({
          OAA_AUTH_MODE: "proxy",
          OAA_PROXY_SHARED_SECRET: "short",
          OAA_ALLOWED_ORIGINS: ORIGIN,
        }),
      /at least 32 are required/
    );
  });

  it("refuses proxy mode with no origin allowlist", () => {
    assert.throws(
      () => assertAccessControlConfig({ OAA_AUTH_MODE: "proxy", OAA_PROXY_SHARED_SECRET: SECRET }),
      /requires OAA_ALLOWED_ORIGINS/
    );
  });

  it("refuses an unrecognised mode rather than guessing one", () => {
    assert.throws(() => assertAccessControlConfig({ OAA_AUTH_MODE: "yes" }), /not a supported value/);
  });

  it("REFUSES unauthenticated mode bound to anything other than loopback", () => {
    // The one combination that would silently publish an anonymous API.
    assert.throws(
      () => assertAccessControlConfig({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0" }),
      /refuses to start/
    );
  });

  it("allows unauthenticated mode on loopback, which is the documented local default", () => {
    const c = assertAccessControlConfig({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "127.0.0.1" });
    assert.equal(c.mode, "disabled");
  });

  it("refuses to start when external OIDC is configured, and says why", () => {
    // OCP 4.22 external OIDC removes the built-in OAuth server, so this
    // topology cannot work. It must fail visibly, not loop at login.
    assert.throws(
      () => assertAccessControlConfig({ ...PROXY_ENV, OAA_OIDC_ISSUER: "https://idp.example.com" }),
      /direct external OIDC is NOT supported/
    );
  });
});

describe("accessControl — the bind address is resolved once and returned", () => {
  // AUTH-01. These are the unit half; backend/test/listener-bind-boundary.test.js
  // is the half that proves the SERVER binds what is resolved here, by
  // connecting to a real interface. Neither is sufficient alone — the defect
  // was precisely that the configuration was right and the socket was not.
  const inContainer = () => ({ inContainer: true, evidence: "/run/.containerenv" });
  const onHost = () => ({ inContainer: false, evidence: null });

  it("defaults unauthenticated mode to loopback", () => {
    assert.equal(resolveBindAddress({ OAA_AUTH_MODE: "disabled" }, onHost).bindAddress, "127.0.0.1");
  });

  it("defaults proxy mode to every interface, because the backend is a separate pod", () => {
    // A loopback bind in the deployed topology would make the backend
    // unreachable from the frontend pod. Identity is what defends it there.
    const r = resolveBindAddress({ ...PROXY_ENV }, onHost);
    assert.equal(r.bindAddress, "0.0.0.0");
    assert.equal(r.loopbackOnly, false);
  });

  it("treats the whole 127.0.0.0/8 range as loopback, not just 127.0.0.1", () => {
    assert.equal(resolveBindAddress({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "127.0.0.2" }, onHost).loopbackOnly, true);
    assert.equal(resolveBindAddress({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "::1" }, onHost).loopbackOnly, true);
  });

  it("REFUSES a declaration-free non-loopback bind in unauthenticated mode", () => {
    assert.throws(
      () => resolveBindAddress({ OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0" }, inContainer),
      /refuses to start bound to/
    );
  });

  it("REFUSES the container declaration when the process is not in a container", () => {
    // The declaration is corroborated, not believed. This is the realistic
    // accident: compose environment lines lifted into a host unit file.
    assert.throws(
      () =>
        resolveBindAddress(
          { OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0", OAA_CONTAINER_NETWORK: "isolated" },
          onHost
        ),
      /NOT running inside a container/
    );
  });

  it("allows the declared, corroborated container case and records the evidence", () => {
    // Compose publishes 127.0.0.1:4000:4000, and a published port forwards to
    // the container's address — never to the container's loopback — so this
    // combination is what makes local Compose work at all.
    const r = resolveBindAddress(
      { OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0", OAA_CONTAINER_NETWORK: "isolated" },
      inContainer
    );
    assert.equal(r.bindAddress, "0.0.0.0");
    assert.equal(r.containerException, true);
    assert.equal(r.evidence, "/run/.containerenv", "the exception must be auditable in the startup log");
  });

  it("rejects a near-miss declaration rather than guessing what was meant", () => {
    assert.throws(
      () =>
        resolveBindAddress(
          { OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "0.0.0.0", OAA_CONTAINER_NETWORK: "yes" },
          inContainer
        ),
      /refuses to start bound to/
    );
  });

  it("surfaces the resolved address through assertAccessControlConfig, which is what index.js binds", () => {
    const c = assertAccessControlConfig({ OAA_AUTH_MODE: "disabled" }, onHost);
    assert.equal(c.bindAddress, "127.0.0.1");
    assert.equal(c.bindLoopbackOnly, true);
  });

  it("detectContainerRuntime reads real markers, and says no when there are none", () => {
    const none = detectContainerRuntime({
      existsSync: () => false,
      readFileSync: () => "0::/user.slice/user-1000.slice/session-3.scope\n",
    });
    assert.deepEqual(none, { inContainer: false, evidence: null });

    const kube = detectContainerRuntime({
      existsSync: () => false,
      readFileSync: () => "0::/kubepods.slice/kubepods-burstable.slice/crio-abc.scope\n",
    });
    assert.equal(kube.inContainer, true);

    const unreadable = detectContainerRuntime({
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("ENOENT");
      },
    });
    assert.equal(unreadable.inContainer, false, "an unreadable probe must fail closed, not open");
  });
});

describe("accessControl [proxy] — identity cannot be forged", () => {
  it("REJECTS a caller that reached the Service directly, with no proxy secret", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, "PROXY_AUTH_REQUIRED");
    } finally {
      await s.close();
    }
  });

  it("REJECTS invented identity headers without the shared secret", async () => {
    // The bypass NetworkPolicy alone would not stop: a namespace-local pod
    // that knows the header names.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`, {
        headers: { [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "admin" },
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, "PROXY_AUTH_REQUIRED");
    } finally {
      await s.close();
    }
  });

  it("REJECTS a wrong shared secret", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`, {
        headers: {
          [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: "y".repeat(40),
          [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "admin",
        },
      });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  it("REJECTS the right secret with no identity", async () => {
    // The proxy is authentic but the user is not logged in.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`, {
        headers: { [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: SECRET },
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, "IDENTITY_REQUIRED");
    } finally {
      await s.close();
    }
  });

  it("ACCEPTS a genuine proxied request and exposes the identity", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`, {
        headers: {
          [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: SECRET,
          [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "alice",
          [ACCESS_CONTROL_HEADERS.IDENTITY_EMAIL_HEADER]: "alice@example.com",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.identity.authenticated, true);
      assert.equal(body.identity.user, "alice");
      assert.equal(body.identity.email, "alice@example.com");
    } finally {
      await s.close();
    }
  });

  it("IGNORES X-Forwarded-Groups even from a request that is otherwise genuine", async () => {
    // openshift/oauth-proxy sets and strips X-Forwarded-User and
    // X-Forwarded-Email (`setRequestHeader`, which strips before setting).
    // It does NOT touch X-Forwarded-Groups at all — so that header arrives
    // exactly as the caller wrote it, and presenting it as `identity.groups`
    // would have made the one authorization-shaped field the one field a
    // caller chooses for themselves.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`, {
        headers: {
          [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: SECRET,
          [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "alice",
          [ACCESS_CONTROL_HEADERS.UNTRUSTED_GROUPS_HEADER]: "cluster-admins, system:masters",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.identity.groups, [], "a forged group claim must not reach the application");
    } finally {
      await s.close();
    }
  });

  it("leaves kubelet probes reachable without identity", async () => {
    // Probes carry no identity and must not be made to; a 401 here means the
    // Deployment never becomes ready.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/health`);
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("requires identity even for GET, because reads here are not harmless", async () => {
    // GET /api/generate renders the pull secret; GET /api/jobs returns tool
    // output. A read-only exemption would be a credential disclosure.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`);
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });
});

describe("accessControl [proxy] — CSRF and origin policy", () => {
  it("REJECTS a cross-site form POST with an empty body", async () => {
    // The exact shape that reached 18 handlers: no custom header, foreign
    // origin, form content-type, empty body.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: {
          Origin: "https://evil.example.net",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "",
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "ORIGIN_FORBIDDEN");
    } finally {
      await s.close();
    }
  });

  it("REJECTS a state-changing request with no CSRF header", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          [ACCESS_CONTROL_HEADERS.PROXY_SECRET_HEADER]: SECRET,
          [ACCESS_CONTROL_HEADERS.IDENTITY_USER_HEADER]: "alice",
        },
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "CSRF_HEADER_REQUIRED");
    } finally {
      await s.close();
    }
  });

  it("REJECTS a foreign Referer when no Origin is sent", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: { ...authedHeaders(), Referer: "https://evil.example.net/page" },
      });
      assert.equal(res.status, 403);
    } finally {
      await s.close();
    }
  });

  it("ACCEPTS a same-origin request from the real UI", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: authedHeaders({ Origin: ORIGIN }),
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("does NOT emit Access-Control-Allow-Origin for a foreign origin", async () => {
    // Wildcard CORS let arbitrary pages READ responses. Without the header
    // the browser withholds the body even when the request itself ran.
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/health`, { headers: { Origin: "https://evil.example.net" } });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    } finally {
      await s.close();
    }
  });

  it("emits Access-Control-Allow-Origin only for an allowlisted origin, never '*'", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/health`, { headers: { Origin: ORIGIN } });
      assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
      assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
      assert.match(res.headers.get("vary") || "", /Origin/);
    } finally {
      await s.close();
    }
  });

  it("refuses a preflight from a foreign origin", async () => {
    const s = await serverWith(PROXY_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example.net" },
      });
      assert.equal(res.status, 403);
    } finally {
      await s.close();
    }
  });
});

describe("accessControl [disabled] — local mode stays usable but not defenceless", () => {
  const DEV_ENV = { OAA_AUTH_MODE: "disabled", BIND_ADDRESS: "127.0.0.1" };

  it("allows a header-less local client, preserving the existing contract", async () => {
    // curl, CI and the existing test suite send no Origin and no custom
    // header. Breaking them would buy nothing: CSRF is a browser problem.
    const s = await serverWith(DEV_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("STILL rejects a cross-site browser POST from a foreign origin", async () => {
    // A page on the internet POSTing to the user's localhost:4000 is a real
    // attack against a loopback-bound dev server, and the Origin check is
    // what stops it.
    const s = await serverWith(DEV_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: { Origin: "https://evil.example.net", "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "ORIGIN_FORBIDDEN");
    } finally {
      await s.close();
    }
  });

  it("allows the local dev UI origin", async () => {
    const s = await serverWith(DEV_ENV);
    try {
      const res = await fetch(`${s.base}/api/start-over`, {
        method: "POST",
        headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    } finally {
      await s.close();
    }
  });

  it("marks the request unauthenticated rather than pretending it has identity", async () => {
    const s = await serverWith(DEV_ENV);
    try {
      const res = await fetch(`${s.base}/api/state`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.identity.authenticated, false);
      assert.equal(body.identity.mode, "disabled");
    } finally {
      await s.close();
    }
  });
});
