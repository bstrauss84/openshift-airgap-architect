/**
 * OpenShift Airgap Architect - read a list of container images from pasted
 * text, a plain-text file or a YAML file (v2.2.0).
 *
 * One image per line. Agnostic to how the list was written:
 *   quay.io/org/app:v1                 plain line
 *   - quay.io/org/app:v1               YAML list item
 *   - name: quay.io/org/app:v1         ImageSetConfiguration additionalImages entry
 *     image: "quay.io/org/app:v1"      key/value, quoted or not
 *   quay.io/org/app:v1   # comment     comments are dropped
 *
 * Sections: YAML section headers (a key ending in ":" with nothing after it)
 * are followed. Entries inside an ImageSetConfiguration section that does not
 * list images to mirror — blockedImages, delete, operators/packages/channels/
 * bundles, platform, helm … (at any depth) — are counted per section and never
 * added; entries under additionalImages, under any other header (a hand-made
 * `images:` list) or under no header are candidates. Other YAML lines (`apiVersion: …`, `---`) are
 * ignored and counted. Inline mappings/lists (`{…}`, `[…]`) are refused with
 * a reason, never guessed at. Nothing is added here; the caller decides, and
 * order, tags and digests are kept exactly as written.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const MAX_IMAGE_LIST_BYTES = 1024 * 1024;

const IMAGE_KEYS = new Set(["name", "image"]);
// ImageSetConfiguration / DeleteImageSetConfiguration sections whose entries
// are not images to mirror (oc-mirror v2 schema).
const NON_IMAGE_SECTIONS = new Set([
  "blockedImages", "delete", "operators", "packages", "channels", "bundles", "targetCatalog",
  "platform", "graph", "release", "architectures", "kubeVirtContainer",
  "helm", "repositories", "charts", "local"
]);
// A YAML key: word characters then ":" followed by a space or end of line.
// Image references contain ":" too, but never ": " (registry:5000/x, app:v1).
const KEY_LINE = /^([A-Za-z_][\w.-]*):(\s+|$)(.*)$/;

const unquote = (v) => {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) return t.slice(1, -1).trim();
  return t;
};

/**
 * @param {string} text
 * @param {{ validate: (ref: string) => string, existing?: string[] }} opts
 *   validate returns "" for a valid reference, else the reason.
 * @returns {{
 *   images: string[], duplicates: string[],
 *   invalid: {line: number, text: string, reason: string}[],
 *   ignored: number,
 *   otherSections: Record<string, number>
 * }}
 */
export function parseImageList(text, { validate, existing = [] }) {
  const have = new Set(existing.map((e) => String(e).trim()).filter(Boolean));
  const images = [];
  const duplicates = [];
  const invalid = [];
  const otherSections = {};
  let ignored = 0;
  /** Open section headers, innermost last: { key, indent }. */
  const headers = [];

  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    // "#" starts a comment at line start or after whitespace (never inside a reference).
    const uncommented = raw.replace(/(^|\s)#.*$/, "");
    if (!uncommented.trim()) return;
    const indent = uncommented.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length;
    let line = uncommented.trim();
    if (line === "---" || line === "...") { ignored += 1; headers.length = 0; return; }
    const isItem = line.startsWith("- ") || line === "-";
    if (isItem) line = line.slice(1).trim();

    // Leave every header at this indentation or deeper; a list item may sit at
    // its parent key's own indentation (valid YAML), so it keeps that header.
    while (headers.length && (headers.at(-1).indent > indent || (headers.at(-1).indent === indent && !isItem))) headers.pop();

    if (!line) { ignored += 1; return; }
    const key = KEY_LINE.exec(line);
    if (key && !key[3].trim()) {
      // A section header (`additionalImages:`, `mirror:`, `- packages:` …).
      headers.push({ key: key[1], indent: isItem ? indent + 2 : indent });
      ignored += 1;
      return;
    }
    const section = [...headers].reverse().find((h) => NON_IMAGE_SECTIONS.has(h.key))?.key || null;
    if (section) {
      // An entry of another section, e.g. blockedImages or an operator package.
      if (isItem || (key && IMAGE_KEYS.has(key[1].toLowerCase()))) otherSections[section] = (otherSections[section] || 0) + 1;
      else ignored += 1;
      return;
    }
    if (key) {
      if (!IMAGE_KEYS.has(key[1].toLowerCase())) { ignored += 1; return; }
      line = key[3];
    }
    const ref = unquote(line);
    let reason;
    if (/^[{[]/.test(ref)) reason = "Inline YAML ({…} or […]) is not read; put each image on its own line.";
    else if (/\s/.test(ref)) reason = "Only one image per line.";
    else reason = validate(ref);
    if (reason) { invalid.push({ line: i + 1, text: raw.trim().slice(0, 200), reason }); return; }
    if (have.has(ref)) { duplicates.push(ref); return; }
    have.add(ref);
    images.push(ref);
  });
  return { images, duplicates, invalid, ignored, otherSections };
}
