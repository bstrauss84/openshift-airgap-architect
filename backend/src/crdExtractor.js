import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const OC_BIN = "/usr/local/bin/oc";

function scanForCrds(dir) {
  const crds = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      crds.push(...scanForCrds(fullPath));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".yaml" && ext !== ".yml" && ext !== ".json") continue;

    let content;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    if (ext === ".json") {
      // FBC JSON (JSONL): olm.bundle entries with base64-encoded CRDs
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.schema === "olm.bundle" && Array.isArray(obj.properties)) {
            for (const prop of obj.properties) {
              if (prop.type === "olm.bundle.object" && prop.value?.data) {
                const decoded = Buffer.from(prop.value.data, "base64").toString("utf8");
                if (decoded.includes("CustomResourceDefinition")) {
                  try {
                    const parsed = yaml.load(decoded);
                    if (parsed?.kind === "CustomResourceDefinition") {
                      crds.push(yaml.dump(parsed, { lineWidth: 120 }));
                    }
                  } catch { /* skip */ }
                }
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    } else {
      // YAML: split multi-doc and check each
      if (!content.includes("CustomResourceDefinition")) continue;
      for (const doc of content.split(/^---$/m)) {
        if (!doc.trim() || !doc.includes("CustomResourceDefinition")) continue;
        try {
          const parsed = yaml.load(doc);
          if (parsed?.kind === "CustomResourceDefinition") {
            crds.push(yaml.dump(parsed, { lineWidth: 120 }));
          }
        } catch { /* skip */ }
      }
    }
  }

  return crds;
}

export function extractCrdsFromCatalogImage(catalogImage, authFile, extractDir, { insecure = false } = {}) {
  const configsOut = path.join(extractDir, "catalog-configs");
  fs.mkdirSync(configsOut, { recursive: true });

  const args = [
    "image", "extract",
    catalogImage,
    `--path=/configs/:${configsOut}`,
    "--confirm",
  ];
  if (authFile) {
    args.push(`--registry-config=${authFile}`);
  }
  if (insecure) {
    args.push("--insecure");
  }

  execFileSync(OC_BIN, args, {
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });

  return scanForCrds(configsOut);
}
