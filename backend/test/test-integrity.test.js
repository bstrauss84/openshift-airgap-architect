import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = __dirname;

const FORBIDDEN_PATTERNS = [
  { name: "test.only", pattern: /\btest\.only\s*\(/g },
  { name: "it.only", pattern: /\bit\.only\s*\(/g },
  { name: "describe.only", pattern: /\bdescribe\.only\s*\(/g },
  { name: "process.exit", pattern: /\bprocess\.exit\s*\(/g },
  { name: "--test-force-exit", pattern: /--test-force-exit/g },
];

const SKIP_PATTERNS = [
  { name: "test.skip", pattern: /\btest\.skip\s*\(/g },
  { name: "it.skip", pattern: /\bit\.skip\s*\(/g },
  { name: "describe.skip", pattern: /\bdescribe\.skip\s*\(/g },
  { name: "test.todo", pattern: /\btest\.todo\s*\(/g },
  { name: "it.todo", pattern: /\bit\.todo\s*\(/g },
];

const ALLOWED_SKIPS = [
  {
    file: "nic-bond-vlan-ipv6.test.js",
    tests: [
      "generates multiple bonds on same node",
      "generates multiple VLANs on same bond",
      "dual-stack with asymmetric VIPs (IPv4 ingress only)",
      "static IPv4 with DHCP IPv6 on same interface",
      "generates routes with IPv6 destinations",
    ],
    reason: "Deferred: secondary interface support not yet implemented in generate.js (governance gap — no backlog IDs)",
  },
];

function getAllowedSkipCount() {
  let count = 0;
  for (const entry of ALLOWED_SKIPS) {
    count += entry.tests.length;
  }
  return count;
}

function isAllowedSkip(fileName, line) {
  for (const entry of ALLOWED_SKIPS) {
    if (fileName !== entry.file) continue;
    for (const testName of entry.tests) {
      if (line.includes(testName)) return true;
    }
  }
  return false;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
      }
    }

    for (const { name, pattern } of SKIP_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        if (!isAllowedSkip(fileName, line)) {
          violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
        }
      }
    }
  }

  return violations;
}

function scanContentString(content, fileName) {
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
      }
    }

    for (const { name, pattern } of SKIP_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        if (!isAllowedSkip(fileName, line)) {
          violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
        }
      }
    }
  }

  return violations;
}

describe("test-integrity guard", () => {
  it("no test file contains unauthorized skip, only, todo, or force-exit markers", () => {
    const testFiles = fs.readdirSync(TEST_DIR)
      .filter(f => f.endsWith(".test.js") && f !== "test-integrity.test.js");

    const allViolations = [];
    for (const file of testFiles) {
      const filePath = path.join(TEST_DIR, file);
      const violations = scanFile(filePath);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(v => `  ${v.file}:${v.line} [${v.marker}] ${v.text}`)
        .join("\n");
      assert.fail(
        `Found ${allViolations.length} unauthorized test marker(s):\n${report}\n\n` +
        "To allow a skip, add it to ALLOWED_SKIPS in test-integrity.test.js with justification."
      );
    }
  });

  it("allowed skips count matches actual skips in allowlisted files", () => {
    const expectedCount = getAllowedSkipCount();
    let actualCount = 0;

    for (const entry of ALLOWED_SKIPS) {
      const filePath = path.join(TEST_DIR, entry.file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      for (const { pattern } of SKIP_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = content.match(pattern);
        if (matches) actualCount += matches.length;
      }
    }

    assert.strictEqual(
      actualCount,
      expectedCount,
      `Allowlist expects ${expectedCount} skips but found ${actualCount}. Update ALLOWED_SKIPS if skips were added or removed.`
    );
  });

  describe("self-tests with synthetic content", () => {
    it("detects test.only in synthetic content", () => {
      const content = 'test.only("should fail", () => {});';
      const violations = scanContentString(content, "synthetic.test.js");
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.only");
    });

    it("detects test.skip in synthetic content (not allowlisted)", () => {
      const content = 'test.skip("some test", () => {});';
      const violations = scanContentString(content, "synthetic.test.js");
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.skip");
    });

    it("detects process.exit in synthetic content", () => {
      const content = "process.exit(1);";
      const violations = scanContentString(content, "synthetic.test.js");
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "process.exit");
    });

    it("detects --test-force-exit in synthetic content", () => {
      const content = '// run with: node --test --test-force-exit test/';
      const violations = scanContentString(content, "synthetic.test.js");
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "--test-force-exit");
    });

    it("allows NIC skips in allowlisted file", () => {
      const content = 'test.skip("generates multiple bonds on same node", () => {});';
      const violations = scanContentString(content, "nic-bond-vlan-ipv6.test.js");
      assert.strictEqual(violations.length, 0);
    });

    it("rejects NIC skip text in non-allowlisted file", () => {
      const content = 'test.skip("generates multiple bonds on same node", () => {});';
      const violations = scanContentString(content, "other.test.js");
      assert.strictEqual(violations.length, 1);
    });

    it("clean content produces zero violations", () => {
      const content = [
        'import { test } from "node:test";',
        'test("works correctly", () => { assert.ok(true); });',
      ].join("\n");
      const violations = scanContentString(content, "clean.test.js");
      assert.strictEqual(violations.length, 0);
    });
  });
});
