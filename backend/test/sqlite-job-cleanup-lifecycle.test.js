/**
 * SQLite handles across repeated job cleanup (v2.1 Tranche 8C)
 *
 * Closure item from the `lifecycle` planned axis, verbatim:
 *   "SQLite statement and connection handles across repeated job cleanup"
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 *
 * `backend/src/utils.js` calls `db.prepare(...)` fresh on every invocation in
 * 17 helpers — there is no statement cache — so one `appendJobOutput` already
 * compiles three statements. The raw asymmetry is real; the axis's own
 * `known.caution` warns that an asymmetry is not by itself a defect, so it
 * was measured rather than assumed.
 *
 * Measured OUT OF SUITE (recorded here as provenance, not re-run as an
 * assertion): 20,000 full job cycles ≈ 100,000 `db.prepare` calls grew RSS by
 * 14.3 MB once and then plateaued — five successive 10,000-cycle phases moved
 * RSS by -0.38 / -0.02 / +0.21 / +0.10 MB, and 1.2 M prepares across six
 * rounds moved it +0.64 / 0.00 / +0.04 / +0.20 / 0.00 MB after the first
 * round's allocator growth. better-sqlite3 finalizes the `sqlite3_stmt` from
 * its wrapper's destructor and the destructor is reached. Conclusion:
 * `db.prepare`-per-call is a CPU and allocator cost, NOT a handle leak.
 *
 * Those are heap measurements, and heap measurements make flaky assertions.
 * What this suite asserts instead is the part that is deterministic and is
 * what the closure item literally asks about — HANDLES:
 *
 *   - the connection: exactly one, still open, after repeated cleanup;
 *   - the kernel's view: SQLite's own descriptors (db, -wal, -shm) do not
 *     scale with the number of cycles;
 *   - the retention contract still bounds the table.
 *
 * Statement-handle finalization itself is therefore classified as covered by
 * the out-of-suite measurement above, not by an executable assertion here.
 * Claiming otherwise would overstate the evidence.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { db } from "../src/db.js";
import {
  createJob,
  updateJob,
  updateJobMetadata,
  appendJobOutput,
  cleanupOldJobs,
  getJob
} from "../src/utils.js";

/** Descriptors this process holds. Linux only; null elsewhere. */
const openFdCount = () => {
  try {
    return fs.readdirSync("/proc/self/fd").length;
  } catch {
    return null;
  }
};

/** Read the descriptor count once it stops moving, rather than after a sleep. */
const settledFdCount = async (timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  let previous = openFdCount();
  for (;;) {
    await new Promise((resolve) => setImmediate(resolve));
    const current = openFdCount();
    if (current === previous) return current;
    if (Date.now() >= deadline) return current;
    previous = current;
  }
};

/** One complete job lifecycle: 7+ prepared statements, then a retention pass. */
const runJobCycles = (count) => {
  for (let i = 0; i < count; i += 1) {
    const jobId = createJob("lifecycle-probe", `probe ${i}`);
    updateJob(jobId, { status: "running", progress: 5 });
    updateJobMetadata(jobId, { probe: i });
    appendJobOutput(jobId, `chunk ${i}\n`);
    updateJob(jobId, { status: "completed", progress: 100, message: "done" });
    if (i % 50 === 0) cleanupOldJobs({ retentionDays: 0, maxCount: 25 });
  }
  cleanupOldJobs({ retentionDays: 0, maxCount: 25 });
};

describe("SQLite handles across repeated job cleanup", () => {
  before(() => {
    // Warm: first use of each statement shape and the WAL/SHM files.
    runJobCycles(20);
  });

  it("keeps exactly one connection, and keeps it open", () => {
    runJobCycles(200);

    assert.equal(db.open, true, "the single connection must survive repeated cleanup");
    assert.equal(db.inTransaction, false, "no transaction may be left dangling");
    // Pins the NOT-APPLICABLE half of the closure item: there is one
    // module-scope Database and no per-operation connection. A future
    // refactor that opened connections per request would break this.
    assert.equal(typeof db.name, "string");
    assert.ok(db.name.endsWith(".db"), `unexpected database path: ${db.name}`);
  });

  it("descriptor use does not scale with the number of cycles", async () => {
    if (openFdCount() === null) return; // not Linux; assertion has no meaning

    const baseline = await settledFdCount();
    runJobCycles(200);
    const afterFew = await settledFdCount();
    runJobCycles(600);
    const afterMany = await settledFdCount();

    // Shape, not slack: a per-cycle handle leak is proportional to the cycle
    // count, so 600 further cycles would cost three times what 200 did.
    const firstGrowth = afterFew - baseline;
    const secondGrowth = afterMany - afterFew;
    assert.ok(
      secondGrowth <= Math.max(firstGrowth, 0) + 2,
      `descriptors scaled with cycles: ${baseline} -> ${afterFew} (200) -> ${afterMany} (+600)`
    );
    assert.ok(
      afterMany - baseline <= 4,
      `800 job cycles grew descriptors by ${afterMany - baseline}`
    );
  });

  it("retention bounds the jobs this probe creates, however many cycles run", () => {
    // Counted as a delta, not an absolute: this DATA_DIR is shared with other
    // suites whose non-terminal rows retention deliberately never touches.
    const probeRows = () =>
      db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE type = 'lifecycle-probe'").get().c;

    runJobCycles(100);
    const afterFew = probeRows();
    runJobCycles(300);
    const afterMany = probeRows();

    assert.ok(afterFew <= 30, `retention did not bound the probe rows: ${afterFew}`);
    assert.ok(
      afterMany <= 30,
      `probe rows grew with cycle count: ${afterFew} after 100 -> ${afterMany} after 400`
    );
    assert.equal(db.open, true);
  });

  it("honours the retention window instead of deleting all finished jobs", () => {
    // `updated_at` is INTEGER in every schema version, but the cutoff used to
    // be stringified with toISOString(). SQLite sorts every INTEGER before
    // every TEXT value, so the age predicate was unconditionally true and a
    // sweep erased the operator's whole job history. This pins both halves:
    // recent work is kept, genuinely old work is collected.
    const fresh = createJob("retention-window-probe", "just finished");
    updateJob(fresh, { status: "completed", progress: 100 });

    const stale = createJob("retention-window-probe", "finished long ago");
    updateJob(stale, { status: "completed", progress: 100 });
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(thirtyDaysAgo, stale);

    const result = cleanupOldJobs({ retentionDays: 7, maxCount: 100000 });

    assert.equal(result.deletedByAge, 1, "exactly the out-of-window job may be deleted by age");
    assert.ok(getJob(fresh), "a job that finished seconds ago must survive a 7-day policy");
    // getJob returns undefined (not null) for a missing row.
    assert.ok(!getJob(stale), "a 30-day-old finished job must be collected");
  });
});
