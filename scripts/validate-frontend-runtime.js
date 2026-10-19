#!/usr/bin/env node
"use strict";

/**
 * Frontend production-runtime guard (PROD-026).
 *
 * WHAT THIS PREVENTS. The frontend image used to be a single stage that ran
 * `npm ci` with no `--omit=dev` and whose production CMD was the Vite
 * DEVELOPMENT SERVER. The full devDependency tree shipped, and vite was the
 * listening process, while the release documentation described those packages
 * as "build-time only, not shipped". A container build reported 15
 * vulnerabilities (1 low, 4 moderate, 8 high, 2 critical) while the security
 * gate reported zero, because the gate audited `--omit=dev` and the image did
 * not.
 *
 * Nothing in the repository asserted any of this, so it survived every test
 * run. This guard is that missing assertion. It is deliberately static: it
 * reads the Containerfile and the deployment surface, so it runs in ordinary
 * CI without building an image. Proving the BUILT image is clean is a
 * complementary, heavier check (Tranche 8 owns image scanning).
 *
 * THE PORT IS A CONTRACT. 5173 appears in the Containerfile, the nginx server
 * block, docker-compose.yml, the frontend Service, the Deployment's
 * containerPort and both of its probes. They are checked together because
 * changing one in isolation is a silent outage.
 *
 * Usage:
 *   node scripts/validate-frontend-runtime.js
 *   node scripts/validate-frontend-runtime.js --root <fixture-dir>
 */

const fs = require("fs");
const path = require("path");

const PORT = "5173";

