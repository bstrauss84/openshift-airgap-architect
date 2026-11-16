/**
 * v2.2.1 (backlog N2): the backend test scripts must run on the product runtime
 * (Node 22) as well as in CI (Node 20). Node 22.23 rejects a bare directory
 * after `node --test` ("Cannot find module …/backend/test", 0 tests run), which
 * Node 20 accepted. The scripts pass shell-expanded file globs instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scripts = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;

test("every `node --test` script names test files, never a bare directory", () => {
  const runners = Object.entries(scripts).filter(([, cmd]) => /node --test\b/.test(cmd));
  assert.ok(runners.length >= 2);
  for (const [name, cmd] of runners) {
    const tail = cmd.slice(cmd.lastIndexOf("node --test")).split(/\s+/).filter((a) => !a.startsWith("-") && a !== "node");
    assert.ok(tail.length, `${name}: no test path`);
    for (const arg of tail) assert.match(arg, /\*\.test\.js$/, `${name}: "${arg}" must be a *.test.js glob, not a directory`);
  }
});

test("the glob covers every backend test file (all live directly in test/)", () => {
  const nested = fs.readdirSync(new URL("./", import.meta.url), { recursive: true }).filter((f) => f.endsWith(".test.js") && f.includes("/"));
  assert.deepEqual(nested, []);
});
