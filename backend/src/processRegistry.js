/**
 * OpenShift Airgap Architect - Active child process registry (L3)
 *
 * Child processes this backend currently owns, keyed by job id. The stop
 * route and the shutdown sequence both read it, so a child that is missing
 * from here is a child nobody can cancel and nobody will reap.
 *
 * This was a module-local `Map` inside index.js, which is exactly why the
 * operator catalog scan — the one spawn site that lives outside index.js —
 * had no way to register its child. Relocating the registry rather than
 * duplicating it keeps there being exactly one.
 *
 * Deliberately dependency-free so any module can own a child without pulling
 * in the server, the database or the job helpers.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/** @type {Map<string, import("node:child_process").ChildProcess>} */
export const activeProcesses = new Map();
