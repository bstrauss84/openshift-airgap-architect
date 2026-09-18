import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_CRDS_DIR = path.join(__dirname, "bundledCrds");

export function getBundledCrds() {
  const crds = [];
  for (const entry of fs.readdirSync(BUNDLED_CRDS_DIR)) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    const content = fs.readFileSync(path.join(BUNDLED_CRDS_DIR, entry), "utf8");
    crds.push(content);
  }
  return crds;
}
