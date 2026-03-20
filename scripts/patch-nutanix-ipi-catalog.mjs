#!/usr/bin/env node
/**
 * One-shot catalog cleanup for nutanix-ipi: remove arbiter, fix platform/replicas,
 * replace Agent doc citations with Nutanix install-config parameter doc.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "frontend/src/data/catalogs/nutanix-ipi.json");

const NUTANIX_PARAMS_URL =
  "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installing_on_nutanix/installation-config-parameters-nutanix";

const nutanixCite = (sectionHeading) => ({
  docId: "installation-config-parameters-nutanix",
  docTitle: "Installation configuration parameters for Nutanix",
  sectionHeading,
  url: NUTANIX_PARAMS_URL
});

const raw = fs.readFileSync(catalogPath, "utf8");
const j = JSON.parse(raw);

j.parameters = j.parameters.filter((p) => !String(p.path || "").startsWith("arbiter."));

for (const param of j.parameters) {
  if (!Array.isArray(param.citations)) continue;
  param.citations = param.citations.map((c) => {
    if (c.docId === "installation-config-parameters-agent") {
      const sh = String(c.sectionHeading || "");
      let heading = "Installation configuration parameters (Nutanix)";
      if (sh.includes("9.1.1") || sh.includes("Required")) heading = "Required install-config parameters";
      else if (sh.includes("9.1.2") || sh.includes("Network")) heading = "Network configuration parameters";
      else if (sh.includes("9.1.3") || sh.includes("Optional")) heading = "Optional install-config parameters";
      return nutanixCite(heading);
    }
    if (c.docId === "image-based-installation-sno") {
      return {
        docId: "installing-disconnected",
        docTitle: "Installing a cluster on disconnected infrastructure",
        sectionHeading: "Mirroring and image sources (shared)",
        url: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/index"
      };
    }
    return c;
  });
}

const byPath = new Map(j.parameters.map((p) => [p.path, p]));

const setAllowed = (pathKey, patch) => {
  const p = byPath.get(pathKey);
  if (p) Object.assign(p, patch);
};

setAllowed("compute[].platform", {
  allowed: ["nutanix", "{}"],
  description: "Cloud provider for worker machines on Nutanix IPI. Use nutanix (must match control plane platform)."
});
setAllowed("controlPlane[].platform", {
  allowed: ["nutanix", "{}"],
  description: "Cloud provider for control plane on Nutanix IPI. Use nutanix (must match compute platform)."
});
setAllowed("controlPlane[].replicas", {
  allowed: [3, 1],
  description:
    "Number of control plane machines for Nutanix IPI: 3 for standard or compact three-node (with compute.replicas 0), or 1 for single-node OpenShift (OpenShift 4.20 Nutanix install-config)."
});
setAllowed("compute[].replicas", {
  allowed: "non-negative integer; 0 for three-node compact when control plane replicas is 3",
  default: 3,
  description:
    "Worker machine count. Standard clusters use at least 3 workers; set 0 with control plane replicas 3 for a compact three-node cluster (OpenShift 4.20 Nutanix doc)."
});

const meta = byPath.get("metadata.name");
if (meta) {
  meta.default = "cluster name from Cluster Identity when not overridden";
  meta.description =
    "Cluster name (metadata.name). DNS records use <name>.<baseDomain>. Must match Cluster Identity in this app.";
}

fs.writeFileSync(catalogPath, `${JSON.stringify(j, null, 2)}\n`);

const paramsDir = path.join(root, "data/params/4.20");
fs.mkdirSync(paramsDir, { recursive: true });
fs.copyFileSync(catalogPath, path.join(paramsDir, "nutanix-ipi.json"));
console.log("Wrote", catalogPath);
console.log("Synced canonical", path.join(paramsDir, "nutanix-ipi.json"));
