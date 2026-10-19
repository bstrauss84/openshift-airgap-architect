/**
 * Axis registry.
 *
 * Order is execution order and is deliberate: identity first, because every
 * downstream verdict is captioned with the identity it establishes; the cheap
 * static axes next; the ones that execute containers last, because they are
 * the slowest and an operator watching a run should see fast failures first.
 *
 * Adding an axis means adding it here. There is no filesystem auto-discovery,
 * because an axis that silently disappears when a file is renamed is the exact
 * failure this harness exists to prevent.
 *
 * REQUIRED means "a full release certification must include this". Every axis
 * is currently required; the flag exists so that a future genuinely-optional
 * axis cannot be added without someone deciding which it is. A run that omits
 * any required axis is PARTIAL and can never be GREEN.
 *
 * NON-WAIVABLE marks axes that project policy says must be CLOSED rather than
 * excepted. Putting that in the registry rather than in the waiver file means
 * relaxing it is a reviewed code change, not a JSON edit.
 */

import identity from "./identity.mjs";
import repoHygiene from "./repo-hygiene.mjs";
import docs from "./docs.mjs";
import dependencyAxes from "./dependencies.mjs";
import secrets from "./secrets.mjs";
import tests from "./tests.mjs";
import ciIntegrity from "./ci-integrity.mjs";
import containers from "./containers.mjs";
import imageVulnerabilities from "./image-vulnerabilities.mjs";
import componentInventory from "./sbom.mjs";
import lifecycle from "./lifecycle.mjs";
import compatibility from "./compatibility.mjs";
import connectivity from "./connectivity.mjs";
import artifacts from "./artifacts.mjs";

export const AXES = Object.freeze([
  identity,
  repoHygiene,
  docs,
  ...dependencyAxes,
  secrets,
  tests,
  ciIntegrity,
  containers,
  imageVulnerabilities,
  componentInventory,
  // Formerly the four `planned.mjs` placeholders. Each is now a real axis
  // with the same id, which is exactly the substitution planned.mjs
  // described: "the placeholder is replaced by a real axis module with the
  // same id, and nothing else in the harness changes."
  //
  // They execute after the container axes because lifecycle and connectivity
  // spawn backend suites and are among the slowest in the run.
  lifecycle,
  compatibility,
  connectivity,
  artifacts,
]);

export const AXIS_IDS = Object.freeze(AXES.map((a) => a.id));

/** Axes a full release certification must include. */
export const REQUIRED_AXIS_IDS = Object.freeze(AXES.filter((a) => a.required !== false).map((a) => a.id));

/** Axes project policy forbids waiving. */
export const NON_WAIVABLE_AXIS_IDS = Object.freeze(AXES.filter((a) => a.nonWaivable === true).map((a) => a.id));

export function axisById(id) {
  return AXES.find((a) => a.id === id) ?? null;
}

/** Axes that resolve, export or execute shipping images. */
export const CONTAINER_AXES = Object.freeze(["containers", "image-vulnerabilities", "component-inventory"]);
