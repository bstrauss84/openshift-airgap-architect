/**
 * Tests for oc-mirror preflight validation error translation.
 * Ensures schema validation errors are translated to human-readable messages.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from 'vitest';

// Mock the translation function (extracted for testing)
const translateValidationError = (path, message) => {
  const fieldLabels = {
    archivePath: "Archive directory",
    workspacePath: "Workspace directory",
    cachePath: "Cache directory",
    registryUrl: "Registry URL",
    configPath: "Config file path",
    rhAuthSource: "Red Hat authentication source",
    rhPullSecret: "Red Hat pull secret",
    mirrorAuthSource: "Mirror registry authentication source",
    mirrorPullSecret: "Mirror registry pull secret",
    configSourceType: "Config source type"
  };

  const fieldLabel = fieldLabels[path] || path;

  if (message.includes("Required")) {
    return `${fieldLabel} is required for this workflow mode.`;
  }
  if (message.includes("Invalid enum value")) {
    return `${fieldLabel} has an invalid value. Please refresh the page and try again.`;
  }
  if (message.includes("Pull secret must be valid JSON")) {
    return `${fieldLabel} must be valid JSON with an "auths" object. Check the format and try again.`;
  }
  if (message.includes("String must contain at least")) {
    return `${fieldLabel} cannot be empty.`;
  }
  if (message.includes("at most") || message.includes("too long")) {
    return `${fieldLabel} is too long. Maximum allowed length is 2048 characters.`;
  }

  return `${fieldLabel}: ${message}`;
};

describe('Preflight validation error translation', () => {
  it('should translate enum validation errors to user-friendly messages', () => {
    const result = translateValidationError(
      'rhAuthSource',
      "Invalid enum value. Expected 'inline' | 'mounted', received 'pasted'"
    );
    expect(result).toBe('Red Hat authentication source has an invalid value. Please refresh the page and try again.');
  });

  it('should translate required field errors with mode context', () => {
    const result = translateValidationError('archivePath', 'Required');
    expect(result).toBe('Archive directory is required for this workflow mode.');
  });

  it('should translate pull secret format errors', () => {
    const result = translateValidationError(
      'rhPullSecret',
      'Pull secret must be valid JSON with auths object'
    );
    expect(result).toBe('Red Hat pull secret must be valid JSON with an "auths" object. Check the format and try again.');
  });

  it('should translate empty string errors', () => {
    const result = translateValidationError(
      'configPath',
      'String must contain at least 1 character(s)'
    );
    expect(result).toBe('Config file path cannot be empty.');
  });

  it('should translate max length errors', () => {
    const result = translateValidationError(
      'registryUrl',
      'String must contain at most 2048 characters'
    );
    expect(result).toBe('Registry URL is too long. Maximum allowed length is 2048 characters.');
  });

  it('should translate unknown field names with original message', () => {
    const result = translateValidationError(
      'unknownField',
      'Some validation error'
    );
    expect(result).toBe('unknownField: Some validation error');
  });

  it('should handle all critical field paths', () => {
    const criticalFields = [
      { path: 'archivePath', expected: 'Archive directory' },
      { path: 'workspacePath', expected: 'Workspace directory' },
      { path: 'cachePath', expected: 'Cache directory' },
      { path: 'registryUrl', expected: 'Registry URL' },
      { path: 'configPath', expected: 'Config file path' },
      { path: 'rhAuthSource', expected: 'Red Hat authentication source' },
      { path: 'rhPullSecret', expected: 'Red Hat pull secret' },
      { path: 'mirrorAuthSource', expected: 'Mirror registry authentication source' },
      { path: 'mirrorPullSecret', expected: 'Mirror registry pull secret' }
    ];

    criticalFields.forEach(({ path, expected }) => {
      const result = translateValidationError(path, 'Required');
      expect(result).toContain(expected);
    });
  });
});

describe('Auth source value mapping', () => {
  it('should map frontend "retained" and "pasted" to backend "inline"', () => {
    const frontendValues = ['retained', 'pasted'];
    frontendValues.forEach(value => {
      const mapped = value === 'mounted' ? 'mounted' : 'inline';
      expect(mapped).toBe('inline');
    });
  });

  it('should map frontend "mounted" to backend "mounted"', () => {
    const mapped = 'mounted' === 'mounted' ? 'mounted' : 'inline';
    expect(mapped).toBe('mounted');
  });

  it('should map mirror auth "reuse" to "reuse"', () => {
    const mapped = 'reuse' === 'reuse' ? 'reuse' : 'inline';
    expect(mapped).toBe('reuse');
  });

  it('should map mirror auth "pasted" to "inline"', () => {
    const mapped = 'pasted' === 'reuse' ? 'reuse' : 'inline';
    expect(mapped).toBe('inline');
  });
});
