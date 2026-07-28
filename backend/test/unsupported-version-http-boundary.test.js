/**
 * Unsupported Version - HTTP Boundary Tests
 *
 * DOC-102 Slice 5F.13: Unsupported OpenShift versions (4.22) must return HTTP 422
 * UNSUPPORTED_VERSION at all HTTP route boundaries before artifact builders execute.
 *
 * Product truth:
 * - v2.0.0 supports 4.20 and 4.21 only
 * - 4.22 is unsupported even if Cincinnati offers it
 * - Unsupported versions must not silently fall back to 4.21 catalogs or artifacts
 *
 * @author Bill Strauss
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import { app } from '../src/index.js';

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * Assert HTTP 422 UNSUPPORTED_VERSION response shape.
 */
function assertUnsupportedVersionResponse(body) {
  assert.strictEqual(body.code, 'UNSUPPORTED_VERSION', 'Response must include code: UNSUPPORTED_VERSION');
  assert.strictEqual(body.requestedVersion, '4.22', 'Response must include requestedVersion: 4.22');
  assert.ok(Array.isArray(body.supportedVersions), 'Response must include supportedVersions array');
  assert.ok(
    body.supportedVersions.includes('4.20') && body.supportedVersions.includes('4.21'),
    'supportedVersions must include 4.20 and 4.21'
  );
  assert.strictEqual(body.supportedVersions.length, 2, 'supportedVersions must contain exactly 2 entries');
}

/**
 * Confirmed 4.22 state fixture (v3 canonical schema).
 */
const confirmed422State = {
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.22',
    selectedPatch: '4.22.1',
    locked: true
  },
  release: {
    channel: '4.22',
    patchVersion: '4.22.1',
    confirmed: true
  },
  blueprint: {
    platform: 'Bare Metal',
    arch: 'x86_64',
    clusterName: 'test-cluster',
    baseDomain: 'example.com',
    confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa test' },
  globalStrategy: {
    networking: {
      networkType: 'OVNKubernetes',
      machineNetworkV4: '192.168.1.0/24',
      clusterNetworkCidr: '10.128.0.0/14',
      clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: '172.30.0.0/16'
    },
    mirroring: {
      registryFqdn: 'registry.local:5000',
      sources: []
    }
  },
  hostInventory: { nodes: [] },
  exportOptions: {
    includeCredentials: false,
    includeCertificates: true,
    includeClientTools: false,
    includeInstaller: false
  }
};

/**
 * Unconfirmed 4.22 state fixture (version.locked = false).
 */
const unconfirmed422State = {
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.22',
    selectedPatch: '4.22.1',
    locked: false
  },
  release: {
    channel: '4.22',
    patchVersion: '4.22.1',
    confirmed: false
  },
  blueprint: {
    platform: 'Bare Metal',
    arch: 'x86_64',
    clusterName: 'test-cluster',
    baseDomain: 'example.com',
    confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa test' },
  globalStrategy: {
    networking: {
      networkType: 'OVNKubernetes',
      machineNetworkV4: '192.168.1.0/24'
    },
    mirroring: {
      registryFqdn: 'registry.local:5000',
      sources: []
    }
  },
  hostInventory: { nodes: [] },
  exportOptions: {
    includeCredentials: false,
    includeCertificates: false
  }
};

/**
 * Confirmed 4.20 state (supported version).
 */
const confirmed420State = {
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.20',
    selectedPatch: '4.20.8',
    locked: true
  },
  release: {
    channel: '4.20',
    patchVersion: '4.20.8',
    confirmed: true
  },
  blueprint: {
    platform: 'Bare Metal',
    arch: 'x86_64',
    clusterName: 'test-cluster',
    baseDomain: 'example.com',
    confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa test' },
  globalStrategy: {
    networking: {
      networkType: 'OVNKubernetes',
      machineNetworkV4: '192.168.1.0/24'
    }
  },
  hostInventory: { nodes: [] },
  exportOptions: { includeCredentials: false }
};

/**
 * Confirmed 4.21 state (supported version).
 */
