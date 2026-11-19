/**
 * v2.2.2 owner decision: the frontend runtime image takes the fixed krb5-libs from the
 * UBI 9 BaseOS repository (14 HIGH CVEs in the 2026-11-12 ubi9/nginx-124 base image's
 * 1.21.1-10.el9_8.1 build are fixed in 1.21.1-10.el9_9.2). Guards that the update
 * stays in the runtime stage, uses the image's own repositories (no --nogpgcheck,
 * no extra repos), updates only that package, and returns to the non-root user.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = readFileSync(new URL("../frontend/Containerfile", import.meta.url), "utf8");
const directives = file.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const runtime = directives.slice(directives.indexOf("FROM registry.access.redhat.com/ubi9/nginx-124"));

test("the runtime stage updates krb5-libs from the image's own UBI repositories", () => {
  assert.match(runtime, /dnf -y \$\{OAA_DNF_CA\} --setopt=install_weak_deps=0 update krb5-libs/);
  assert.doesNotMatch(runtime, /--nogpgcheck|gpgcheck=0|--enablerepo|--repofrompath|sslverify=0/);
  assert.doesNotMatch(runtime, /dnf -y [^\n]*update\s*(&&|\\|$)/m, "no blanket update");
});

test("the update runs as root and the stage returns to UID 1001 before serving", () => {
  const i = runtime.indexOf("update krb5-libs");
  assert.ok(runtime.lastIndexOf("USER root", i) >= 0);
  const after = runtime.slice(i);
  assert.match(after, /^USER 1001$/m);
  assert.match(directives.trimEnd().split("\n").filter((l) => l.startsWith("USER ")).pop(), /^USER 1001$/);
});

test("/run keeps the base image's owner and mode across the secret-mount update step", () => {
  // Buildah recreates /run as root:root 0755 when a RUN uses --mount=type=secret,
  // and /run is a temporary mount inside that step. nginx as UID 1001 (or an
  // arbitrary OpenShift UID with gid 0) then cannot write /run/nginx.pid and exits.
  // Record and restore must therefore be separate plain RUN steps around it.
  const runs = runtime.slice(0, runtime.indexOf("COPY --from=builder")).split(/\n(?=RUN |USER |COPY |FROM )/);
  const iUpd = runs.findIndex((r) => r.includes("update krb5-libs"));
  assert.match(runs[iUpd], /^RUN --mount=type=secret/);
  const rec = runs.findIndex((r) => r.includes("> /tmp/oaa-run-state"));
  const res = runs.findIndex((r) => r.includes('OAA_RUN_STATE="$(cat /tmp/oaa-run-state)"'));
  assert.ok(rec >= 0 && rec < iUpd, "/run state is recorded before the update step");
  assert.ok(res > iUpd, "/run is restored after the update step");
  for (const k of [rec, res]) assert.doesNotMatch(runs[k], /--mount/, "record/restore steps have no mounts");
  assert.match(runs[res], /chown "\$\{OAA_RUN_STATE% \*\}" \/run/);
  assert.match(runs[res], /chmod "\$\{OAA_RUN_STATE#\* \}" \/run/);
  assert.match(runs[res], /test "\$\(stat -c '%u:%g %a' \/run\)" = "\$\{OAA_RUN_STATE\}"/, "build fails if /run differs");
  assert.match(runs[res], /-perm -g=w/, "build fails unless group 0 can write /run");
});
