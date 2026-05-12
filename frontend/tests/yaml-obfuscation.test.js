/**
 * Tests for YAML obfuscation utility.
 * Ensures sensitive values are properly redacted.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from 'vitest';
import { obfuscateYaml } from '../src/utils/yamlObfuscation';

describe('obfuscateYaml', () => {
  it('should return original content when showSensitive is true', () => {
    const yaml = "pullSecret: 'secret123'\nsshKey: 'ssh-rsa AAAA'";
    expect(obfuscateYaml(yaml, true)).toBe(yaml);
  });

  it('should return original content when yamlContent is empty', () => {
    expect(obfuscateYaml('', false)).toBe('');
    expect(obfuscateYaml(null, false)).toBe(null);
    expect(obfuscateYaml(undefined, false)).toBe(undefined);
  });

  describe('pullSecret obfuscation', () => {
    it('should obfuscate pullSecret with quoted JSON', () => {
      const yaml = "pullSecret: '{\"auths\":{\"registry.redhat.io\":{\"auth\":\"base64string\"}}}'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("pullSecret: '***REDACTED***'");
    });

    it('should obfuscate pullSecret without quotes', () => {
      const yaml = "pullSecret: {\"auths\":{\"registry.redhat.io\":{\"auth\":\"base64string\"}}}";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("pullSecret: '***REDACTED***'");
    });

    it('should obfuscate multiple pullSecret fields', () => {
      const yaml = `
apiVersion: v1
pullSecret: '{"auths":{}}'
metadata:
  name: test
pullSecret: '{"auths":{}}'`;
      const result = obfuscateYaml(yaml);
      expect(result).toContain("pullSecret: '***REDACTED***'");
      expect(result).not.toContain('{"auths"');
    });
  });

  describe('sshKey obfuscation', () => {
    it('should obfuscate sshKey field', () => {
      const yaml = "sshKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("sshKey: '***REDACTED***'");
    });

    it('should obfuscate sshKey without quotes', () => {
      const yaml = "sshKey: ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("sshKey: '***REDACTED***'");
    });
  });

  describe('password field obfuscation', () => {
    it('should obfuscate password field (case-insensitive)', () => {
      const yaml = "password: 'mypassword123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("password: '***REDACTED***'");
    });

    it('should obfuscate Password with capital P', () => {
      const yaml = "Password: 'MyPassword123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("Password: '***REDACTED***'");
    });

    it('should obfuscate fields containing password', () => {
      const yaml = `userPassword: 'pass123'
adminPassword: 'admin456'
databasePassword: 'db789'`;
      const result = obfuscateYaml(yaml);
      expect(result).toContain("userPassword: '***REDACTED***'");
      expect(result).toContain("adminPassword: '***REDACTED***'");
      expect(result).toContain("databasePassword: '***REDACTED***'");
      expect(result).not.toContain('pass123');
      expect(result).not.toContain('admin456');
      expect(result).not.toContain('db789');
    });
  });

  describe('secret field obfuscation', () => {
    it('should obfuscate secret field (case-insensitive)', () => {
      const yaml = "clientSecret: 'secret123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("clientSecret: '***REDACTED***'");
    });

    it('should obfuscate Secret with capital S', () => {
      const yaml = "apiSecret: 'MySecret123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("apiSecret: '***REDACTED***'");
    });

    it('should not double-obfuscate pullSecret', () => {
      const yaml = "pullSecret: '***REDACTED***'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("pullSecret: '***REDACTED***'");
    });
  });

  describe('token field obfuscation', () => {
    it('should obfuscate token field (case-insensitive)', () => {
      const yaml = "token: 'abc123xyz'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("token: '***REDACTED***'");
    });

    it('should obfuscate accessToken field', () => {
      const yaml = "accessToken: 'mytoken123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("accessToken: '***REDACTED***'");
    });

    it('should obfuscate refreshToken field', () => {
      const yaml = "refreshToken: 'refresh123'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("refreshToken: '***REDACTED***'");
    });
  });

  describe('proxy credential obfuscation', () => {
    it('should obfuscate HTTP proxy credentials in URLs', () => {
      const yaml = "httpProxy: 'http://user:password@proxy.example.com:8080'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("httpProxy: 'http://***REDACTED***@proxy.example.com:8080'");
    });

    it('should obfuscate HTTPS proxy credentials in URLs', () => {
      const yaml = "httpsProxy: 'https://admin:secret123@proxy.internal:3128'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("httpsProxy: 'https://***REDACTED***@proxy.internal:3128'");
    });

    it('should handle URLs without credentials unchanged', () => {
      const yaml = "httpProxy: 'http://proxy.example.com:8080'";
      const result = obfuscateYaml(yaml);
      expect(result).toBe("httpProxy: 'http://proxy.example.com:8080'");
    });
  });

  describe('complex YAML obfuscation', () => {
    it('should obfuscate multiple sensitive fields in complex YAML', () => {
      const yaml = `apiVersion: v1
metadata:
  name: test-config
pullSecret: '{"auths":{"registry.redhat.io":{"auth":"dXNlcjpwYXNz"}}}'
sshKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...'
credentials:
  username: admin
  password: 'adminpass123'
  token: 'token123'
proxy:
  http: 'http://user:pass@proxy.example.com:8080'
  https: 'https://admin:secret@proxy.internal:3128'
baseDomain: example.com
networking:
  clusterNetwork:
    - cidr: 10.128.0.0/14`;

      const result = obfuscateYaml(yaml);

      // Should obfuscate sensitive fields
      expect(result).toContain("pullSecret: '***REDACTED***'");
      expect(result).toContain("sshKey: '***REDACTED***'");
      expect(result).toContain("password: '***REDACTED***'");
      expect(result).toContain("token: '***REDACTED***'");
      expect(result).toContain("http://***REDACTED***@proxy.example.com:8080");
      expect(result).toContain("https://***REDACTED***@proxy.internal:3128");

      // Should NOT contain sensitive values
      expect(result).not.toContain('dXNlcjpwYXNz');
      expect(result).not.toContain('AAAAB3NzaC1yc2EAAAADAQABAAABAQC');
      expect(result).not.toContain('adminpass123');
      expect(result).not.toContain('token123');
      expect(result).not.toContain('user:pass@');
      expect(result).not.toContain('admin:secret@');

      // Should preserve non-sensitive fields
      expect(result).toContain('baseDomain: example.com');
      expect(result).toContain('username: admin');
      expect(result).toContain('cidr: 10.128.0.0/14');
    });
  });
});
