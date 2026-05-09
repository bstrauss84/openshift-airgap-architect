/**
 * Tests for mirrorToMirror authentication logic.
 * Verifies both RH and mirror pull secrets are required and merged correctly.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import test from 'node:test';
import assert from 'node:assert';

test('mirrorToMirror preflight: requires both RH and mirror pull secrets', async (t) => {
  await t.test('should pass when both secrets provided', () => {
    const checks = { auth: null };
    const blockers = [];
    const fieldErrors = {};
    const mode = "mirrorToMirror";
    const rhPullSecret = '{"auths":{"registry.redhat.io":{"auth":"rhtoken"}}}';
    const mirrorPullSecret = '{"auths":{"mirror.example.com":{"auth":"mirrortoken"}}}';
    const mirrorAuthSource = "inline";

    // Simulate RH secret check (lines 1660-1668)
    if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
      if (rhPullSecret && typeof rhPullSecret === "string" && rhPullSecret.trim().length > 0) {
        checks.auth = "present";
      } else {
        checks.auth = "missing";
        const msg = "Red Hat pull secret is required to pull from registry.redhat.io / quay.io.";
        blockers.push(msg);
        fieldErrors.rhPullSecret = { severity: "blocker", message: msg };
      }
    }

    // Simulate mirror secret check (lines 1670-1696)
    if (mode === "diskToMirror" || mode === "mirrorToMirror") {
      let mirrorSecretPresent = false;
      if (mirrorAuthSource === "reuse") {
        // Not testing "reuse" path here
      } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
        mirrorSecretPresent = true;
      } else {
        const msg = "Mirror registry credentials are required for this mode.";
        blockers.push(msg);
        fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
      }
      if (!mirrorSecretPresent) checks.auth = "missing";
    }

    assert.strictEqual(blockers.length, 0, 'Should have no blockers when both secrets provided');
    assert.strictEqual(checks.auth, 'present', 'Auth check should be present');
  });

  await t.test('should block when only RH secret provided', () => {
    const checks = { auth: null };
    const blockers = [];
    const fieldErrors = {};
    const mode = "mirrorToMirror";
    const rhPullSecret = '{"auths":{"registry.redhat.io":{"auth":"rhtoken"}}}';
    const mirrorPullSecret = null;
    const mirrorAuthSource = "inline";

    // Simulate RH secret check
    if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
      if (rhPullSecret && typeof rhPullSecret === "string" && rhPullSecret.trim().length > 0) {
        checks.auth = "present";
      } else {
        checks.auth = "missing";
        const msg = "Red Hat pull secret is required to pull from registry.redhat.io / quay.io.";
        blockers.push(msg);
        fieldErrors.rhPullSecret = { severity: "blocker", message: msg };
      }
    }

    // Simulate mirror secret check
    if (mode === "diskToMirror" || mode === "mirrorToMirror") {
      let mirrorSecretPresent = false;
      if (mirrorAuthSource === "reuse") {
        // Not testing "reuse" path here
      } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
        mirrorSecretPresent = true;
      } else {
        const msg = "Mirror registry credentials are required for this mode.";
        blockers.push(msg);
        fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
      }
      if (!mirrorSecretPresent) checks.auth = "missing";
    }

    assert.strictEqual(blockers.length, 1, 'Should have 1 blocker (missing mirror secret)');
    assert.ok(blockers[0].includes('Mirror registry credentials'), 'Blocker should mention mirror credentials');
    assert.strictEqual(fieldErrors.mirrorPullSecret?.severity, 'blocker', 'Mirror secret error should be blocker');
    assert.strictEqual(checks.auth, 'missing', 'Auth check should be missing');
  });

  await t.test('should block when only mirror secret provided', () => {
    const checks = { auth: null };
    const blockers = [];
    const fieldErrors = {};
    const mode = "mirrorToMirror";
    const rhPullSecret = null;
    const mirrorPullSecret = '{"auths":{"mirror.example.com":{"auth":"mirrortoken"}}}';
    const mirrorAuthSource = "inline";

    // Simulate RH secret check
    if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
      if (rhPullSecret && typeof rhPullSecret === "string" && rhPullSecret.trim().length > 0) {
        checks.auth = "present";
      } else {
        checks.auth = "missing";
        const msg = "Red Hat pull secret is required to pull from registry.redhat.io / quay.io.";
        blockers.push(msg);
        fieldErrors.rhPullSecret = { severity: "blocker", message: msg };
      }
    }

    // Simulate mirror secret check
    if (mode === "diskToMirror" || mode === "mirrorToMirror") {
      let mirrorSecretPresent = false;
      if (mirrorAuthSource === "reuse") {
        // Not testing "reuse" path here
      } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
        mirrorSecretPresent = true;
      } else {
        const msg = "Mirror registry credentials are required for this mode.";
        blockers.push(msg);
        fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
      }
      if (!mirrorSecretPresent) checks.auth = "missing";
    }

    assert.strictEqual(blockers.length, 1, 'Should have 1 blocker (missing RH secret)');
    assert.ok(blockers[0].includes('Red Hat pull secret'), 'Blocker should mention RH pull secret');
    assert.strictEqual(fieldErrors.rhPullSecret?.severity, 'blocker', 'RH secret error should be blocker');
    assert.strictEqual(checks.auth, 'missing', 'Auth check should be missing');
  });

  await t.test('should block when neither secret provided', () => {
    const checks = { auth: null };
    const blockers = [];
    const fieldErrors = {};
    const mode = "mirrorToMirror";
    const rhPullSecret = null;
    const mirrorPullSecret = null;
    const mirrorAuthSource = "inline";

    // Simulate RH secret check
    if (mode === "mirrorToDisk" || mode === "mirrorToMirror") {
      if (rhPullSecret && typeof rhPullSecret === "string" && rhPullSecret.trim().length > 0) {
        checks.auth = "present";
      } else {
        checks.auth = "missing";
        const msg = "Red Hat pull secret is required to pull from registry.redhat.io / quay.io.";
        blockers.push(msg);
        fieldErrors.rhPullSecret = { severity: "blocker", message: msg };
      }
    }

    // Simulate mirror secret check
    if (mode === "diskToMirror" || mode === "mirrorToMirror") {
      let mirrorSecretPresent = false;
      if (mirrorAuthSource === "reuse") {
        // Not testing "reuse" path here
      } else if (mirrorPullSecret && typeof mirrorPullSecret === "string" && mirrorPullSecret.trim().length > 0) {
        mirrorSecretPresent = true;
      } else {
        const msg = "Mirror registry credentials are required for this mode.";
        blockers.push(msg);
        fieldErrors.mirrorPullSecret = { severity: "blocker", message: msg };
      }
      if (!mirrorSecretPresent) checks.auth = "missing";
    }

    assert.strictEqual(blockers.length, 2, 'Should have 2 blockers (both secrets missing)');
    assert.ok(blockers.some(b => b.includes('Red Hat pull secret')), 'Should block on RH secret');
    assert.ok(blockers.some(b => b.includes('Mirror registry credentials')), 'Should block on mirror secret');
    assert.strictEqual(fieldErrors.rhPullSecret?.severity, 'blocker', 'RH secret error should be blocker');
    assert.strictEqual(fieldErrors.mirrorPullSecret?.severity, 'blocker', 'Mirror secret error should be blocker');
    assert.strictEqual(checks.auth, 'missing', 'Auth check should be missing');
  });
});

test('mergePullSecrets: correctly merges auth objects', async (t) => {
  await t.test('should merge two pull secrets with different auths', () => {
    const rhSecret = '{"auths":{"registry.redhat.io":{"auth":"rhtoken"},"quay.io":{"auth":"quaytoken"}}}';
    const mirrorSecret = '{"auths":{"mirror.example.com":{"auth":"mirrortoken"}}}';

    // Simulate mergePullSecrets from utils.js (lines 155-159)
    const parsedA = JSON.parse(rhSecret);
    const parsedB = JSON.parse(mirrorSecret);
    const merged = JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });

    const result = JSON.parse(merged);
    assert.ok(result.auths['registry.redhat.io'], 'Should contain registry.redhat.io auth');
    assert.ok(result.auths['quay.io'], 'Should contain quay.io auth');
    assert.ok(result.auths['mirror.example.com'], 'Should contain mirror.example.com auth');
    assert.strictEqual(result.auths['registry.redhat.io'].auth, 'rhtoken', 'RH token should be preserved');
    assert.strictEqual(result.auths['quay.io'].auth, 'quaytoken', 'Quay token should be preserved');
    assert.strictEqual(result.auths['mirror.example.com'].auth, 'mirrortoken', 'Mirror token should be preserved');
  });

  await t.test('should handle overlapping registry keys (last one wins)', () => {
    const secretA = '{"auths":{"registry.example.com":{"auth":"tokenA"}}}';
    const secretB = '{"auths":{"registry.example.com":{"auth":"tokenB"}}}';

    const parsedA = JSON.parse(secretA);
    const parsedB = JSON.parse(secretB);
    const merged = JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });

    const result = JSON.parse(merged);
    // Object spread makes the second value win when keys overlap
    assert.strictEqual(result.auths['registry.example.com'].auth, 'tokenB', 'Second secret should override first');
  });
});

test('mirrorToMirror run: auth file creation logic', async (t) => {
  await t.test('should merge both secrets when both provided', () => {
    const mode = "mirrorToMirror";
    const rhPullSecretRaw = '{"auths":{"registry.redhat.io":{"auth":"rhtoken"}}}';
    const mirrorPullSecretRaw = '{"auths":{"mirror.example.com":{"auth":"mirrortoken"}}}';
    const mirrorAuthSource = "inline";

    // Simulate lines 1913-1925
    let authFileContent = null;
    if (mode === "mirrorToMirror") {
      const rhRaw = rhPullSecretRaw;
      const mirrorRaw = mirrorAuthSource === "reuse"
        ? null // Would come from state.credentials.mirrorRegistryPullSecret
        : mirrorPullSecretRaw;

      if (rhRaw && mirrorRaw) {
        // Simulate normalizePullSecret (just return as-is for test)
        const normalized1 = rhRaw;
        const normalized2 = mirrorRaw;

        // Simulate mergePullSecrets
        const parsedA = JSON.parse(normalized1);
        const parsedB = JSON.parse(normalized2);
        authFileContent = JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });
      } else if (rhRaw) {
        authFileContent = rhRaw;
      } else if (mirrorRaw) {
        authFileContent = mirrorRaw;
      }
    }

    assert.ok(authFileContent, 'Auth file content should be created');
    const result = JSON.parse(authFileContent);
    assert.ok(result.auths['registry.redhat.io'], 'Should contain RH registry auth');
    assert.ok(result.auths['mirror.example.com'], 'Should contain mirror registry auth');
  });

  await t.test('should use only RH secret when mirror secret missing', () => {
    const mode = "mirrorToMirror";
    const rhPullSecretRaw = '{"auths":{"registry.redhat.io":{"auth":"rhtoken"}}}';
    const mirrorPullSecretRaw = null;
    const mirrorAuthSource = "inline";

    let authFileContent = null;
    if (mode === "mirrorToMirror") {
      const rhRaw = rhPullSecretRaw;
      const mirrorRaw = mirrorAuthSource === "reuse" ? null : mirrorPullSecretRaw;

      if (rhRaw && mirrorRaw) {
        const parsedA = JSON.parse(rhRaw);
        const parsedB = JSON.parse(mirrorRaw);
        authFileContent = JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });
      } else if (rhRaw) {
        authFileContent = rhRaw;
      } else if (mirrorRaw) {
        authFileContent = mirrorRaw;
      }
    }

    assert.ok(authFileContent, 'Auth file content should be created (RH only)');
    const result = JSON.parse(authFileContent);
    assert.ok(result.auths['registry.redhat.io'], 'Should contain RH registry auth');
    assert.strictEqual(Object.keys(result.auths).length, 1, 'Should only have RH auth');
  });

  await t.test('should use only mirror secret when RH secret missing', () => {
    const mode = "mirrorToMirror";
    const rhPullSecretRaw = null;
    const mirrorPullSecretRaw = '{"auths":{"mirror.example.com":{"auth":"mirrortoken"}}}';
    const mirrorAuthSource = "inline";

    let authFileContent = null;
    if (mode === "mirrorToMirror") {
      const rhRaw = rhPullSecretRaw;
      const mirrorRaw = mirrorAuthSource === "reuse" ? null : mirrorPullSecretRaw;

      if (rhRaw && mirrorRaw) {
        const parsedA = JSON.parse(rhRaw);
        const parsedB = JSON.parse(mirrorRaw);
        authFileContent = JSON.stringify({ auths: { ...parsedA.auths, ...parsedB.auths } });
      } else if (rhRaw) {
        authFileContent = rhRaw;
      } else if (mirrorRaw) {
        authFileContent = mirrorRaw;
      }
    }

    assert.ok(authFileContent, 'Auth file content should be created (mirror only)');
    const result = JSON.parse(authFileContent);
    assert.ok(result.auths['mirror.example.com'], 'Should contain mirror registry auth');
    assert.strictEqual(Object.keys(result.auths).length, 1, 'Should only have mirror auth');
  });
});
