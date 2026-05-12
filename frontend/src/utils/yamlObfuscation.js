/**
 * OpenShift Airgap Architect - YAML Obfuscation Utilities
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Obfuscates sensitive values in YAML content for display.
 *
 * @param {string} yamlContent - The YAML content to obfuscate
 * @param {boolean} showSensitive - If true, returns unobfuscated content
 * @returns {string} - Obfuscated YAML content
 *
 * Obfuscates:
 * - pullSecret: Full JSON credential block
 * - sshKey: SSH public key
 * - password fields (case-insensitive)
 * - secret fields (case-insensitive)
 * - token fields (case-insensitive)
 * - HTTP/HTTPS proxy credentials embedded in URLs
 */
export const obfuscateYaml = (yamlContent, showSensitive = false) => {
  if (showSensitive || !yamlContent) return yamlContent;

  let obfuscated = yamlContent;

  // pullSecret: Replace entire value with placeholder
  // Handles both quoted JSON strings and inline JSON objects
  // Strategy: Match pullSecret: followed by any content until end of line
  obfuscated = obfuscated.replace(
    /pullSecret:\s*.+$/gm,
    "pullSecret: '***REDACTED***'"
  );

  // sshKey: Replace with placeholder
  // Matches: sshKey: 'ssh-rsa AAAA...'
  obfuscated = obfuscated.replace(
    /sshKey:\s*.+/g,
    "sshKey: '***REDACTED***'"
  );

  // password fields (case-insensitive)
  // Matches: password: 'value', userPassword: 'value', etc.
  obfuscated = obfuscated.replace(
    /(\w*password\w*):\s*.+/gi,
    "$1: '***REDACTED***'"
  );

  // secret fields (case-insensitive)
  // Matches: secret: 'value', clientSecret: 'value', etc.
  // BUT NOT pullSecret (already handled above)
  obfuscated = obfuscated.replace(
    /(\w*secret\w*):\s*.+/gi,
    (match, fieldName) => {
      if (fieldName.toLowerCase() === 'pullsecret') return match; // Skip, already handled
      return `${fieldName}: '***REDACTED***'`;
    }
  );

  // token fields (case-insensitive)
  // Matches: token: 'value', accessToken: 'value', etc.
  obfuscated = obfuscated.replace(
    /(\w*token\w*):\s*.+/gi,
    "$1: '***REDACTED***'"
  );

  // HTTP/HTTPS proxy credentials in URLs
  // Matches: http://user:password@proxy.example.com:8080
  obfuscated = obfuscated.replace(
    /(https?:\/\/)[^:@]+:[^@]+@/gi,
    "$1***REDACTED***@"
  );

  return obfuscated;
};
