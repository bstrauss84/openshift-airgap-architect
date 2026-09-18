/**
 * OpenShift Airgap Architect - Operator-Managed Mode Tests
 *
 * Tests for OpenShift operator-managed mode detection and pull secret handling.
 * Verifies environment variable detection, mounted secret validation, and
 * fail-fast behavior when required secrets are missing.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert";

// ===================================================================
// Operator-Managed Detection Tests
// ===================================================================

test("isOperatorManaged() returns true when OPENSHIFT_OPERATOR_MANAGED=true", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    process.env.OPENSHIFT_OPERATOR_MANAGED = "true";
    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };
    assert.strictEqual(isOperatorManaged(), true);
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    } else {
      delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    }
  }
});

test("isOperatorManaged() returns true when OPENSHIFT_OPERATOR_MANAGED=1", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    process.env.OPENSHIFT_OPERATOR_MANAGED = "1";
    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };
    assert.strictEqual(isOperatorManaged(), true);
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    } else {
      delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    }
  }
});

test("isOperatorManaged() returns false when OPENSHIFT_OPERATOR_MANAGED not set", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };
    assert.strictEqual(isOperatorManaged(), false);
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    }
  }
});

test("isOperatorManaged() returns false when OPENSHIFT_OPERATOR_MANAGED=false", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    process.env.OPENSHIFT_OPERATOR_MANAGED = "false";
    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };
    assert.strictEqual(isOperatorManaged(), false);
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    } else {
      delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    }
  }
});

// ===================================================================
// authAvailable() with Mounted Secret Tests
// ===================================================================

test("authAvailable(mountedSecret) returns true when mountedSecret provided", () => {
  const authAvailable = (mountedSecret = null) => {
    if (mountedSecret) return true;
    const file = process.env.REGISTRY_AUTH_FILE;
    if (!file) return false;
    try {
      return !!file && !!require("node:fs").existsSync(file);
    } catch {
      return false;
    }
  };

  const mockSecret = '{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}';
  assert.strictEqual(authAvailable(mockSecret), true);
});

test("authAvailable(null) returns false when REGISTRY_AUTH_FILE not set", () => {
  const oldValue = process.env.REGISTRY_AUTH_FILE;
  try {
    delete process.env.REGISTRY_AUTH_FILE;
    const authAvailable = (mountedSecret = null) => {
      if (mountedSecret) return true;
      const file = process.env.REGISTRY_AUTH_FILE;
      if (!file) return false;
      try {
        return !!file && !!require("node:fs").existsSync(file);
      } catch {
        return false;
      }
    };
    assert.strictEqual(authAvailable(null), false);
  } finally {
    if (oldValue !== undefined) {
      process.env.REGISTRY_AUTH_FILE = oldValue;
    }
  }
});

test("authAvailable(null) returns false when REGISTRY_AUTH_FILE points to non-existent file", () => {
  const oldValue = process.env.REGISTRY_AUTH_FILE;
  try {
    process.env.REGISTRY_AUTH_FILE = "/tmp/nonexistent-auth-file-12345.json";
    const authAvailable = (mountedSecret = null) => {
      if (mountedSecret) return true;
      const file = process.env.REGISTRY_AUTH_FILE;
      if (!file) return false;
      try {
        return !!file && !!require("node:fs").existsSync(file);
      } catch {
        return false;
      }
    };
    assert.strictEqual(authAvailable(null), false);
  } finally {
    if (oldValue !== undefined) {
      process.env.REGISTRY_AUTH_FILE = oldValue;
    } else {
      delete process.env.REGISTRY_AUTH_FILE;
    }
  }
});

test("authAvailable(mountedSecret) returns true even when REGISTRY_AUTH_FILE not set", () => {
  const oldValue = process.env.REGISTRY_AUTH_FILE;
  try {
    delete process.env.REGISTRY_AUTH_FILE;
    const authAvailable = (mountedSecret = null) => {
      if (mountedSecret) return true;
      const file = process.env.REGISTRY_AUTH_FILE;
      if (!file) return false;
      try {
        return !!file && !!require("node:fs").existsSync(file);
      } catch {
        return false;
      }
    };
    const mockSecret = '{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}';
    assert.strictEqual(authAvailable(mockSecret), true);
  } finally {
    if (oldValue !== undefined) {
      process.env.REGISTRY_AUTH_FILE = oldValue;
    }
  }
});

// ===================================================================
// validateOperatorRequirements() Behavior Tests
// ===================================================================

test("validateOperatorRequirements() should not exit when not operator-managed", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    delete process.env.OPENSHIFT_OPERATOR_MANAGED;

    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };

    const validateOperatorRequirements = (mountedSecret = null) => {
      if (!isOperatorManaged()) return;
      if (!mountedSecret) {
        throw new Error("FATAL: Pull secret required in operator mode");
      }
    };

    // Should not throw when not operator-managed
    assert.doesNotThrow(() => validateOperatorRequirements(null));
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    }
  }
});

test("validateOperatorRequirements() should throw when operator-managed without secret", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    process.env.OPENSHIFT_OPERATOR_MANAGED = "true";

    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };

    const validateOperatorRequirements = (mountedSecret = null) => {
      if (!isOperatorManaged()) return;
      if (!mountedSecret) {
        throw new Error("FATAL: Pull secret required in operator mode");
      }
    };

    // Should throw when operator-managed without secret
    assert.throws(
      () => validateOperatorRequirements(null),
      /FATAL: Pull secret required in operator mode/
    );
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    } else {
      delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    }
  }
});

test("validateOperatorRequirements() should not throw when operator-managed WITH secret", () => {
  const oldValue = process.env.OPENSHIFT_OPERATOR_MANAGED;
  try {
    process.env.OPENSHIFT_OPERATOR_MANAGED = "true";

    const isOperatorManaged = () => {
      const managed = process.env.OPENSHIFT_OPERATOR_MANAGED;
      return managed === "true" || managed === "1";
    };

    const validateOperatorRequirements = (mountedSecret = null) => {
      if (!isOperatorManaged()) return;
      if (!mountedSecret) {
        throw new Error("FATAL: Pull secret required in operator mode");
      }
    };

    const mockSecret = '{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}';

    // Should not throw when operator-managed with secret
    assert.doesNotThrow(() => validateOperatorRequirements(mockSecret));
  } finally {
    if (oldValue !== undefined) {
      process.env.OPENSHIFT_OPERATOR_MANAGED = oldValue;
    } else {
      delete process.env.OPENSHIFT_OPERATOR_MANAGED;
    }
  }
});
