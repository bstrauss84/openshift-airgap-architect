import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = __dirname;
const BACKLOG_PATH = path.resolve(__dirname, "../../docs/BACKLOG_STATUS.md");

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
];

const TODO_PATTERN = /\btest\.todo\s*\(\s*["'`](\[([A-Z]+-\d+)\])\s+.+\s*-\s+.+["'`]\s*\)/g;
const TODO_RAW_PATTERN = /\btest\.todo\s*\(/g;
const TODO_WITH_CALLBACK = /\btest\.todo\s*\(\s*["'`].*["'`]\s*,/g;

const BACKLOG_ID_PATTERN = /^\[([A-Z]+-\d+)\]/;

function loadBacklogIds() {
  const content = fs.readFileSync(BACKLOG_PATH, "utf8");
  const ids = new Map();
  const rowPattern = /\|\s*(DOC-\d+|PHX-\d+|PROD-\d+|DEF-\d+|LOG-\d+|DB-[A-Z]+-\d+|LOCAL\s*#\d+)\s*\|[^|]*\|\s*(\S+)\s*\|/g;
  let match;
  while ((match = rowPattern.exec(content)) !== null) {
    const id = match[1].trim();
    const status = match[2].trim();
    if (!ids.has(id)) {
      ids.set(id, status);
    }
  }
  return ids;
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
        violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
      }
    }
  }

  return violations;
}

function validateTodos(filePath, backlogIds) {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    TODO_RAW_PATTERN.lastIndex = 0;
    if (!TODO_RAW_PATTERN.test(line)) continue;

    TODO_WITH_CALLBACK.lastIndex = 0;
    if (TODO_WITH_CALLBACK.test(line)) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-with-callback",
        text: line.trim(), reason: "test.todo must not have an executable callback"
      });
      continue;
    }

    const idMatch = line.match(/\btest\.todo\s*\(\s*["'`]\[([A-Z]+-\d+)\]\s+.+\s*-\s+.+["'`]\s*\)/);
    if (!idMatch) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-bad-format",
        text: line.trim(),
        reason: 'test.todo must match format: test.todo("[ID] name - reason")'
      });
      continue;
    }

    const id = idMatch[1];
    if (!backlogIds.has(id)) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-unknown-id",
        text: line.trim(), reason: `Backlog ID ${id} not found in BACKLOG_STATUS.md`
      });
      continue;
    }

    const status = backlogIds.get(id);
    if (status === "verified_done" || status === "obsolete") {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-resolved-id",
        text: line.trim(),
        reason: `Backlog ID ${id} has status '${status}' — todo should be implemented or removed`
      });
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
        violations.push({ file: fileName, line: lineNum, marker: name, text: line.trim() });
      }
    }
  }

  return violations;
}

function validateTodoString(content, fileName, backlogIds) {
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    TODO_RAW_PATTERN.lastIndex = 0;
    if (!TODO_RAW_PATTERN.test(line)) continue;

    TODO_WITH_CALLBACK.lastIndex = 0;
    if (TODO_WITH_CALLBACK.test(line)) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-with-callback",
        text: line.trim(), reason: "test.todo must not have an executable callback"
      });
      continue;
    }

    const idMatch = line.match(/\btest\.todo\s*\(\s*["'`]\[([A-Z]+-\d+)\]\s+.+\s*-\s+.+["'`]\s*\)/);
    if (!idMatch) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-bad-format",
        text: line.trim(),
        reason: 'test.todo must match format: test.todo("[ID] name - reason")'
      });
      continue;
    }

    const id = idMatch[1];
    if (!backlogIds.has(id)) {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-unknown-id",
        text: line.trim(), reason: `Backlog ID ${id} not found in BACKLOG_STATUS.md`
      });
      continue;
    }

    const status = backlogIds.get(id);
    if (status === "verified_done" || status === "obsolete") {
      violations.push({
        file: fileName, line: lineNum, marker: "test.todo-resolved-id",
        text: line.trim(),
        reason: `Backlog ID ${id} has status '${status}' — todo should be implemented or removed`
      });
    }
  }

  return violations;
}

