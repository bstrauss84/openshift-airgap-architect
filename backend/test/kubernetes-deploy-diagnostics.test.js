/**
 * v2.2.2: diagnostics for two in-cluster misconfigurations seen on a hand-written
 * OpenShift Deployment (not the shipped manifests):
 *   1. backend bound to loopback in a pod -> probes "connection refused";
 *   2. DATA_DIR group-writable for another pod's fsGroup GID that this pod lacks.
 * Neither changes behaviour: the bind address and the fail-closed DATA_DIR check
 * are exactly as before. The startup behaviour itself is exercised under Podman
 * by backend/test/deployment-identity/identity-matrix.sh (emulation of the
 * kubelet's fsGroup with --group-add, not a real cluster).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kubernetesLoopbackWarning, resolveBindAddress } from "../src/accessControl.js";

const notInContainer = () => ({ inContainer: false, evidence: null });

test("warns when a pod (KUBERNETES_SERVICE_HOST) binds loopback only", () => {
  const env = { KUBERNETES_SERVICE_HOST: "172.30.0.1" };
  const { loopbackOnly } = resolveBindAddress(env, notInContainer);
  assert.equal(loopbackOnly, true, "auth disabled with no BIND_ADDRESS still defaults to loopback");
  const w = kubernetesLoopbackWarning(env, loopbackOnly);
  assert.match(w, /connection refused/);
  assert.match(w, /oc apply -k manifests\/openshift\//);
  assert.match(w, /BIND_ADDRESS=0\.0\.0\.0 and OAA_CONTAINER_NETWORK=isolated/);
  assert.match(w, /no login/, "the unauthenticated trade-off is stated");
});

test("no warning outside Kubernetes, or when the bind is not loopback", () => {
  assert.equal(kubernetesLoopbackWarning({}, true), null, "Compose / local runs stay quiet");
  assert.equal(kubernetesLoopbackWarning({ KUBERNETES_SERVICE_HOST: "  " }, true), null);
  assert.equal(kubernetesLoopbackWarning({ KUBERNETES_SERVICE_HOST: "172.30.0.1" }, false), null);
});

test("the hint never widens the bind: KUBERNETES_SERVICE_HOST alone keeps loopback", () => {
  const r = resolveBindAddress({ KUBERNETES_SERVICE_HOST: "172.30.0.1" }, notInContainer);
  assert.equal(r.bindAddress, "127.0.0.1");
  assert.equal(r.containerException, false);
});

const ep = readFileSync(new URL("../scripts/entrypoint.sh", import.meta.url), "utf8");

test("entrypoint diagnoses a group-writable DATA_DIR owned by a GID this process lacks", () => {
  const branch = ep.slice(ep.indexOf("is not writable by UID"), ep.indexOf('rm -f "$DATA_DIR/.write-probe"'));
  assert.match(branch, /stat -c '%g' "\$DATA_DIR"/);
  assert.match(branch, /-perm -g=w/);
  assert.match(branch, /id -G \| tr ' ' '\\n' \| grep -qx "\$dgid"/);
  assert.match(branch, /manifests\/openshift\//);
  assert.match(branch, /fsGroup: \$dgid/);
  assert.match(branch, /Do not chmod 777/);
  assert.match(branch, /exit 1\s*\nfi\s*$/, "still fails closed after diagnosing");
  assert.doesNotMatch(branch, /chmod\s+(-R\s+)?[0-7]*7{3}\s+"?\$DATA_DIR/, "never widens permissions itself");
});
