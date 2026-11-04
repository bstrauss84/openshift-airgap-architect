/**
 * v2.2.0 — anonymous destination registry (Install's "Anonymous pulls" carried
 * over to Mirroring): the preflight names the OKD placeholder honestly instead
 * of claiming credentials were provided.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedPreflightItems, isAnonymousPlaceholder, OKD_PLACEHOLDER_AUTH } from "../src/ocMirrorPreflightItems.js";
import { parseRegistryAuth } from "../src/registryAuth.js";

const placeholder = JSON.stringify({ auths: { "mirror.example.com:8443": { auth: OKD_PLACEHOLDER_AUTH, email: "" } } });
const real = JSON.stringify({ auths: { "mirror.example.com:8443": { auth: Buffer.from("pusher:pw").toString("base64") } } });
const items = (mirrorPullSecret) => sharedPreflightItems({ mode: "mirrorToMirror", checks: {}, fieldErrors: {}, registryUrl: "mirror.example.com:8443/ocp", configSourceType: "generated", rhPullSecret: null, rhAuthSource: "inline", mirrorPullSecret, tool: null, trust: { ok: true }, redHatContent: false });

test("the OKD placeholder is the same value Install emits and is accepted as auth JSON", () => {
  assert.equal(OKD_PLACEHOLDER_AUTH, "aWQ6cGFzcwo=");
  assert.equal(Buffer.from(OKD_PLACEHOLDER_AUTH, "base64").toString(), "id:pass\n");
  assert.deepEqual(Object.keys(parseRegistryAuth(placeholder, "destination")), ["mirror.example.com:8443"]);
});

test("preflight says anonymous for the placeholder and 'credentials provided' for a real credential", () => {
  assert.equal(isAnonymousPlaceholder(placeholder), true);
  assert.equal(isAnonymousPlaceholder(real), false);
  assert.equal(isAnonymousPlaceholder("not json"), false);
  assert.match(items(placeholder).find((i) => i.id === "registry").detail, /anonymous access — the OKD placeholder credential, no real account/);
  assert.match(items(real).find((i) => i.id === "registry").detail, /credentials provided for this run only/);
});
