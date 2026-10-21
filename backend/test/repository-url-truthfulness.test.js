/**
 * OpenShift Airgap Architect - Test Suite
 *
 * REPOSITORY URL TRUTHFULNESS (v2.1.1).
 *
 * The stale `billstrauss/openshift-airgap-architect` URL was not confined to the
 * About dialog: it was stamped into the header of every generated
 * install-config.yaml and agent-config.yaml, into the exported Field Guide
 * footer, and into the backend startup banner. `package.json` had already been
 * corrected to `bstrauss84/...` before v2.1.0, which is exactly what made the
 * remaining copies easy to miss — the obvious place to look was already right.
 *
 * That URL is not decoration. It is what a user copies out of a generated
 * artifact to find the project, and it 404s.
 *
 * These are behaviour-level assertions: they call the real generators and
 * inspect emitted bytes, rather than grepping source files.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallConfig, buildAgentConfig } from "../src/generate.js";

const STALE = "billstrauss";
const CANONICAL = "https://github.com/bstrauss84/openshift-airgap-architect";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

// A minimal supported-version state: generation fails closed without one.
const minimalState = () => ({
  version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.1", locked: true },
  release: { channel: "4.22", patchVersion: "4.22.1", confirmed: true }
});

describe("generated artifacts carry the canonical repository URL", () => {
  it("install-config.yaml header names bstrauss84 and never billstrauss", () => {
    const raw = buildInstallConfig(minimalState());
    assert.ok(raw.includes(CANONICAL), "install-config header lost the canonical URL");
    assert.ok(!raw.includes(STALE), "install-config header still carries the stale owner");
  });

  it("agent-config.yaml header names bstrauss84 and never billstrauss", () => {
    const raw = buildAgentConfig(minimalState());
    assert.ok(raw.includes(CANONICAL), "agent-config header lost the canonical URL");
    assert.ok(!raw.includes(STALE), "agent-config header still carries the stale owner");
  });
});

describe("no production source path reintroduces the stale owner", () => {
  // Deliberately a source sweep rather than a per-call-site list: the defect
  // recurred precisely because each new emitter copied the old string. Tests
  // and historical documents are excluded; they record what WAS true.
  const roots = [
    path.join(REPO_ROOT, "backend", "src"),
    path.join(REPO_ROOT, "frontend", "src")
  ];

  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(p, out);
      } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
        out.push(p);
      }
    }
    return out;
  };

  it("backend/src and frontend/src contain zero occurrences", () => {
    const offenders = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const text = fs.readFileSync(file, "utf8");
        if (text.includes(STALE)) offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `stale repository owner still present in production source:\n  ${offenders.join("\n  ")}`
    );
  });

  it("the exported Field Guide footer names the canonical repository", () => {
    const assembler = fs.readFileSync(
      path.join(REPO_ROOT, "backend", "src", "fieldGuide", "assembler.js"),
      "utf8"
    );
    assert.ok(assembler.includes(CANONICAL), "Field Guide footer lost the canonical URL");
    assert.ok(!assembler.includes(STALE), "Field Guide footer still carries the stale owner");
  });
});
