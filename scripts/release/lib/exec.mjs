/**
 * Command execution for certification axes.
 *
 * Every axis that proves something by running a command goes through here, so
 * that the three things certification evidence must record — the exact argv,
 * the exit code, and the duration — are captured uniformly rather than
 * per-axis.
 *
 * Commands are always argv arrays. There is no shell-string form on purpose:
 * axis inputs include branch names, image tags and file paths, and a shell
 * string would make those injectable.
 */

import { spawnSync } from "node:child_process";

/** Is an executable resolvable on PATH? */
export function hasTool(name) {
  const r = spawnSync("command", ["-v", name], { shell: "/bin/sh", stdio: "ignore" });
  return r.status === 0;
}

/**
 * Run a command to completion.
 *
 * Never throws on a non-zero exit: a failing command is ordinary evidence, and
 * the axis decides whether that means FAIL or INCOMPLETE. Only a command that
 * could not be spawned at all surfaces as `spawnError`.
 */
export function run(cmd, args, { cwd = process.cwd(), env = process.env, timeoutMs = 20 * 60_000, input } = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    input,
  });
  const durationMs = Date.now() - started;

  return {
    command: [cmd, ...args].join(" "),
    argv: [cmd, ...args],
    status: r.status,
    signal: r.signal,
    // `spawnSync` sets `error` both for ENOENT and for a timeout kill; the
    // caller needs to tell those apart.
    spawnError: r.error && r.error.code === "ENOENT" ? String(r.error.message) : null,
    timedOut: Boolean(r.error && r.error.code === "ETIMEDOUT"),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    durationMs,
  };
}

/** Last `n` lines of a command's combined output, for one-line result details. */
export function tail(res, n = 20) {
  return `${res.stdout}${res.stderr}`.trimEnd().split("\n").slice(-n).join("\n");
}

/** A compact, JSON-serialisable record of a command run, for evidence. */
export function record(res) {
  return {
    command: res.command,
    exitCode: res.status,
    signal: res.signal,
    timedOut: res.timedOut,
    spawnError: res.spawnError,
    durationMs: res.durationMs,
    stdoutBytes: res.stdout.length,
    stderrBytes: res.stderr.length,
  };
}
