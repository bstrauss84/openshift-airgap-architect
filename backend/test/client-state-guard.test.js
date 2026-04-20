import { test } from "node:test";
import assert from "node:assert";
import { parseOptionalClientState } from "../src/clientStateGuard.js";

test("parseOptionalClientState rejects arrays", () => {
  const r = parseOptionalClientState([], () => ({ ok: true }));
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).includes("plain"));
});

test("parseOptionalClientState rejects exotic prototype", () => {
  const evil = Object.create({ a: 1 });
  evil.b = 2;
  const r = parseOptionalClientState(evil, () => ({}));
  assert.strictEqual(r.ok, false);
});

test("parseOptionalClientState accepts JSON-shaped plain object", () => {
  const r = parseOptionalClientState({ blueprint: { platform: "Bare Metal" } }, () => ({}));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.blueprint.platform, "Bare Metal");
});

test("parseOptionalClientState uses fallback when state omitted", () => {
  const r = parseOptionalClientState(undefined, () => ({ fb: 1 }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.fb, 1);
});

test("parseOptionalClientState uses fallback for null state", () => {
  const r = parseOptionalClientState(null, () => ({ fb: 2 }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.fb, 2);
});
