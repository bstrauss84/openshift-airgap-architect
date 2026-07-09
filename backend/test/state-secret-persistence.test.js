/**
 * OpenShift Airgap Architect - State Secret Persistence Test Suite
 *
 * Verifies that credentials are NOT persisted to backend SQLite database.
 * Tests both direct sanitizer functions and real HTTP /api/state behavior.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { stripProxyCredentials, sanitizeCredentialFields, sanitizeStateForPersistence } from "../src/stateSanitizer.js";
import { app } from "../src/index.js";
import { getState } from "../src/utils.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Unit tests for stripProxyCredentials
test("stripProxyCredentials removes credentials from http proxy URL", () => {
  const result = stripProxyCredentials("http://user:pass@proxy.example.com:8080");
  assert.strictEqual(result, "http://proxy.example.com:8080/");
});

test("stripProxyCredentials removes credentials from https proxy URL", () => {
  const result = stripProxyCredentials("https://admin:secret@10.0.0.1:3128/path");
  assert.strictEqual(result, "https://10.0.0.1:3128/path");
});

test("stripProxyCredentials preserves URL without credentials", () => {
  const result = stripProxyCredentials("http://proxy.example.com:8080");
  assert.strictEqual(result, "http://proxy.example.com:8080/");
});

test("stripProxyCredentials handles empty string", () => {
  const result = stripProxyCredentials("");
  assert.strictEqual(result, "");
});

test("stripProxyCredentials handles null/undefined", () => {
  assert.strictEqual(stripProxyCredentials(null), "");
  assert.strictEqual(stripProxyCredentials(undefined), "");
});

test("stripProxyCredentials handles invalid URL", () => {
  const result = stripProxyCredentials("not-a-url");
  assert.strictEqual(result, "not-a-url");
});

// Unit tests for sanitizeCredentialFields
test("sanitizeCredentialFields strips password field", () => {
  const input = { hostname: "vcenter.local", password: "secret123", datacenter: "DC1" };
  const result = sanitizeCredentialFields(input);
  assert.strictEqual(result.hostname, "vcenter.local");
  assert.strictEqual(result.datacenter, "DC1");
  assert.strictEqual(result.password, undefined);
});

test("sanitizeCredentialFields strips case-insensitive credential fields", () => {
  const input = {
    Password: "secret1",
    SECRET: "secret2",
    Token: "secret3",
    AccessToken: "secret4",
    hostname: "server.local"
  };
  const result = sanitizeCredentialFields(input);
  assert.strictEqual(result.hostname, "server.local");
  assert.strictEqual(result.Password, undefined);
  assert.strictEqual(result.SECRET, undefined);
  assert.strictEqual(result.Token, undefined);
  assert.strictEqual(result.AccessToken, undefined);
});

test("sanitizeCredentialFields strips exact-match auth/auths fields", () => {
  const input = {
    auths: { "registry.io": { auth: "dGVzdDp0ZXN0" } },
    authenticationMode: "certificate",
    hostname: "registry.local"
  };
  const result = sanitizeCredentialFields(input);
  assert.strictEqual(result.hostname, "registry.local");
  assert.strictEqual(result.authenticationMode, "certificate");
  assert.strictEqual(result.auths, undefined);
});

test("sanitizeCredentialFields recursively strips nested credentials", () => {
  const input = {
    platform: {
      vsphere: {
        hostname: "vcenter.local",
        password: "secret",
        nested: {
          token: "abc123",
          datacenter: "DC1"
        }
      }
    }
  };
  const result = sanitizeCredentialFields(input);
  assert.strictEqual(result.platform.vsphere.hostname, "vcenter.local");
  assert.strictEqual(result.platform.vsphere.nested.datacenter, "DC1");
  assert.strictEqual(result.platform.vsphere.password, undefined);
  assert.strictEqual(result.platform.vsphere.nested.token, undefined);
});

test("sanitizeCredentialFields handles arrays", () => {
  const input = {
    nodes: [
      { hostname: "node1", bmcPassword: "secret1" },
      { hostname: "node2", bmcPassword: "secret2" }
    ]
  };
  const result = sanitizeCredentialFields(input);
  assert.strictEqual(result.nodes[0].hostname, "node1");
  assert.strictEqual(result.nodes[1].hostname, "node2");
  assert.strictEqual(result.nodes[0].bmcPassword, undefined);
  assert.strictEqual(result.nodes[1].bmcPassword, undefined);
});

test("sanitizeCredentialFields does not mutate input", () => {
  const input = { hostname: "server", password: "secret" };
  const inputCopy = JSON.parse(JSON.stringify(input));
  sanitizeCredentialFields(input);
  assert.deepStrictEqual(input, inputCopy);
});

// Unit tests for sanitizeStateForPersistence
test("sanitizeStateForPersistence strips pull secrets", () => {
  const input = {
    credentials: {
      pullSecretPlaceholder: '{"auths":{"registry.io":{"auth":"SECRET"}}}',
      mirrorRegistryPullSecret: '{"auths":{"mirror.io":{"auth":"SECRET"}}}',
      sshPublicKey: "ssh-rsa AAAA..."
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.credentials.sshPublicKey, "ssh-rsa AAAA...");
  assert.strictEqual(result.credentials.pullSecretPlaceholder, undefined);
  assert.strictEqual(result.credentials.mirrorRegistryPullSecret, undefined);
});

test("sanitizeStateForPersistence strips SSH private key but preserves public key", () => {
  const input = {
    credentials: {
      sshPrivateKey: "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----",
      sshPublicKey: "ssh-rsa AAAA..."
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.credentials.sshPublicKey, "ssh-rsa AAAA...");
  assert.strictEqual(result.credentials.sshPrivateKey, undefined);
});

test("sanitizeStateForPersistence strips vSphere credentials but preserves config", () => {
  const input = {
    platformConfig: {
      vsphere: {
        hostname: "vcenter.local",
        username: "administrator@vsphere.local",
        password: "secret123",
        datacenter: "DC1",
        datastore: "datastore1",
        vcenters: [
          { hostname: "vc1.local", user: "admin", password: "pass1" },
          { hostname: "vc2.local", username: "admin", password: "pass2" }
        ]
      }
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.platformConfig.vsphere.hostname, "vcenter.local");
  assert.strictEqual(result.platformConfig.vsphere.datacenter, "DC1");
  assert.strictEqual(result.platformConfig.vsphere.datastore, "datastore1");
  assert.strictEqual(result.platformConfig.vsphere.username, undefined);
  assert.strictEqual(result.platformConfig.vsphere.password, undefined);
  assert.strictEqual(result.platformConfig.vsphere.vcenters[0].hostname, "vc1.local");
  assert.strictEqual(result.platformConfig.vsphere.vcenters[0].user, undefined);
  assert.strictEqual(result.platformConfig.vsphere.vcenters[0].username, undefined);
  assert.strictEqual(result.platformConfig.vsphere.vcenters[0].password, undefined);
});

test("sanitizeStateForPersistence strips Nutanix credentials but preserves config", () => {
  const input = {
    platformConfig: {
      nutanix: {
        endpoint: "prism.local",
        port: 9440,
        username: "admin",
        password: "secret",
        cluster: "cluster1"
      }
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.platformConfig.nutanix.endpoint, "prism.local");
  assert.strictEqual(result.platformConfig.nutanix.port, 9440);
  assert.strictEqual(result.platformConfig.nutanix.cluster, "cluster1");
  assert.strictEqual(result.platformConfig.nutanix.username, undefined);
  assert.strictEqual(result.platformConfig.nutanix.password, undefined);
});

test("sanitizeStateForPersistence strips BMC credentials but preserves BMC address and node hostname", () => {
  const input = {
    hostInventory: {
      nodes: [
        {
          hostname: "node1.local",
          role: "control-plane",
          bmc: {
            address: "ipmi://10.0.0.10",
            username: "admin",
            password: "secret"
          }
        },
        {
          hostname: "node2.local",
          role: "worker",
          bmcUsername: "root",
          bmcPassword: "password"
        }
      ]
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.hostInventory.nodes[0].hostname, "node1.local");
  assert.strictEqual(result.hostInventory.nodes[0].role, "control-plane");
  assert.strictEqual(result.hostInventory.nodes[0].bmc.address, "ipmi://10.0.0.10");
  assert.strictEqual(result.hostInventory.nodes[0].bmc.username, undefined);
  assert.strictEqual(result.hostInventory.nodes[0].bmc.password, undefined);
  assert.strictEqual(result.hostInventory.nodes[1].hostname, "node2.local");
  assert.strictEqual(result.hostInventory.nodes[1].bmcUsername, undefined);
  assert.strictEqual(result.hostInventory.nodes[1].bmcPassword, undefined);
});

test("sanitizeStateForPersistence strips proxy URL credentials but preserves scheme/host/port", () => {
  const input = {
    globalStrategy: {
      proxies: {
        httpProxy: "http://user:pass@proxy.corp.com:8080",
        httpsProxy: "https://admin:secret@10.0.0.1:3128",
        noProxy: "localhost,127.0.0.1"
      }
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.globalStrategy.proxies.httpProxy, "http://proxy.corp.com:8080/");
  assert.strictEqual(result.globalStrategy.proxies.httpsProxy, "https://10.0.0.1:3128/");
  assert.strictEqual(result.globalStrategy.proxies.noProxy, "localhost,127.0.0.1");
});

test("sanitizeStateForPersistence strips unknown nested exact-match credential fields recursively", () => {
  const input = {
    customField: {
      nested: {
        password: "secret1",
        token: "token123",
        secret: "secret2",
        privateKey: "key123",
        config: "safe",
        authenticationMode: "certificate",
        subscriptionId: "sub-12345",
        clientId: "client-67890"
      }
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.strictEqual(result.customField.nested.config, "safe");
  assert.strictEqual(result.customField.nested.authenticationMode, "certificate");
  assert.strictEqual(result.customField.nested.subscriptionId, "sub-12345");
  assert.strictEqual(result.customField.nested.clientId, "client-67890");
  assert.strictEqual(result.customField.nested.password, undefined);
  assert.strictEqual(result.customField.nested.token, undefined);
  assert.strictEqual(result.customField.nested.secret, undefined);
  assert.strictEqual(result.customField.nested.privateKey, undefined);
});

test("sanitizeStateForPersistence does not mutate input state", () => {
  const input = {
    credentials: { pullSecretPlaceholder: "SECRET" },
    platformConfig: { vsphere: { password: "secret" } }
  };
  const inputCopy = JSON.parse(JSON.stringify(input));
  sanitizeStateForPersistence(input);
  assert.deepStrictEqual(input, inputCopy);
});

test("sanitizeStateForPersistence preserves existing version state", () => {
  const input = {
    version: {
      _schemaVersion: 3,
      selectedMinor: "4.21",
      selectedPatch: "4.21.20",
      selectedChannel: "stable-4.21",
      locked: true
    }
  };
  const result = sanitizeStateForPersistence(input);
  assert.deepStrictEqual(result.version, input.version);
});

// Integration tests with real HTTP /api/state endpoint
test("POST /api/state does not persist pull secret auths", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    // Post state with pull secret auths
    const stateWithSecrets = {
      credentials: {
        pullSecretPlaceholder: '{"auths":{"registry.redhat.io":{"auth":"SECRET"}}}',
        sshPublicKey: "ssh-rsa AAAA..."
      }
    };

    const postRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stateWithSecrets)
    });

    // Backend should reject pull secret in POST
    assert.strictEqual(postRes.status, 400);
    const body = await postRes.json();
    assert.ok(body.error.includes("Credentials should not be included"));
  } finally {
    server.close();
  }
});

test("POST /api/state does not persist vSphere password", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const stateWithVsphere = {
      platformConfig: {
        vsphere: {
          hostname: "vcenter.local",
          username: "admin",
          password: "secret123",
          datacenter: "DC1"
        }
      }
    };

    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stateWithVsphere)
    });

    // Get persisted state directly from backend
    const persistedState = getState();
    assert.strictEqual(persistedState?.platformConfig?.vsphere?.hostname, "vcenter.local");
    assert.strictEqual(persistedState?.platformConfig?.vsphere?.datacenter, "DC1");
    assert.strictEqual(persistedState?.platformConfig?.vsphere?.password, undefined);
    assert.strictEqual(persistedState?.platformConfig?.vsphere?.username, undefined);
  } finally {
    server.close();
  }
});

test("POST /api/state does not persist BMC credentials but preserves BMC address", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const stateWithBmc = {
      hostInventory: {
        nodes: [
          {
            hostname: "node1.local",
            bmc: {
              address: "ipmi://10.0.0.10",
              username: "admin",
              password: "secret"
            }
          }
        ]
      }
    };

    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stateWithBmc)
    });

    const persistedState = getState();
    assert.strictEqual(persistedState?.hostInventory?.nodes[0]?.hostname, "node1.local");
    assert.strictEqual(persistedState?.hostInventory?.nodes[0]?.bmc?.address, "ipmi://10.0.0.10");
    assert.strictEqual(persistedState?.hostInventory?.nodes[0]?.bmc?.username, undefined);
    assert.strictEqual(persistedState?.hostInventory?.nodes[0]?.bmc?.password, undefined);
  } finally {
    server.close();
  }
});

test("POST /api/state strips proxy URL credentials but preserves scheme/host/port", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const stateWithProxy = {
      globalStrategy: {
        proxies: {
          httpProxy: "http://user:pass@proxy.corp.com:8080",
          httpsProxy: "https://admin:secret@10.0.0.1:3128"
        }
      }
    };

    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stateWithProxy)
    });

    const persistedState = getState();
    assert.strictEqual(persistedState?.globalStrategy?.proxies?.httpProxy, "http://proxy.corp.com:8080/");
    assert.strictEqual(persistedState?.globalStrategy?.proxies?.httpsProxy, "https://10.0.0.1:3128/");
  } finally {
    server.close();
  }
});

test("POST /api/state accepts supported 4.20 state", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state420 = {
      version: {
        selectedMinor: "4.20",
        selectedPatch: "4.20.40",
        selectedChannel: "stable-4.20",
        locked: true
      }
    };

    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state420)
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.version.selectedMinor, "4.20");
  } finally {
    server.close();
  }
});

test("POST /api/state accepts supported 4.21 state", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state421 = {
      version: {
        selectedMinor: "4.21",
        selectedPatch: "4.21.20",
        selectedChannel: "stable-4.21",
        locked: true
      }
    };

    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state421)
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.version.selectedMinor, "4.21");
  } finally {
    server.close();
  }
});