const confirmed421State = {
  version: {
    _schemaVersion: 3,
    selectedMinor: '4.21',
    selectedPatch: '4.21.5',
    locked: true
  },
  release: {
    channel: '4.21',
    patchVersion: '4.21.5',
    confirmed: true
  },
  blueprint: {
    platform: 'Bare Metal',
    arch: 'x86_64',
    clusterName: 'test-cluster',
    baseDomain: 'example.com',
    confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa test' },
  globalStrategy: {
    networking: {
      networkType: 'OVNKubernetes',
      machineNetworkV4: '192.168.1.0/24'
    }
  },
  hostInventory: { nodes: [] },
  exportOptions: { includeCredentials: false }
};

describe('Unsupported Version - HTTP Boundary Tests', () => {
  describe('GET /api/generate', () => {
    it('rejects confirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        // Set confirmed 4.22 state
        await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmed422State)
        });

        const res = await fetch(`${baseUrl}/api/generate`);
        assert.strictEqual(res.status, 422, 'GET /api/generate must return 422 for 4.22');
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects unconfirmed 4.22 state with 422 UNSUPPORTED_VERSION (support check before confirmation check)', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unconfirmed422State)
        });

        const res = await fetch(`${baseUrl}/api/generate`);
        assert.strictEqual(
          res.status,
          422,
          'GET /api/generate must return 422 UNSUPPORTED_VERSION before confirmation check for unconfirmed 4.22'
        );
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.20 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmed420State)
        });

        const res = await fetch(`${baseUrl}/api/generate`);
        assert.notStrictEqual(
          res.status,
          422,
          'GET /api/generate must not return 422 for supported 4.20'
        );
        // Should succeed (200) or fail for another reason (e.g., 400), but not unsupported version
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.20 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.21 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmed421State)
        });

        const res = await fetch(`${baseUrl}/api/generate`);
        assert.notStrictEqual(
          res.status,
          422,
          'GET /api/generate must not return 422 for supported 4.21'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.21 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('POST /api/generate', () => {
    it('rejects confirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        assert.strictEqual(res.status, 422, 'POST /api/generate must return 422 for 4.22');
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects unconfirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: unconfirmed422State })
        });
        assert.strictEqual(
          res.status,
          422,
          'POST /api/generate must return 422 UNSUPPORTED_VERSION before confirmation check for unconfirmed 4.22'
        );
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.20 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed420State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/generate must not return 422 for supported 4.20'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.20 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.21 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed421State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/generate must not return 422 for supported 4.21'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.21 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('POST /api/bundle.prepare', () => {
    it('rejects confirmed 4.22 state with 422 UNSUPPORTED_VERSION and does not issue token', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        assert.strictEqual(res.status, 422, 'POST /api/bundle.prepare must return 422 for 4.22');
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
        assert.strictEqual(body.token, undefined, 'Must not issue token for unsupported version');
      } finally {
        await closeServer(server);
      }
    });

    it('rejects unconfirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: unconfirmed422State })
        });
        assert.strictEqual(
          res.status,
          422,
          'POST /api/bundle.prepare must return 422 UNSUPPORTED_VERSION before confirmation check for unconfirmed 4.22'
        );
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
        assert.strictEqual(body.token, undefined, 'Must not issue token for unsupported version');
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.20 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed420State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/bundle.prepare must not return 422 for supported 4.20'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.20 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.21 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed421State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/bundle.prepare must not return 422 for supported 4.21'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.21 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('POST /api/bundle.zip', () => {
    it('rejects confirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.zip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        assert.strictEqual(res.status, 422, 'POST /api/bundle.zip must return 422 for 4.22');
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('rejects unconfirmed 4.22 state with 422 UNSUPPORTED_VERSION', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.zip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: unconfirmed422State })
        });
        assert.strictEqual(
          res.status,
          422,
          'POST /api/bundle.zip must return 422 UNSUPPORTED_VERSION before confirmation check for unconfirmed 4.22'
        );
        const body = await res.json();
        assertUnsupportedVersionResponse(body);
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.20 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.zip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed420State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/bundle.zip must not return 422 for supported 4.20'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.20 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });

    it('does not reject supported 4.21 state', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const res = await fetch(`${baseUrl}/api/bundle.zip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed421State })
        });
        assert.notStrictEqual(
          res.status,
          422,
          'POST /api/bundle.zip must not return 422 for supported 4.21'
        );
        if (res.status === 422) {
          const body = await res.json();
          assert.notStrictEqual(
            body.code,
            'UNSUPPORTED_VERSION',
            'Supported 4.21 must not trigger UNSUPPORTED_VERSION'
          );
        }
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('HTTP error parity across routes', () => {
    it('GET /api/generate and POST /api/generate return identical error shape for 4.22', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(confirmed422State)
        });
        const getRes = await fetch(`${baseUrl}/api/generate`);
        const getBody = await getRes.json();

        const postRes = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        const postBody = await postRes.json();

        assert.strictEqual(getRes.status, postRes.status);
        assert.strictEqual(getBody.code, postBody.code);
        assert.strictEqual(getBody.requestedVersion, postBody.requestedVersion);
        assert.deepStrictEqual(getBody.supportedVersions, postBody.supportedVersions);
      } finally {
        await closeServer(server);
      }
    });

    it('POST /api/generate and POST /api/bundle.prepare return identical error shape for 4.22', async () => {
      const { server, baseUrl } = await createTestServer();
      try {
        const genRes = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        const genBody = await genRes.json();

        const bundleRes = await fetch(`${baseUrl}/api/bundle.prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: confirmed422State })
        });
        const bundleBody = await bundleRes.json();

        assert.strictEqual(genRes.status, bundleRes.status);
        assert.strictEqual(genBody.code, bundleBody.code);
        assert.strictEqual(genBody.requestedVersion, bundleBody.requestedVersion);
        assert.deepStrictEqual(genBody.supportedVersions, bundleBody.supportedVersions);
      } finally {
        await closeServer(server);
      }
    });
  });
});
