/**
 * Owner request (2026-11-04): "Generate keypair" labelled new public keys with the
 * backend's user@hostname (ssh-keygen's default comment), which can carry a
 * workstation's account and internal domain, or a container's user and id, into
 * install-config sshKey. Newly generated keys now carry a fixed neutral comment;
 * keys the user provides keep their own comment.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { app, GENERATED_SSH_KEY_COMMENT } from "../src/index.js";
import { buildInstallConfig } from "../src/generate.js";
import { bareMetalAgent } from "./fixtures/base-states.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const PREFIX = { ed25519: "ssh-ed25519 ", rsa: "ssh-rsa ", ecdsa: "ecdsa-sha2-nistp521 " };

test("the neutral comment holds no personal or host metadata", () => {
  assert.equal(GENERATED_SSH_KEY_COMMENT, "openshift-airgap-architect-generated");
  assert.doesNotMatch(GENERATED_SSH_KEY_COMMENT, /@|\s/);
});

for (const algorithm of ["ed25519", "rsa", "ecdsa"]) {
  test(`generated ${algorithm} key: neutral comment, no user@host, valid and matching key pair`, async () => {
    const { server, baseUrl } = await createTestServer(app);
    let dir;
    try {
      const res = await fetch(`${baseUrl}/api/ssh/keypair`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-OAA-Request": "1" }, body: JSON.stringify({ algorithm })
      });
      assert.equal(res.status, 200);
      const { publicKey, privateKey } = await res.json();
      const parts = publicKey.split(" ");
      assert.equal(parts.length, 3, "type, key, comment");
      assert.ok(publicKey.startsWith(PREFIX[algorithm]));
      assert.equal(parts[2], GENERATED_SSH_KEY_COMMENT);
      assert.ok(!publicKey.includes("@"), "no user@host comment");
      for (const own of [os.hostname(), os.userInfo().username].filter((v) => v && v.length > 2)) {
        assert.ok(!publicKey.includes(own), "the server's own host or user name never appears");
      }
      // Byte integrity: ssh-keygen parses the public key, and the private key derives exactly that public key.
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-sshc-"));
      const priv = path.join(dir, "k"); const pub = path.join(dir, "k.pub");
      fs.writeFileSync(priv, privateKey, { mode: 0o600 }); fs.writeFileSync(pub, `${publicKey}\n`);
      const fp = execFileSync("ssh-keygen", ["-l", "-f", pub], { encoding: "utf8" });
      assert.match(fp, new RegExp(`${GENERATED_SSH_KEY_COMMENT}`));
      const derived = execFileSync("ssh-keygen", ["-y", "-f", priv], { encoding: "utf8" }).trim().split(" ").slice(0, 2).join(" ");
      assert.equal(derived, parts.slice(0, 2).join(" "));
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      await closeTestServer(server);
    }
  });
}

test("a key the user provides keeps its own comment in install-config", () => {
  const userKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMYuVI5y+yHH9W66z8dykIXBLC9q27gps/NeeiU+r92b alice@laptop.example.com";
  const state = bareMetalAgent({ credentials: { sshPublicKey: userKey } });
  const ic = yaml.load(buildInstallConfig(state));
  assert.equal(ic.sshKey, userKey);
});

test("a generated key used in install-config carries the neutral comment unchanged", () => {
  const generated = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMYuVI5y+yHH9W66z8dykIXBLC9q27gps/NeeiU+r92b ${GENERATED_SSH_KEY_COMMENT}`;
  const ic = yaml.load(buildInstallConfig(bareMetalAgent({ credentials: { sshPublicKey: generated } })));
  assert.equal(ic.sshKey, generated);
});
