/**
 * Regression tests: VIP/DNS language correctness in Field Guides.
 *
 * DOC-148 (v2.1.2) INVERTED the earlier contract. These tests used to REQUIRE
 * at least one `ping` VIP check carrying a "# Expect: 0 received" comment.
 * That guidance was itself the defect: an unanswered ping cannot prove an
 * address is free (a host can filter ICMP and still hold it), and Red Hat's
 * requirement is that the network administrator RESERVES two unique virtual IP
 * addresses (OCP 4.22 "Installing on bare metal", "Reserving IP addresses for
 * nodes with the DHCP server"). No replacement network probe is offered.
 *
 * Prevents reintroduction of:
 * - any ping / "0 received" expected result offered as a pre-install VIP check
 * - "VIP reachability" language for pre-install VIP checks
 * and keeps the DNS rules: DNS checks use dig/getent/nslookup and query a
 * concrete apps name. Covers 4.20, 4.21 and 4.22, both as compartment data and
 * as the rendered Field Guide for each installation method.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compartments_v422 } from "../src/fieldGuide/v4.22/index.js";
import { compartments_v421 } from "../src/fieldGuide/v4.21/index.js";
import { compartments_v420 } from "../src/fieldGuide/v4.20/index.js";
import { buildFieldGuide } from "../src/fieldGuide/index.js";

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

const mentionsVip = (i) => /\bVIP\b|apiVip|ingressVip/i.test(i.text + " " + i.cmd);

describe("VIP/DNS language correctness", () => {
  for (const [label, compartments] of [["v4.20", compartments_v420], ["v4.21", compartments_v421], ["v4.22", compartments_v422]]) {
    describe(label, () => {
      it("no VIP item offers ping as proof, or an expected ping result (DOC-148)", () => {
        const bad = allItems(compartments).filter(
          (i) => mentionsVip(i) && (/\bping\s+-c|\barping\b/.test(i.cmd) || /0 received/i.test(i.text + " " + i.cmd))
        );
        assert.equal(bad.length, 0,
          "ping-as-proof VIP guidance found: " + bad.map((b) => `[${b.compartmentId}] ${b.text.slice(0, 80)}`).join("; "));
      });

      it("no VIP item uses 'reachability' language for a pre-install check", () => {
        const bad = allItems(compartments).filter(
          (i) => mentionsVip(i) && /vip reachability|reachable.*not responding/i.test(i.text)
        );
        assert.equal(bad.length, 0, bad.map((b) => `[${b.compartmentId}] ${b.text.slice(0, 80)}`).join("; "));
      });

      it("VIP reservation guidance points at the reservation record and says why a probe is not proof", () => {
        const reservation = allItems(compartments).filter((i) => /VIP (address )?reservation/i.test(i.text));
        assert.ok(reservation.length >= 2, "expected at least the global reservation and re-check items");
        for (const i of reservation) {
          assert.match(i.text, /IP address management records/, `[${i.compartmentId}] must point at the reservation record`);
          assert.match(i.text, /does not prove an address is free/, `[${i.compartmentId}] must say a probe is not proof`);
        }
      });

      it("DNS-only resolution checks use dig/getent, not ping", () => {
        const dnsItems = allItems(compartments).filter(
          i => /dns.*resolv|resolv.*dns|verify.*dns|re-verify.*dns/i.test(i.text) && i.cmd
        );
        const bad = dnsItems.filter(i => i.cmd.includes("ping "));
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

  it("the VIP guidance is identical across 4.20, 4.21 and 4.22 (no per-minor drift)", () => {
    const vipTexts = (cs) => allItems(cs).filter(mentionsVip).map((i) => `${i.compartmentId}|${i.text}|${i.cmd}`).sort();
    assert.deepEqual(vipTexts(compartments_v421), vipTexts(compartments_v420));
    assert.deepEqual(vipTexts(compartments_v422), vipTexts(compartments_v421));
  });
});

describe("DOC-148 rendered Field Guides carry no ping-as-proof, for every method", () => {
  const SCENARIOS = [
    ["Bare Metal", "Agent-Based Installer"],
    ["Bare Metal", "IPI"],
    ["Bare Metal", "UPI"],
    ["VMware vSphere", "IPI"],
    ["VMware vSphere", "UPI"],
    ["VMware vSphere", "Agent-Based Installer"],
    ["Nutanix", "IPI"],
    ["AWS GovCloud", "IPI"],
  ];
  const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };
  for (const minor of ["4.20", "4.21", "4.22"]) {
    for (const [platform, method] of SCENARIOS) {
      it(`${minor} ${platform} / ${method}`, () => {
        const md = buildFieldGuide({
          version: { selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, selectedVersion: PATCH[minor], locked: true },
          release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
          blueprint: { platform, clusterName: "doc148", baseDomain: "example.com", arch: "x86_64" },
          methodology: { method },
          hostInventory: { apiVip: "192.0.2.5", ingressVip: "192.0.2.6", nodes: [] },
        }, []);
        assert.doesNotMatch(md, /ping\s+-c\s*\d*\s+(192\.0\.2\.[56]|<api-vip>|<ingress-vip>)/, "a VIP ping survived in the rendered guide");
        assert.doesNotMatch(md, /0 received/);
        assert.match(md, /VIP address reservation/);
        assert.match(md, /does not prove an address is free/);
      });
    }
  }
});
