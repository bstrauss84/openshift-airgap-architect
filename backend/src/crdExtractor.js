import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const OC_BIN = "/usr/local/bin/oc";

function parseJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = inString; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return objects;
}

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
      // FBC catalog.json: multiple top-level JSON objects (may be pretty-printed)
      for (const obj of parseJsonObjects(content)) {
        if (obj.schema !== "olm.bundle" || !Array.isArray(obj.properties)) continue;
        for (const prop of obj.properties) {
          if (prop.type !== "olm.bundle.object" || !prop.value?.data) continue;
          const decoded = Buffer.from(prop.value.data, "base64").toString("utf8");
          if (!decoded.includes("CustomResourceDefinition")) continue;
          try {
            const parsed = JSON.parse(decoded);
            if (parsed?.kind === "CustomResourceDefinition") {
              crds.push(yaml.dump(parsed, { lineWidth: 120 }));
            }
          } catch {
            try {
              const parsed = yaml.load(decoded);
              if (parsed?.kind === "CustomResourceDefinition") {
                crds.push(yaml.dump(parsed, { lineWidth: 120 }));
              }
            } catch { /* skip */ }
          }
        }
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
