#!/usr/bin/env node
"use strict";

/**
 * Static guard: buildNmState in backend/src/generate.js must not emit camelCase keys
 * that conflict with NMState / catalog (data/params) kebab-case for agent-config.networkConfig.
 *
 * Regression guard for prefix-length, base-iface, link-aggregation, etc.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const genPath = path.join(repoRoot, "backend", "src", "generate.js");

function main() {
  const src = fs.readFileSync(genPath, "utf8");
  const start = src.indexOf("const buildNmState");
  if (start === -1) {
    console.error("Could not find buildNmState in generate.js");
    process.exit(1);
  }
  const endMarker = "\nconst getPrimaryInterfaceName";
  const end = src.indexOf(endMarker, start);
  const body = end === -1 ? src.slice(start) : src.slice(start, end);
  const errs = [];

  if (body.includes("prefixLength")) {
    errs.push("Forbidden: prefixLength in buildNmState (use prefix-length for NMState / catalog).");
  }
  if (body.includes("linkAggregation")) {
    errs.push("Forbidden: linkAggregation in buildNmState (use link-aggregation).");
  }
  if (/vlan:\s*\{\s*["']?baseIface\b/.test(body)) {
    errs.push("Forbidden: vlan.baseIface object key in buildNmState (use base-iface).");
  }

  if (errs.length) {
    errs.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log("NMState generator guard OK:", genPath);
  process.exit(0);
}

main();