describe("test-integrity guard", () => {
  it("no test file contains unauthorized skip, only, or force-exit markers", () => {
    const testFiles = fs.readdirSync(TEST_DIR)
      .filter(f => f.endsWith(".test.js") && f !== "test-integrity.test.js");

    const allViolations = [];
    for (const file of testFiles) {
      const filePath = path.join(TEST_DIR, file);
      allViolations.push(...scanFile(filePath));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(v => `  ${v.file}:${v.line} [${v.marker}] ${v.text}`)
        .join("\n");
      assert.fail(
        `Found ${allViolations.length} unauthorized test marker(s):\n${report}\n\n` +
        "All executable skips must be converted to test.todo with a backlog ID."
      );
    }
  });

  it("all test.todo entries have valid backlog IDs with acceptable status", () => {
    const backlogIds = loadBacklogIds();
    assert.ok(backlogIds.size > 0, "Should load backlog IDs from BACKLOG_STATUS.md");

    const testFiles = fs.readdirSync(TEST_DIR)
      .filter(f => f.endsWith(".test.js") && f !== "test-integrity.test.js");

    const allViolations = [];
    for (const file of testFiles) {
      const filePath = path.join(TEST_DIR, file);
      allViolations.push(...validateTodos(filePath, backlogIds));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(v => `  ${v.file}:${v.line} [${v.marker}] ${v.reason}\n    ${v.text}`)
        .join("\n");
      assert.fail(
        `Found ${allViolations.length} test.todo violation(s):\n${report}`
      );
    }
  });

  it("backlog ID loader finds expected IDs", () => {
    const backlogIds = loadBacklogIds();
    assert.ok(backlogIds.has("DOC-123"), "Should find DOC-123");
    assert.ok(backlogIds.has("DOC-124"), "Should find DOC-124");
    assert.ok(backlogIds.has("DOC-125"), "Should find DOC-125");
    assert.ok(backlogIds.has("DOC-126"), "Should find DOC-126");
    assert.strictEqual(backlogIds.get("DOC-123"), "deferred");
    assert.strictEqual(backlogIds.get("DOC-124"), "deferred");
  });

  describe("self-tests with synthetic content", () => {
    it("detects test.only in synthetic content", () => {
      const content = 'test.only("should fail", () => {});';
      const violations = scanContentString(content, "synthetic.test.js");
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.only");
    });

    it("detects test.skip in synthetic content", () => {
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

    it("clean content produces zero violations", () => {
      const content = [
        'import { test } from "node:test";',
        'test("works correctly", () => { assert.ok(true); });',
      ].join("\n");
      const violations = scanContentString(content, "clean.test.js");
      assert.strictEqual(violations.length, 0);
    });

    it("accepts valid test.todo with known deferred backlog ID", () => {
      const content = 'test.todo("[DOC-123] generates multiple bonds on same node - secondary interface support not yet implemented");';
      const backlogIds = new Map([["DOC-123", "deferred"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 0);
    });

    it("accepts valid test.todo with active backlog ID", () => {
      const content = 'test.todo("[DOC-120] some feature - not yet implemented");';
      const backlogIds = new Map([["DOC-120", "active"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 0);
    });

    it("rejects test.todo with unknown backlog ID", () => {
      const content = 'test.todo("[DOC-999] some test - reason");';
      const backlogIds = new Map([["DOC-123", "deferred"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-unknown-id");
    });

    it("rejects test.todo with verified_done backlog ID", () => {
      const content = 'test.todo("[DOC-074] ipv6 test - done feature");';
      const backlogIds = new Map([["DOC-074", "verified_done"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-resolved-id");
    });

    it("rejects test.todo with obsolete backlog ID", () => {
      const content = 'test.todo("[DOC-101] old item - should be removed");';
      const backlogIds = new Map([["DOC-101", "obsolete"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-resolved-id");
    });

    it("rejects test.todo missing backlog ID prefix", () => {
      const content = 'test.todo("some test without ID - reason");';
      const backlogIds = new Map([["DOC-123", "deferred"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-bad-format");
    });

    it("rejects test.todo missing reason after dash", () => {
      const content = 'test.todo("[DOC-123] generates multiple bonds");';
      const backlogIds = new Map([["DOC-123", "deferred"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-bad-format");
    });

    it("rejects test.todo with executable callback", () => {
      const content = 'test.todo("some test", () => {});';
      const backlogIds = new Map([["DOC-123", "deferred"]]);
      const violations = validateTodoString(content, "synthetic.test.js", backlogIds);
      assert.strictEqual(violations.length, 1);
      assert.strictEqual(violations[0].marker, "test.todo-with-callback");
    });
  });
});
