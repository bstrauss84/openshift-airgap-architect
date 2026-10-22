/**
 * DOC-219 — generation with an imported out-of-family primary address.
 *
 * buildNmState deliberately writes a family the cluster does not enable as
 * `{ enabled: false }` (pinned by t7c4a-host-network-family-semantics). What it
 * must NOT do is let that discarded address leak somewhere else. It did:
 * rendezvousIP was always read from the IPv4 field, so in an IPv6-only cluster
 * an imported leftover IPv4 address — absent from every host's NMState — became
 * the address the agent ISO waits for. A clean IPv6-only cluster got the
 * generic fallback for the same reason.
 *
 * Also pinned: the import boundary preserves the out-of-family value (the
 * diagnostic lives in the wizard; the data is never silently coerced).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { buildAgentConfig } from "../src/generate.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const PATCH = { "4.20": "4.20.40", "4.21": "4.21.35", "4.22": "4.22.16" };
const V4 = { ipv4Cidr: "192.0.2.10/24", ipv4Gateway: "192.0.2.1" };
const V6 = { ipv6Cidr: "2001:db8::10/64", ipv6Gateway: "2001:db8::1" };

const master = (addresses) => ({
  role: "master",
  hostname: "master-0",
  primary: {
    type: "ethernet",
    mode: "static",
    ethernet: { name: "eno5", macAddress: "00:00:5E:00:53:05" },
    ipv4Cidr: "", ipv4Gateway: "", ipv6Cidr: "", ipv6Gateway: "",
    ...addresses
  }
});

const stateFor = (minor, ipStackMode, addresses) => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: minor, selectedPatch: PATCH[minor], selectedChannel: `stable-${minor}`, selectedVersion: PATCH[minor], locked: true },
  release: { channel: minor, patchVersion: PATCH[minor], confirmed: true },
  blueprint: { platform: "Bare Metal", arch: "x86_64", clusterName: "doc219", baseDomain: "example.com", confirmed: true },
  methodology: { method: "Agent-Based Installer" },
  hostInventory: { ipStackMode, nodes: [master(addresses)] },
});

const agent = (st) => yaml.load(buildAgentConfig(st));
const primaryIface = (out) => out.hosts[0].networkConfig.interfaces.find((i) => i.name === "eno5");

describe("DOC-219 rendezvousIP is taken from the family the cluster enables", () => {
  for (const minor of SUPPORTED_MINORS) {
    describe(minor, () => {
      it("IPv6-only + leftover IPv4: the discarded IPv4 appears nowhere, rendezvous is the IPv6 address", () => {
        const text = buildAgentConfig(stateFor(minor, "ipv6", { ...V4, ...V6 }));
        const out = yaml.load(text);
        assert.equal(out.rendezvousIP, "2001:db8::10");
        assert.deepEqual(primaryIface(out).ipv4, { enabled: false });
        assert.ok(!text.includes("192.0.2.10"), "the discarded IPv4 address leaked into agent-config.yaml");
        assert.ok(!text.includes("192.0.2.1\n") && !text.includes("192.0.2.1'"), "the discarded IPv4 gateway leaked");
      });

      it("IPv6-only, clean: rendezvous is the IPv6 address, not the generic fallback", () => {
        assert.equal(agent(stateFor(minor, "ipv6", V6)).rendezvousIP, "2001:db8::10");
      });

      it("IPv4-only + leftover IPv6: rendezvous stays IPv4 and the IPv6 address is not emitted", () => {
        const text = buildAgentConfig(stateFor(minor, "ipv4", { ...V4, ...V6 }));
        assert.equal(yaml.load(text).rendezvousIP, "192.0.2.10");
        assert.ok(!text.includes("2001:db8::10"), "the discarded IPv6 address leaked");
      });

      it("dual-stack: unchanged — both families emitted, rendezvous is IPv4", () => {
        const out = agent(stateFor(minor, "dual-stack", { ...V4, ...V6 }));
        assert.equal(out.rendezvousIP, "192.0.2.10");
        assert.equal(primaryIface(out).ipv4.enabled, true);
        assert.equal(primaryIface(out).ipv6.enabled, true);
      });
    });
  }

  it("an unset stack mode keeps the historical IPv4 behaviour", () => {
    const st = stateFor("4.22", undefined, { ...V4, ...V6 });
    assert.equal(agent(st).rendezvousIP, "192.0.2.10");
  });

  it("generation never mutates the imported state", () => {
    const st = stateFor("4.22", "ipv6", { ...V4, ...V6 });
    const before = JSON.stringify(st);
    buildAgentConfig(st);
    assert.equal(JSON.stringify(st), before);
  });
});

describe("DOC-219 the import boundary preserves the out-of-family value", () => {
  let server, baseUrl;
  before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
  after(async () => { await closeTestServer(server); });

  it("POST /api/run/import keeps the leftover IPv4 address for the wizard to report", async () => {
    const res = await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, state: stateFor("4.22", "ipv6", { ...V4, ...V6 }) }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const stored = await (await fetch(`${baseUrl}/api/state`)).json();
    const primary = stored.hostInventory.nodes[0].primary;
    assert.equal(primary.ipv4Cidr, V4.ipv4Cidr);
    assert.equal(primary.ipv4Gateway, V4.ipv4Gateway);
    assert.equal(primary.ipv6Cidr, V6.ipv6Cidr);
  });
});
