/**
 * Regression tests: VIP/DNS language correctness in Field Guides.
 *
 * Prevents reintroduction of:
 * - "VIP reachability" language for pre-install ping probes (VIPs must be free, not reachable)
 * - ping commands without "0 received" / "must be free" expected-result guidance
 * - generic "reachable" label applied to pre-install VIP collision checks
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";

function allItems(compartments) {
  const items = [];
  for (const c of compartments) {
    if (c.items) {
      for (const item of c.items) {
        items.push({ compartmentId: c.id, version: c.version, text: item.text, cmd: item.cmd || "" });
      }
    }
  }
  return items;
}

function itemsWithPing(compartments) {
  return allItems(compartments).filter(i => i.cmd.includes("ping "));
}

describe("VIP/DNS language correctness", () => {
  for (const [label, compartments] of [["v4.20", compartments_v420], ["v4.21", compartments_v421]]) {
    describe(label, () => {
      it("no ping item uses 'VIP reachability' or 'Check VIP reachability' language", () => {
        const bad = itemsWithPing(compartments).filter(
          i => /vip reachability/i.test(i.text) || /check.*reachability/i.test(i.text)
        );
        assert.equal(bad.length, 0,
          "ping-based VIP checks must not use 'reachability' language — " +
          "pre-install VIPs are expected to NOT respond. Found: " +
          bad.map(b => `[${b.compartmentId}] ${b.text.slice(0, 80)}`).join("; "));
      });

      it("no ping item describes VIPs as 'reachable and not responding' (contradictory)", () => {
        const bad = itemsWithPing(compartments).filter(
          i => /reachable.*not responding/i.test(i.text)
        );
        assert.equal(bad.length, 0,
          "Contradictory 'reachable and not responding' language found: " +
          bad.map(b => `[${b.compartmentId}] ${b.text.slice(0, 80)}`).join("; "));
      });

      it("every ping item explains VIPs must be free/unclaimed or not responding", () => {
        const pings = itemsWithPing(compartments);
        assert.ok(pings.length > 0, "Expected at least one ping item");
        const bad = pings.filter(
          i => !/free|unclaimed|not.+respond|0 received/i.test(i.text + " " + i.cmd)
        );
        assert.equal(bad.length, 0,
          "Every ping item must explain that VIPs should be free/unclaimed/not-responding. Missing: " +
          bad.map(b => `[${b.compartmentId}] ${b.text.slice(0, 80)}`).join("; "));
      });

      it("every ping command includes expected-result comment with '0 received'", () => {
        const pings = itemsWithPing(compartments);
        const bad = pings.filter(i => !i.cmd.includes("0 received"));
        assert.equal(bad.length, 0,
          "Every ping command must include '0 received' expected-result guidance. Missing: " +
          bad.map(b => `[${b.compartmentId}] ${b.cmd.slice(0, 80)}`).join("; "));
      });

      it("DNS-only resolution checks use dig/getent, not ping", () => {
        const dnsItems = allItems(compartments).filter(
          i => /dns.*resolv|resolv.*dns|verify.*dns|re-verify.*dns/i.test(i.text) && i.cmd
        );
        const dnsOnlyItems = dnsItems.filter(
          i => !/vip.*availab|confirm.*vip|availability.*probe/i.test(i.text)
        );
        const bad = dnsOnlyItems.filter(i => i.cmd.includes("ping "));
        assert.equal(bad.length, 0,
          "DNS-only resolution checks must use dig/getent/nslookup, not ping. Found: " +
          bad.map(b => `[${b.compartmentId}] ${b.text.slice(0, 60)}`).join("; "));
      });

      it("wildcard apps DNS checks query a concrete name, not a literal wildcard", () => {
        const dnsItems = allItems(compartments).filter(
          i => i.cmd && i.cmd.includes("apps.") && (i.cmd.includes("dig ") || i.cmd.includes("getent "))
        );
        const bad = dnsItems.filter(i => /dig.*\*\.apps\.|getent.*\*\.apps\./i.test(i.cmd));
        assert.equal(bad.length, 0,
          "Wildcard apps DNS checks must query a concrete name (e.g. test.apps...) not a literal *. Found: " +
          bad.map(b => `[${b.compartmentId}] ${b.cmd.slice(0, 80)}`).join("; "));
      });
    });
  }
});