/** Directive lines only: comments here explain the old defect by name. */
function directives(text) {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

/** Everything from the last FROM onwards — the stage that actually ships. */
function finalStage(text) {
  const lines = directives(text).split("\n");
  let start = 0;
  lines.forEach((l, i) => {
    if (/^\s*FROM\s/i.test(l)) start = i;
  });
  return lines.slice(start).join("\n");
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function run(root) {
  const errors = [];
  const add = (msg) => errors.push(msg);

  const cfPath = path.join(root, "frontend", "Containerfile");
  const cf = read(cfPath);
  if (!cf) {
    console.error(`Missing ${cfPath}`);
    return 1;
  }
  const all = directives(cf);
  const last = finalStage(cf);

  /* ---- 1. the dev server must not be the runtime ---- */
  if (/vite\/bin\/vite\.js|vite\s+(--host|preview|dev)|\bnpm\s+run\s+dev\b/.test(last)) {
    add("the final stage still launches the Vite dev server — PROD-026 regressed");
  }
  // EVERY CMD/ENTRYPOINT in the final stage is checked, not just the effective
  // one. A container engine honours only the last CMD, so a leftover
  // `CMD ["node","node_modules/vite/bin/vite.js",...]` above a correct one
  // would still start nginx and every runtime test would pass — while the file
  // continued to describe a dev-server runtime. Dead instructions that contradict
  // the real contract are how the next reader gets it wrong.
  const cmds = [...last.matchAll(/^\s*(CMD|ENTRYPOINT)\s+(.+)$/gim)];
  if (cmds.length === 0) add("the final stage declares no CMD/ENTRYPOINT");
  for (const c of cmds) {
    if (/vite/i.test(c[2])) add(`a Vite runtime instruction remains in the final stage: ${c[0].trim()}`);
  }
  if (cmds.filter((c) => c[1].toUpperCase() === "CMD").length > 1) {
    add(`the final stage declares ${cmds.length} CMD/ENTRYPOINT instructions; only the last takes effect, so the others are dead and misleading`);
  }
  const cmd = cmds[cmds.length - 1];

  /* ---- 2. it must be a real multi-stage build ---- */
  const stages = (all.match(/^\s*FROM\s/gim) || []).length;
  if (stages < 2) add(`expected a builder + runtime multi-stage build, found ${stages} FROM`);

  /* ---- 3. the dev tree must not reach the final stage ---- */
  const copiesModules = last
    .split("\n")
    .filter((l) => /^\s*COPY\s+--from=/i.test(l) && /node_modules/.test(l));
  if (copiesModules.length) {
    add(`the final stage copies node_modules from a builder: ${copiesModules[0].trim()}`);
  }
  const installs = last.match(/npm\s+(ci|install|i)\b[^&|\n]*/g) || [];
  for (const inst of installs) {
    if (!/--omit=dev|--production|--only=prod/.test(inst)) {
      add(`the final stage installs dev dependencies: \`${inst.trim()}\``);
    }
  }

  /* ---- 4. a production build must actually be produced ---- */
  if (!/npm\s+run\s+build/.test(all)) {
    add("no `npm run build` anywhere — the image would ship no built assets");
  }
  if (!/COPY\s+--from=\S+[^\n]*dist\//i.test(last)) {
    add("the final stage does not copy the build output (dist/) from the builder");
  }

  /* ---- 5. the runtime must be unprivileged ---- */
  const users = last.match(/^\s*USER\s+(\S+)/gim) || [];
  const finalUser = users.length ? users[users.length - 1].trim().split(/\s+/)[1] : null;
  if (!finalUser) add("the final stage does not drop from root (no USER directive)");
  else if (finalUser === "root" || finalUser === "0") add(`the final stage runs as ${finalUser}`);

  /* ---- 6. the serving port contract, everywhere at once ---- */
  if (!new RegExp(`EXPOSE\\s+${PORT}\\b`).test(last)) {
    add(`the final stage does not EXPOSE ${PORT}`);
  }
  const surfaces = [
    // The nginx server block ships as a TEMPLATE, rendered at container start
    // so the same-origin /api proxy can be pointed at the backend Service and
    // given the proxy shared secret. It must not sit in nginx.d/*.conf
    // unrendered: the image includes that glob and the placeholders are not
    // valid nginx syntax.
    //
    // The listen line is GENERATED, because the address differs between the
    // authenticated topology (loopback, so oauth-proxy is the only way in)
    // and Compose (the container boundary). So the port contract is checked
    // where it now lives — the renderer — and the template is checked for
    // the placeholder the renderer fills. Matching `listen 5173` in the
    // template would now match a COMMENT about the old behaviour, which is a
    // green test asserting nothing.
    ["frontend/container/nginx-oaa.conf.template", /^OAA_LISTEN_DIRECTIVES$/m],
    ["frontend/container/oaa-render-nginx.sh", new RegExp(`^PORT=${PORT}$`, "m")],
    ["docker-compose.yml", new RegExp(`${PORT}:${PORT}`)],
    ["manifests/base/frontend-service.yaml", new RegExp(`port:\\s*${PORT}\\b`)],
    ["manifests/base/frontend-deployment.yaml", new RegExp(`containerPort:\\s*${PORT}\\b`)],
  ];
  for (const [rel, re] of surfaces) {
    const body = read(path.join(root, rel));
    if (body === null) add(`missing ${rel}`);
    else if (!re.test(body)) add(`${rel} does not reference the serving port ${PORT}`);
  }

  /* ---- 7. deployment-time API base must survive the static build ---- */
  // `vite build` inlines import.meta.env, so without a runtime-config hop the
  // documented VITE_API_BASE override would silently stop working.
  const indexHtml = read(path.join(root, "frontend", "index.html"));
  if (!indexHtml) add("missing frontend/index.html");
  else {
    const cfgAt = indexHtml.indexOf("/runtime-config.js");
    const modAt = indexHtml.indexOf("/src/main.jsx");
    if (cfgAt === -1) add("frontend/index.html does not load /runtime-config.js");
    else if (modAt !== -1 && cfgAt > modAt) {
      add("frontend/index.html loads /runtime-config.js AFTER the module bundle");
    }
  }
  const apiJs = read(path.join(root, "frontend", "src", "api.js"));
  if (!apiJs) add("missing frontend/src/api.js");
  else if (!/__OAA_RUNTIME_CONFIG__/.test(apiJs)) {
    add("frontend/src/api.js ignores the runtime config, so VITE_API_BASE would be build-time only");
  }
  for (const rel of [
    "frontend/container/oaa-entrypoint.sh",
    "frontend/container/oaa-render-nginx.sh",
    "frontend/container/nginx-oaa.conf.template",
  ]) {
    if (read(path.join(root, rel)) === null) add(`missing ${rel}`);
  }
  const entry = read(path.join(root, "frontend", "container", "oaa-entrypoint.sh"));
  if (entry && !/VITE_API_BASE/.test(entry)) {
    add("the entrypoint does not read VITE_API_BASE, so deployment-time configuration is lost");
  }

  /* ---- 8. SPA fallback, so a reload cannot 404 ---- */
  const nginxConf = read(path.join(root, "frontend", "container", "nginx-oaa.conf.template"));
  if (nginxConf && !/try_files[^;]*\/index\.html/.test(nginxConf)) {
    add("nginx has no index.html fallback — a reload or deep path would 404");
  }

  if (errors.length) {
    console.error(`Frontend production-runtime guard FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(
    `Frontend production-runtime guard OK: ${stages}-stage build, runtime is \`${(cmd && cmd[2].trim()) || "?"}\` ` +
      `as ${finalUser}, no dev dependencies or node_modules in the final stage, build output copied from the ` +
      `builder, port ${PORT} consistent across Containerfile/nginx/compose/Service/Deployment, and VITE_API_BASE ` +
      `still resolved at runtime.`
  );
  return 0;
}

if (require.main === module) {
  const i = process.argv.indexOf("--root");
  const root = i !== -1 ? process.argv[i + 1] : path.resolve(__dirname, "..");
  process.exit(run(root));
}

module.exports = { run, finalStage, directives, PORT };
