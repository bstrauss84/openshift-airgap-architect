/**
 * AXIS: containers — structural certification of the shipping images.
 *
 * Proves properties of the images that will actually be delivered, by
 * inspecting and executing inside them rather than by reading the
 * Containerfile and believing it. The distinction matters: the frontend
 * Containerfile's own header documents a period when the file said one thing
 * and the built image did another (a dev server shipped as the production
 * process with its full devDependency tree resident), and only an assertion
 * against the built artifact would have caught it.
 *
 * PROVENANCE GATES EVERYTHING BELOW IT. Asserting against "the local image
 * with the right tag" proves nothing about the candidate: a stale image
 * satisfies every structural check while containing none of the source being
 * certified. So the complete shipping set must be present AND provably built
 * from this candidate before a single assertion is evaluated. Until the
 * Containerfiles carry provenance labels or a release build emits a manifest
 * (8D/8F), this axis is INCOMPLETE by design — see lib/provenance.mjs.
 *
 * Assertions are declarative so the evidence names each property and its
 * outcome individually, instead of collapsing to one boolean.
 */

import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { runInImage, REQUIRED_ROLES } from "../lib/images.mjs";
import { verifyShippingSet } from "../lib/provenance.mjs";

const ID = "containers";

/** `sh -c` probes returning exit 0 for the expected state. */
const PROBES = {
  frontend: [
    {
      name: "no Node.js runtime in the final image",
      // The PROD-026 contract: the runtime carries nginx and static assets only.
      argv: ["/bin/sh", "-c", "! command -v node && ! command -v npm"],
    },
    {
      name: "no node_modules tree in the final image",
      argv: ["/bin/sh", "-c", "! find / -xdev -maxdepth 6 -type d -name node_modules -print -quit | grep -q ."],
    },
    { name: "nginx is present", argv: ["/bin/sh", "-c", "command -v nginx"] },
    { name: "built assets are present", argv: ["/bin/sh", "-c", "test -f /opt/app-root/src/index.html"] },
    {
      name: "no source, test or dev artifacts shipped",
      argv: ["/bin/sh", "-c", "! find /opt/app-root/src -name '*.test.js' -o -name '*.spec.js' -o -name 'vite.config.js' | grep -q ."],
    },
  ],
  backend: [
    { name: "node runtime is present", argv: ["/bin/sh", "-c", "command -v node"] },
    { name: "oc is baked in", argv: ["/bin/sh", "-c", "test -x /usr/local/bin/oc"] },
    { name: "oc-mirror is baked in", argv: ["/bin/sh", "-c", "test -x /usr/local/bin/oc-mirror"] },
    { name: "tool provenance is recorded", argv: ["/bin/sh", "-c", "test -s /app/tools-provenance.env"] },
    {
      name: "canonical data is shipped (not the runtime volume)",
      argv: ["/bin/sh", "-c", "test -d /app/data/arch-support && test -d /app/data/params"],
    },
    {
      name: "devDependencies are absent from the shipped tree",
      argv: ["/bin/sh", "-c", "! test -d /app/node_modules/vitest && ! test -d /app/node_modules/supertest"],
    },
  ],
};

/** Privilege-drop helpers a shell script can hand off to. */
const DROP_TOOLS = "(runuser|gosu|su-exec|setpriv|chroot --userspec)";

/**
 * Strip shell comments so prose cannot satisfy a structural assertion.
 *
 * Tracks single and double quotes, because `#` inside a quoted string is data,
 * not a comment. Not a complete shell parser — it does not need to be. It
 * needs to be strictly better than matching raw text, and specifically it must
 * make the top-of-file comment "run as root only to fix DATA_DIR ownership;
 * then drop to UID 1001" — which contains no `exec` but did contain the
 * tool names an earlier revision matched on — incapable of proving anything.
 */
export function stripShellComments(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "\\") { i++; continue; }
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === "#" && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/**
 * Does this entrypoint provably hand the long-lived process to a non-root uid?
 *
 * Requires an `exec` into a privilege-drop helper in executable position. A
 * mention of `runuser` in a comment, in a string, or in a branch that is not
 * the process handoff does not satisfy it.
 */
export function provesPrivilegeDrop(entrypointText) {
  const code = stripShellComments(entrypointText);
  return new RegExp(String.raw`(^|[;&|]|\bthen\b|\belse\b|\bdo\b)\s*exec\s+${DROP_TOOLS}\b`, "m").test(code);
}

