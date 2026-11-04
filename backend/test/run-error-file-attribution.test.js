/**
 * v2.2.0 stabilization — an earlier attempt's oc-mirror error list is never
 * attributed to the run that repeats it.
 *
 * Found by the exact-binary "Run the same again" test for mirror to disk
 * (2026-11-03): the failed attempt wrote working-dir/logs/mirroring_errors_*.txt
 * 0.7 s before the retry started; the 1 s mtime tolerance counted it as the
 * retry's, so a complete retry was reported "incomplete". Real files, real mtimes.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRunErrorFile, snapshotErrorFiles } from "../src/mirroringOperations.js";

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-errfile-"));
  const logs = path.join(dir, "working-dir", "logs");
  fs.mkdirSync(logs, { recursive: true });
  return { dir, logs };
};

test("a list written just before the retry started is the earlier attempt's, not the retry's", () => {
  const { dir, logs } = setup();
  try {
    const earlier = path.join(logs, "mirroring_errors_20261103_122654.txt");
    fs.writeFileSync(earlier, "error mirroring image localhost:5872/qa/app-03:1 error: 503\n");
    const retryStart = fs.statSync(earlier).mtimeMs + 700;
    // Without the snapshot (the old behaviour) the file is inside the 1 s tolerance.
    assert.ok(readRunErrorFile([dir], retryStart, retryStart + 5000, { fsImpl: fs }), "baseline: attributed by mtime alone");
    const before = snapshotErrorFiles([dir], { fsImpl: fs });
    assert.equal(readRunErrorFile([dir], retryStart, retryStart + 5000, { fsImpl: fs, before }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a list the run itself writes (new, or rewritten after it started) is still found", () => {
  const { dir, logs } = setup();
  try {
    const old = path.join(logs, "mirroring_errors_20261103_100000.txt");
    fs.writeFileSync(old, "old\n");
    const before = snapshotErrorFiles([dir], { fsImpl: fs });
    const start = Date.now();
    fs.writeFileSync(path.join(logs, "mirroring_errors_20261103_100500.txt"), "new failure\n");
    const found = readRunErrorFile([dir], start - 10, Date.now() + 1000, { fsImpl: fs, before });
    assert.deepEqual(found.lines, ["new failure"]);
    // The same name rewritten later (a different mtime) counts as this run's.
    fs.rmSync(path.join(logs, "mirroring_errors_20261103_100500.txt"));
    const t = new Date(Date.now() + 2000);
    fs.writeFileSync(old, "rewritten\n");
    fs.utimesSync(old, t, t);
    assert.deepEqual(readRunErrorFile([dir], start - 10, Date.now() + 5000, { fsImpl: fs, before }).lines, ["rewritten"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("records without a snapshot (older runs) behave as before", () => {
  const { dir, logs } = setup();
  try {
    fs.writeFileSync(path.join(logs, "mirroring_errors_20261103_110000.txt"), "x\n");
    const t = Date.now();
    assert.ok(readRunErrorFile([dir], t - 100, t + 1000, { fsImpl: fs, before: undefined }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
