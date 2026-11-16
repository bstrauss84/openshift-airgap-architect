/**
 * OpenShift Airgap Architect - YAML Obfuscation Utilities
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * The redaction placeholder. Kept as a quoted YAML scalar so the preview's
 * syntax highlighter renders it in the established string colour, which is
 * what gives the "Redacted" marker its familiar look in the drawer.
 */
export const REDACTED_PLACEHOLDER = "'***REDACTED***'";

/**
 * Keys whose value is sensitive wherever it appears. Matched against the whole
 * key name, case-insensitively, so `pullSecret`, `adminPassword`, `clientSecret`
 * and `refreshToken` are all covered.
 */
const SENSITIVE_KEY = /^[A-Za-z0-9_.\-]*(?:pullsecret|sshkey|password|secret|token|apikey|accesskeyid)[A-Za-z0-9_.\-]*$/i;

/**
 * Keys that are only sensitive inside a credential-bearing block. A bare
 * `username` is ordinary configuration, but the one inside a host's `bmc:`, a
 * vCenter entry or a Nutanix Prism Central block is half of a credential pair
 * and must not be displayed.
 */
const CONTEXT_SENSITIVE_KEY = /^(?:user|username)$/i;

/** Blocks whose members are credentials: host BMCs, vSphere vCenters, Nutanix Prism Central. */
const CREDENTIAL_BLOCK_KEY = /^(?:bmc|vcenters|prismcentral)$/i;

/**
 * `scheme://user:password@host` userinfo. Deliberately anchored with character
 * classes that exclude whitespace and `/` so it can only ever match inside a
 * single URL token on a single line. The previous implementation used `[^@]+`,
 * which matches newlines and therefore swallowed the whole document.
 */
const URL_USERINFO = /(\bhttps?:\/\/)[^\s/@:]+:[^\s/@]*@/gi;

/** `indent`, `- ` markers, `key`, and the inline value of a YAML mapping line. */
const MAPPING_LINE = /^(\s*)((?:-\s+)*)([^\s#:][^:]*?)\s*:(\s*)(.*)$/;

const redactUrlUserinfo = (line) => line.replace(URL_USERINFO, "$1***REDACTED***@");

/**
 * Obfuscates sensitive values in YAML content for display.
 *
 * Operates strictly line by line. No pattern is allowed to span a newline, so a
 * value that js-yaml wrapped into a folded (`>-`) or literal (`|`) block scalar
 * cannot survive by hiding on a continuation line, and no match can consume
 * unrelated document structure on the way to a delimiter.
 *
 * Once a sensitive key is found, every following line indented deeper than that
 * key is dropped. That covers folded/literal block bodies, wrapped scalars and
 * nested maps alike, and fails closed on anything unanticipated.
 *
 * @param {string} yamlContent - The YAML content to obfuscate
 * @param {boolean} showSensitive - If true, returns unobfuscated content
 * @returns {string} - YAML with sensitive values replaced, structure intact
 *
 * Obfuscates:
 * - pullSecret: full JSON credential block, single-line or folded across lines
 * - sshKey: SSH public key
 * - password / secret / token / apiKey / accessKeyId fields (case-insensitive,
 *   any prefix or suffix)
 * - username inside a `bmc:`, `vcenters:` or `prismCentral:` block
 * - HTTP/HTTPS credentials embedded in URLs
 *
 * sshKey carries the SSH PUBLIC key, which `shared/stateSanitizer.js` does not
 * classify as a secret. It is redacted here anyway: that is the long-standing
 * preview behaviour users expect, and it keeps the key's trailing `user@host`
 * comment out of the rendered document.
 */
export const obfuscateYaml = (yamlContent, showSensitive = false) => {
  if (showSensitive || !yamlContent) return yamlContent;

  const lines = String(yamlContent).split("\n");
  const out = [];

  // Indentation of the sensitive key currently being redacted; every deeper
  // line belongs to its value and is dropped. `null` when not redacting.
  let redactingBelowIndent = null;
  // Indentation of each enclosing credential block, outermost first.
  const credentialBlocks = [];

  for (const line of lines) {
    const isBlank = line.trim() === "";
    const indent = line.length - line.trimStart().length;

    if (redactingBelowIndent !== null) {
      // Blank lines carry nothing, and may be part of a redacted block scalar.
      if (isBlank || indent > redactingBelowIndent) continue;
      redactingBelowIndent = null;
    }

    if (isBlank) {
      out.push(line);
      continue;
    }

    while (credentialBlocks.length && indent <= credentialBlocks[credentialBlocks.length - 1]) {
      credentialBlocks.pop();
    }

    const parsed = MAPPING_LINE.exec(line);
    if (!parsed) {
      // Comments, block-scalar bodies of non-sensitive keys, bare sequence
      // entries. Still scrubbed for credentials embedded in URLs.
      out.push(redactUrlUserinfo(line));
      continue;
    }

    const [, leading, marker, key, , value] = parsed;
    const keyIndent = leading.length + marker.length;
    const inCredentialBlock = credentialBlocks.length > 0;

    if (SENSITIVE_KEY.test(key) || (inCredentialBlock && CONTEXT_SENSITIVE_KEY.test(key))) {
      out.push(`${leading}${marker}${key}: ${REDACTED_PLACEHOLDER}`);
      redactingBelowIndent = keyIndent;
      continue;
    }

    if (CREDENTIAL_BLOCK_KEY.test(key) && value === "") {
      credentialBlocks.push(keyIndent);
    }

    out.push(redactUrlUserinfo(line));
  }

  return out.join("\n");
};