/** Config-level assertions evaluated from `image inspect`, plus the entrypoint text. */
function configAssertions(img, entrypointText, dropTargetUid) {
  const out = [];
  const env = Object.fromEntries(img.env.map((e) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; }));
  const configNonRoot = img.user !== "" && img.user !== "0" && img.user !== "root";

  if (img.role === "backend") {
    // The backend is root at config level BY DESIGN: backend/scripts/entrypoint.sh
    // runs as root only to chown DATA_DIR (a bind mount whose ownership the
    // image cannot predict) and then execs the app as a non-root user.
    // Asserting a non-root `User` here would report a documented, intentional
    // design as a release blocker. What is worth proving is that the drop is
    // real and that its target is genuinely not uid 0.
    const dropProven = provesPrivilegeDrop(entrypointText);
    out.push({
      name: "entrypoint execs the app through a privilege-drop helper",
      ok: configNonRoot || dropProven,
      observed: configNonRoot ? `User=${img.user} (never root)` : dropProven ? "exec into runuser/gosu/su-exec found in executable position" : "no privilege drop in executable position",
      posture: configNonRoot ? null : "image starts as root by design — PROD-029 / PROD-039 own restricted-SCC viability",
    });
    out.push({
      name: "privilege-drop target is not uid 0",
      ok: configNonRoot || (dropTargetUid !== null && dropTargetUid !== 0),
      observed: configNonRoot ? "n/a — never root" : dropTargetUid === null ? "drop target user does not exist in the image" : `uid=${dropTargetUid}`,
    });
  } else {
    out.push({ name: "does not run as root", ok: configNonRoot, observed: `User=${img.user || "(unset → root)"}` });
  }

  out.push({ name: "architecture recorded", ok: Boolean(img.architecture), observed: `${img.os}/${img.architecture}` });

  if (img.role === "backend") {
    out.push({ name: "NODE_ENV=production", ok: env.NODE_ENV === "production", observed: `NODE_ENV=${env.NODE_ENV}` });
    out.push({
      name: "canonical data dir declared",
      ok: env.OAA_CANONICAL_DATA_DIR === "/app/data",
      observed: `OAA_CANONICAL_DATA_DIR=${env.OAA_CANONICAL_DATA_DIR}`,
    });
    out.push({ name: "exposes 4000", ok: img.exposedPorts.some((p) => p.startsWith("4000")), observed: img.exposedPorts.join(",") });
  }
  if (img.role === "frontend") {
    out.push({ name: "exposes 5173", ok: img.exposedPorts.some((p) => p.startsWith("5173")), observed: img.exposedPorts.join(",") });
    out.push({
      name: "production process is not a dev server",
      ok: !/vite/i.test([...img.cmd, ...img.entrypoint].join(" ")),
      observed: `Cmd=${img.cmd.join(" ")}`,
    });
  }
  return out;
}

export default {
  id: ID,
  title: "Shipping container images: provenance, structure and runtime posture",
  required: true,
  inputs: ["backend/Containerfile", "frontend/Containerfile", "frontend/container", "backend/scripts", "docker-compose.yml"],
  reuse: REUSE.CONTEXT,

  contextKey({ shippingImages }) {
    // A locally rebuilt image changes the answer with the source unchanged.
    return {
      engine: shippingImages?.engineVersion ?? null,
      imageIds: (shippingImages?.images ?? []).map((i) => `${i.role}=${i.id ?? "absent"}`).sort(),
    };
  },

  async run({ store, shippingImages, candidate, buildManifest }) {
    const { engine, images } = shippingImages;

    if (!engine) {
      return incomplete(ID, "no container engine (podman/docker) available; shipping images could not be certified", {
        evidence: { reason: "no container engine" },
      });
    }

    // Complete set + candidate binding, before any assertion is evaluated.
    const set = verifyShippingSet(images, candidate, buildManifest, REQUIRED_ROLES);
    const provenanceArtifact = store.writeArtifact(ID, "provenance.json", set);
    if (!set.ok) {
      return incomplete(ID, set.reason, {
        evidence: { provenance: set, requiredRoles: REQUIRED_ROLES },
        artifacts: [provenanceArtifact],
      });
    }

    const report = [];
    for (const img of images) {
      // Read the entrypoint out of the image rather than off disk: the
      // question is what the delivered artifact does, not what the repository
      // says.
      const ep = runInImage(engine, img.id, [
        "/bin/sh",
        "-c",
        "cat /app/entrypoint.sh /opt/app-root/bin/oaa-entrypoint.sh 2>/dev/null || true",
      ]);
      // Resolve the drop target's uid inside the image, so "drops privilege"
      // is not satisfied by dropping to another root account.
      const uidProbe = runInImage(engine, img.id, ["/bin/sh", "-c", "id -u appuser 2>/dev/null || true"]);
      const dropTargetUid = /^\d+$/.test(uidProbe.stdout.trim()) ? Number(uidProbe.stdout.trim()) : null;

      const assertions = configAssertions(img, ep.stdout, dropTargetUid);
      for (const probe of PROBES[img.role] ?? []) {
        const res = runInImage(engine, img.id, probe.argv);
        assertions.push({
          name: probe.name,
          ok: res.status === 0,
          observed: res.status === 0 ? "as expected" : `exit ${res.status}: ${(res.stderr || res.stdout).trim().slice(0, 200)}`,
          executed: true,
        });
      }
      report.push({
        role: img.role,
        ref: img.ref,
        id: img.id,
        repoDigests: img.repoDigests,
        architecture: `${img.os}/${img.architecture}`,
        sizeBytes: img.size,
        created: img.created,
        provenance: set.perImage.find((p) => p.role === img.role),
        assertions,
      });
    }

    const artifacts = [provenanceArtifact, store.writeArtifact(ID, "image-certification.json", report)];
    const failures = report.flatMap((r) => r.assertions.filter((a) => !a.ok).map((a) => `${r.role}: ${a.name} (${a.observed})`));

    if (failures.length) {
      return fail(ID, `${failures.length} image assertion(s) failed — ${failures.slice(0, 3).join("; ")}`, {
        evidence: { report, failures },
        artifacts,
      });
    }

    const ids = report.map((r) => `${r.role}=${String(r.id).replace(/^sha256:/, "").slice(0, 12)}`).join(" ");
    const total = report.reduce((n, r) => n + r.assertions.length, 0);
    return pass(ID, `${total} assertions passed against ${report.length} candidate-bound images (${ids})`, {
      evidence: { report, provenance: set },
      artifacts,
    });
  },
};
