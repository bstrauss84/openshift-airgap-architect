/**
 * OpenShift Airgap Architect - ownership of an oc-mirror run's temp files
 * (v2.2.0 M5, F13)
 *
 * A run needs two files for as long as oc-mirror is working on its behalf: the
 * ImageSetConfiguration (deleted afterwards only when this backend generated it
 * into DATA_DIR/tmp; an operator's own file or a Mirroring plan is never ours to
 * delete) and the registry auth file written from the pull secret.
 *
 * WHY THIS EXISTS (F13). The signature auto-retry is a second oc-mirror process
 * started from the first one's `close` handler — and that same handler then
 * unlinked both files synchronously, before the retry's first `await`. The retry
 * therefore spawned with no auth file (external configs) or with no config path
 * at all (generated configs, whose path was never recorded), and could not
 * succeed. Ownership is now explicit: whoever holds the resources releases them,
 * exactly once; when a retry starts it TAKES them, and the original run's close
 * handler no longer touches them.
 *
 * The per-run registries.d directory is deliberately not part of this: each run
 * writes and removes its own.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { safeUnlink } from "./utils.js";

/**
 * @param {{ configPath?: string|null, configIsOurs?: boolean, authFile?: string|null }} files
 */
export function createRunResources({ configPath = null, configIsOurs = false, authFile = null } = {}) {
  let released = false;
  return {
    configPath,
    configIsOurs,
    authFile,
    /** Files a Start Over must leave alone while the owning job runs. */
    paths: () => (released ? [] : [configIsOurs ? configPath : null, authFile].filter(Boolean)),
    get released() {
      return released;
    },
    /** Remove what this run owns. Idempotent; returns true on the first call only. */
    release() {
      if (released) return false;
      released = true;
      if (configIsOurs && configPath) safeUnlink(configPath);
      if (authFile) safeUnlink(authFile);
      return true;
    }
  };
}
